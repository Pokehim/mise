// Brief → 3 Designs (spec §13): three agent loops in parallel, one per direction, each designing in
// its own in-memory Design through the tools, with the SDK's Tool Runner driving the loop.
//
// Built for speed and cost. Claude designs a whole room in one reply of decorating moves (moves.ts), so a
// Design usually takes one request instead of several. The reply streams, and each tool runs as soon
// as its call is complete, while Claude writes the next one; every Edit goes out to the Mover as it
// is made (onEvent). The request opens with what the three takes share (tools, system prompt, room
// context), which is written to the cache once, before the takes start, and read by each (warmCache).
import Anthropic from '@anthropic-ai/sdk';
import { DIRECTIONS, type Direction, type GenerateEvent, type GenerateResult, type LoopReport } from '../../shared/generate';
import { newId } from '../../shared/ids';
import { replay } from '../../shared/replay';
import type { Catalog, Design, RoomSetup } from '../../shared/types';
import { briefMessage, currentRoom, roomContext, SYSTEM_PROMPT } from './prompt';
import { roomSummary } from './roomSummary';
import { createSession, type DesignContext, type DesignSession } from './tools';

/** Claude Sonnet 5.5, the standard: half the price of Opus 5.5 per token, and a quarter of Opus in fast mode, for Designs about as good, if slower. */
const MODEL = 'claude-sonnet-5-5';
/** Fast mode, when the Mover picks it: Claude Opus 5.5, which has it, at about twice the speed of a Brief on Sonnet and 3 to 4 times its cost. */
const FAST_MODEL = 'claude-opus-5-5';
const FAST_MODE_BETA = 'fast-mode-2026-02-01';
/** How long one loop may take: past it, the Design keeps the Edits Claude made until then. */
export const LOOP_TIMEOUT_MS = 120_000;
/** The most requests one loop makes: one reply of moves, a turn of fixes, and room to spare. */
const MAX_REQUESTS = 6;
const NUDGE = 'Call finish_design now to finish this Design.';
/** The text a note stands in with for work a reply was cut off before finishing. */
const INTERRUPTED = 'This part of the response was interrupted before it finished.';
/** Claude's prompt cache keeps a prefix 5 minutes after its last use: one used more recently than this is still there. */
const CACHED_FOR_MS = 4 * 60_000;

let client: Anthropic | undefined;
/**
 * The Anthropic client, made on first use from the server's .env: ANTHROPIC_API_KEY, and
 * ANTHROPIC_WORKSPACE_ID for a key that isn't scoped to one workspace, which must name it on every request.
 */
export function anthropic() {
  const workspace = process.env.ANTHROPIC_WORKSPACE_ID;
  return (client ??= new Anthropic(workspace ? { defaultHeaders: { 'anthropic-workspace-id': workspace } } : {}));
}

export interface GenerateDesignsRequest extends Omit<DesignContext, 'edits' | 'startsFrom'> {
  client: Anthropic;
  scanId: string;
  /** The Mover's current Design, which every take starts from; without it, they start from the Scan as it is. */
  current?: Design;
  /** Saves a Design as soon as its loop finishes it. */
  save: (design: Design) => Promise<unknown>;
  /** Fast mode: quicker Designs from Claude Opus 5.5 at its fast speed, for several times the cost of the standard, Sonnet 5.5. */
  fast?: boolean;
  loopTimeoutMs?: number;
  /** Called with each step as it happens: each Edit, and each Design finished or failed. */
  onEvent?: (event: GenerateEvent) => void;
}

/** Turns a Brief into up to 3 Designs, one per direction. When a loop fails, the others are still returned (spec §13.1). */
export async function generateDesigns(request: GenerateDesignsRequest): Promise<GenerateResult> {
  const started = performance.now();
  const shared = sharedRequest(request);
  await inCache(request, shared);
  // The takes run side by side, and each needs a name of its own.
  const takenNames = new Set<string>();
  const current = request.current && currentRoom(request.setup, request.catalog, request.current);
  const runs = await Promise.all(DIRECTIONS.map((direction) => designLoop({ ...request, takenNames }, shared, direction, current)));
  return {
    designs: runs.flatMap(({ design }) => (design ? [design] : [])),
    failures: runs.flatMap(({ direction, error }) => (error ? [{ direction, error }] : [])),
    loops: runs.map(({ report }) => report),
    seconds: seconds(started),
  };
}

