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
/** The size, in meters, of a cell of the grid the walkway is searched on. */
const CELL = 0.05;
/** Half the width of someone walking: the walkway keeps their center this far from floor items and walls. */
const WALKER_RADIUS = 0.3;
/** What a walkway must reach the front of, from each door. */
const WALKWAY_TARGETS: Category[] = ['bed', 'desk', 'dresser'];

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

/** A grid of CELL squares over the floor: for each cell, how many things keep a walker's center out of it. */
interface Grid { minX: number; minZ: number; cols: number; rows: number; blocked: Uint8Array }

/**
 * The Fit rule violations of a room (spec §10.6, §13.2): overlap, outside-floor, door-swing,
 * blocks-window and walkway. With `subjectIds`, only those items' violations, still checked against everything.
 */
export function checkFit(setup: RoomSetup, catalog: Catalog, state: RoomState, subjectIds?: string[]): FitViolation[] {
  const items = roomItems(setup, catalog, state);
  const zones = openingZones(setup);
  const subjects = subjectIds ? items.filter((item) => subjectIds.includes(item.id)) : items;
  return [
    ...subjects.flatMap((subject) => [
      ...items
        .filter((other) => other !== subject && collide(subject, other) && overlap(subject, other))
        .map((other): FitViolation => ({ rule: 'overlap', subjectId: subject.id, otherId: other.id, message: `Overlaps ${other.name}` })),
      ...(subject.placement.mount === 'floor' ? floorChecks(subject, setup, zones) : []),
    ]),
    ...walkway(setup, items, zones, subjects),
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
 * The walkway rule (spec §13.2): someone 0.6 m wide can walk from each door to the front of every bed,
 * desk and dresser; a bed's long sides count as its front too. The search moves the walker's center
 * over a grid, so it keeps WALKER_RADIUS from every floor item except rugs, and from the walls except
 * where a door opens. A subject breaks the rule when its own front can't be reached, or when the path
 * to something else opens without it.
 */
function walkway(setup: RoomSetup, items: Item[], zones: Zone[], subjects: Item[]): FitViolation[] {
  const doors = zones.filter(({ opening }) => opening.kind === 'door');
  // An item in a door's way already breaks door-swing, so the walkway leaves it out.
  const standing = items.filter((item) => item.placement.mount === 'floor' && !liesFlat(item)
    && !doors.some(({ corners }) => polygonsOverlap(item.corners, corners, TOLERANCE)));
  const targets = standing.filter(({ category }) => WALKWAY_TARGETS.includes(category));
  // A chair pulled up to a desk stands in front of it, but it gets pulled out to sit down.
  const desks = targets.filter(({ category }) => category === 'desk').map((desk) => rectCorners(fronts(desk, WALKER_RADIUS)[0]));
  const obstacles = standing.filter((item) => item.category !== 'chair' || !desks.some((front) => polygonsOverlap(item.corners, front, TOLERANCE)));
  // Only an obstacle can block a path, and every target is one.
  if (!doors.length || !targets.length || !subjects.some((subject) => obstacles.includes(subject))) return [];

  const grid = floorGrid(setup, doors.map(({ opening }) => opening));
  const cells = new Map(obstacles.map((item) => [item, cellsIn(grid, grown(item.rect, WALKER_RADIUS))]));
  for (const own of cells.values()) stamp(grid, own, 1);
  // Its front is reached once the walker's center is just past the WALKER_RADIUS it keeps from it.
  const goals = targets.map((target) => ({ target, cells: fronts(target, WALKER_RADIUS + CELL).flatMap((strip) => cellsIn(grid, strip)) }));
  const seeds = doors.map(({ opening }) => {
    const wall = setup.walls.find(({ id }) => id === opening.wallId)!; // openingZones skips Openings without one
    return { door: opening, cell: cellAt(grid, wallPoint(wall, opening.offset + opening.width / 2, WALKER_RADIUS)) };
  });

  const cut = cutOff(grid, seeds, goals);
  if (!cut.size) return [];
  return subjects.flatMap((subject): FitViolation[] => {
    const own = cells.get(subject);
    if (!own) return [];
    const door = cut.get(subject);
    stamp(grid, own, -1);
    const without = cutOff(grid, seeds, goals);
    stamp(grid, own, 1);
    const unreached: FitViolation[] = door ? [{ rule: 'walkway', subjectId: subject.id, otherId: door.id, message: 'No clear path from the door' }] : [];
    return [
      ...unreached,
      ...[...cut.keys()]
        .filter((target) => target !== subject && !without.has(target))
        .map((target): FitViolation => ({ rule: 'walkway', subjectId: subject.id, otherId: target.id, message: `Blocks the path to ${target.name}` })),
    ];
  });
}

/**
 * The targets the walkway from some door doesn't reach, each with the first such door. Each search
 * marks the cells it reaches with its door's index; a door inside another's walkway shares it.
 */
function cutOff(grid: Grid, seeds: { door: Opening; cell: number }[], goals: { target: Item; cells: number[] }[]): Map<Item, Opening> {
  const reached = new Int16Array(grid.blocked.length).fill(-1);
  const cut = new Map<Item, Opening>();
  seeds.forEach(({ door, cell }, index) => {
    if (cell >= 0 && reached[cell] === -1 && !grid.blocked[cell]) search(grid, cell, index, reached);
    const walkway = cell >= 0 ? reached[cell] : -1;
    for (const { target, cells } of goals) {
      if (!cut.has(target) && (walkway === -1 || !cells.some((goal) => reached[goal] === walkway))) cut.set(target, door);
    }
  });
  return cut;
}

/** Breadth-first search from a cell through the open cells next to each other, marking each with `mark`. */
function search({ cols, rows, blocked }: Grid, start: number, mark: number, reached: Int16Array) {
  const queue = new Int32Array(blocked.length);
  let [head, tail] = [0, 0];
  const visit = (cell: number) => {
    if (reached[cell] !== -1 || blocked[cell]) return;
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
}

/** The grid over a room's floor, with the cells off the floor, or within WALKER_RADIUS of a wall, blocked. */
function floorGrid({ floor: { polygon }, walls }: RoomSetup, doors: Opening[]): Grid {
  const [minX, minZ] = [Math.min(...polygon.map(([x]) => x)), Math.min(...polygon.map(([, z]) => z))];
  const cols = Math.ceil((Math.max(...polygon.map(([x]) => x)) - minX) / CELL);
  const rows = Math.ceil((Math.max(...polygon.map(([, z]) => z)) - minZ) / CELL);
  const grid = { minX, minZ, cols, rows, blocked: new Uint8Array(cols * rows).fill(1) };
  // Row by row, the floor is between pairs of the polygon's edge crossings, as in pointInPolygon.
  for (let j = 0; j < rows; j++) {
    const z = minZ + (j + 0.5) * CELL;
    const crossings = polygon.flatMap(([xi, zi], i) => {
      const [xj, zj] = polygon[(i + 1) % polygon.length];
      return zi > z !== zj > z ? [xi + ((z - zi) * (xj - xi)) / (zj - zi)] : [];
    }).sort((a, b) => a - b);
    for (let k = 0; k + 1 < crossings.length; k += 2) {
      for (let i = Math.max(0, Math.ceil((crossings[k] - minX) / CELL - 0.5)); i < cols && minX + (i + 0.5) * CELL < crossings[k + 1]; i++) {
        grid.blocked[j * cols + i] = 0;
      }
    }
  }
  // Along the walls, except through a doorway.
  for (const wall of walls) {
    const length = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]);
    const doorways = doors.filter(({ wallId }) => wallId === wall.id).map(({ offset, width }) => [offset, offset + width]);
    let from = 0;
    for (const [doorStart, doorEnd] of [...doorways.sort(([a], [b]) => a - b), [length, length]]) {
      if (doorStart > from) blockNear(grid, wallPoint(wall, from), wallPoint(wall, doorStart));
      from = Math.max(from, doorEnd);
    }
  }
  return grid;
}

/** Blocks the cells within WALKER_RADIUS of the segment from a to b. */
function blockNear(grid: Grid, a: Vec2, b: Vec2) {
  const { minX, minZ, cols, blocked } = grid;
  const [i0, i1, j0, j1] = cellBounds(grid, [a, b], WALKER_RADIUS);
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      if (distanceToSegment([minX + (i + 0.5) * CELL, minZ + (j + 0.5) * CELL], a, b) < WALKER_RADIUS) blocked[j * cols + i] = 1;
    }
  }
}

