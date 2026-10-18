// Decorating moves: one tool call for each part of a decorated room. A gallery wall, a rug, a reading
// corner, the bed, and the furniture tops. Claude picks the items and what they go with; the move works
// out the spots with the same Anchors and Fit rules as place_piece. So a whole Design fits in one reply,
// with no round trip to learn a Piece's id before hanging the next frame beside it.
import { ToolError } from '@anthropic-ai/sdk/lib/tools/ToolError';
import { type Anchor, BY_WALL, GALLERY_GAP } from '../../shared/anchors';
import type { Item } from '../../shared/fit';
import { isBy } from '../../shared/geometry';
import type { CatalogItem, Category, RoomSetup } from '../../shared/types';
import { TOP_CATEGORIES } from './roomSummary';

/** What a move can do to the Design: read the room and the Catalog, and place Pieces as place_piece does. */
export interface Draft {
  setup: RoomSetup;
  /** The Catalog item with this id, if the Catalog has it. */
  item(catalogId: string): CatalogItem | undefined;
  /** An Original or a Piece in the room, or a ToolError. */
  inRoom(id: string): Item;
  /** Everything in the room: the visible Originals and the Pieces. */
  items(): Item[];
  /** Places a Piece where the Anchor says, with every check place_piece makes: its id, or a ToolError saying why not. */
  place(item: CatalogItem, anchor: Anchor): string;
}

/** What a move did: the Pieces it placed, and what it skipped and why. */
export interface MoveReport {
  placed: { catalog_id: string; piece_id: string; as: string }[];
  skipped: { catalog_id: string; why: string }[];
}

/** A lamp this tall, in meters, stands on the floor; a shorter one goes on a table. */
const FLOOR_LAMP = 1;
/** A plant or decor shorter than this goes on a furniture top, not on the floor. */
const FLOOR_DECOR = 0.6;
/** What a table lamp can stand on, beside a reading chair. */
const SIDE_TABLES: Category[] = ['table', 'nightstand', 'storage', 'shelf', 'dresser'];
/** What a table lamp can stand on anywhere in the room, when it has no side table: the tops decor rests on, but a bed. */
const LAMP_TOPS: Category[] = TOP_CATEGORIES.filter((category) => category !== 'bed');

/** Whether a lamp stands on the floor, rather than on a table. */
export const isFloorLamp = ({ size: [, height] }: CatalogItem) => height >= FLOOR_LAMP;

/** Collects a move's report, and fails the call only when the move placed nothing at all. */
function reporter(verb: string) {
  const report: MoveReport = { placed: [], skipped: [] };
  const placed = (catalogId: string, pieceId: string, as: string) => report.placed.push({ catalog_id: catalogId, piece_id: pieceId, as });
  const skip = (catalogId: string, why: string) => report.skipped.push({ catalog_id: catalogId, why });
  return {
    placed,
    skip,
    /** Places an item with `place` and reports it, or reports why it was skipped: its Piece id, if placed. */
    attempt: (catalogId: string, place: () => { pieceId: string; as: string }): string | undefined => {
      try {
        const { pieceId, as } = place();
        placed(catalogId, pieceId, as);
        return pieceId;
      } catch (error) {
        skip(catalogId, reason(error));
        return undefined;
      }
    },
    done: () => {
      if (!report.placed.length) throw new ToolError(`${verb} nothing: ${report.skipped.map(({ why }) => why).join('; ')}`);
      return report;
    },
  };
}

/** Why a call failed, as Claude reads it. */
const reason = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Looks up each Catalog id, in order, skipping the ones the Catalog lacks and the ones `reject` gives
 * a reason against.
 */
function lookUp(draft: Draft, catalogIds: string[], skip: (catalogId: string, why: string) => void, reject?: (item: CatalogItem) => string | undefined) {
  return catalogIds.flatMap((catalogId) => {
    const item = draft.item(catalogId);
    const why = item ? reject?.(item) : `The Catalog has no item "${catalogId}"`;
    if (why) skip(catalogId, why);
    return item && !why ? [item] : [];
  });
}

/**
 * Tries each Anchor in turn and places the item at the first that works. When none does, it throws why
 * the first, the spot asked for, failed: its Fit violations say more than the last fallback's.
 */
