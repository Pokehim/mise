// Brief → 3 Designs (spec §13): three agent loops in parallel, one per direction, each designing in
// its own in-memory Design through the tools, with the SDK's Tool Runner driving the loop.
//
// Built for speed. Claude designs a whole room in one reply of decorating moves (moves.ts), so a
// Design usually takes one request instead of several. The reply streams, and each tool runs as soon
// as its call is complete, while Claude writes the next one; every Edit goes out to the Mover as it
// is made (onEvent). The request opens with what the three takes share (tools, system prompt, room
// context), which is cached, and can be written to the cache before the Brief arrives (warmCache).
import Anthropic from '@anthropic-ai/sdk';
import { DIRECTIONS, type Direction, type GenerateEvent, type GenerateResult, type LoopReport } from '../../shared/generate';
import { newId } from '../../shared/ids';
import { replay } from '../../shared/replay';
import type { Catalog, Design, RoomSetup } from '../../shared/types';
import { briefMessage, roomContext, SYSTEM_PROMPT } from './prompt';
import { roomSummary } from './roomSummary';
import { createSession, type DesignContext, type DesignSession } from './tools';

const MODEL = 'claude-opus-5-5';
/** How long one loop may take before it fails (spec §13.3). */
const LOOP_TIMEOUT_MS = 45_000;
/** The most requests one loop makes: one reply of moves, a turn of fixes, and room to spare. */
const MAX_REQUESTS = 6;
const NUDGE = 'Call finish_design now to finish this Design.';
const FAST_MODE_BETA = 'fast-mode-2026-02-01';

let client: Anthropic | undefined;
/**
 * The Anthropic client, made on first use from the server's .env: ANTHROPIC_API_KEY, and
 * ANTHROPIC_WORKSPACE_ID for a key that isn't scoped to one workspace, which must name it on every request.
 */
export function anthropic() {
  const workspace = process.env.ANTHROPIC_WORKSPACE_ID;
  return (client ??= new Anthropic(workspace ? { defaultHeaders: { 'anthropic-workspace-id': workspace } } : {}));
}

export interface GenerateDesignsRequest extends DesignContext {
  client: Anthropic;
  scanId: string;
  /** Saves a Design as soon as its loop finishes it. */
  save: (design: Design) => Promise<unknown>;
  /** Fast mode (spec §13.3): faster output at twice the price. */
  fast?: boolean;
  loopTimeoutMs?: number;
  /** Called with each step as it happens: each Edit, and each Design finished or failed. */
  onEvent?: (event: GenerateEvent) => void;
}

/** Turns a Brief into up to 3 Designs, one per direction. When a loop fails, the others are still returned (spec §13.1). */
export async function generateDesigns(request: GenerateDesignsRequest): Promise<GenerateResult> {
  const started = performance.now();
  const shared = sharedRequest(request);
  // The takes run side by side, and each needs a name of its own.
  const takenNames = new Set<string>();
  const runs = await Promise.all(DIRECTIONS.map((direction) => designLoop({ ...request, takenNames }, shared, direction)));
  return {
    designs: runs.flatMap(({ design }) => (design ? [design] : [])),
    failures: runs.flatMap(({ direction, error }) => (error ? [{ direction, error }] : [])),
    loops: runs.map(({ report }) => report),
    seconds: seconds(started),
  };
}

/**
 * Writes what every take of a Scan's Brief reads first (tools, system prompt, room context) to the
 * prompt cache, so that the Designs start sooner: a request with max_tokens 0 runs no generation. Send
 * it when the Mover starts writing a Brief.
 */
export async function warmCache(request: Pick<GenerateDesignsRequest, 'client' | 'setup' | 'catalog' | 'materials' | 'shelfLevels' | 'fast'>) {
  const shared = sharedRequest(request);
  const tools = createSession({ ...request, brief: { text: '' } }).tools.map(({ run, parse, ...definition }) => definition);
  const response = await request.client.beta.messages.create({
    ...shared,
    tools: tools as Anthropic.Beta.BetaToolUnion[],
    max_tokens: 0,
    messages: [{ role: 'user', content: 'warm up' }],
  });
  return response.usage;
}

