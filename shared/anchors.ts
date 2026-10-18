import { checkFit, type Item as RoomItem, roomItems, TOLERANCE } from './fit';
import { distanceToWall, footprint, type OrientedRect, polygonsOverlap, rectCorners, rectInPolygon, wallPoint } from './geometry';
import type { Catalog, CatalogItem, FitViolation, Placement, RoomSetup, RoomState, Vec2, Wall } from './types';

/** How far, in meters, each step slides a Placement that breaks a Fit rule. */
const STEP = 0.1;
/** How far it may slide each way. */
const MAX_SLIDE = 1;
/** The slides to try, nearest first: 0, +0.1, −0.1, +0.2, … −1. */
const SLIDES = [0, ...Array.from({ length: Math.round(MAX_SLIDE / STEP) }, (_, i) => [(i + 1) * STEP, -(i + 1) * STEP]).flat()];
/** How far apart, in meters, the spots open_floor looks at are. */
const SPOT_SPACING = 0.1;
/** How many open-floor spots are checked against the Fit rules, best first, before giving up: each check is a walkway search. */
const OPEN_FLOOR_TRIES = 20;
/** How far apart those spots are, at least, so that they spread over the room instead of crowding the best one. */
const OPEN_FLOOR_SPREAD = 0.5;
/** How high the center of a wall item hangs unless the Anchor says otherwise: 57″, the gallery standard. */
const CENTER_HEIGHT = 1.45;
/** Slack for floating point when a slide is checked against how far it may go. */
const EPSILON = 1e-9;

/**
 * Where along a wall, seen from inside the room facing it: flush with its left end, centered, flush
 * with its right end, or a fraction from left (0) to right (1).
 */
export type Along = 'left' | 'center' | 'right' | number;

/** A placement described by its relationship to the room instead of by coordinates (spec §13.2). */
export type Anchor =
  | { kind: 'against_wall'; wall_id: string; along: Along }
  | { kind: 'beside'; target_id: string; side: 'left' | 'right' | 'front' }
  | { kind: 'under_window'; opening_id: string }
  | { kind: 'on_wall'; wall_id: string; along: Along; center_height_m?: number }
  | { kind: 'on_top_of'; target_id: string }
  | { kind: 'centered_under'; target_id: string }
  | { kind: 'open_floor'; near_id?: string };

/** A resolved Anchor: the Placement it stands for, or why there is none. */
export type Resolution = { placement: Placement } | { error: string; violations: FitViolation[] };

/** The Placements an Anchor allows, the one nearest to what it asks for first, and what to say when none fits; or why it allows none. */
type Candidates = { placements: Placement[]; noFit: string } | { error: string };

/** The Placement an Anchor stands for, for a new Piece of `item` in the room (spec §13.2). */
export function resolveAnchor(setup: RoomSetup, catalog: Catalog, state: RoomState, item: CatalogItem, anchor: Anchor): Resolution {
  const candidates = candidatesFor(setup, roomItems(setup, catalog, state), item, anchor);
  if ('error' in candidates) return { error: candidates.error, violations: [] };
  const withItem = { ...catalog, items: [...catalog.items, item] };
  // The new Piece goes by its Catalog id while it is checked, so that is how violations name it.
  const violations = (placement: Placement) => checkFit(setup, withItem, {
    ...state, pieces: { ...state.pieces, [item.id]: { catalogId: item.id, placement, partColors: {} } },
  }, [item.id], { walkway: true });
  const placement = candidates.placements.find((candidate) => !violations(candidate).length);
  if (placement) return { placement };
  const [asked] = candidates.placements;
  return { error: candidates.noFit, violations: asked ? violations(asked) : [] };
}

