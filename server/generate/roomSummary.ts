import { BY_WALL, isFurniture, partParamsOf, restingHeight, wallBehind } from '../../shared/anchors';
import { checkFit, type Item, roomItems } from '../../shared/fit';
import {
  distanceToWall, fromLeft, gapTo, isBy, overlapLength, pointInPolygon, polygonsOverlap, rectCorners, spanFromLeft, wallLength, wallPoint,
} from '../../shared/geometry';
import type { Catalog, CatalogItem, Category, Placement, RoomSetup, RoomState, Vec2, Wall } from '../../shared/types';
import { m } from './forClaude';

/** The room as Claude reads it before it designs (spec §13.1, step 2), with where decor can go. */
export interface RoomSummary {
  room: { width_m: number; depth_m: number; ceiling_height_m: number };
  /** The parts of the floor: the main area furniture goes in, and the passages and alcoves off it. */
  layout: Layout;
  walls: { id: string; name: string; length_m: number }[];
  openings: {
    id: string;
    kind: 'door' | 'window';
    wall_id: string;
    /** "North wall, left side" */
    position: string;
    /** How far its left edge is from the wall's left end, seen from inside the room facing the wall. */
    from_left_m: number;
    width_m: number;
    bottom_m: number;
    height_m: number;
  }[];
  originals: {
    id: string;
    label: string;
    category: Category;
    kept: boolean;
    size_m: { width: number; height: number; depth: number };
    /** "against the North wall, left side, in the corner with the West wall" */
    position: string;
  }[];
  /** The largest rectangles of floor nothing stands on, largest first. */
  free_floor: { width_m: number; depth_m: number; position: string; next_to: string[] }[];
  /** How many Catalog items each category has. */
  catalog: Partial<Record<Category, number>>;
  decor: { wall_spans: WallSpan[]; tops: Top[] };
}

/** The parts of the floor, from the room's shape alone. */
interface Layout {
  /** The largest rectangle of floor: where the furniture goes. */
  main: Area;
  /** Narrow parts of the floor with a door, such as an entry hall: the way in, kept clear of furniture. */
  passages: (Area & { doors: string[] })[];
  /** Any other part of the floor off the main area, such as a nook. */
  alcoves: (Area & { doors: string[] })[];
}

/** A part of the floor: its size, square to the longest wall, and the stretches of wall along it. */
interface Area {
  width_m: number;
  depth_m: number;
  /** From each wall's left end, seen from inside the room; `along` is the same stretch as against_wall's 0 to 1. */
  walls: { wall_id: string; from_left_m: number; to_left_m: number; along: [number, number] }[];
}

/** A stretch of wall that art can hang on, 1.0 to 2.0 m up, measured from the wall's left end seen from inside the room. */
interface WallSpan {
  wall_id: string;
  from_left_m: number;
  to_left_m: number;
  width_m: number;
  /** The furniture against the wall under the span, and how tall it is: what art can hang over. */
  below: { id: string; label: string; from_left_m: number; to_left_m: number; top_m: number }[];
}

/** A furniture top that decor can rest on: an Original's or a Piece's. */
interface Top {
  target_id: string;
  label: string;
  category: Category;
  /** How high above the floor decor rests on it: on a bed, the bedding. */
  top_m: number;
  width_m: number;
  depth_m: number;
  /** The ids of what already rests on it. */
  holds: string[];
}

/** How close, in meters, an item stands to a wall to be against it. */
const AGAINST = 0.15;
/** An item farther than this from every wall stands in the middle of the room. */
const MIDDLE = 1;
/** The size of a cell of the grid free floor is looked for on. */
const CELL = 0.1;
/** How many free floor rectangles to list, and the smallest side one may have. */
const FREE_FLOOR_COUNT = 3;
const FREE_FLOOR_MIN_SIDE = 0.5;
/** The height band wall art hangs in. */
const ART_BAND: [number, number] = [1, 2];
/** The shortest art worth hanging: furniture that leaves less of the band than this above it hides the wall. */
const SMALLEST_ART = 0.3;
/** How far art keeps from the edges of an Opening. */
const OPENING_MARGIN = 0.1;
/** The narrowest wall span worth listing: about one small frame. */
const MIN_SPAN = 0.4;
/** A part of the floor this narrow or narrower, with a door, is a passage: the way in. */
const PASSAGE_WIDTH = 1.8;
/** Parts of the floor smaller than this, in square meters, or narrower than SLIVER, are left out: jogs in the walls. */
const MIN_PART_AREA = 0.5;
const SLIVER = 0.4;
/** How far into the room a wall is probed for the part of the floor along it. */
const WALL_PROBE = 0.2;
/** What decor rests on top of. */
export const TOP_CATEGORIES: Category[] = ['bed', 'desk', 'table', 'nightstand', 'dresser', 'shelf', 'storage'];