type WarmRequest = Pick<GenerateDesignsRequest, 'client' | 'setup' | 'catalog' | 'materials' | 'shelfLevels' | 'fast'>;

/** For each client, the shared prefixes it has had cached, by model, speed and room context: when each was last used, and the warm-up that wrote it. */
const cached = new WeakMap<Anthropic, Map<string, { usedAt: number; written: Promise<unknown> }>>();
const prefixesOf = (client: Anthropic) => cached.get(client) ?? cached.set(client, new Map()).get(client)!;
/** Each model, and each speed, caches a prefix of its own. */
const prefixKey = ({ model, speed, system }: SharedRequest) => `${model} ${speed ?? 'standard'}\n${system[1].text}`;

/**
 * Writes what every take of a Scan's Brief reads first (tools, system prompt, room context) to the
 * prompt cache, so that the Designs start sooner: a request with max_tokens 0 runs no generation. Send
 * it when the Mover starts writing a Brief.
 */
export async function warmCache(request: WarmRequest, shared = sharedRequest(request)) {
  // The conversation isn't cached: there is none.
  const { cache_control, ...prefix } = shared;
  const tools = createSession({ ...request, brief: { text: '' } }).tools.map(({ run, parse, ...definition }) => definition);
  // A warm-up is worth little late: it isn't retried.
  const written = request.client.withOptions({ maxRetries: 0 }).beta.messages.create({
    ...prefix,
    tools: tools as Anthropic.Beta.BetaToolUnion[],
    max_tokens: 0,
    messages: [{ role: 'user', content: 'warm up' }],
  });
  const [prefixes, key] = [prefixesOf(request.client), prefixKey(shared)];
  const entry = { usedAt: Date.now(), written };
  prefixes.set(key, entry);
  try {
    return (await written).usage;
  } catch (error) {
    if (prefixes.get(key) === entry) prefixes.delete(key);
    throw error;
  }
}

/**
 * Has the shared prefix in the cache before the takes start. They start together, so none would find
 * it there from another: unless a warm-up wrote it or a Brief read it a few minutes ago, it is written
 * once first, instead of by each take.
 */
async function inCache(request: WarmRequest, shared: SharedRequest) {
  const [prefixes, key] = [prefixesOf(request.client), prefixKey(shared)];
  const entry = prefixes.get(key);
  // Without it, the takes still run: each writes the prefix itself.
  await (entry && Date.now() - entry.usedAt < CACHED_FOR_MS ? entry.written : warmCache(request, shared)).catch(() => {});
  // The takes read it now, which keeps it cached as long again.
  const used = prefixes.get(key);
  if (used) used.usedAt = Date.now();
}

/** The parts of a request every take of a Brief shares, in the order the cache reads them. */
export function sharedRequest({ setup, catalog, fast = false }: { setup: RoomSetup; catalog: Catalog; fast?: boolean }) {
  const summary = roomSummary(setup, catalog, replay(setup, catalog, []));
  return {
    model: fast ? FAST_MODEL : MODEL,
    system: [
      { type: 'text' as const, text: SYSTEM_PROMPT },
      // The cache breakpoint: everything up to here is the same for the three takes, and for a warm-up.
      { type: 'text' as const, text: roomContext(summary, catalog), cache_control: { type: 'ephemeral' as const } },
    ],
    // Past it, each request caches the conversation so far, which the next one reads.
    cache_control: { type: 'ephemeral' as const },
    tool_choice: { type: 'auto' as const },
    // The notes Claude writes before its tool calls, its plan for the take, come back as thinking blocks: shown, its reasoning not.
    thinking: { type: 'adaptive' as const, display: 'updates' as const },
    output_config: { effort: 'low' as const },
    fallbacks: 'default' as const,
    betas: ['server-side-fallback-2026-07-01', 'thinking-display-updates-2026-08-18', ...(fast ? [FAST_MODE_BETA] : [])],
    ...(fast && { speed: 'fast' as const }),
  };
}

