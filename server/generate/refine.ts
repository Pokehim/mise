// Refine (spec §13.1, step 7): one agent loop that adjusts one existing Design to the Mover's words.
// Claude reads the Design as it stands and appends a few Edits through the same tools as Generate
// (tools.ts), from the same cached system prompt and room context, so a Refine starts warm.
import Anthropic from '@anthropic-ai/sdk';
import { roomItems } from '../../shared/fit';
import { budgetInText } from '../../shared/generate';
import { replay } from '../../shared/replay';
import type { Brief, Catalog, Design, Edit, RoomSetup, RoomState } from '../../shared/types';
import { sharedRequest } from './agent';
import { catalogEntry, m } from './forClaude';
import { roomSummary } from './roomSummary';
import { createSession, type DesignContext, type DesignSession } from './tools';

/** How many Edits a Refine makes, at least and at most, not counting removals ("make it cozier": 1 to 4). */
export const REFINE_EDITS: [min: number, max: number] = [1, 4];
/** Enough for a few searches, the Edits, and a fix or two. */
const MAX_TOOL_CALLS = 14;
const MAX_REQUESTS = 4;
/** The same limit as one Generate loop (spec §13.3). */
const TIMEOUT_MS = 45_000;
const NUDGE = 'Call finish_design now to finish this Refine.';

export interface RefineRequest extends Omit<DesignContext, 'brief' | 'edits' | 'editRange'> {
  client: Anthropic;
  design: Design;
  /** What the Mover asks for: "make it cozier". */
  text: string;
  fast?: boolean;
  timeoutMs?: number;
}

/** The Design with Claude's Edits appended, and just the new ones. */
export interface RefineResult { design: Design; edits: Edit[]; seconds: number }

/** Runs one Refine of a Design. It fails when Claude makes no Edit, or takes too long. */
export async function refineDesign(request: RefineRequest): Promise<RefineResult> {
  const { client, design, text, setup, catalog, fast = false, timeoutMs = TIMEOUT_MS } = request;
  const started = performance.now();
  // A budget the Mover's words name ("keep it under $300") is this Refine's; otherwise the Brief's stands.
  const budgetUsd = budgetInText(text) ?? design.brief?.budgetUsd;
  const brief: Brief = { ...(design.brief ?? { text }), ...(budgetUsd !== undefined && { budgetUsd }) };
  const session = createSession({
    ...request,
    brief,
    edits: design.edits,
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
        // Refused in fast mode before any Edit, it goes on at standard speed, as a Generate loop does.
        const refused = error instanceof Anthropic.RateLimitError || error instanceof Anthropic.InternalServerError;
        if (!refused || params.speed !== 'fast' || made()) throw error;
        console.warn(`Refine: fast mode refused (${error.message}), going on at standard speed`);
        params = sharedRequest({ setup, catalog });
        messages = before;
        attempt--;
      }
    }
  } catch (error) {
    if (!signal.aborted) throw error;
    // Out of time after some Edits: each passed every check when it was made, so they stand.
    if (!made()) throw new Error(`Claude took longer than ${timeoutMs / 1000} s`);
    console.warn(`Refine ${design.id}: out of time after ${made()} Edits, keeping them`);
  }

  const edits = session.edits.slice(design.edits.length);
  if (!edits.length) throw new Error('Claude made no changes');
  // Without finish_design, the Edits still count, and the Design keeps its name.
  const { name, rationale, palette } = session.finished ?? design;
  const refined: Design = { ...design, name, rationale, palette, edits: session.edits, updatedAt: new Date().toISOString() };
  const seconds = Math.round((performance.now() - started) / 100) / 10;
  console.log(`Refine ${design.id}: ${edits.length} Edits in ${seconds} s, ${session.toolCalls} tool calls`);
  return { design: refined, edits, seconds };
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
    if (reply.stop_reason === 'refusal') throw new Error('Claude declined this Refine');
    // Any call that hasn't run yet runs now, so that a finished Refine ends without one more request.
    await runner.generateToolResponse();
    if (session.finished) break;
  }
  return [...runner.params.messages];
}

/** The first message of a Refine: the Design as it stands, and what the Mover asks of it. */
export function refineMessage(setup: RoomSetup, catalog: Catalog, design: Design, brief: Brief, text: string, state: RoomState): string {
  const walls = new Map(setup.walls.map((wall) => [wall.id, wall.name]));
  const items = new Map(catalog.items.map((item) => [item.id, item]));
  const standing = new Map(roomItems(setup, catalog, state).map((item) => [item.id, item]));
  const pieces = Object.entries(state.pieces).flatMap(([id, { catalogId, placement, partColors, replacesOriginalId }]) => {
    const item = items.get(catalogId);
    if (!item) return [];
    const { id: catalog_id, ...entry } = catalogEntry(item);
    return [{
      id, catalog_id, ...entry,
      mount: placement.mount,
      ...(placement.wallId && { wall: walls.get(placement.wallId) }),
      position_m: placement.position.map(m),
      ...(replacesOriginalId && { replaces: replacesOriginalId }),
      ...(Object.keys(partColors).length && { part_colors: partColors }),
    }];
  });
  const originals = Object.entries(state.originals).flatMap(([id, { visible, moved, partColors, partFinishes }]) => {
    const changes = [
      !visible && (Object.values(state.pieces).some(({ replacesOriginalId }) => replacesOriginalId === id) ? 'replaced' : 'removed'),
      moved && standing.has(id) && 'moved',
      Object.keys(partColors).length && `recolored ${JSON.stringify(partColors)}`,
      Object.keys(partFinishes).length && `finished ${JSON.stringify(partFinishes)}`,
    ].filter(Boolean);
    return changes.length ? [{ id, changes }] : [];
  });
  const finishes = [
    ...Object.entries(state.surfaces.walls).map(([id, finish]) => ({ target: walls.get(id) ?? id, wall_id: id, finish })),
    ...(state.surfaces.floor ? [{ target: 'floor', finish: state.surfaces.floor }] : []),
  ];
  return [
    `This is a Refine of a Design that is already in the room, not a new Design.`,
    `The Design: "${design.name}", for the Brief "${brief.text}"${brief.styles?.length ? ` (${brief.styles.join(', ')})` : ''}.`,
    ...(design.rationale ? [`Its idea: ${design.rationale}`] : []),
    ...(design.palette ? [`Its Palette: ${JSON.stringify(design.palette)}`] : []),
    `Budget: ${brief.budgetUsd !== undefined ? `$${brief.budgetUsd} for all the Pieces, those already placed included` : 'none given'}`,
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