/** The Room Summary of a Scan in the state a Design has it (spec §13.1), for Claude's first message. */
export function roomSummary(setup: RoomSetup, catalog: Catalog, state: RoomState): RoomSummary {
  const items = roomItems(setup, catalog, state);
  const partParams = partParamsOf(setup, catalog, state);
  const label = (id: string) => setup.originals.find((original) => original.id === id)?.label
    ?? catalog.items.find((item) => item.id === state.pieces[id]?.catalogId)?.title ?? id;
  const { polygon } = setup.floor;
  const bounds: Bounds = {
    minX: Math.min(...polygon.map(([x]) => x)), maxX: Math.max(...polygon.map(([x]) => x)),
    minZ: Math.min(...polygon.map(([, z]) => z)), maxZ: Math.max(...polygon.map(([, z]) => z)),
  };

  return {
    room: { width_m: m(bounds.maxX - bounds.minX), depth_m: m(bounds.maxZ - bounds.minZ), ceiling_height_m: m(setup.ceilingHeight) },
    layout: layout(setup),
    walls: setup.walls.map((wall) => ({ id: wall.id, name: wall.name, length_m: m(wallLength(wall)) })),
    openings: setup.openings.flatMap(({ id, kind, wallId, offset, width, bottom, height }) => {
      const wall = setup.walls.find((candidate) => candidate.id === wallId);
      if (!wall) return [];
      const [left] = fromLeft(wall, [offset, offset + width]);
      const position = `${wall.name}, ${side((left + width / 2) / wallLength(wall))}`;
      return [{ id, kind, wall_id: wallId, position, from_left_m: m(left), width_m: m(width), bottom_m: m(bottom), height_m: m(height) }];
    }),
    originals: setup.originals.flatMap(({ id, label: originalLabel, category, kept, box: { size: [width, height, depth] } }) => {
      const item = items.find((candidate) => candidate.id === id);
      if (!item) return [];
      return [{ id, label: originalLabel, category, kept, size_m: { width: m(width), height: m(height), depth: m(depth) }, position: whereItStands(setup.walls, item) }];
    }),
    free_floor: freeFloor(setup, catalog, state, items, bounds),
    catalog: catalog.items.reduce<RoomSummary['catalog']>((counts, { category }) => ({ ...counts, [category]: (counts[category] ?? 0) + 1 }), {}),
    decor: {
      wall_spans: setup.walls.flatMap((each) => wallSpans(setup, each, items, label)),
      tops: items
        .filter(({ category, placement }) => placement.mount === 'floor' && TOP_CATEGORIES.includes(category))
        .map((top): Top => {
          const height = restingHeight(top, partParams(top.id));
          return {
            target_id: top.id,
            label: label(top.id),
            category: top.category,
            top_m: m(height),
            width_m: m(top.rect.size[0]),
            depth_m: m(top.rect.size[1]),
            holds: items.filter((other) => restsOn(other, top, height)).map(({ id }) => id),
          };
        }),
    },
  };
}

/** Which third of a wall a fraction of its length from the left end is in. */
const side = (fraction: number) => (fraction < 1 / 3 ? 'left side' : fraction > 2 / 3 ? 'right side' : 'center');

/** Where an item stands, in words: "against the East wall, left side", or "in the middle of the room". */
function whereItStands(walls: Wall[], item: Item): string {
  const back = wallBehind(walls, item, AGAINST);
  if (!back) {
    const [nearest] = walls.map((wall) => ({ wall, gap: gapTo(wall, item) })).sort((a, b) => a.gap - b.gap);
    return !nearest || nearest.gap > MIDDLE ? 'in the middle of the room' : `${m(nearest.gap)} m out from the ${nearest.wall.name}`;
  }
  const [from, to] = spanFromLeft(back, item.corners);
  const corner = walls.find((wall) => wall !== back && isBy(wall, item, AGAINST));
  return `against the ${back.name}, ${side((from + to) / 2 / wallLength(back))}${corner ? `, in the corner with the ${corner.name}` : ''}`;
}