/** The Placements an Anchor allows for `item`, before the Fit rules pick among them, or why it allows none. */
function candidatesFor(setup: RoomSetup, inRoom: RoomItem[], item: CatalogItem, anchor: Anchor): Candidates {
  const [width, height, depth] = item.size;
  /** The Placement, then the Placement slid along the unit vector [ax, az], from `min` to `max` meters. */
  const sliding = (placement: Placement, [ax, az]: Vec2, [min, max]: [number, number]): Candidates => {
    const [x, y, z] = placement.position;
    return {
      placements: SLIDES
        .filter((slide) => slide >= min - EPSILON && slide <= max + EPSILON)
        .map((slide): Placement => ({ ...placement, position: [x + ax * slide, y, z + az * slide] })),
      noFit: `${item.title} doesn't fit there, even slid up to ${MAX_SLIDE} m either way`,
    };
  };
  /**
   * Back flush to a wall, its center `along` meters from the wall's start, sliding along the wall
   * but keeping that center within `[from, to]`, by default where the item stays on the wall: on the
   * floor, or hung with its center `centerHeight` up.
   */
  const flushTo = (wall: Wall, along: number, { centerHeight, from = width / 2, to = wallLength(wall) - width / 2 }:
    { centerHeight?: number; from?: number; to?: number } = {}): Candidates => {
    if (width > wallLength(wall) + EPSILON) return { error: `${item.title} is wider than the ${wall.name}` };
    const [x, z] = wallPoint(wall, along, depth / 2);
    const rotationY = facing(wall.normal);
    const range: [number, number] = [from - along, to - along];
    if (centerHeight === undefined) return sliding({ position: [x, 0, z], rotationY, mount: 'floor' }, direction(wall), range);
    const bottom = centerHeight - height / 2;
    if (bottom < 0 || bottom + height > wall.height) {
      const where = `the ${wall.name} ${centerHeight} m up`;
      return { error: `${item.title}, ${height} m tall, doesn't fit on ${where}: the wall is ${wall.height} m tall` };
    }
    return sliding({ position: [x, bottom, z], rotationY, mount: 'wall', wallId: wall.id }, direction(wall), range);
  };
  const wallOf = (id: string) => setup.walls.find((wall) => wall.id === id);
  const targetOf = (id: string) => inRoom.find((target) => target.id === id);
  const noWall = (id: string) => ({ error: `The room has no wall "${id}"` });
  const noTarget = (id: string) => ({ error: `The room has no Original or Piece "${id}"` });

  // A wall item only hangs, and only a wall item hangs.
  if (item.mount === 'wall' && anchor.kind !== 'on_wall') return { error: `${item.title} hangs on a wall: use on_wall` };
  if (item.mount !== 'wall' && anchor.kind === 'on_wall') {
    return { error: `${item.title} stands on the floor: on_wall is for wall items` };
  }
  switch (anchor.kind) {
    case 'against_wall':
    case 'on_wall': {
      const { along } = anchor;
      const wall = wallOf(anchor.wall_id);
      if (!wall) return noWall(anchor.wall_id);
      if (typeof along === 'number' && !(along >= 0 && along <= 1)) {
        return { error: `along goes from 0 (the left end) to 1 (the right end), not ${along}` };
      }
      const centerHeight = anchor.kind === 'on_wall' ? anchor.center_height_m ?? CENTER_HEIGHT : undefined;
      return flushTo(wall, fromStart(wall, width, along), { centerHeight });
    }
    case 'under_window': {
      const opening = setup.openings.find(({ id }) => id === anchor.opening_id);
      if (!opening) return { error: `The room has no window "${anchor.opening_id}"` };
      if (opening.kind !== 'window') return { error: `${opening.id} is a ${opening.kind}, not a window` };
      const wall = wallOf(opening.wallId);
      if (!wall) return noWall(opening.wallId);
      // It slides along the wall, but its center stays under the window.
      const [from, to] = [Math.max(width / 2, opening.offset), Math.min(wallLength(wall) - width / 2, opening.offset + opening.width)];
      return flushTo(wall, opening.offset + opening.width / 2, { from, to });
    }
    case 'beside': {
      const target = targetOf(anchor.target_id);
      if (!target) return noTarget(anchor.target_id);
      const { placement: { rotationY }, rect: { size: [targetWidth, targetDepth] } } = target;
      // Beside it, backs in line; in front of it, facing it. It slides along the side it is at, but
      // its center never past that side's ends, so that it stays next to the target.
      const { across, out, turn, axis, min, max } = anchor.side === 'front'
        ? {
          across: 0,
          out: targetDepth / 2 + depth / 2,
          turn: Math.PI,
          axis: rightOf(rotationY),
          min: -targetWidth / 2,
          max: targetWidth / 2,
        }
        : {
          across: (anchor.side === 'right' ? 1 : -1) * (targetWidth / 2 + width / 2),
          out: depth / 2 - targetDepth / 2,
          turn: 0,
          axis: frontOf(rotationY),
          min: -depth / 2,
          max: targetDepth - depth / 2,
        };
      const [x, z] = inFrameOf(target.placement, [across, out]);
      return sliding({ position: [x, 0, z], rotationY: wrapped(rotationY + turn), mount: 'floor' }, axis, [min, max]);
    }
    case 'on_top_of': {
      const target = targetOf(anchor.target_id);
      if (!target) return noTarget(anchor.target_id);
      const { placement: { position: [x, , z], rotationY }, rect: { size: [targetWidth, targetDepth] }, heights: [, top] } = target;
      if (width > targetWidth + EPSILON || depth > targetDepth + EPSILON) {
        return { error: `${item.title} doesn't fit on top of ${target.name}` };
      }
      // Across the top, never off its sides.
      const slack = (targetWidth - width) / 2;
      return sliding({ position: [x, top, z], rotationY, mount: 'surface' }, rightOf(rotationY), [-slack, slack]);
    }
    case 'centered_under': {
      if (item.category !== 'rug') {
        return { error: `Only a rug goes centered under something: ${item.title} is a ${item.category.replace('_', ' ')}` };
      }
      const target = targetOf(anchor.target_id);
      if (!target) return noTarget(anchor.target_id);
      const { placement: { rotationY }, rect: { size: [, targetDepth] } } = target;
      // Its long side runs across the target, as a rug goes under a bed or a sofa. A third of
      // how far it reaches out goes under the target's front, so its center is a sixth past it.
      const [reach, turn] = width >= depth ? [depth, 0] : [width, Math.PI / 2];
      const [x, z] = inFrameOf(target.placement, [0, targetDepth / 2 + reach / 6]);
      // It slides further under the target, or out from it until only a sixth of it is under, staying centered.
      const placement: Placement = { position: [x, 0, z], rotationY: wrapped(rotationY + turn), mount: 'floor' };
      return sliding(placement, frontOf(rotationY), [-Infinity, reach / 6]);
    }
    case 'open_floor': {
      const near = anchor.near_id === undefined ? undefined : targetOf(anchor.near_id);
      if (anchor.near_id !== undefined && !near) return noTarget(anchor.near_id);
      return { placements: openFloor(setup, inRoom, item, near), noFit: `No open floor fits ${item.title}` };
    }
  }
}