export type SharedRequest = ReturnType<typeof sharedRequest>;

/** Where a take's conversation stands: its messages so far, and how many Edits the Design had after the last reply's tools ran. */
interface Conversation { messages: Anthropic.Beta.BetaMessageParam[]; edits: number }

/** The same request at standard speed, on the same model: Claude reads back only its own model's thinking. */
export function standardSpeed({ speed, betas, ...params }: SharedRequest): SharedRequest {
  return { ...params, betas: betas.filter((beta) => beta !== FAST_MODE_BETA) };
}

/**
 * One agent loop: Claude designs in its own session until it calls finish_design, runs out of requests,
 * or of time. A loop cut short keeps the Edits it made: each passed the Fit rules when it was made.
 */
async function designLoop(
  request: GenerateDesignsRequest, shared: SharedRequest, direction: Direction, current?: string,
): Promise<{ direction: Direction; report: LoopReport; design?: Design; error?: string }> {
  const { client, brief, loopTimeoutMs = LOOP_TIMEOUT_MS, onEvent } = request;
  const started = performance.now();
  const report: LoopReport = {
    direction, seconds: 0, requests: 0, toolCalls: 0,
    usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  };
  const session = createSession({
    ...request,
    startsFrom: request.current?.edits,
    onEdit: (edit) => {
      report.firstEditSeconds ??= seconds(started);
      onEvent?.({ type: 'edit', direction, edit });
    },
  });
  const fail = (why: string) => {
    console.error(`Generate (${direction}) failed: ${why}`);
    finishReport(report, started, session);
    onEvent?.({ type: 'failure', direction, error: why, report });
    return { direction, error: why, report };
  };
  const timeout = AbortSignal.timeout(loopTimeoutMs);
  let stopped: Error | undefined;
  try {
    let messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: briefMessage(brief, direction, current) }];
    let params = shared;
    // Claude sometimes ends its turn without finish_design: it gets asked once more.
    for (let attempt = 0; attempt < 2 && !session.finished && report.requests < MAX_REQUESTS; attempt++) {
      // Asked once: a take that goes on at standard speed after a refusal has the question already.
      if (attempt && messages.at(-1)?.content !== NUDGE) messages = [...messages, { role: 'user', content: NUDGE }];
      const conversation: Conversation = { messages, edits: session.edits.length };
      try {
        messages = await run(client, params, session, conversation, report, {
          started, signal: timeout, onText: (text) => onEvent?.({ type: 'plan', direction, text }),
        });
      } catch (error) {
        // Fast mode has its own rate limit, and its requests aren't retried: refused, the take goes on at
        // standard speed from where it was, as long as the refused request made no Edits.
        const refused = error instanceof Anthropic.RateLimitError || error instanceof Anthropic.InternalServerError;
        if (!refused || params.speed !== 'fast' || session.edits.length !== conversation.edits) throw error;
        console.warn(`Generate (${direction}): fast mode refused (${error.message}), going on at standard speed`);
        params = standardSpeed(params);
        messages = [...conversation.messages];
        attempt--;
      }
    }
  } catch (error) {
    stopped = error as Error;
  }
  let finished: Pick<Design, 'name' | 'rationale' | 'palette'> | undefined = session.finished;
  if (!finished) {
    const why = timeout.aborted ? `The AI took longer than ${loopTimeoutMs / 1000} s` : stopped?.message ?? 'The AI stopped without finishing the Design';
    // The take's own Edits, after those of the Design it starts from.
    const made = session.edits.length - (request.current?.edits.length ?? 0);
    if (!made) return fail(why);
    console.warn(`Generate (${direction}): ${why}, so its Design keeps the ${made} Edits made until then`);
    const cause = timeout.aborted ? `Out of time after ${loopTimeoutMs / 1000} s` : stopped ? 'Cut short by an error' : 'Stopped before finishing';
    finished = unfinished(direction, made, cause);
  }
  try {
    const now = new Date().toISOString();
    const { name, rationale, palette } = finished;
    const design: Design = {
      version: 1, id: newId('ds'), scanId: request.scanId, name, createdAt: now, updatedAt: now,
      origin: 'claude', brief, rationale, palette, edits: session.edits,
      ...(request.current && { startedFrom: { designId: request.current.id, edits: request.current.edits.length } }),
    };
    await request.save(design);
    report.designId = design.id;
    finishReport(report, started, session);
    onEvent?.({ type: 'design', direction, design, report });
    return { direction, design, report };
  } catch (error) {
    return fail((error as Error).message);
  }
}

