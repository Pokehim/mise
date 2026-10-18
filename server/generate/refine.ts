// Refine (spec §13.1, step 7): one agent loop that adjusts one existing Design to the Mover's words.
// Claude reads the Design as it stands and appends a few Edits through the same tools as Generate
// (tools.ts), from the same cached system prompt and room context, so a Refine starts warm.
import Anthropic from '@anthropic-ai/sdk';
import { budgetInText } from '../../shared/generate';
import { replay } from '../../shared/replay';
import type { Brief, Catalog, Design, Edit, RoomSetup, RoomState } from '../../shared/types';
import { LOOP_TIMEOUT_MS, sharedRequest, standardSpeed } from './agent';
import { designInWords } from './forClaude';
import { roomSummary } from './roomSummary';
import { createSession, type DesignContext, type DesignSession } from './tools';

/** How many Edits a Refine makes, at least and at most, not counting removals ("make it cozier": 1 to 4). */
export const REFINE_EDITS: [min: number, max: number] = [1, 4];
/** Enough for a few searches, the Edits, and a fix or two. */
const MAX_TOOL_CALLS = 14;
const MAX_REQUESTS = 4;
const NUDGE = 'Call finish_design now to finish this Refine.';

export interface RefineRequest extends Omit<DesignContext, 'brief' | 'edits' | 'editRange'> {
  client: Anthropic;
  design: Design;
  /** What the Mover asks for: "make it cozier". */
  text: string;
  /** Fast mode, as for Generate: Claude Opus 5.5 at its fast speed. */
  fast?: boolean;
  timeoutMs?: number;
}

/** The Design with Claude's Edits appended, and just the new ones. */
export interface RefineResult { design: Design; edits: Edit[]; seconds: number }

/** Runs one Refine of a Design, in as long as a Generate loop may take. It fails when Claude makes no Edit in that time. */
export async function refineDesign(request: RefineRequest): Promise<RefineResult> {
  const { client, design, text, setup, catalog, fast = false, timeoutMs = LOOP_TIMEOUT_MS } = request;
  const started = performance.now();
  // The Edits of the Design a Generate began from: their Pieces are the room's, not this Design's.
  const startsFrom = design.startedFrom && design.edits.slice(0, design.startedFrom.edits);
  // A dollar amount in the Mover's words above what the Design's Pieces cost is a new budget ("keep it under $500"). One
  // below can't be, it's the price of what to add ("a lamp under $30"), which Claude reads in the words; the Brief's budget stands.
  const named = budgetInText(text);
  const budgetUsd = named !== undefined && named > piecesUsd(setup, catalog, design.edits, startsFrom) ? named : design.brief?.budgetUsd;
  const brief: Brief = { ...(design.brief ?? { text }), ...(budgetUsd !== undefined && { budgetUsd }) };
  const session = createSession({
    ...request,
    brief,
    edits: design.edits,
    startsFrom,
    editRange: REFINE_EDITS,
    maxToolCalls: MAX_TOOL_CALLS,
    // A Refine of 1 to 4 Edits can't remodel a room: the Design's own large changes don't hold it back.
    maxLargeChanges: Infinity,
  });
  const made = () => session.edits.length - design.edits.length;
  const signal = AbortSignal.timeout(timeoutMs);

  try {
    let params = sharedRequest({ setup, catalog, fast });
    let messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: refineMessage(setup, catalog, design, brief, text, session.state) }];
    // Claude sometimes ends its turn without finish_design: it gets asked once more.
    for (let attempt = 0; attempt < 2 && !session.finished; attempt++) {
      if (attempt) messages = [...messages, { role: 'user', content: NUDGE }];
      const before = messages;
      try {
        messages = await run(client, params, session, messages, signal);
      } catch (error) {
        // Refused in fast mode before any Edit, it goes on at standard speed on the same model, as a Generate loop does.
        const refused = error instanceof Anthropic.RateLimitError || error instanceof Anthropic.InternalServerError;
        if (!refused || params.speed !== 'fast' || made()) throw error;
        console.warn(`Refine: fast mode refused (${error.message}), going on at standard speed`);
        params = standardSpeed(params);
        messages = before;
        attempt--;
      }
    }
  } catch (error) {
    if (!signal.aborted) throw error;
    // Out of time after some Edits: each passed every check when it was made, so they stand.
    if (!made()) throw new Error(`The AI took longer than ${timeoutMs / 1000} s`);
    console.warn(`Refine ${design.id}: out of time after ${made()} Edits, keeping them`);
  }

  const edits = session.edits.slice(design.edits.length);
  if (!edits.length) throw new Error('The AI made no changes');
  // Without finish_design, the Edits still count, and the Design keeps its name.
  const { name, rationale, palette } = session.finished ?? design;
  const refined: Design = { ...design, name, rationale, palette, edits: session.edits, updatedAt: new Date().toISOString() };
  const seconds = Math.round((performance.now() - started) / 100) / 10;
  console.log(`Refine ${design.id}: ${edits.length} Edits in ${seconds} s, ${session.toolCalls} tool calls`);
  return { design: refined, edits, seconds };
}