/** The parts of a request every take of a Brief shares, in the order the cache reads them. */
function sharedRequest({ setup, catalog, fast = false }: { setup: RoomSetup; catalog: Catalog; fast?: boolean }) {
  const summary = roomSummary(setup, catalog, replay(setup, catalog, []));
  return {
    model: MODEL,
    system: [
      { type: 'text' as const, text: SYSTEM_PROMPT },
      // The cache breakpoint: everything up to here is the same for the three takes, and for a warm-up.
      { type: 'text' as const, text: roomContext(summary, catalog), cache_control: { type: 'ephemeral' as const } },
    ],
    tool_choice: { type: 'auto' as const },
    output_config: { effort: 'low' as const },
    fallbacks: 'default' as const,
    betas: ['server-side-fallback-2026-07-01', ...(fast ? [FAST_MODE_BETA] : [])],
    ...(fast && { speed: 'fast' as const }),
  };
}

type SharedRequest = ReturnType<typeof sharedRequest>;

/** The same request at standard speed. */
function standardSpeed({ speed, betas, ...params }: SharedRequest): SharedRequest {
  return { ...params, betas: betas.filter((beta) => beta !== FAST_MODE_BETA) };
}

/** One agent loop: Claude designs in its own session until it calls finish_design, runs out of requests, or of time. */
async function designLoop(request: GenerateDesignsRequest, shared: SharedRequest, direction: Direction) {
  const { client, brief, loopTimeoutMs = LOOP_TIMEOUT_MS, onEvent } = request;
  const started = performance.now();
  const report: LoopReport = {
    direction, seconds: 0, requests: 0, toolCalls: 0,
    usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  };
  const session = createSession({
    ...request,
    onEdit: (edit) => {
      report.firstEditSeconds ??= seconds(started);
      onEvent?.({ type: 'edit', direction, edit });
    },
  });
  const timeout = AbortSignal.timeout(loopTimeoutMs);
  try {
    let messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: briefMessage(brief, direction) }];
    let params = shared;
    // Claude sometimes ends its turn without finish_design: it gets asked once more.
    for (let attempt = 0; attempt < 2 && !session.finished && report.requests < MAX_REQUESTS; attempt++) {
      if (attempt) messages = [...messages, { role: 'user', content: NUDGE }];
      try {
        messages = await run(client, params, session, messages, report, { started, signal: timeout });
      } catch (error) {
        // Fast mode has its own rate limit: still refused after the SDK's retries, before the Design has begun, it goes on at standard speed.
        const refused = error instanceof Anthropic.RateLimitError || error instanceof Anthropic.InternalServerError;
        if (!refused || params.speed !== 'fast' || session.edits.length) throw error;
        console.warn(`Generate (${direction}): fast mode refused (${error.message}), going on at standard speed`);
        params = standardSpeed(params);
        attempt--;
      }
    }
    if (!session.finished) throw new Error('Claude stopped without finishing the Design');
    const now = new Date().toISOString();
    const { name, rationale, palette } = session.finished;
    const design: Design = {
      version: 1, id: newId('ds'), scanId: request.scanId, name, createdAt: now, updatedAt: now,
      origin: 'claude', brief, rationale, palette, edits: session.edits,
    };
    await request.save(design);
    report.designId = design.id;
    finishReport(report, started, session);
    onEvent?.({ type: 'design', direction, design, report });
    return { direction, design, report };
  } catch (error) {
    const why = timeout.aborted ? `Claude took longer than ${loopTimeoutMs / 1000} s` : (error as Error).message;
    console.error(`Generate (${direction}) failed: ${why}`);
    finishReport(report, started, session);
    onEvent?.({ type: 'failure', direction, error: why, report });
    return { direction, error: why, report };
  }
}

/**
 * Runs the Tool Runner from these messages until Claude stops calling tools or finishes the Design,
 * and returns the conversation so far. Replies stream, and each tool runs as soon as its call is complete.
 */
async function run(
  client: Anthropic, shared: SharedRequest, session: DesignSession, messages: Anthropic.Beta.BetaMessageParam[],
  report: LoopReport, { started, signal }: { started: number; signal: AbortSignal },
) {
  const runner = client.beta.messages.toolRunner({
    ...shared,
    max_tokens: 16000,
    max_iterations: MAX_REQUESTS - report.requests,
    messages,
    tools: session.tools,
    stream: true,
    runToolsEagerly: true,
  }, { signal });
  for await (const stream of runner) {
    report.requests++;
    for await (const event of stream) {
      if (event.type === 'content_block_start') report.firstTokenSeconds ??= seconds(started);
    }
    const reply = await stream.finalMessage();
    for (const key of Object.keys(report.usage) as (keyof LoopReport['usage'])[]) report.usage[key] += reply.usage[key] ?? 0;
    if (reply.stop_reason === 'refusal') throw new Error('Claude declined to design this room');
    // Any call that hasn't run yet runs now, so that a finished Design ends the loop without one more request.
    await runner.generateToolResponse();
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
