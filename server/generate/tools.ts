// The tools Claude designs with (spec §13.2). Each runs against one in-memory Design through the same
// shared modules the editor uses: replay, fit, catalog-search and anchors. A failure goes back to
// Claude as an is_error tool result that says why, listing any Fit violations.
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { BetaRunnableTool } from '@anthropic-ai/sdk/lib/tools/BetaRunnableTool';
import { ToolError } from '@anthropic-ai/sdk/lib/tools/ToolError';
import { z } from 'zod';
import {
  type Anchor, type AnchorOptions, CENTER_HEIGHT, GALLERY_GAP, inPlaceOf, MAX_SLIDE, placementViolations, type Resolution, resolveAnchor,
} from '../../shared/anchors';
import { search } from '../../shared/catalog-search';
import { roomItems } from '../../shared/fit';
import { newId } from '../../shared/ids';
import { partsFor } from '../../shared/parts';
import { replay } from '../../shared/replay';
import type { Brief, Catalog, CatalogItem, Category, Edit, FitViolation, Hex, LibraryMaterial, Palette, Placement, RoomSetup, RoomState } from '../../shared/types';
import { catalogEntry, m, offeredToClaude } from './forClaude';
import { reviewFlags } from './review';
import { type Draft, dressBed, hangGallery, layRug, makeCorner, styleTops } from './moves';

export interface DesignContext extends AnchorOptions {
  setup: RoomSetup;
  catalog: Catalog;
  brief: Brief;
  /** The Material Library that apply_finish picks materials from. */
  materials: LibraryMaterial[];
  /** The most tool calls Claude gets for this Design; finish_design always runs. */
  maxToolCalls?: number;
  /** The most large furniture changes this Design may make. */
  maxLargeChanges?: number;
  /** Called with each Edit as soon as it is applied, so the Mover can watch the Design take shape. */
  onEdit?: (edit: Edit) => void;
  /** The names the Brief's finished takes have taken, shared by its sessions, so that each take has a name of its own. */
  takenNames?: Set<string>;
}

/** One Design being made: its Edits, the room they make, and the tools that change it. */
export interface DesignSession {
  readonly edits: Edit[];
  readonly state: RoomState;
  /** What finish_design gave, once the Design is done. */
  readonly finished?: { name: string; rationale: string; palette: Palette };
  /** How many tool calls Claude has made. */
  readonly toolCalls: number;
  readonly tools: BetaRunnableTool[];
}

/** How many tool calls a Design gets: about 40 for 8 to 24 Edits, with searches and a few retries (spec §13.3, raised for decorating and remodels, as in #97). */
const MAX_TOOL_CALLS = 40;
/** How many Edits a Design has, at least and at most, not counting removals: a remodel clears what doesn't belong first. */
export const EDIT_RANGE: [min: number, max: number] = [8, 24];
/**
 * How many large furniture changes a Design may make: enough to furnish an empty room, or to remodel, as a
 * Brief that turns a lounge into a bedroom needs (from #97). Removing an Original doesn't count.
 */
export const MAX_LARGE_CHANGES = 8;
/** The most Pieces a Design may have (spec §2.3). */
const MAX_PIECES = 25;
/** Categories that are always large furniture. Shelves, tables, storage and chairs are when they are big. */
const LARGE: Category[] = ['bed', 'sofa', 'desk', 'dresser', 'wardrobe'];
const SIZEABLE: Category[] = ['shelf', 'table', 'storage', 'chair'];
const SIZEABLE_AREA = 0.6;
const SIZEABLE_HEIGHT = 1.2;
/** What counts as a large furniture change, for the system prompt: the rule `isLarge` and the replaced or moved Originals count by. */
export const LARGE_CHANGES = `placing a ${LARGE.join(', ')}, or a ${SIZEABLE.join(', ')} of ${SIZEABLE_AREA} m² or more or `
  + `${SIZEABLE_HEIGHT} m or taller; or replacing or moving one of the room's Originals (removing one doesn't count)`;
/**
 * The keys of a tool's input that name something in the room, which may be the Catalog id of a Piece placed earlier.
 * Not make_corner's chair_id: a Catalog id there is a chair to place.
 */