function placeFirst(draft: Draft, item: CatalogItem, anchors: Anchor[]): { pieceId: string; anchor: Anchor } {
  let first: unknown;
  for (const anchor of anchors) {
    try {
      return { pieceId: draft.place(item, anchor), anchor };
    } catch (error) {
      first ??= error;
    }
  }
  throw first ?? new ToolError(`There is nowhere for ${item.title}`);
}

/** The frames in hanging order, left to right: the widest in the middle, the others alternating out from it. */
function middleOut(frames: CatalogItem[]): CatalogItem[] {
  const ordered: CatalogItem[] = [];
  frames.toSorted((a, b) => b.size[0] - a.size[0]).forEach((frame, i) => (i % 2 ? ordered.unshift(frame) : ordered.push(frame)));
  return ordered;
}

/**
 * A gallery wall over furniture: the frames in a row, the widest in the middle, `GALLERY_GAP` apart,
 * the row centered over the target and clear of it. On the wall asked for, or failing that, on another
 * wall the target stands against. A frame that doesn't fit is skipped.
 */
export function hangGallery(draft: Draft, { over_id, wall_id, catalog_ids }: { over_id: string; wall_id: string; catalog_ids: string[] }): MoveReport {
  const { placed, skip, attempt, done } = reporter('Hung');
  const target = draft.inRoom(over_id);
  const frames = lookUp(draft, catalog_ids, skip, (frame) =>
    (frame.category === 'wall_art' || frame.category === 'mirror' ? undefined : `${frame.title} is not wall art or a mirror`));
  if (!frames.length) return done();
  const row = middleOut(frames);
  const walls = [wall_id, ...draft.setup.walls.filter((wall) => wall.id !== wall_id && isBy(wall, target, BY_WALL)).map(({ id }) => id)];
  const rowWidth = row.reduce((total, frame) => total + frame.size[0], 0) + GALLERY_GAP * (row.length - 1);
  // The widest frame, in the middle of the row, and how far its center is from the row's.
  const middle = Math.floor(row.length / 2);
  const offset = -rowWidth / 2 + row.slice(0, middle).reduce((total, frame) => total + frame.size[0] + GALLERY_GAP, 0) + row[middle].size[0] / 2;
  const outward = [
    ...row.slice(middle + 1).map((frame) => ['right', frame] as const),
    ...row.slice(0, middle).reverse().map((frame) => ['left', frame] as const),
  ];
  let firstFailure: unknown;
  for (const wall of walls) {
    // The middle frame first, where it is in the row centered over the target; then outward, each frame
    // beside the last on its side, or on the other side when it doesn't fit there. Hung from the middle,
    // the row stays centered even when it is wider than the target, which a frame's center may not leave.
    let middleId: string;
    try {
      middleId = draft.place(row[middle], { kind: 'on_wall_over', target_id: over_id, wall_id: wall, offset_m: offset });
    } catch (error) {
      firstFailure ??= error;
      continue;
    }
    placed(row[middle].id, middleId, `over ${target.name}`);
    const ends = { left: middleId, right: middleId };
    for (const [side, frame] of outward) {
      const sides = side === 'right' ? (['right', 'left'] as const) : (['left', 'right'] as const);
      attempt(frame.id, () => {
        const { pieceId, anchor } = placeFirst(draft, frame, sides.map((each): Anchor => ({ kind: 'on_wall_beside', target_id: ends[each], side: each, gap_m: GALLERY_GAP })));
        if (anchor.kind === 'on_wall_beside') ends[anchor.side] = pieceId;
        return { pieceId, as: `over ${target.name}` };
      });
    }
    return done();
  }
  for (const frame of row) skip(frame.id, reason(firstFailure));
  return done();
}

/** A rug centered under a bed or a sofa, or failing that on the open floor nearest it. */
export function layRug(draft: Draft, { catalog_id, under_id }: { catalog_id: string; under_id: string }): MoveReport {
  const { skip, attempt, done } = reporter('Laid');
  const target = draft.inRoom(under_id);
  const [rug] = lookUp(draft, [catalog_id], skip, (item) => (item.category === 'rug' ? undefined : `${item.title} is not a rug`));
  if (!rug) return done();
  attempt(rug.id, () => {
    const { pieceId, anchor } = placeFirst(draft, rug, [{ kind: 'centered_under', target_id: under_id }, { kind: 'open_floor', near_id: under_id }]);
    return { pieceId, as: anchor.kind === 'centered_under' ? `centered under ${target.name}` : `on the open floor near ${target.name}` };
  });
  return done();
}