/** Whether `item` rests on `top`, whose decor rests `height` up: it stands on it, over it. */
function restsOn(item: Item, top: Item, height: number) {
  const [x, , z] = item.placement.position;
  return item !== top && item.placement.mount === 'surface' && pointInPolygon([x, z], top.corners) && Math.abs(item.heights[0] - height) < 0.05;
}

/**
 * The spans of a wall that art can hang on: the wall 1.0 to 2.0 m up, less its Openings (and 10 cm
 * around them), what already hangs there, and furniture against it too tall to hang art over in the band.
 * Lower furniture is listed under the span: on_wall_over hangs art clear of it.
 */
function wallSpans(setup: RoomSetup, wall: Wall, items: Item[], label: (id: string) => string): WallSpan[] {
  const inBand = ([bottom, top]: [number, number]) => overlapLength([bottom, top], ART_BAND) > 0;
  const openings = setup.openings
    .filter(({ wallId, bottom, height }) => wallId === wall.id && inBand([bottom, bottom + height]))
    .map(({ offset, width }): [number, number] => {
      const [from, to] = fromLeft(wall, [offset, offset + width]);
      return [from - OPENING_MARGIN, to + OPENING_MARGIN];
    });
  const byWall = items.filter((item) => item.category !== 'rug' && isBy(wall, item, BY_WALL));
  const onWall = ({ placement }: Item) => placement.mount === 'wall' && placement.wallId === wall.id;
  const tall = (item: Item) => item.heights[1] > ART_BAND[1] - SMALLEST_ART;
  const blocked = [
    ...openings,
    ...byWall.filter((item) => (onWall(item) ? inBand(item.heights) : tall(item))).map(({ corners }) => spanFromLeft(wall, corners)),
  ];
  const below = byWall.filter((item) => item.placement.mount !== 'wall' && !tall(item));
  return subtract([0, wallLength(wall)], blocked)
    .filter(([from, to]) => to - from >= MIN_SPAN)
    .map(([from, to]) => ({
      wall_id: wall.id,
      from_left_m: m(from),
      to_left_m: m(to),
      width_m: m(to - from),
      below: below.flatMap((item) => {
        const [itemFrom, itemTo] = spanFromLeft(wall, item.corners);
        if (overlapLength([itemFrom, itemTo], [from, to]) <= 0) return [];
        const span = { from_left_m: m(Math.max(0, itemFrom)), to_left_m: m(Math.min(wallLength(wall), itemTo)) };
        return [{ id: item.id, label: label(item.id), ...span, top_m: m(item.heights[1]) }];
      }),
    }));
}

/** What is left of an interval once the others are taken out of it. */
function subtract([start, end]: [number, number], taken: [number, number][]): [number, number][] {
  const left: [number, number][] = [];
  let from = start;
  for (const [a, b] of taken.toSorted(([a], [b]) => a - b)) {
    if (a > from) left.push([from, Math.min(a, end)]);
    from = Math.max(from, b);
  }
  if (from < end) left.push([from, end]);
  return left.filter(([a, b]) => b > a);
}

/**
 * The parts of a room's floor, from its shape alone: the main area is the largest rectangle of floor, and
 * each other part is a passage when it's narrow and has a door, or else an alcove. Found on a CELL grid
 * square to the longest wall, so that a room scanned at an angle still lines up with it.
 */
