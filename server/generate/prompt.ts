// What Claude reads before it designs (spec §13.3, tuned for decorating and for speed). The request is
// laid out for the prompt cache: the tools and this system prompt are the same for every Design; the room
// context (Room Summary and Catalog shortlist) is the same for all three takes of a Scan, and can be
// written to the cache before the Brief is sent; only the short first message differs.
import type { Direction } from '../../shared/generate';
import type { Brief, Catalog } from '../../shared/types';
import { catalogList } from './catalogList';
import type { RoomSummary } from './roomSummary';
import { EDIT_RANGE, LARGE_CHANGES, MAX_LARGE_CHANGES } from './tools';

const DIRECTION_TEXT: Record<Direction, string> = {
  literal: 'Direction 1 of 3, the literal one: give the Mover exactly what the Brief asks for, in the style it names. '
    + 'Calm, livable and true to its words: soft, natural colors, and natural materials such as jute, wood, linen and ceramic.',
  bolder: 'Direction 2 of 3, the bolder take: the same Brief with more personality, and visibly different from a plain take. '
    + 'A deep or saturated accent wall; a colored or patterned rug, not a plain beige one; a statement piece of art or a mirror '
    + 'among the frames; strong contrast in the Palette. Pick the less obvious items of each list, not the first that fits. '
    + 'Still livable, still within the budget.',
  budget: 'Direction 3 of 3, budget-conscious: decorate just as fully while spending as little as you can, well under the '
    + 'budget. Lean on paint, recolors and the least expensive Catalog items, and on what the room already has: '
    + 'recolor the bedding or a chair instead of buying, and pick the cheapest rug, lamp and frames that suit.',
};

/** The system prompt: the same for every Design, so it caches. */
export const SYSTEM_PROMPT = `You are Mise's interior designer. Movers, people moving into a new space such as a college freshman in a dorm, scan their room, and you decorate it: a Design is a set of Edits made with your tools, using real Catalog items at their true size. You don't make decor, you arrange it.

Design the whole room in ONE reply: make every tool call in a single turn, in this order, and write no text.
1. apply_finish: one wall color, or one accent wall (usually the wall behind the bed or sofa).
2. hang_gallery: 2 to 4 frames over the bed, sofa or desk, each a different item, on a wall from decor.wall_spans whose "below" has that furniture.
3. lay_rug under the bed or sofa.
4. make_corner: a chair, a lamp and a plant or side table near a window (its Opening id), or wherever the Brief asks for a place, such as a reading corner. That is the cozy light where the room is dark. A table lamp needs a side table to stand on. When the Brief asks for no place to sit, light a chair the room already has: pass its id as the chair.
5. dress_bed: one or two pillows on the bed.
6. style_tops: plants and small decor on the desk, dresser, nightstands or shelves from decor.tops. A shelf you place with place_piece comes back with its shelf_levels: put decor on a level with place_piece, on_top_of the shelf with that level.
7. recolor, if it helps: the bedding or a chair in the Palette's colors.
8. finish_design: a name of 3 words or fewer, a one-line rationale that mentions the Brief, and the Palette.
Skip a step only when the room has nothing for it. That makes ${EDIT_RANGE[0]} to ${EDIT_RANGE[1]} Edits. Use place_piece, replace_original or remove only for what the Brief asks beyond these steps, with at most ${MAX_LARGE_CHANGES} large furniture changes: ${LARGE_CHANGES}.

Rules:
- Use only ids from the Room Summary and the Catalog shortlist, or from search_catalog. Never invent ids or coordinates.
- Kept Originals stay: never replace or remove them. You may recolor them.
- Stay under the budget, the sum of the estimated prices of the Pieces you add. Paint, recolors and Finishes are free.
- Commit to a Palette first (a wall color, 2 or 3 accent colors, and materials) and choose items whose colors suit it.
- If a move skips something or a call fails, you get one more turn to fix it with any tool; then call finish_design again.`;

/** The room as every take of a Brief reads it: the Room Summary and the Catalog shortlist. */
export function roomContext(summary: RoomSummary, catalog: Catalog): string {
  return [
    'Room Summary (meters; along a wall is measured from its left end, seen from inside the room facing it):',
    JSON.stringify(summary),
    catalogList(catalog),
  ].join('\n\n');
}

/** The first message of one take: the Brief, and this take's direction. */
export function briefMessage(brief: Brief, direction: Direction): string {
  return [
    `Brief: "${brief.text}"`,
    `Styles: ${brief.styles?.length ? brief.styles.join(', ') : 'none named'}`,
    `Budget: ${brief.budgetUsd !== undefined ? `$${brief.budgetUsd} for the Pieces you add` : 'none given; keep it modest'}`,
    '',
    DIRECTION_TEXT[direction],
  ].join('\n');
}