/**
 * A reading corner, or any spot for sitting: a chair on the open floor nearest `near_id` (a window, an
 * Original or a Piece), or a chair already in the room where it stands; a lamp beside it, and a side piece
 * on its other side. A table lamp goes on top of the side piece when that is a table, and a floor lamp
 * stands beside the chair.
 */
export function makeCorner(
  draft: Draft, { chair_id, lamp_id, side_id, near_id }: { chair_id: string; lamp_id: string; side_id: string; near_id: string },
): MoveReport {
  const { skip, attempt, done } = reporter('Placed');
  let chairId = chair_id;
  // A chair from the Catalog goes near near_id; one already in the room, such as an Original desk chair, stays put.
  if (!draft.items().some(({ id }) => id === chair_id)) {
    const [chair] = lookUp(draft, [chair_id], skip);
    const pieceId = chair && attempt(chair.id, () => ({ pieceId: draft.place(chair, { kind: 'open_floor', near_id }), as: `near ${near_id}` }));
    if (!pieceId) return done();
    chairId = pieceId;
  }
  const [lamp] = lamp_id ? lookUp(draft, [lamp_id], skip) : [];
  const [side] = side_id ? lookUp(draft, [side_id], skip) : [];
  // Beside the chair, its right first; or failing both sides, on the open floor nearest it.
  const byChair = (item: CatalogItem) => placeFirst(draft, item, [
    { kind: 'beside', target_id: chairId, side: 'right' },
    { kind: 'beside', target_id: chairId, side: 'left' },
    { kind: 'open_floor', near_id: chairId },
  ]).pieceId;
  // On the furniture tops nearest the chair, `first` before them.
  const onNearestTop = (item: CatalogItem, first?: string) => {
    const [x, , z] = draft.inRoom(chairId).placement.position;
    const distance = ({ placement: { position: [tx, , tz] } }: Item) => Math.hypot(tx - x, tz - z);
    const tops = draft.items()
      .filter(({ id, category, placement }) => id !== first && placement.mount === 'floor' && LAMP_TOPS.includes(category))
      .sort((a, b) => distance(a) - distance(b));
    return placeFirst(draft, item, [...(first ? [first] : []), ...tops.map(({ id }) => id)].map((id): Anchor => ({ kind: 'on_top_of', target_id: id }))).pieceId;
  };
  /** Puts the item on the nearest top or by the chair: its Piece id, or undefined when it didn't fit. */
  const put = (item: CatalogItem, onTop: boolean, first?: string) => attempt(item.id, () => (onTop
    ? { pieceId: onNearestTop(item, first), as: 'on the nearest furniture top' }
    : { pieceId: byChair(item), as: 'by the chair' }));
  const sideTable = side && SIDE_TABLES.includes(side.category);
  // A side table goes in first, so that a table lamp can stand on it.
  const sideTableId = sideTable ? put(side, false) : undefined;
  if (lamp) put(lamp, !isFloorLamp(lamp), sideTableId);
  // A small plant or ornament beside a reading chair sits on a table, not on the floor.
  if (side && !sideTable) put(side, side.size[1] < FLOOR_DECOR);
  return done();
}

/** Pillows and throws resting on a bed's bedding. */
export function dressBed(draft: Draft, { bed_id, catalog_ids }: { bed_id: string; catalog_ids: string[] }): MoveReport {
  const { skip, attempt, done } = reporter('Put');
  const bed = draft.inRoom(bed_id);
  if (bed.category !== 'bed') throw new ToolError(`${bed.name} is not a bed: put decor on it with style_tops`);
  for (const item of lookUp(draft, catalog_ids, skip)) {
    attempt(item.id, () => ({ pieceId: draft.place(item, { kind: 'on_top_of', target_id: bed_id }), as: `on ${bed.name}` }));
  }
  return done();
}

/** Decor, plants and table lamps resting on furniture tops: desks, dressers, nightstands and shelves. */
export function styleTops(draft: Draft, { items }: { items: { catalog_id: string; on_id: string }[] }): MoveReport {
  const { skip, attempt, done } = reporter('Put');
  for (const { catalog_id, on_id } of items) {
    const [item] = lookUp(draft, [catalog_id], skip);
    if (item) attempt(item.id, () => ({ pieceId: draft.place(item, { kind: 'on_top_of', target_id: on_id }), as: `on ${draft.inRoom(on_id).name}` }));
  }
  return done();
}