/** The cell a floor point is in, or −1 off the grid. */
function cellAt({ minX, minZ, cols, rows }: Grid, [x, z]: Vec2): number {
  const [i, j] = [Math.floor((x - minX) / CELL), Math.floor((z - minZ) / CELL)];
  return i >= 0 && i < cols && j >= 0 && j < rows ? j * cols + i : -1;
}

/** The first and last columns, then rows, of the cells within `margin` of the box around some points. */
function cellBounds({ minX, minZ, cols, rows }: Grid, points: Vec2[], margin = 0): [number, number, number, number] {
  const span = (values: number[], min: number, count: number) => [
    Math.max(0, Math.floor((Math.min(...values) - margin - min) / CELL)),
    Math.min(count - 1, Math.floor((Math.max(...values) + margin - min) / CELL)),
  ];
  return [...span(points.map(([x]) => x), minX, cols), ...span(points.map(([, z]) => z), minZ, rows)] as [number, number, number, number];
}

/** The cells whose centers are inside a rectangle. */
function cellsIn(grid: Grid, rect: OrientedRect): number[] {
  const { minX, minZ, cols } = grid;
  const [i0, i1, j0, j1] = cellBounds(grid, rectCorners(rect));
  const { center: [cx, cz], size: [width, depth], rotationY } = rect;
  const [cos, sin] = [Math.cos(rotationY), Math.sin(rotationY)];
  const cells: number[] = [];
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      // The cell center in the rectangle's own frame: the turn rectCorners makes, undone.
      const [dx, dz] = [minX + (i + 0.5) * CELL - cx, minZ + (j + 0.5) * CELL - cz];
      if (Math.abs(dx * cos - dz * sin) < width / 2 && Math.abs(dx * sin + dz * cos) < depth / 2) cells.push(j * cols + i);
    }
  }
  return cells;
}

