import { footprint, type OrientedRect, overlapLength, polygonsOverlap, rectCorners, rectInPolygon, wallPoint } from './geometry';
import type { Catalog, Category, FitViolation, Opening, Placement, RoomSetup, RoomState, Vec2, Vec3, Wall } from './types';

/** How far, in meters, things may overlap before a Fit rule counts it: flush placement and scan noise. */
export const TOLERANCE = 0.01;
/** How far into the room a door that doesn't swing needs the floor clear. */
const DOORWAY_DEPTH = 0.6;
/** How far into the room a window needs the floor clear of anything taller than its sill. */
const WINDOW_DEPTH = 0.4;
/** Straight segments that stand in for the arc of a door's swing: they stray from it by about 1 mm. */
const ARC_SEGMENTS = 16;
/** The size, in meters, of a cell of the grid the walkway is searched on. */
const CELL = 0.05;
/** Half the width of someone walking: the walkway keeps their center this far from floor items and walls. */
const WALKER_RADIUS = 0.3;
/**
 * The least floor, in square meters of where a walker's center can be, that counts as part of the room
 * when it's cut off from the doors: about a 1.3 m square of floor. Less is a nook behind furniture.
 */
const POCKET_AREA = 0.5;
/** How far from a target's edge the walker's center can be and still reach it: one cell past the WALKER_RADIUS it keeps. */
const REACH = WALKER_RADIUS + CELL;
/** What a walkway must reach the front of, from each door. */
const WALKWAY_TARGETS: Category[] = ['bed', 'desk', 'dresser'];

