import { footprint, type OrientedRect, pointInPolygon, polygonsOverlap, rectCorners, rectsOverlap, wallPoint } from './geometry';
import type { Catalog, Category, FitViolation, Opening, Placement, RoomSetup, RoomState, Vec2, Vec3, Wall } from './types';

/** How far, in meters, things may overlap before a Fit rule counts it: flush placement and scan noise. */
const TOLERANCE = 0.01;

/** Something that takes up room: a visible Original or a Piece. */
interface Item {
  id: string;
  /** How messages name it: "your desk", or a Piece's Catalog title. */
  name: string;
  category: Category;
  placement: Placement;
  size: Vec3;
  rect: OrientedRect;
}

/**
 * The Fit rule violations of a room (spec §10.6, §13.2): overlap, outside-floor, door-swing and
 * blocks-window. With `subjectIds`, only those items' violations, still checked against everything.
 */
export function checkFit(setup: RoomSetup, catalog: Catalog, state: RoomState, subjectIds?: string[]): FitViolation[] {
  const items = roomItems(setup, catalog, state);
  const subjects = subjectIds ? items.filter((item) => subjectIds.includes(item.id)) : items;
  return subjects.flatMap((subject) => [
    ...items
      .filter((other) => other !== subject && collide(subject, other) && overlap(subject, other))
      .map((other): FitViolation => ({ rule: 'overlap', subjectId: subject.id, otherId: other.id, message: `Overlaps ${other.name}` })),
    ...(subject.placement.mount === 'floor' ? floorChecks(subject, setup) : []),
  ]);
}

/** The checks only a floor item gets: outside-floor, then door-swing and blocks-window, which a flat rug never fails. */
function floorChecks(subject: Item, setup: RoomSetup): FitViolation[] {
  const violations: FitViolation[] = [];
  if (!insideFloor(subject.rect, setup.floor.polygon)) {
    violations.push({ rule: 'outside-floor', subjectId: subject.id, message: 'Outside the room' });
  }
  if (subject.category === 'rug') return violations;
  const corners = rectCorners(subject.rect);
  for (const opening of setup.openings) {
    const wall = setup.walls.find(({ id }) => id === opening.wallId);
    if (!wall) continue;
    if (opening.kind === 'door' && polygonsOverlap(corners, doorZone(opening, wall), TOLERANCE)) {
      violations.push({ rule: 'door-swing', subjectId: subject.id, otherId: opening.id, message: 'Blocks the door' });
    }
    if (opening.kind === 'window' && heights(subject)[1] > opening.bottom
      && polygonsOverlap(corners, inFront(opening, wall, WINDOW_DEPTH), TOLERANCE)) {
      violations.push({ rule: 'blocks-window', subjectId: subject.id, otherId: opening.id, message: 'Blocks the window' });
    }
  }
  return violations;
}

/** Straight segments that stand in for the arc of a door's swing: they stray from it by about 1 mm. */
const ARC_SEGMENTS = 16;

/** How far into the room a door that doesn't swing needs the floor clear. */
const DOORWAY_DEPTH = 0.6;
/** How far into the room a window needs the floor clear of anything taller than its sill. */
const WINDOW_DEPTH = 0.4;

/** The floor in front of an opening, `depth` meters into the room. */
const inFront = ({ offset, width }: Opening, wall: Wall, depth: number): Vec2[] =>
  [wallPoint(wall, offset), wallPoint(wall, offset + width), wallPoint(wall, offset + width, depth), wallPoint(wall, offset, depth)];

/** The floor a door needs clear: the quarter-disc its leaf sweeps from the hinge, or 0.6 m in front of a door that doesn't swing. */
function doorZone(door: Opening, wall: Wall): Vec2[] {
  const { offset, width, swing } = door;
  if (swing !== 'in-left' && swing !== 'in-right') return inFront(door, wall, DOORWAY_DEPTH);
  // `swing` names the hinge side as seen from inside the room, facing the wall, where right is [nz, −nx].
  const { start: [sx, sz], end: [ex, ez], normal: [nx, nz] } = wall;
  const endIsRight = (ex - sx) * nz - (ez - sz) * nx > 0;
  const hinge = endIsRight === (swing === 'in-right') ? offset + width : offset;
  const toLatch = hinge === offset ? 1 : -1;
  const arc = Array.from({ length: ARC_SEGMENTS + 1 }, (_, i) => {
    const angle = (i / ARC_SEGMENTS) * (Math.PI / 2);
    return wallPoint(wall, hinge + toLatch * width * Math.cos(angle), width * Math.sin(angle));
  });
  return [wallPoint(wall, hinge), ...arc];
}

/** Whether a footprint lies on the floor, allowing it to reach the tolerance past the walls. */
function insideFloor({ center, size: [width, depth], rotationY }: OrientedRect, floor: Vec2[]) {
  const inner = rectCorners({ center, size: [Math.max(0, width - 2 * TOLERANCE), Math.max(0, depth - 2 * TOLERANCE)], rotationY });
  // In a room that isn't convex, an inner corner of the room can cut into a footprint whose corners are all on the floor.
  return inner.every((corner) => pointInPolygon(corner, floor)) && !floor.some((corner) => pointInPolygon(corner, inner));
}

/**
 * Whether two items can be in each other's way. Wall items meet only wall items on the same wall;
 * an item standing on furniture skips the floor checks; rugs lie under furniture, so they only meet rugs.
 */
function collide({ placement: a, category: aCategory }: Item, { placement: b, category: bCategory }: Item) {
  if (a.mount === 'wall' && b.mount === 'wall') return a.wallId !== undefined && a.wallId === b.wallId;
  return a.mount === 'floor' && b.mount === 'floor' && (aCategory === 'rug') === (bCategory === 'rug');
}

/** Whether two items take up the same room. Wall items can hang one above another, so their heights count too. */
function overlap(a: Item, b: Item) {
  if (!rectsOverlap(a.rect, b.rect, TOLERANCE)) return false;
  return a.placement.mount !== 'wall' || overlapLength(heights(a), heights(b)) > TOLERANCE;
}

const heights = ({ placement: { position: [, y] }, size: [, h] }: Item): [number, number] => [y, y + h];

const overlapLength = ([a0, a1]: [number, number], [b0, b1]: [number, number]) => Math.min(a1, b1) - Math.max(a0, b0);

function roomItems(setup: RoomSetup, catalog: Catalog, state: RoomState): Item[] {
  const item = (id: string, name: string, category: Category, placement: Placement, size: Vec3): Item =>
    ({ id, name, category, placement, size, rect: footprint(placement, size) });
  const originals = setup.originals
    .filter((original) => state.originals[original.id]?.visible)
    .map((original) => item(
      original.id, `your ${original.label.toLowerCase()}`, original.category, state.originals[original.id].placement, original.box.size,
    ));
  const pieces = Object.entries(state.pieces).flatMap(([id, { catalogId, placement }]) => {
    const catalogItem = catalog.items.find(({ id: itemId }) => itemId === catalogId);
    return catalogItem ? [item(id, catalogItem.title, catalogItem.category, placement, catalogItem.size)] : [];
  });
  return [...originals, ...pieces];
}