const ROOM_ID_KEYS = ['target_id', 'near_id', 'over_id', 'under_id', 'bed_id', 'on_id'];
/** How far a replacing Piece slides along its width to clear a Fit rule, each way, nearest first. */
const REPLACE_SLIDES = [0, 0.1, -0.1, 0.2, -0.2, 0.3, -0.3];

// Every category, for search_catalog: typing the keys as Record<Category, true> makes the compiler
// reject a list that misses one.
const CATEGORIES = Object.keys({
  chair: true, desk: true, table: true, nightstand: true, bed: true, sofa: true,
  dresser: true, wardrobe: true, shelf: true, storage: true,
  rug: true, lamp: true, wall_art: true, mirror: true, plant: true, decor: true,
} satisfies Record<Category, true>) as [Category, ...Category[]];

const isLarge = ({ category, size: [width, height, depth] }: CatalogItem) =>
  LARGE.includes(category) || (SIZEABLE.includes(category) && (width * depth >= SIZEABLE_AREA || height >= SIZEABLE_HEIGHT));

const along = z.union([z.enum(['left', 'center', 'right']), z.number()])
  .describe('Where along the wall, seen from inside the room facing it: "left", "center", "right", or a fraction from 0 (left end) to 1 (right end)');
const color = z.string().describe('A hex color, "#rrggbb"');

const anchorSchema = z.union([
  z.object({ kind: z.literal('against_wall'), wall_id: z.string(), along })
    .describe('Back flush to a wall, at that spot along it'),
  z.object({ kind: z.literal('beside'), target_id: z.string(), side: z.enum(['left', 'right', 'front']) })
    .describe("Next to an Original or Piece, backs in line; left and right as seen facing the target's front. 'front' faces it, like a chair at a desk"),
  z.object({ kind: z.literal('under_window'), opening_id: z.string() }).describe('Centered below a window'),
  z.object({ kind: z.literal('on_wall'), wall_id: z.string(), along, center_height_m: z.number().optional() })
    .describe(`Hung on a wall, its center ${CENTER_HEIGHT} m up unless center_height_m says otherwise`),
  z.object({
    kind: z.literal('on_wall_over'),
    target_id: z.string(),
    wall_id: z.string().optional().describe("The wall to hang it on; by default the one the target's back is to"),
    offset_m: z.number().optional().describe("How far right of the target's middle to center it, seen facing the wall; negative is left"),
    center_height_m: z.number().optional().describe(`By default ${CENTER_HEIGHT} m, or higher to clear the target`),
  }).describe('Hung on the wall centered over furniture standing against it, such as the first frame of a gallery wall over a bed'),
  z.object({
    kind: z.literal('on_wall_beside'),
    target_id: z.string().describe('A wall item already hung, such as the first frame of a gallery wall'),
    side: z.enum(['left', 'right']).describe('Seen facing the wall'),
    gap_m: z.number().optional().describe(`The gap between the two, ${GALLERY_GAP} m by default`),
    center_height_m: z.number().optional().describe("By default, the target's center height"),
  }).describe('Hung on the same wall beside another wall item, exactly the gap apart: the next frames of a gallery wall'),
  z.object({
    kind: z.literal('on_top_of'),
    target_id: z.string(),
    level: z.number().optional().describe('For a shelf: which of the shelf_levels place_piece gave, 0 at the bottom; without it, the top'),
  }).describe('Resting on a furniture top: decor and plants on desks, dressers, nightstands and shelves; pillows on a bed rest on its bedding'),
  z.object({ kind: z.literal('centered_under'), target_id: z.string() })
    .describe('A rug centered under a bed or sofa, about a third of it under'),
  z.object({ kind: z.literal('open_floor'), near_id: z.string().optional() })
    .describe('The largest free spot of floor, or the free spot nearest near_id'),
]);

const finishTarget = z.union([
  z.object({ kind: z.literal('wall'), wall_id: z.string() }),
  z.object({ kind: z.literal('floor') }),
  z.object({ kind: z.literal('original'), original_id: z.string(), part_id: z.string() }),
]);