/** What a Design Claude didn't finish goes by: a name for its take, and a rationale that says how far it got. */
function unfinished(direction: Direction, edits: number, cause: string): Pick<Design, 'name' | 'rationale' | 'palette'> {
  return { name: `Unfinished ${direction} take`, rationale: `${cause}: these are the ${edits} Edit${edits === 1 ? '' : 's'} the AI made until then.` };
}

/**
 * Runs the Tool Runner from these messages until Claude stops calling tools or finishes the Design,
 * and returns the conversation so far. Replies stream, and each tool runs as soon as its call is complete.
 */
async function run(
  client: Anthropic, shared: SharedRequest, session: DesignSession, conversation: Conversation,
  report: LoopReport, { started, signal, onText }: { started: number; signal: AbortSignal; onText: (text: string) => void },
) {
  // A fast request isn't retried: refused, it goes on at standard speed at once (designLoop), which is.
  const runner = (shared.speed === 'fast' ? client.withOptions({ maxRetries: 0 }) : client).beta.messages.toolRunner({
    ...shared,
    max_tokens: 16000,
    max_iterations: MAX_REQUESTS - report.requests,
    messages: conversation.messages,
    tools: session.tools,
    stream: true,
    runToolsEagerly: true,
  }, { signal });
  // The runner adds each reply and its tool results to these before it sends the next request.
  conversation.messages = runner.params.messages;
  for await (const stream of runner) {
    report.requests++;
    let wrote = false;
    for await (const event of stream) {
      if (event.type === 'content_block_start') report.firstTokenSeconds ??= seconds(started);
      // What Claude writes before its tool calls is its plan for the take: its notes, each its own block, a line each.
      if (event.type === 'content_block_delta') {
        const text = event.delta.type === 'text_delta' ? event.delta.text : event.delta.type === 'thinking_delta' ? event.delta.thinking : '';
        if (text && text !== INTERRUPTED) onText(text);
        wrote ||= !!text;
      }
      if (event.type === 'content_block_stop' && wrote) {
        onText('\n');
        wrote = false;
      }
    }
    const reply = await stream.finalMessage();
    for (const key of Object.keys(report.usage) as (keyof LoopReport['usage'])[]) report.usage[key] += reply.usage[key] ?? 0;
    if (reply.stop_reason === 'refusal') throw new Error('The AI declined to design this room');
    // Any call that hasn't run yet runs now, so that a finished Design ends the loop without one more request.
    await runner.generateToolResponse();
    conversation.edits = session.edits.length;
    if (session.finished) break;
  }
  return runner.params.messages;
}

/** Fills in a loop's time and tool calls once it is over, and logs it. */
function finishReport(report: LoopReport, started: number, session: DesignSession) {
  report.seconds = seconds(started);
  report.toolCalls = session.toolCalls;
  console.log(`Generate (${report.direction}): ${report.seconds} s (first word ${report.firstTokenSeconds} s, first Edit `
    + `${report.firstEditSeconds} s), ${report.requests} requests, ${report.toolCalls} tool calls, ${report.usage.input_tokens} in `
    + `(+${report.usage.cache_read_input_tokens} cached, ${report.usage.cache_creation_input_tokens} written) / ${report.usage.output_tokens} out tokens`);
}

const seconds = (since: number) => Math.round((performance.now() - since) / 100) / 10;