/** What the Pieces of these Edits cost by the Catalog's estimates, but for those of the Edits they start from. */
function piecesUsd(setup: RoomSetup, catalog: Catalog, edits: Edit[], startsFrom: Edit[] = []): number {
  const theRooms = replay(setup, catalog, startsFrom).pieces;
  const prices = new Map(catalog.items.map(({ id, priceEstimateUsd }) => [id, priceEstimateUsd]));
  return Object.entries(replay(setup, catalog, edits).pieces)
    .filter(([id]) => !theRooms[id]).reduce((total, [, { catalogId }]) => total + (prices.get(catalogId) ?? 0), 0);
}

/** Runs the Tool Runner until Claude stops calling tools or finishes, and returns the conversation so far. */
async function run(
  client: Anthropic, params: ReturnType<typeof sharedRequest>, session: DesignSession,
  messages: Anthropic.Beta.BetaMessageParam[], signal: AbortSignal,
) {
  // A fast request isn't retried: refused, it goes on at standard speed at once (refineDesign), which is.
  const runner = (params.speed === 'fast' ? client.withOptions({ maxRetries: 0 }) : client).beta.messages.toolRunner({
    ...params,
    max_tokens: 16000,
    max_iterations: MAX_REQUESTS,
    messages,
    tools: session.tools,
  }, { signal });
  for await (const reply of runner) {
    if (reply.stop_reason === 'refusal') throw new Error('The AI declined this Refine');
    // Any call that hasn't run yet runs now, so that a finished Refine ends without one more request.
    await runner.generateToolResponse();
    if (session.finished) break;
  }
  return [...runner.params.messages];
}

/** The first message of a Refine: the Design as it stands, and what the Mover asks of it. */
export function refineMessage(setup: RoomSetup, catalog: Catalog, design: Design, brief: Brief, text: string, state: RoomState): string {
  const { pieces, finishes, originals } = designInWords(setup, catalog, state);
  return [
    `This is a Refine of a Design that is already in the room, not a new Design.`,
    `The Design: "${design.name}", for the Brief "${brief.text}"${brief.styles?.length ? ` (${brief.styles.join(', ')})` : ''}.`,
    ...(design.rationale ? [`Its idea: ${design.rationale}`] : []),
    ...(design.palette ? [`Its Palette: ${JSON.stringify(design.palette)}`] : []),
    `Budget: ${brief.budgetUsd !== undefined ? `$${brief.budgetUsd} for all the Pieces ${design.startedFrom ? 'this Design added to the room' : 'in it'}, those already placed included` : 'none given'}`,
    '',
    `The Mover asks: "${text}"`,
    '',
    `Change the Design as the Mover asks, and only that: ${REFINE_EDITS[0]} to ${REFINE_EDITS[1]} Edits, removals not counted. `
      + 'Keep its Palette, its focal point and what already works, unless the Mover asks otherwise; build on the Pieces it has. '
      + 'To swap a Piece, remove it and add the new one. The steps for a new Design don\'t apply here: begin with one short line '
      + 'saying what you will change, then make the calls in the same reply, then call finish_design with the Design\'s name '
      + `(keep "${design.name}" unless the change gives it a new idea), a one-line rationale that now covers this change too, `
      + 'and the Palette, updated if you changed it. Pieces already in the room go by their id.',
    '',
    `Its Pieces: ${JSON.stringify(pieces)}`,
    `Its Finishes: ${JSON.stringify(finishes)}`,
    `Originals it changed: ${JSON.stringify(originals)}`,
    '',
    'The room as the Design has it now (meters; along a wall is measured from its left end, seen from inside the room facing it):',
    JSON.stringify(roomSummary(setup, catalog, state)),
  ].join('\n');
}