/**
 * Spots on open floor that `item` fits in, back to the nearest wall, best first: the farthest from
 * walls and furniture, or the nearest to `near`. Open floor is floor no furniture stands on, and
 * for a rug, no other rug lies on. The Fit rules, the walkway among them, then pick among them.
 */
function openFloor(setup: RoomSetup, inRoom: RoomItem[], item: CatalogItem, near?: RoomItem): Placement[] {
  const { polygon } = setup.floor;
  const obstacles = inRoom.filter(({ category, placement }) =>
    placement.mount === 'floor' && (category !== 'rug' || item.category === 'rug'));
  const [xs, zs] = [polygon.map(([x]) => x), polygon.map(([, z]) => z)];
  const [minX, minZ] = [Math.min(...xs), Math.min(...zs)];
  const [cols, rows] = [Math.ceil((Math.max(...xs) - minX) / SPOT_SPACING), Math.ceil((Math.max(...zs) - minZ) / SPOT_SPACING)];
  const spots: { placement: Placement; clearance: number; nearness: number }[] = [];
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const point: Vec2 = [minX + (i + 0.5) * SPOT_SPACING, minZ + (j + 0.5) * SPOT_SPACING];
      // The walls it faces, by the distance to their planes: in a room with an inner corner, a
      // wall's plane can pass nearer than the wall itself, which only makes the spot look smaller.
      const walls = setup.walls.map((wall) => ({ wall, distance: distanceToWall(point, wall) })).filter(({ distance }) => distance >= 0);
      if (!walls.length) continue;
      const nearest = walls.reduce((a, b) => (b.distance < a.distance ? b : a));
      const placement: Placement = { position: [point[0], 0, point[1]], rotationY: facing(nearest.wall.normal), mount: 'floor' };
      const rect = footprint(placement, item.size);
      const corners = rectCorners(rect);
      const blocked = obstacles.some((obstacle) => polygonsOverlap(corners, obstacle.corners, TOLERANCE));
      if (blocked || !rectInPolygon(rect, polygon, TOLERANCE)) continue;
      const clearance = Math.min(nearest.distance, ...obstacles.map((obstacle) => distanceToRect(point, obstacle.rect)));
      spots.push({ placement, clearance, nearness: near ? distanceToRect(point, near.rect) : 0 });
    }
  }
  const tries: Placement[] = [];
  for (const { placement } of spots.sort((a, b) => a.nearness - b.nearness || b.clearance - a.clearance)) {
    const [x, , z] = placement.position;
    if (tries.every(({ position: [tx, , tz] }) => Math.hypot(x - tx, z - tz) >= OPEN_FLOOR_SPREAD)) tries.push(placement);
    if (tries.length === OPEN_FLOOR_TRIES) break;
  }
  return tries;
}

