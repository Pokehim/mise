import { footprint, type OrientedRect, overlapLength, polygonsOverlap, rectCorners, rectInPolygon, wallPoint } from './geometry';
import type { Catalog, Category, FitViolation, Opening, Placement, RoomSetup, RoomState, Vec2, Vec3, Wall } from './types';

/** How far, in meters, things may overlap before a Fit rule counts it: flush placement and scan noise. */
const TOLERANCE = 0.01;
/** How far into the room a door that doesn't swing needs the floor clear. */
const DOORWAY_DEPTH = 0.6;
/** How far into the room a window needs the floor clear of anything taller than its sill. */
const WINDOW_DEPTH = 0.4;
/** Straight segments that stand in for the arc of a door's swing: they stray from it by about 1 mm. */
const ARC_SEGMENTS = 16;

/** Something that takes up room: a visible Original or a Piece. */
interface Item {
  id: string;
  /** How messages name it: "your desk", or a Piece's Catalog title. */
  name: string;
  category: Category;
  placement: Placement;
  rect: OrientedRect;
  corners: Vec2[];
  /** The [bottom, top] of the item, in meters above the floor. */
  heights: [number, number];
}

/** The floor an Opening needs clear. */
interface Zone { opening: Opening; corners: Vec2[] }

/**
 * The Fit rule violations of a room (spec §10.6, §13.2): overlap, outside-floor, door-swing and
 * blocks-window. With `subjectIds`, only those items' violations, still checked against everything.
 */
export function checkFit(setup: RoomSetup, catalog: Catalog, state: RoomState, subjectIds?: string[]): FitViolation[] {
  const items = roomItems(setup, catalog, state);
  const zones = openingZones(setup);
  const subjects = subjectIds ? items.filter((item) => subjectIds.includes(item.id)) : items;
  return subjects.flatMap((subject) => [
    ...items
      .filter((other) => other !== subject && collide(subject, other) && overlap(subject, other))
      .map((other): FitViolation => ({ rule: 'overlap', subjectId: subject.id, otherId: other.id, message: `Overlaps ${other.name}` })),
    ...(subject.placement.mount === 'floor' ? floorChecks(subject, setup, zones) : []),
  ]);
}

/** The checks only a floor item gets: outside-floor, then door-swing and blocks-window, which a flat rug never fails. */
function floorChecks(subject: Item, setup: RoomSetup, zones: Zone[]): FitViolation[] {
  const violations: FitViolation[] = [];
  if (!rectInPolygon(subject.rect, setup.floor.polygon, TOLERANCE)) {
    violations.push({ rule: 'outside-floor', subjectId: subject.id, message: 'Outside the room' });
  }
  if (liesFlat(subject)) return violations;
  // An Opening needs its zone clear of anything taller than its bottom: everything, for a door.
  for (const { opening, corners } of zones) {
    if (subject.heights[1] <= opening.bottom || !polygonsOverlap(subject.corners, corners, TOLERANCE)) continue;
    violations.push(opening.kind === 'door'
      ? { rule: 'door-swing', subjectId: subject.id, otherId: opening.id, message: 'Blocks the door' }
      : { rule: 'blocks-window', subjectId: subject.id, otherId: opening.id, message: 'Blocks the window' });
  }
  return violations;
}

/** Rugs lie flat: furniture stands on them and doors sweep over them, so they only collide with other rugs. */
const liesFlat = (item: Item) => item.category === 'rug';

/**
 * Whether two items can be in each other's way: only items with the same mount can. On the floor,
 * rugs meet only rugs; on walls, only items on the same wall meet.
 */
function collide(a: Item, b: Item) {
  if (a.placement.mount !== b.placement.mount) return false;
  switch (a.placement.mount) {
    case 'floor':
      return liesFlat(a) === liesFlat(b);
    case 'wall':
      return a.placement.wallId !== undefined && a.placement.wallId === b.placement.wallId;
    case 'surface':
      return true;
  }
}

/** Whether two items take up the same room. Off the floor, one can be above another, so their heights count too. */
function overlap(a: Item, b: Item) {
  if (!polygonsOverlap(a.corners, b.corners, TOLERANCE)) return false;
  return a.placement.mount === 'floor' || overlapLength(a.heights, b.heights) > TOLERANCE;
}

function openingZones(setup: RoomSetup): Zone[] {
  return setup.openings.flatMap((opening) => {
    const wall = setup.walls.find(({ id }) => id === opening.wallId);
    if (!wall) return [];
    return [{ opening, corners: opening.kind === 'door' ? doorZone(opening, wall) : inFront(opening, wall, WINDOW_DEPTH) }];
  });
}

/** The floor in front of an Opening, `depth` meters into the room. */
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

function roomItems(setup: RoomSetup, catalog: Catalog, state: RoomState): Item[] {
  const item = ({ id, name, category, placement, size }: Pick<Item, 'id' | 'name' | 'category' | 'placement'> & { size: Vec3 }): Item => {
    const rect = footprint(placement, size);
    const bottom = placement.position[1];
    return { id, name, category, placement, rect, corners: rectCorners(rect), heights: [bottom, bottom + size[1]] };
  };
  const catalogItems = new Map(catalog.items.map((catalogItem) => [catalogItem.id, catalogItem]));
  const originals = setup.originals
    .filter((original) => state.originals[original.id]?.visible)
    .map(({ id, label, category, box }) =>
      item({ id, name: `your ${label.toLowerCase()}`, category, placement: state.originals[id].placement, size: box.size }));
  const pieces = Object.entries(state.pieces).flatMap(([id, { catalogId, placement }]) => {
    const catalogItem = catalogItems.get(catalogId);
    return catalogItem ? [item({ id, name: catalogItem.title, category: catalogItem.category, placement, size: catalogItem.size })] : [];
  });
  return [...originals, ...pieces];
}