/** A new Design session, with the 7 tools of spec §13.2 that change it. */
export function createSession({
  setup, catalog, brief, materials, shelfLevels = {}, maxToolCalls = MAX_TOOL_CALLS, maxLargeChanges = MAX_LARGE_CHANGES, onEdit, takenNames,
}: DesignContext): DesignSession {
  let edits: Edit[] = [];
  let state = replay(setup, catalog, edits);
  let finished: DesignSession['finished'];
  let toolCalls = 0;
  // finish_design sends Claude back at most once for what the Design lacks, and once for a name another take has.
  let sentBack = false;
  let renamed = false;

  const catalogItems = new Map(catalog.items.map((item) => [item.id, item]));
  const catalogItem = (id: string) => catalogItems.get(id);
  const pieces = () => Object.values(state.pieces).map((piece) => ({ ...piece, item: catalogItem(piece.catalogId)! }));
  const totalUsd = () => pieces().reduce((total, { item }) => total + item.priceEstimateUsd, 0);
  /** Each Original replaced, removed or moved (Kept ones can't be), and each large Piece placed new. */
  /** Each Original replaced or moved (Kept ones can't be), and each large Piece placed new. Removing an Original doesn't count. */
  const largeChanges = () => pieces().filter(({ replacesOriginalId }) => replacesOriginalId).length
    + Object.values(state.originals).filter(({ moved }) => moved).length
    + pieces().filter(({ item, replacesOriginalId }) => !replacesOriginalId && isLarge(item)).length;
  /** The Edits that count toward EDIT_RANGE: all but removals. */
  const counted = () => edits.filter(({ type }) => type !== 'remove').length;
  const original = (id: string) => setup.originals.find((candidate) => candidate.id === id);
  const inRoom = (id: string) => roomItems(setup, catalog, state).find((candidate) => candidate.id === id)
    ?? fail(`The room has no Original or Piece "${id}"`);
  const requireItem = (id: string) => catalogItem(id) ?? fail(`The Catalog has no item "${id}": use an id from search_catalog`);

  /** Appends an Edit by Claude and replays the Design, or fails with why replay would skip it. */
  function apply(fields: DistributiveOmit<Edit, 'id' | 'at' | 'by'>) {
    if (fields.type !== 'remove' && counted() >= EDIT_RANGE[1]) fail(`This Design has ${EDIT_RANGE[1]} Edits, the most it may have: call finish_design`);
    const edit = { ...fields, id: newId('ed'), at: new Date().toISOString(), by: 'claude' } as Edit;
    const next = replay(setup, catalog, [...edits, edit]);
    const skipped = next.skipped.find(({ editId }) => editId === edit.id);
    if (skipped) fail(SKIPPED[skipped.reason]);
    edits = [...edits, edit];
    state = next;
    onEdit?.(edit);
  }

  /** Places a Piece of `item` where the Anchor says, with every check: its id, or a ToolError saying why not. */
  function place(item: CatalogItem, anchor: Anchor): string {
    checkRoomFor(item, isLarge(item));
    const placement = resolved(resolveAnchor(setup, catalog, state, item, anchor, { shelfLevels }));
    const pieceId = newId('pc');
    apply({ type: 'place', pieceId, catalogId: item.id, placement });
    return pieceId;
  }
  const draft: Draft = { setup, item: catalogItem, inRoom, items: () => roomItems(setup, catalog, state), place };

  /** Fails unless the Design can take one more large furniture change. */
  function checkLargeChange() {
    if (largeChanges() >= maxLargeChanges) {
      fail(`This Design already has ${maxLargeChanges} large furniture changes, the most it may have: decorate instead`);
    }
  }
  /** Fails unless the Design can still add `item`: within the budget and the Piece count, and a large change if it is one. */
  function checkRoomFor(item: CatalogItem, large: boolean) {
    if (Object.keys(state.pieces).length >= MAX_PIECES) fail(`This Design has ${MAX_PIECES} Pieces, the most it may have`);
    if (large) checkLargeChange();
    const total = totalUsd() + item.priceEstimateUsd;
    if (brief.budgetUsd !== undefined && total >= brief.budgetUsd) {
      fail(`${item.title} (≈ $${item.priceEstimateUsd}) would take the estimated total to $${total}, and it must stay under the `
        + `$${brief.budgetUsd} budget: $${brief.budgetUsd - totalUsd()} is left`);
    }
  }
  const spent = () => ({
    total_usd: totalUsd(),
    ...(brief.budgetUsd !== undefined && { budget_left_usd: brief.budgetUsd - totalUsd() }),
  });

  /**
   * The id of something in the room that `id` names: itself, or for the Catalog id of a Piece placed
   * earlier, that Piece: the latest of them, or with "#2", the second placed. Claude places furniture and
   * decorates around it in one reply, before the Piece ids come back with the reply's results.
   */
  function roomId(id: string): string {
    if (state.originals[id] || state.pieces[id] || setup.openings.some((opening) => opening.id === id)) return id;
    const [, catalogId, nth] = /^(.+?)(?:#(\d+))?$/.exec(id)!;
    const placed = Object.entries(state.pieces).filter(([, piece]) => piece.catalogId === catalogId);
    return (nth ? placed[Number(nth) - 1] : placed.at(-1))?.[0] ?? id;
  }
  /** A tool's input with each id of something in the room as roomId reads it. */
  function withRoomIds<T>(input: T): T {
    if (Array.isArray(input)) return input.map(withRoomIds) as T;
    if (!input || typeof input !== 'object') return input;
    return Object.fromEntries(Object.entries(input).map(([key, value]) =>
      [key, ROOM_ID_KEYS.includes(key) && typeof value === 'string' ? roomId(value) : withRoomIds(value)])) as T;
  }

  /**
   * A tool of the session: counted, closed once the Design is finished, and strict unless `strict` is
   * false. betaZodTool checks every input against its schema either way.
   */
  function tool<Input extends z.ZodObject>(name: string, description: string, inputSchema: Input, run: (input: z.infer<Input>) => object, strict = true) {
    return {
      ...betaZodTool({
        name,
        description,
        inputSchema,
        run: (input) => {
          if (finished) fail('The Design is finished');
          if (name !== 'finish_design' && toolCalls >= maxToolCalls) fail('No tool calls are left: call finish_design now');
          toolCalls++;
          try {
            const result = run(withRoomIds(input));
            const { skipped } = result as { skipped?: unknown[] };
            if (skipped?.length) console.warn(`[generate] ${name} skipped ${JSON.stringify(skipped)}`);
            return JSON.stringify(result);
          } catch (error) {
            // Every failure goes back to Claude, and costs it a turn: worth seeing on the server too.
            console.warn(`[generate] ${name} failed: ${(error as Error).message}`);
            throw error;
          }
        },
      }),
      ...(strict && { strict: true }),
    };
  }

  const tools = [
    tool(
      'hang_gallery',
      `A gallery wall in one call: 1 to 4 frames or mirrors in a row over a bed, sofa or desk, the widest in the middle, `
        + `${GALLERY_GAP} m apart, centered over it at ${CENTER_HEIGHT} m or higher to clear it. If the wall can't take them, it tries `
        + 'another wall the target stands against. Reports what it hung, and what it skipped and why.',
      z.object({
        over_id: z.string().describe('The bed, sofa or desk to hang over'),
        wall_id: z.string().describe('The wall behind it, from decor.wall_spans'),
        catalog_ids: z.array(z.string()).describe('The frames, each a different Catalog item'),
      }),
      (input) => hangGallery(draft, input),
    ),
    tool(
      'lay_rug',
      'A rug under a bed or sofa, about a third of it under, or centered under a table so its chairs stand on it too; '
        + 'or on the open floor nearest it when it can\'t go under.',
      z.object({ catalog_id: z.string(), under_id: z.string() }),
      (input) => layRug(draft, input),
    ),
    tool(
      'make_corner',
      'A reading corner, or any spot to sit, in one call: the chair on the open floor nearest near_id (a window\'s Opening id, '
        + 'an Original or a Piece), the lamp beside it, and the side item on its other side. A table lamp goes on the side item '
        + 'when that is a table; a floor lamp stands beside the chair. The chair can be one already in the room: it stays where it is.',
      z.object({
        chair_id: z.string().describe('A Catalog chair, or the id of a chair already in the room'),
        lamp_id: z.string().describe('A lamp, or "" for none'),
        side_id: z.string().describe('A side table, plant or decor, or "" for none'),
        near_id: z.string().describe('A window\'s Opening id, or an Original or Piece'),
      }),
      (input) => makeCorner(draft, input),
    ),
    tool(
      'dress_bed',
      'Pillows and throws resting on a bed\'s bedding, against the headboard first.',
      z.object({ bed_id: z.string(), catalog_ids: z.array(z.string()) }),
      (input) => dressBed(draft, input),
    ),
    tool(
      'style_tops',
      'Decor, plants and table lamps resting on furniture tops from decor.tops: desks, dressers, nightstands and shelves.',
      z.object({ items: z.array(z.object({ catalog_id: z.string(), on_id: z.string() })) }),
      (input) => styleTops(draft, input),
    ),
    tool(
      'search_catalog',
      'Search the Catalog of real items. Returns items with their id, title, size [width, height, depth] in meters, colors, '
        + 'styles and estimated price. text must match words in the title; prefer category and color.',
      z.object({
        category: z.enum(CATEGORIES as [Category, ...Category[]]),
        text: z.string().optional(),
        color: z.string().optional().describe('A color name, such as "white" or "walnut"'),
        max_width_m: z.number().optional(),
        max_depth_m: z.number().optional(),
        max_price_usd: z.number().optional(),
        limit: z.number().optional().describe('At most this many items; 10 by default'),
      }),
      ({ category, text, color: colorName, max_width_m, max_depth_m, max_price_usd, limit = 10 }) => ({
        items: search(catalog, { category, text, color: colorName, maxSize: [max_width_m ?? Infinity, Infinity, max_depth_m ?? Infinity], limit: Infinity })
          .filter(({ item }) => offeredToClaude(item) && (max_price_usd === undefined || item.priceEstimateUsd <= max_price_usd))
          .slice(0, limit)
          .map(({ item }) => catalogEntry(item)),
      }),
    ),
    tool(
      'place_piece',
      `Add a Catalog item to the room as a Piece, where an Anchor says. If that spot breaks a Fit rule, the Piece slides up to ${MAX_SLIDE} m `
        + 'along the Anchor to the nearest spot that fits; otherwise it fails with the Fit violations. Wall art and mirrors take '
        + 'on_wall, on_wall_over or on_wall_beside; everything else stands on the floor or rests on_top_of furniture.',
      z.object({ catalog_id: z.string(), anchor: anchorSchema }),
      ({ catalog_id, anchor }) => {
        const item = requireItem(catalog_id);
        const pieceId = place(item, anchor);
        const { placement } = state.pieces[pieceId];
        const levels = shelfLevels[item.id]?.map(({ height, clearance }, level) => ({
          level, height_m: m(height), ...(Number.isFinite(clearance) && { room_above_m: m(clearance) }),
        }));
        return { piece_id: pieceId, placement: placementForClaude(setup, placement, item), ...(levels && { shelf_levels: levels }), ...spent() };
      },
      // Not strict: its Anchor union over the room's ids compiles to a grammar the API rejects as too
      // large ("The compiled grammar is too large", 400 on every request).
      false,
    ),
    tool(
      'replace_original',
      "Replace an Original that isn't Kept with a Catalog item, standing where the Original stood, its back where the Original's was.",
      z.object({ original_id: z.string(), catalog_id: z.string() }),
      ({ original_id, catalog_id }) => {
        const scanned = original(original_id) ?? fail(`The room has no Original "${original_id}"`);
        const { name } = inRoom(original_id);
        if (scanned.kept) fail(keptMessage(name));
        const item = requireItem(catalog_id);
        checkRoomFor(item, true);
        const pieceId = newId('pc');
        // Where the Mover's Replace would put it, then slid along its width, nearest first, to clear the Fit rules.
        const flush = inPlaceOf(setup.walls, state.originals[original_id].placement, scanned.box.size[2], item.size[2]);
        const [[x, y, z], [rx, rz]] = [flush.position, [Math.cos(flush.rotationY), -Math.sin(flush.rotationY)]];
        let first: FitViolation[] | undefined;
        for (const slide of REPLACE_SLIDES) {
          const placement: Placement = { ...flush, position: [x + rx * slide, y, z + rz * slide] };
          const edit = { type: 'replace', originalId: original_id, pieceId, catalogId: item.id, placement, via: 'replace' } as const;
          const next = replay(setup, catalog, [...edits, { ...edit, id: 'ed_try', at: '', by: 'claude' }]);
          const violations = placementViolations(setup, catalog, next, pieceId);
          if (!violations.length) {
            apply(edit);
            return { piece_id: pieceId, placement: placementForClaude(setup, placement, item), ...spent() };
          }
          first ??= violations;
        }
        return fail(withViolations(`${item.title} doesn't fit where ${name} stands`, first!));
      },
    ),
    tool(
      'recolor',
      'Recolor one Part of an Original or a Piece, or every Part with part_id "*". Kept Originals may be recolored. Parts: '
        + `${CATEGORIES.map((category) => `${category} ${partsFor(category).map(({ id }) => id).join(', ')}`).join('; ')}.`,
      z.object({ target_id: z.string(), part_id: z.string(), color }),
      ({ target_id, part_id, color: hex }) => {
        const target = inRoom(target_id);
        const parts = partsFor(target.category).map(({ id }) => id);
        if (part_id !== '*' && !parts.includes(part_id)) {
          fail(`${target.name} has no Part "${part_id}": its Parts are ${parts.join(', ')}, or "*" for all of them`);
        }
        apply({ type: 'recolor', targetId: target_id, partId: part_id, color: checkHex(hex) });
        return { ok: true };
      },
    ),
    tool(
      'apply_finish',
      'Give a wall or the floor a Finish: paint, or a material from the Material Library. Original Parts take materials too, such as '
        + `an oak desk top. Materials: ${materials.map(({ id, kind }) => `${id} (${kind})`).join(', ')}.`,
      z.object({
        target: finishTarget,
        finish: z.union([
          z.object({ kind: z.literal('paint'), color }),
          z.object({ kind: z.literal('material'), material_id: z.string() }),
        ]),
      }),
      ({ target, finish }) => {
        if (target.kind === 'wall' && !setup.walls.some(({ id }) => id === target.wall_id)) fail(`The room has no wall "${target.wall_id}"`);
        if (target.kind === 'original') inRoom(target.original_id);
        if (finish.kind === 'paint') {
          if (target.kind === 'floor') fail('Paint is for walls and furniture: give the floor a wood, stone, carpet or tile material');
          apply({ type: 'finish', target: finishTargetOf(target), finish: { kind: 'paint', color: checkHex(finish.color) } });
          return { ok: true };
        }
        const material = materials.find(({ id }) => id === finish.material_id)
          ?? fail(`The Material Library has no material "${finish.material_id}": it has ${materials.map(({ id }) => id).join(', ')}`);
        if (material.kind === 'wallpaper' && target.kind !== 'wall') fail(`${material.name} is wallpaper: it goes on walls`);
        apply({ type: 'finish', target: finishTargetOf(target), finish: { kind: 'material', materialId: material.id } });
        return { ok: true };
      },
    ),
    tool(
      'remove',
      "Remove Pieces, or Originals that aren't Kept: one or many in one call, as when a remodel clears the room. "
        + "Removals don't count toward the Edit or large-change limits.",
      z.object({ target_ids: z.array(z.string()) }),
      ({ target_ids }) => {
        const ids = [...new Set(target_ids)];
        // Check them all before removing any, so a bad id leaves the Design as it was.
        for (const id of ids) {
          const { name } = inRoom(id);
          if (original(id)?.kept) fail(keptMessage(name));
        }
        for (const id of ids) apply({ type: 'remove', targetId: id });
        return { ok: true, removed: ids.length, ...spent() };
      },
    ),
    tool(
      'finish_design',
      'End the Design: a name of 3 words or fewer, a one-line rationale that mentions the Brief, and its Palette.',
      z.object({
        name: z.string(),
        rationale: z.string(),
        palette: z.object({ wall: color, accents: z.array(color), materials: z.array(z.string()) }),
      }),
      ({ name, rationale, palette }) => {
        const words = name.trim().split(/\s+/).length;
        if (words > 3) fail(`The name "${name}" has ${words} words: use 3 or fewer`);
        // What the room lacks, and what the review flags, go back together: one more turn at most.
        const lacking = missing();
        const flags = reviewFlags(setup, catalog, state);
        if ((lacking.length || flags.length) && !sentBack && toolCalls < maxToolCalls) {
          sentBack = true;
          fail([
            ...(lacking.length ? [`Not finished: ${lacking.join('. ')}. Add them.`] : []),
            ...(flags.length ? [`Review: ${flags.join('. ')}. Fix each, or keep it on purpose.`] : []),
            'Then call finish_design again',
          ].join(' '));
        }
        const taken = [...(takenNames ?? [])].find((other) => other.toLowerCase() === name.trim().toLowerCase());
        if (taken && !renamed) {
          renamed = true;
          fail(`Another take on this Brief is called "${taken}": give this one a name of its own`);
        }
        finished = {
          name: name.trim(),
          rationale: rationale.trim().split('\n')[0],
          palette: { wall: checkHex(palette.wall), accents: palette.accents.map(checkHex), materials: palette.materials },
        };
        takenNames?.add(finished.name);
        return { ok: true };
      },
    ),
  ];

  /** What a decorated Design still lacks (spec §13.3, tuned for decorating). */
  function missing(): string[] {
    const placed = pieces();
    const has = (...categories: Category[]) => placed.filter(({ item }) => categories.includes(item.category));
    const needs = [
      has('wall_art', 'mirror').length < 2 && 'wall art (2 to 4 frames)',
      !has('rug').length && 'a rug',
      !has('lamp').length && 'a lamp',
      !has('decor', 'plant').some(({ placement }) => placement.mount === 'surface') && 'decor on the bed or a furniture top',
    ].filter((need): need is string => !!need);
    return [
      ...(counted() < EDIT_RANGE[0]
        ? [`this Design has ${counted()} Edit${counted() === 1 ? '' : 's'} besides removals, and needs ${EDIT_RANGE[0]} to ${EDIT_RANGE[1]}`] : []),
      ...(needs.length ? [`It still needs ${needs.join(', ')}`] : []),
    ];
  }

  return {
    get edits() { return edits; },
    get state() { return state; },
    get finished() { return finished; },
    get toolCalls() { return toolCalls; },
    tools,
  };
}

/** Ends the tool call with an is_error result that says why. */
function fail(message: string): never {
  throw new ToolError(message);
}

/** The Placement a resolved Anchor stands for, or a failure that lists the Fit violations. */
function resolved(resolution: Resolution): Placement {
  if ('error' in resolution) fail(withViolations(resolution.error, resolution.violations));
  return resolution.placement;
}

function withViolations(message: string, violations: FitViolation[]) {
  if (!violations.length) return message;
  return `${message}. Fit violations: ${violations.map(({ message: why, rule, otherId }) => `${why} (${rule}${otherId ? `, ${otherId}` : ''})`).join('; ')}`;
}

const keptMessage = (name: string) => `${name} is Kept: it stays in the room. You can recolor it, but not move, replace or remove it`;

/** Why replay skipped an Edit, as Claude reads it. */
const SKIPPED = {
  'missing-target': 'That is no longer in the room',
  kept: 'That is Kept: it stays in the room',
  'unknown-catalog': 'The Catalog has no such item',
  'unknown-part': 'It has no such Part',
  'duplicate-id': 'That id is taken',
};

function checkHex(hex: string): Hex {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) fail(`"${hex}" isn't a color: use "#rrggbb"`);
  return hex.toLowerCase() as Hex;
}

function finishTargetOf(target: z.infer<typeof finishTarget>) {
  switch (target.kind) {
    case 'wall':
      return { kind: 'wall', wallId: target.wall_id } as const;
    case 'floor':
      return { kind: 'floor' } as const;
    case 'original':
      return { kind: 'original', originalId: target.original_id, partId: target.part_id } as const;
  }
}

/** A Placement as Claude reads it back: where it went, in meters, and which wall it hangs on. */
function placementForClaude(setup: RoomSetup, { position, rotationY, mount, wallId }: Placement, item: CatalogItem) {
  return {
    mount,
    position_m: position.map(m),
    top_m: m(position[1] + item.size[1]),
    facing_deg: Math.round((rotationY * 180) / Math.PI),
    ...(wallId && { wall_id: wallId, wall: setup.walls.find(({ id }) => id === wallId)?.name }),
  };
}

/** Omit applied to each member of a union, so each member keeps its own fields. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