/** The rotationY that turns an item's front (+Z) toward `direction`. */
const facing = ([x, z]: Vec2) => Math.atan2(x, z);

/** An angle wrapped into the range −π to π. */
const wrapped = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));

/** The unit vector along an item's own +X: its right, seen facing its front. */
const rightOf = (rotationY: number): Vec2 => [Math.cos(rotationY), -Math.sin(rotationY)];

/** The unit vector along an item's own +Z: the way it faces. */
const frontOf = (rotationY: number): Vec2 => [Math.sin(rotationY), Math.cos(rotationY)];

/** The floor point at [x, z] in a Placement's own frame, where +Z is its front: as `rectCorners` turns them. */
function inFrameOf({ position: [cx, , cz], rotationY }: Placement, [x, z]: Vec2): Vec2 {
  const [cos, sin] = [Math.cos(rotationY), Math.sin(rotationY)];
  return [cx + x * cos + z * sin, cz - x * sin + z * cos];
}

/** How far a floor point is from a rectangle: 0 inside it. */
function distanceToRect([x, z]: Vec2, { center: [cx, cz], size: [width, depth], rotationY }: OrientedRect): number {
  const [dx, dz] = [x - cx, z - cz];
  const [cos, sin] = [Math.cos(rotationY), Math.sin(rotationY)];
  // Into the rectangle's own frame: the turn `inFrameOf` makes, undone.
  const [along, out] = [dx * cos - dz * sin, dx * sin + dz * cos];
  return Math.hypot(Math.max(0, Math.abs(along) - width / 2), Math.max(0, Math.abs(out) - depth / 2));
}

/** The fraction from a wall's left end to its right that each word for `along` stands for. */
const FRACTIONS = { left: 0, center: 0.5, right: 1 };

/** How long a wall is, in meters. */
const wallLength = ({ start: [sx, sz], end: [ex, ez] }: Wall) => Math.hypot(ex - sx, ez - sz);

/** The unit vector from a wall's start toward its end. */
const direction = (wall: Wall): Vec2 => {
  const length = wallLength(wall);
  return [(wall.end[0] - wall.start[0]) / length, (wall.end[1] - wall.start[1]) / length];
};

/** How far from a wall's start the center of an item `width` wide goes, at `along` it. */
function fromStart(wall: Wall, width: number, along: Along): number {
  const { start: [sx, sz], end: [ex, ez], normal: [nx, nz] } = wall;
  const length = wallLength(wall);
  const fromLeft = width / 2 + (typeof along === 'number' ? along : FRACTIONS[along]) * (length - width);
  // Seen from inside the room, facing the wall, right is [nz, −nx].
  const startIsLeft = (ex - sx) * nz - (ez - sz) * nx > 0;
  return startIsLeft ? fromLeft : length - fromLeft;
}