/** Something that takes up room: a visible Original or a Piece. */
export interface Item {
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

/** The floor an Opening needs clear, in front of it on its wall. */
interface Zone { opening: Opening; wall: Wall; corners: Vec2[] }

/** A grid of CELL squares over the floor: for each cell, how many things keep a walker's center out of it. */
interface Grid { minX: number; minZ: number; cols: number; rows: number; blockers: Uint8Array }

/** The cells of the grid a walker comes in through a door at. */
interface Doorway { door: Opening; cells: number[] }

/** The cells of the grid a walker stands in to reach a target. */
interface Goal { target: Item; cells: number[] }

/**
 * The Fit rule violations of a room (spec §10.6): overlap, outside-floor, door-swing and blocks-window,
 * plus walkway when asked for, as only Claude's Edits are held to it (§13.2). With `subjectIds`, only
 * those items' violations, still checked against everything.
 */
export function checkFit(
  setup: RoomSetup, catalog: Catalog, state: RoomState, subjectIds?: string[], { walkway: withWalkway = false } = {},
): FitViolation[] {
  const items = roomItems(setup, catalog, state);
  const zones = openingZones(setup);
  const subjects = subjectIds ? items.filter((item) => subjectIds.includes(item.id)) : items;
  return [
    ...subjects.flatMap((subject) => [
      ...items
        .filter((other) => other !== subject && collide(subject, other) && overlap(subject, other))
        .map((other): FitViolation => ({ rule: 'overlap', subjectId: subject.id, otherId: other.id, message: `Overlaps ${other.name}` })),
      ...(subject.placement.mount === 'floor' ? floorChecks(subject, setup, zones) : []),
      ...(subject.placement.mount === 'wall' ? wallChecks(subject, setup) : []),
    ]),
    ...(withWalkway ? walkway(setup, items, zones, subjects) : []),
  ];
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

/** The check only a wall item gets: hanging over an Opening in its wall, which overlaps the Opening. */
function wallChecks(subject: Item, setup: RoomSetup): FitViolation[] {
  const wall = setup.walls.find(({ id }) => id === subject.placement.wallId);
  if (!wall) return [];
  // How far from the wall's start the item reaches, each way.
  const { start: [sx, sz], end: [ex, ez] } = wall;
  const length = Math.hypot(ex - sx, ez - sz);
  const along = subject.corners.map(([x, z]) => ((x - sx) * (ex - sx) + (z - sz) * (ez - sz)) / length);
  const span: [number, number] = [Math.min(...along), Math.max(...along)];
  return setup.openings
    .filter(({ wallId, offset, width, bottom, height }) => wallId === wall.id
      && overlapLength([offset, offset + width], span) > TOLERANCE
      && overlapLength([bottom, bottom + height], subject.heights) > TOLERANCE)
    .map((opening) => ({ rule: 'overlap', subjectId: subject.id, otherId: opening.id, message: `Covers the ${opening.kind}` }));
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

/**
 * The walkway rule (spec §13.2): someone 0.6 m wide can walk in through each door to the front of
 * every bed, desk and dresser; a bed's long sides count as its front too. And to all of the room: no
 * part of the open floor bigger than a nook may be shut off from the doors, as a bed across the end of
 * an entry passage shuts off the room. The search moves the walker's center over a grid, so it keeps
 * WALKER_RADIUS from every floor item but rugs, and from the walls but their doorways. A subject breaks
 * the rule when its own front can't be reached, when the path to another target opens without it, or,
 * failing those, when part of the room does.
 */
function walkway(setup: RoomSetup, items: Item[], zones: Zone[], subjects: Item[]): FitViolation[] {
  const obstacles = items.filter((item) => item.placement.mount === 'floor' && !liesFlat(item));
  const targets = obstacles.filter(({ category }) => WALKWAY_TARGETS.includes(category));
  const doors = zones.filter(({ opening }) => opening.kind === 'door');
  // Only an obstacle can block a path.
  if (!doors.length || !subjects.some((subject) => obstacles.includes(subject))) return [];

  const grid = floorGrid(setup, doors.map(({ opening }) => opening));
  const cells = new Map(obstacles.map((item) => [item, cellsNear(grid, item.rect, WALKER_RADIUS)]));
  for (const own of cells.values()) stamp(grid, own, 1);
  // The walker comes in anywhere across a doorway, 0.3 m in.
  const doorways = doors.map(({ opening: door, wall }): Doorway =>
    ({ door, cells: cellsNear(grid, alongWall(wall, door.offset, door.offset + door.width, WALKER_RADIUS, REACH)) }));
  const chairs = obstacles.filter(({ category }) => category === 'chair');
  const goals = targets.map((target): Goal => {
    // A chair pulled up to a desk stands in its front: walking up to the chair is walking up to the desk.
    const front = target.category === 'desk' ? rectCorners(fronts(target)[0]) : undefined;
    const pulledUp = front ? chairs.filter(({ corners }) => polygonsOverlap(corners, front, TOLERANCE)) : [];
    // Someone stands squarely in front of it: all of them, WALKER_RADIUS each side of their center, within its ends.
    const squarely = fronts(target, WALKER_RADIUS).flatMap((strip) => cellsNear(grid, strip));
    return { target, cells: [...squarely, ...pulledUp.flatMap(({ rect }) => cellsNear(grid, rect, REACH))] };
  });

  const cut = cutOff(grid, doorways, goals);
  const shutOff = shutOffFloor(grid, doorways);
  if (!cut.size && !shutOff) return [];
  return subjects.flatMap((subject): FitViolation[] => {
    const own = cells.get(subject);
    if (!own) return [];
    const door = cut.get(subject);
    stamp(grid, own, -1);
    const without = cutOff(grid, doorways, goals);
    const shutOffWithout = shutOff ? shutOffFloor(grid, doorways) : 0;
    stamp(grid, own, 1);
    const violation = (otherId: string, message: string): FitViolation => ({ rule: 'walkway', subjectId: subject.id, otherId, message });
    const paths = [
      ...(door ? [violation(door.id, 'No clear path from the door')] : []),
      ...[...cut.keys()]
        .filter((target) => target !== subject && !without.has(target))
        .map((target) => violation(target.id, `Blocks the path to ${target.name}`)),
    ];
    // Shutting off a target says the most; the floor counts when the subject shuts off a part of the room on its own.
    if (paths.length || shutOff - shutOffWithout < POCKET_AREA / CELL ** 2) return paths;
    return [violation(doors[0].opening.id, 'Cuts off part of the room from the door')];
  });
}

/** How many cells of open floor no doorway reaches, counting only the parts of the room big enough to be one. */
function shutOffFloor(grid: Grid, doorways: Doorway[]): number {
  const reached = new Int32Array(grid.blockers.length).fill(-1);
  for (const { cells } of doorways) for (const cell of cells) if (!grid.blockers[cell] && reached[cell] === -1) search(grid, cell, 0, reached);
  let shut = 0;
  for (let cell = 0, mark = 1; cell < reached.length; cell++) {
    if (grid.blockers[cell] || reached[cell] !== -1) continue;
    const size = search(grid, cell, mark++, reached);
    if (size >= POCKET_AREA / CELL ** 2) shut += size;
  }
  return shut;
}

/** The targets the walkway in through some door doesn't reach, each with the first such door. */
function cutOff(grid: Grid, doorways: Doorway[], goals: Goal[]): Map<Item, Opening> {
  // Each search marks the cells it reaches with its own number, so cells with the same number are connected.
  const reached = new Int32Array(grid.blockers.length).fill(-1);
  let searches = 0;
  const cut = new Map<Item, Opening>();
  for (const { door, cells } of doorways) {
    const open = cells.filter((cell) => !grid.blockers[cell]);
    for (const cell of open) if (reached[cell] === -1) search(grid, cell, searches++, reached);
    const walkways = new Set(open.map((cell) => reached[cell]));
    for (const { target, cells: goal } of goals) {
      if (!cut.has(target) && !goal.some((cell) => walkways.has(reached[cell]))) cut.set(target, door);
    }
  }
  return cut;
}

/** Breadth-first search from a cell through the open cells next to each other, marking each with `mark`: how many it marked. */
function search({ cols, rows, blockers }: Grid, start: number, mark: number, reached: Int32Array): number {
  const queue = new Int32Array(blockers.length);
  let [head, tail] = [0, 0];
  const visit = (cell: number) => {
    if (reached[cell] !== -1 || blockers[cell]) return;
    reached[cell] = mark;
    queue[tail++] = cell;
  };
  visit(start);
  while (head < tail) {
    const cell = queue[head++];
    const [i, j] = [cell % cols, Math.floor(cell / cols)];
    if (i > 0) visit(cell - 1);
    if (i < cols - 1) visit(cell + 1);
    if (j > 0) visit(cell - cols);
    if (j < rows - 1) visit(cell + cols);
  }
  return tail;
}

/** The grid over a room's floor, with the cells off the floor, or within WALKER_RADIUS of a wall, blocked. */
function floorGrid({ floor: { polygon }, walls }: RoomSetup, doors: Opening[]): Grid {
  const [minX, minZ] = [Math.min(...polygon.map(([x]) => x)), Math.min(...polygon.map(([, z]) => z))];
  const cols = Math.ceil((Math.max(...polygon.map(([x]) => x)) - minX) / CELL);
  const rows = Math.ceil((Math.max(...polygon.map(([, z]) => z)) - minZ) / CELL);
  const grid = { minX, minZ, cols, rows, blockers: new Uint8Array(cols * rows).fill(1) };
  // Row by row, the floor is between pairs of the polygon's edge crossings, as in pointInPolygon.
  for (let j = 0; j < rows; j++) {
    const [, z] = cellCenter(grid, 0, j);
    const crossings = polygon.flatMap(([xi, zi], i) => {
      const [xj, zj] = polygon[(i + 1) % polygon.length];
      return zi > z !== zj > z ? [xi + ((z - zi) * (xj - xi)) / (zj - zi)] : [];
    }).sort((a, b) => a - b);
    for (let k = 0; k + 1 < crossings.length; k += 2) {
      const [from, to] = [crossings[k], crossings[k + 1]];
      for (let i = Math.max(0, Math.ceil((from - minX) / CELL - 0.5)); i < cols && cellCenter(grid, i, j)[0] < to; i++) {
        grid.blockers[j * cols + i] = 0;
      }
    }
  }
  // Along the walls, except through a doorway.
  for (const wall of walls) {
    const length = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]);
    const doorways = doors.filter(({ wallId }) => wallId === wall.id).map(({ offset, width }) => [offset, offset + width]);
    let from = 0;
    for (const [doorStart, doorEnd] of [...doorways.sort(([a], [b]) => a - b), [length, length]]) {
      if (doorStart > from) stamp(grid, cellsNear(grid, alongWall(wall, from, doorStart, 0, 0), WALKER_RADIUS), 1);
      from = Math.max(from, doorEnd);
    }
  }
  return grid;
}

/** The center of the cell in column i, row j. */
const cellCenter = ({ minX, minZ }: Grid, i: number, j: number): Vec2 => [minX + (i + 0.5) * CELL, minZ + (j + 0.5) * CELL];

/** The first and last columns, then rows, of the cells within `margin` of the box around some points. */
function cellBounds({ minX, minZ, cols, rows }: Grid, points: Vec2[], margin = 0): [number, number, number, number] {
  const span = (values: number[], min: number, count: number): [number, number] => [
    Math.max(0, Math.floor((Math.min(...values) - margin - min) / CELL)),
    Math.min(count - 1, Math.floor((Math.max(...values) + margin - min) / CELL)),
  ];
  return [...span(points.map(([x]) => x), minX, cols), ...span(points.map(([, z]) => z), minZ, rows)];
}

/** The cells whose centers are inside a rectangle, or less than `margin` from it: the rectangle grown with round corners. */
function cellsNear(grid: Grid, rect: OrientedRect, margin = 0): number[] {
  const [i0, i1, j0, j1] = cellBounds(grid, rectCorners(rect), margin);
  const { center: [cx, cz], size: [width, depth], rotationY } = rect;
  const [cos, sin] = [Math.cos(rotationY), Math.sin(rotationY)];
  const cells: number[] = [];
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const [x, z] = cellCenter(grid, i, j);
      // How far past the rectangle's sides the cell center is, in its own frame: the turn rectCorners makes, undone.
      const across = Math.abs((x - cx) * cos - (z - cz) * sin) - width / 2;
      const out = Math.abs((x - cx) * sin + (z - cz) * cos) - depth / 2;
      if ((across < 0 && out < 0) || Math.hypot(Math.max(0, across), Math.max(0, out)) < margin) cells.push(j * grid.cols + i);
    }
  }
  return cells;
}

