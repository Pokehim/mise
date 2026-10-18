import { isFurniture } from './anchors';
import { roomItems } from './fit';
import { footprint, rectCorners } from './geometry';
import { besideEdge, contactHold, type Edge, edgeHolder, edgesOf, moved, pusher, slideIn, TUCK_TARGETS, tuckAtEdge, wallSnapped } from './tuck';
import type { Catalog, Placement, RoomSetup, RoomState, Vec3 } from './types';

/** How near square to another item's side, in radians, a dragged item must be for it to turn square as it snaps: 10°, a quiet turn. */
const SNAP_ANGLE = (10 * Math.PI) / 180;
/** How near lining up with the ends of the side it snaps against, in meters, its own ends must be for them to line up. */
const ALIGN = 0.06;
/** How near square, in radians, counts as square: floating point. */
const SQUARE = 1e-6;

/** An angle kept in (−π, π]. */
const wrapped = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));

/**
 * The item turned about its center so that its nearest side faces the edge squarely, when it is
 * within SNAP_ANGLE of that; else as it is.
 */
function squaredTo({ outward: [ox, oz] }: Edge, placement: Placement): Placement {
  // The way a side facing the edge faces, as a rotationY turns an item's front.
  const toward = Math.atan2(-ox, -oz);
  const turn = [0, Math.PI / 2, Math.PI, -Math.PI / 2]
    .map((side) => wrapped(toward - (placement.rotationY + side)))
    .sort((a, b) => Math.abs(a) - Math.abs(b))[0];
  return Math.abs(turn) < SNAP_ANGLE ? { ...placement, rotationY: wrapped(placement.rotationY + turn) } : placement;
}

/** The item slid along the edge so that one of its ends lines up with an end of the edge, when one is within ALIGN of it. */
function alignedWith(edge: Edge, placement: Placement, size: Vec3): Placement | undefined {
  const { alongFrom, alongTo } = besideEdge(edge, rectCorners(footprint(placement, size)));
  const shift = [-edge.halfLength - alongFrom, edge.halfLength - alongTo]
    .filter((it) => Math.abs(it) <= ALIGN)
    .sort((a, b) => Math.abs(a) - Math.abs(b))[0];
  return shift === undefined ? undefined : moved(placement, edge.along, shift);
}

/**
 * Furniture snapping together, for a drag of one item (spec §10.3): a function from where the drag
 * puts it, after the wall snap and before it, to where it goes. Another item's side is solid, as
 * walls are: dragged into it, an item stops where it touches, and within 6 cm of touching it snaps
 * against it and holds there until pulled 20 cm back (`contactHold`). Only the boxes count, so a desk
 * still goes under a loft bed. As it snaps, within 10° of square to that side it turns square, and an
 * end within 6 cm of lining up with an end of that side lines up, so two tables pushed together make
 * one. Walls win: where the wall snap moved or turned it, it keeps that. A chair at a desk or table tucks in instead (`tuckSnap`), so
 * those aren't its to snap to. Undefined for anything that isn't furniture standing on the floor.
 */
export function snapTogether(setup: RoomSetup, catalog: Catalog, state: RoomState, subjectId: string):
  ((placed: Placement, unsnapped: Placement) => Placement) | undefined {
  const items = roomItems(setup, catalog, state);
  const subject = items.find(({ id }) => id === subjectId);
  if (!subject || !isFurniture(subject)) return undefined;
  const size: Vec3 = [subject.rect.size[0], subject.heights[1] - subject.heights[0], subject.rect.size[1]];
  const tucks = subject.category === 'chair';
  const snapAtEdge = edgeHolder(items
    .filter((item) => item !== subject && isFurniture(item) && !(tucks && TUCK_TARGETS.includes(item.category)))
    .flatMap(edgesOf), size);
  const push = pusher(setup, catalog, state, subjectId);
  const hold = contactHold(size);
  return (placed, unsnapped) => snapAtEdge(placed, (edge, backOut) => {
    if (wallSnapped(edge, placed, unsnapped)) {
      hold.letGo();
      return placed;
    }
    if (hold.contactFrom(push, edge, placed) === 'free') return placed;
    const squared = placed.rotationY === unsnapped.rotationY ? squaredTo(edge, placed) : placed;
    const aligned = isSquare(edge, squared) ? alignedWith(edge, squared, size) : undefined;
    // Lined up and square if that fits, else square, else just pushed against it; and only once it snaps.
    // Backed out of what the pointer pushed it into, just as it is, as backing out costs the most.
    for (const at of backOut ? [placed] : [aligned, squared, placed]) {
      const contact = at && slideIn(push, edge, at, size, backOut);
      if (contact) return hold.at(edge, placed, contact);
    }
    return null;
  }) ?? placed;
}

/** Whether an item already stands square to an edge. */
const isSquare = ({ outward: [ox, oz] }: Edge, { rotationY }: Placement) =>
  [0, Math.PI / 2, Math.PI, -Math.PI / 2].some((side) => Math.abs(wrapped(Math.atan2(-ox, -oz) - rotationY - side)) < SQUARE);

/**
 * The snaps a drag of one item makes to other items, after the wall snap (spec §10.3): a chair at a
 * desk or table tucks in (`tuckSnap`), and that edge is the tuck's alone while the chair is at it,
 * snapped or not; anything else near furniture snaps against it (`snapTogether`). Undefined for an
 * item neither applies to.
 */
export function dragSnap(setup: RoomSetup, catalog: Catalog, state: RoomState, subjectId: string):
  ((placed: Placement, unsnapped: Placement) => Placement) | undefined {
  const tuck = tuckAtEdge(setup, catalog, state, subjectId);
  const together = snapTogether(setup, catalog, state, subjectId);
  if (!tuck) return together;
  return (placed, unsnapped) => tuck(placed, unsnapped) ?? together?.(placed, unsnapped) ?? placed;
}
