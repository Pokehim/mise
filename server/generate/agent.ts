// Brief → 3 Designs (spec §13): three agent loops in parallel, one per direction, each designing in
// its own in-memory Design through the tools, with the SDK's Tool Runner driving the loop.
import Anthropic from '@anthropic-ai/sdk';
import { DIRECTIONS, type Direction, type GenerateResult, type LoopReport } from '../../shared/generate';
import { newId } from '../../shared/ids';
import { replay } from '../../shared/replay';
import type { Design } from '../../shared/types';
import { firstMessage, SYSTEM_PROMPT } from './prompt';
import { roomSummary } from './roomSummary';
import { createSession, type DesignContext, type DesignSession } from './tools';

const MODEL = 'claude-opus-5-5';
/** How long one loop may take before it fails: spec §13.3's 45 s, raised for review_design and its fixes, which take loops to 20–45 s. */
const LOOP_TIMEOUT_MS = 60_000;
/** The most requests one loop makes: a few turns of many tool calls each, a review and its fixes, and retries. */
const MAX_REQUESTS = 14;
const NUDGE = 'Call finish_design now to finish this Design.';

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
}

/** Turns a Brief into up to 3 Designs, one per direction. When a loop fails, the others are still returned (spec §13.1). */
export async function generateDesigns(request: GenerateDesignsRequest): Promise<GenerateResult> {
  const started = performance.now();
  const summary = roomSummary(request.setup, request.catalog, replay(request.setup, request.catalog, []));
  const runs = await Promise.all(DIRECTIONS.map((direction) => designLoop(request, direction, firstMessage(request.brief, summary, request.catalog, direction))));
  return {
    designs: runs.flatMap(({ design }) => (design ? [design] : [])),
    failures: runs.flatMap(({ direction, error }) => (error ? [{ direction, error }] : [])),
    loops: runs.map(({ report }) => report),
    seconds: seconds(started),
  };
}

/** One agent loop: Claude designs in its own session until it calls finish_design, runs out of requests, or of time. */
async function designLoop(request: GenerateDesignsRequest, direction: Direction, message: string) {
  const { client, brief, fast = false, loopTimeoutMs = LOOP_TIMEOUT_MS } = request;
  const started = performance.now();
  const session = createSession(request);
  const report: LoopReport = {
    direction, seconds: 0, requests: 0, toolCalls: 0,
    usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  };
  const timeout = AbortSignal.timeout(loopTimeoutMs);
  try {
    let messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: message }];
    // Claude sometimes ends its turn without finish_design: it gets asked once more.
    for (let attempt = 0; attempt < 2 && !session.finished && report.requests < MAX_REQUESTS; attempt++) {
      if (attempt) messages = [...messages, { role: 'user', content: NUDGE }];
      messages = await run(client, session, messages, report, { fast, signal: timeout });
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
    return { direction, design, report: finishReport(report, started, session) };
  } catch (error) {
    const why = timeout.aborted ? `Claude took longer than ${loopTimeoutMs / 1000} s` : (error as Error).message;
    console.error(`Generate (${direction}) failed: ${why}`);
    return { direction, error: why, report: finishReport(report, started, session) };
  }
}

/**
 * Runs the Tool Runner from these messages until Claude stops calling tools or finishes the Design,
 * and returns the conversation so far.
 */
async function run(
  client: Anthropic, session: DesignSession, messages: Anthropic.Beta.BetaMessageParam[], report: LoopReport,
  { fast, signal }: { fast: boolean; signal: AbortSignal },
) {
  const runner = client.beta.messages.toolRunner({
    model: MODEL,
    max_tokens: 16000,
    max_iterations: MAX_REQUESTS - report.requests,
    system: SYSTEM_PROMPT,
    messages,
    tools: session.tools,
    tool_choice: { type: 'auto' },
    output_config: { effort: 'low' },
    fallbacks: 'default',
    // Each request resends the conversation so far: caching it makes the next turn read it back cheaply.
    cache_control: { type: 'ephemeral' },
    betas: ['server-side-fallback-2026-07-01', ...(fast ? ['fast-mode-2026-02-01' as const] : [])],
    ...(fast && { speed: 'fast' as const }),
  }, { signal });
  for await (const reply of runner) {
    report.requests++;
    for (const key of Object.keys(report.usage) as (keyof LoopReport['usage'])[]) report.usage[key] += reply.usage[key] ?? 0;
    if (reply.stop_reason === 'refusal') throw new Error('Claude declined to design this room');
    // Running the tools here, not at the end of the turn, lets a finished Design end the loop
    // without one more request.
    await runner.generateToolResponse();
    if (session.finished) break;
  }
  return runner.params.messages;
}

function finishReport(report: LoopReport, started: number, session: DesignSession): LoopReport {
  report.seconds = seconds(started);
  report.toolCalls = session.toolCalls;
  console.log(`Generate (${report.direction}): ${report.seconds} s, ${report.requests} requests, ${report.toolCalls} tool calls, `
    + `${report.usage.input_tokens} in (+${report.usage.cache_read_input_tokens} cached) / ${report.usage.output_tokens} out tokens`);
  return report;
}

const seconds = (since: number) => Math.round((performance.now() - since) / 100) / 10;