/** Puts something on these cells (+1), or takes it off (−1). */
const stamp = (grid: Grid, cells: number[], change: 1 | -1) => {
  for (const cell of cells) grid.blockers[cell] += change;
};

/**
 * The strips, REACH deep, along an item's front, where someone stands to use it; a bed's long sides
 * too. Each stops `inset` short of the ends, but stays two cells long.
 */
function fronts({ category, rect: { center: [cx, cz], size: [width, depth], rotationY } }: Item, inset = 0): OrientedRect[] {
  const [cos, sin] = [Math.cos(rotationY), Math.sin(rotationY)];
  // The strip centered at [x, z] in the item's own frame, turned as rectCorners turns it.
  const strip = (x: number, z: number, size: Vec2): OrientedRect =>
    ({ center: [cx + x * cos + z * sin, cz - x * sin + z * cos], size, rotationY });
  const along = (length: number) => Math.max(length - 2 * inset, 2 * CELL);
  const front = strip(0, (depth + REACH) / 2, [along(width), REACH]);
  if (category !== 'bed') return [front];
  return [front, ...[1, -1].map((side) => strip((side * (width + REACH)) / 2, 0, [REACH, along(depth)]))];
}

/** The floor along a wall, from `from` to `to` meters from its start, and from `near` to `far` meters out from it. */
const alongWall = (wall: Wall, from: number, to: number, near: number, far: number): OrientedRect =>
  ({ center: wallPoint(wall, (from + to) / 2, (near + far) / 2), size: [to - from, far - near], rotationY: Math.atan2(...wall.normal) });

function openingZones(setup: RoomSetup): Zone[] {
  return setup.openings.flatMap((opening) => {
    const wall = setup.walls.find(({ id }) => id === opening.wallId);
    if (!wall) return [];
    return [{ opening, wall, corners: opening.kind === 'door' ? doorZone(opening, wall) : inFront(opening, wall, WINDOW_DEPTH) }];
  });
}

/** The floor in front of an Opening, `depth` meters into the room. */
const inFront = ({ offset, width }: Opening, wall: Wall, depth: number): Vec2[] =>
  rectCorners(alongWall(wall, offset, offset + width, 0, depth));

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

/** The visible Originals and the Pieces of a room, as the Fit rules see them. */
export function roomItems(setup: RoomSetup, catalog: Catalog, state: RoomState): Item[] {
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