function layout(setup: RoomSetup): Layout {
  const longest = setup.walls.reduce((best, wall) => (wallLength(wall) > wallLength(best) ? wall : best));
  const angle = Math.atan2(longest.end[1] - longest.start[1], longest.end[0] - longest.start[0]);
  const [cos, sin] = [Math.cos(angle), Math.sin(angle)];
  const square = ([x, z]: Vec2): Vec2 => [x * cos + z * sin, z * cos - x * sin];
  const polygon = setup.floor.polygon.map(square);
  const [minX, minZ] = [Math.min(...polygon.map(([x]) => x)), Math.min(...polygon.map(([, z]) => z))];
  const cols = Math.round((Math.max(...polygon.map(([x]) => x)) - minX) / CELL);
  const rows = Math.round((Math.max(...polygon.map(([, z]) => z)) - minZ) / CELL);
  const floor = Array.from({ length: rows }, (_, row) =>
    Array.from({ length: cols }, (_, col) => pointInPolygon([minX + (col + 0.5) * CELL, minZ + (row + 0.5) * CELL], polygon)));

  // Each cell's part: 0 the main area, 1 on for the others, −1 off the floor.
  const main = largestRectangle(floor)!;
  const inMain = (row: number, col: number) => row >= main.row && row < main.row + main.rows && col >= main.col && col < main.col + main.cols;
  const part = floor.map((cells, row) => cells.map((cell, col): number | undefined => (!cell ? -1 : inMain(row, col) ? 0 : undefined)));
  const parts = [{ rows: main.rows, cols: main.cols, cells: main.rows * main.cols }];
  part.forEach((cells, row) => cells.forEach((cell, col) => {
    if (cell !== undefined) return;
    // The cells next to each other that no part has yet are a new one.
    const id = parts.length;
    let [cells0, rowRange, colRange] = [0, [row, row], [col, col]];
    const queue: [number, number][] = [[row, col]];
    part[row][col] = id;
    while (queue.length) {
      const [r, c] = queue.pop()!;
      cells0++;
      rowRange = [Math.min(rowRange[0], r), Math.max(rowRange[1], r)];
      colRange = [Math.min(colRange[0], c), Math.max(colRange[1], c)];
      for (const [nr, nc] of [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]]) {
        if (part[nr]?.[nc] === undefined && nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
          part[nr][nc] = id;
          queue.push([nr, nc]);
        }
      }
    }
    parts.push({ rows: rowRange[1] - rowRange[0] + 1, cols: colRange[1] - colRange[0] + 1, cells: cells0 });
  }));
  const partAt = (point: Vec2) => {
    const [x, z] = square(point);
    return part[Math.floor((z - minZ) / CELL)]?.[Math.floor((x - minX) / CELL)] ?? -1;
  };

  // The stretches of each wall along each part, found by probing the floor just in front of the wall.
  const walls = parts.map((): Area['walls'] => []);
  for (const wall of setup.walls) {
    const length = wallLength(wall);
    let run: { part: number; from: number } | undefined;
    const close = (to: number) => {
      if (!run || run.part < 0 || to - run.from < SLIVER) return;
      const [from, toLeft] = fromLeft(wall, [run.from, to]);
      walls[run.part].push({ wall_id: wall.id, from_left_m: m(from), to_left_m: m(toLeft), along: [m(from / length), m(toLeft / length)] });
    };
    for (let along = CELL / 2; along < length; along += CELL) {
      const here = partAt(wallPoint(wall, along, WALL_PROBE));
      if (here === run?.part) continue;
      close(along - CELL / 2);
      run = { part: here, from: Math.max(0, along - CELL / 2) };
    }
    close(length);
  }
  const doors = (id: number) => setup.openings.filter((opening) => {
    const wall = setup.walls.find(({ id: wallId }) => wallId === opening.wallId);
    return opening.kind === 'door' && wall && partAt(wallPoint(wall, opening.offset + opening.width / 2, WALL_PROBE)) === id;
  }).map(({ id: openingId }) => openingId);

  const area = (id: number): Area => ({ width_m: m(parts[id].cols * CELL), depth_m: m(parts[id].rows * CELL), walls: walls[id] });
  const others = parts.flatMap(({ rows: partRows, cols: partCols, cells }, id) => {
    if (!id || cells * CELL ** 2 < MIN_PART_AREA || Math.min(partRows, partCols) * CELL < SLIVER) return [];
    const each = { ...area(id), doors: doors(id) };
    return [{ each, passage: Math.min(partRows, partCols) * CELL <= PASSAGE_WIDTH && each.doors.length > 0 }];
  });
  return {
    main: area(0),
    passages: others.filter(({ passage }) => passage).map(({ each }) => each),
    alcoves: others.filter(({ passage }) => !passage).map(({ each }) => each),
  };
}