const stamp = (grid: Grid, cells: number[], change: 1 | -1) => {
  for (const cell of cells) grid.blocked[cell] += change;
};

/** A rectangle grown by `margin` on every side. */
const grown = ({ center, size: [width, depth], rotationY }: OrientedRect, margin: number): OrientedRect =>
  ({ center, size: [width + 2 * margin, depth + 2 * margin], rotationY });

/** The strips, `depth` deep, along an item's front, where someone stands to use it; a bed's long sides too. */
function fronts({ category, rect: { center: [cx, cz], size: [width, depth], rotationY } }: Item, stripDepth: number): OrientedRect[] {
  const [cos, sin] = [Math.cos(rotationY), Math.sin(rotationY)];
  const strip = (x: number, z: number, size: Vec2): OrientedRect => ({ center: [cx + x * cos + z * sin, cz - x * sin + z * cos], size, rotationY });
  const front = strip(0, (depth + stripDepth) / 2, [width, stripDepth]);
  if (category !== 'bed') return [front];
  return [front, strip((width + stripDepth) / 2, 0, [stripDepth, depth]), strip(-(width + stripDepth) / 2, 0, [stripDepth, depth])];
}

/** How far a floor point is from the segment between a and b. */
function distanceToSegment([px, pz]: Vec2, [ax, az]: Vec2, [bx, bz]: Vec2): number {
  const [dx, dz] = [bx - ax, bz - az];
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(px - ax - t * dx, pz - az - t * dz);
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