/** The box around the room's floor. */
interface Bounds { minX: number; maxX: number; minZ: number; maxZ: number }

/** The id the free floor probe goes by: no Piece or Catalog item has it. */
const PROBE = '__free_floor_probe';

/**
 * The largest rectangles of floor a Piece could stand on, largest first: square to the room, on a
 * 10 cm grid, where a low probe breaks no Fit rule. So they leave out furniture, the door swing and
 * anything off the floor, but not rugs, which furniture stands on.
 */
function freeFloor(setup: RoomSetup, catalog: Catalog, state: RoomState, items: Item[], { minX, maxX, minZ, maxZ }: Bounds): RoomSummary['free_floor'] {
  const probe: CatalogItem = { ...catalog.items[0], id: PROBE, category: 'decor', mount: 'floor', size: [CELL, 0.05, CELL] };
  const withProbe = { ...catalog, items: [...catalog.items, probe] };
  const [cols, rows] = [Math.round((maxX - minX) / CELL), Math.round((maxZ - minZ) / CELL)];
  const free = Array.from({ length: rows }, (_, row) => Array.from({ length: cols }, (_, col) => {
    const placement: Placement = { position: [minX + (col + 0.5) * CELL, 0, minZ + (row + 0.5) * CELL], rotationY: 0, mount: 'floor' };
    const probed = { ...state, pieces: { ...state.pieces, [PROBE]: { catalogId: PROBE, placement, partColors: {} } } };
    return !checkFit(setup, withProbe, probed, [PROBE]).length;
  }));

  const found: RoomSummary['free_floor'] = [];
  for (let i = 0; i < FREE_FLOOR_COUNT; i++) {
    const rect = largestRectangle(free);
    if (!rect || Math.min(rect.cols, rect.rows) * CELL < FREE_FLOOR_MIN_SIDE - 1e-9) break;
    for (let row = rect.row; row < rect.row + rect.rows; row++) free[row].fill(false, rect.col, rect.col + rect.cols);
    const [width, depth] = [rect.cols * CELL, rect.rows * CELL];
    const center: Vec2 = [minX + (rect.col + rect.cols / 2) * CELL, minZ + (rect.row + rect.rows / 2) * CELL];
    const corners = rectCorners({ center, size: [width, depth], rotationY: 0 });
    found.push({
      width_m: m(width),
      depth_m: m(depth),
      position: whereFloorIs(setup.walls, center),
      next_to: items
        .filter((item) => isFurniture(item) && polygonsOverlap(corners, item.corners, -AGAINST))
        .map(({ id }) => id),
    });
  }
  return found;
}

/** Where a spot on the floor is, in words: in the middle of the room, or by its nearest walls. */
function whereFloorIs(walls: Wall[], point: Vec2): string {
  const near = walls.filter((wall) => distanceToWall(point, wall) <= MIDDLE).toSorted((a, b) => distanceToWall(point, a) - distanceToWall(point, b));
  if (!near.length) return 'in the middle of the room';
  return near.length === 1 ? `by the ${near[0].name}` : `in the corner of the ${near[0].name} and the ${near[1].name}`;
}

/** The largest rectangle of true cells in a grid of rows, by the largest rectangle under each row's histogram. */
function largestRectangle(grid: boolean[][]): { row: number; col: number; rows: number; cols: number } | undefined {
  let best: { row: number; col: number; rows: number; cols: number } | undefined;
  const heights = new Array<number>(grid[0]?.length ?? 0).fill(0);
  grid.forEach((cells, row) => {
    cells.forEach((cell, col) => (heights[col] = cell ? heights[col] + 1 : 0));
    // Each bar's rectangle spans the bars around it that are at least as tall.
    const stack: number[] = [];
    for (let col = 0; col <= heights.length; col++) {
      const height = col < heights.length ? heights[col] : 0;
      while (stack.length && heights[stack.at(-1)!] >= height) {
        const tall = heights[stack.pop()!];
        const from = stack.length ? stack.at(-1)! + 1 : 0;
        if (tall && (!best || tall * (col - from) > best.rows * best.cols)) best = { row: row - tall + 1, col: from, rows: tall, cols: col - from };
      }
      stack.push(col);
    }
  });
  return best;
}
