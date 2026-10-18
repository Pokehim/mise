import { checkFit, type Item as RoomItem, roomItems, TOLERANCE } from './fit';
import {
  alongFromStart, distanceToWall, footprint, isBy, type OrientedRect, overlapLength, polygonsOverlap, rectCorners, rectInPolygon,
  spanFromLeft, spanFromStart, startIsLeft, wallLength, wallPoint,
} from './geometry';
import { BEDDING_RANGE, HEADBOARD_DEPTH } from './parts';
import type { Catalog, CatalogItem, FitViolation, PartParams, Placement, RoomSetup, RoomState, Vec2, Wall } from './types';

/** How far, in meters, each step slides a Placement that breaks a Fit rule. */
const STEP = 0.1;
/** How far it may slide each way. */
export const MAX_SLIDE = 1;
/** The slides to try, nearest first: 0, +0.1, −0.1, +0.2, … −1. */
const SLIDES = [0, ...Array.from({ length: Math.round(MAX_SLIDE / STEP) }, (_, i) => [(i + 1) * STEP, -(i + 1) * STEP]).flat()];
/** How far apart, in meters, the spots open_floor looks at are. */
const SPOT_SPACING = 0.1;
/** How many open-floor spots are checked against the Fit rules, best first, before giving up: each check is a walkway search. */
const OPEN_FLOOR_TRIES = 20;
/** How far apart those spots are, at least, so that they spread over the room instead of crowding the best one. */
const OPEN_FLOOR_SPREAD = 0.5;
/** How high the center of a wall item hangs unless the Anchor says otherwise: 57″, the gallery standard. */
export const CENTER_HEIGHT = 1.45;
/** How far above the furniture under it a wall item hung over it keeps its bottom edge. */
const ABOVE_FURNITURE = 0.15;
/** How far apart, in meters, wall items hung beside each other are unless the Anchor says otherwise. */
export const GALLERY_GAP = 0.08;
/** How close to a wall, in meters, furniture stands to be against it: wall items hang over it, or behind it. */
export const BY_WALL = 0.3;
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
  /** Hung centered over furniture against the wall, `offset_m` to the right seen facing it; clear of the furniture by default. */
  | { kind: 'on_wall_over'; target_id: string; wall_id?: string; offset_m?: number; center_height_m?: number }
  /** Hung beside another wall item on its wall, `gap_m` apart, centers level by default: a gallery wall's next frame. */
  | { kind: 'on_wall_beside'; target_id: string; side: 'left' | 'right'; gap_m?: number; center_height_m?: number }
  | { kind: 'on_top_of'; target_id: string; level?: number }
  | { kind: 'centered_under'; target_id: string }
  | { kind: 'open_floor'; near_id?: string };

/**
 * One level of a shelf that things can rest on, in the shelf's own frame (bottom-center origin, +Z
 * front): how high it is, the middle and size of its surface, and how much room is above it.
 */
export interface ShelfLevel { height: number; center: Vec2; size: Vec2; clearance: number }

/** What the resolver can't read from the room itself: the levels of Catalog shelves, by Catalog id, read from their models. */
export interface AnchorOptions { shelfLevels?: Record<string, ShelfLevel[]> }

/** A resolved Anchor: the Placement it stands for, or why there is none. */
export type Resolution = { placement: Placement } | { error: string; violations: FitViolation[] };

/** The Placements an Anchor allows, the one nearest to what it asks for first, and what to say when none fits. */
type Allowed = { placements: Placement[]; noFit: string };
/** The Placements an Anchor allows, or why it allows none. */
type Candidates = Allowed | { error: string };

/** The Placement an Anchor stands for, for a new Piece of `item` in the room (spec §13.2). */
export function resolveAnchor(
  setup: RoomSetup, catalog: Catalog, state: RoomState, item: CatalogItem, anchor: Anchor, { shelfLevels = {} }: AnchorOptions = {},
): Resolution {
  const catalogId = (id: string) => (Object.hasOwn(state.pieces, id) ? state.pieces[id].catalogId : undefined);
  const details: Details = { partParams: partParamsOf(setup, catalog, state), levels: (id) => shelfLevels[catalogId(id) ?? ''] };
  const candidates = candidatesFor(setup, roomItems(setup, catalog, state), item, anchor, details);
  if ('error' in candidates) return { error: candidates.error, violations: [] };
  const withItem = { ...catalog, items: [...catalog.items, item] };
  // The new Piece goes by its Catalog id while it is checked, so that is how violations name it.
  const violations = (placement: Placement) =>
    placementViolations(setup, withItem, { ...state, pieces: { ...state.pieces, [item.id]: { catalogId: item.id, placement, partColors: {} } } }, item.id);
  const placement = candidates.placements.find((candidate) => !violations(candidate).length);
  if (placement) return { placement };
  const [asked] = candidates.placements;
  return { error: candidates.noFit, violations: asked ? violations(asked) : [] };
}

/** The Part rule overrides of an Original or a Piece in the room, by its id. */
export function partParamsOf(setup: RoomSetup, catalog: Catalog, state: RoomState): (id: string) => PartParams | undefined {
  return (id) => setup.originals.find((original) => original.id === id)?.partParams
    ?? (Object.hasOwn(state.pieces, id) ? catalog.items.find(({ id: itemId }) => itemId === state.pieces[id].catalogId)?.partParams : undefined);
}

/**
 * The Fit rules a placement by Claude is held to (spec §13.2): every rule, the walkway among them, and
 * wall items kept clear of the furniture against their wall. `subjectId` is the item placed, already in `state`.
 */
export function placementViolations(setup: RoomSetup, catalog: Catalog, state: RoomState, subjectId: string): FitViolation[] {
  return [...checkFit(setup, catalog, state, [subjectId], { walkway: true }), ...clearOfWallItems(setup, roomItems(setup, catalog, state), subjectId)];
}

/** Furniture: what stands on the floor and isn't a rug, which furniture stands on. */
export const isFurniture = ({ category, placement }: Pick<RoomItem, 'category' | 'placement'>) => placement.mount === 'floor' && category !== 'rug';

/**
 * The stopgap for a Fit rule shared/fit.ts lacks: a wall item mustn't hang where furniture against
 * its wall rises past its bottom edge, which would clip into it, and furniture mustn't stand in front of one so.
 */
function clearOfWallItems(setup: RoomSetup, items: RoomItem[], subjectId: string): FitViolation[] {
  const subject = items.find(({ id }) => id === subjectId);
  if (!subject) return [];
  const clips = (art: RoomItem, other: RoomItem) => {
    const wall = setup.walls.find(({ id }) => id === art.placement.wallId);
    return !!wall && isBy(wall, other, BY_WALL) && other.heights[1] > art.heights[0] + TOLERANCE
      && overlapLength(spanFromLeft(wall, art.corners), spanFromLeft(wall, other.corners)) > TOLERANCE;
  };
  if (subject.placement.mount === 'wall') {
    return items.filter((other) => isFurniture(other) && clips(subject, other))
      .map((other) => ({ rule: 'overlap', subjectId, otherId: other.id, message: `Hangs behind ${other.name}` }));
  }
  if (!isFurniture(subject)) return [];
  return items.filter((other) => other.placement.mount === 'wall' && clips(other, subject))
    .map((other) => ({ rule: 'overlap', subjectId, otherId: other.id, message: `Stands in front of ${other.name}` }));
}

/** What the resolver knows of an Original or a Piece beyond its box, by its id: its Part rule overrides, and its shelf levels. */
interface Details {
  partParams: (id: string) => PartParams | undefined;
  levels: (id: string) => ShelfLevel[] | undefined;
}

/** The Placements an Anchor allows for `item`, before the Fit rules pick among them, or why it allows none. */
function candidatesFor(setup: RoomSetup, inRoom: RoomItem[], item: CatalogItem, anchor: Anchor, { partParams, levels }: Details): Candidates {
  const [width, height, depth] = item.size;
  /** The Placement, then the Placement slid along the unit vector [ax, az], from `min` to `max` meters. */
  const sliding = (placement: Placement, [ax, az]: Vec2, [min, max]: [number, number]): Allowed => {
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
  /** On one level of a shelf, across it but never off its sides, and only with room above. */
  const onLevel = (target: RoomItem, index: number): Candidates => {
    const shelf = levels(target.id) ?? [];
    const level = shelf[index];
    if (!level) {
      return { error: shelf.length ? `${target.name} has levels 0 (the bottom) to ${shelf.length - 1} (the top), not ${index}` : `${target.name} has no shelf levels` };
    }
    if (height > level.clearance + EPSILON) {
      return { error: `${item.title}, ${height} m tall, is too tall for level ${index} of ${target.name}: it has ${level.clearance} m above it` };
    }
    const [levelWidth, levelDepth] = level.size;
    if (width > levelWidth + EPSILON || depth > levelDepth + EPSILON) return { error: `${item.title} doesn't fit on level ${index} of ${target.name}` };
    const { placement, heights: [bottom] } = target;
    const [x, z] = inFrameOf(placement, level.center);
    const at: Placement = { position: [x, bottom + level.height, z], rotationY: placement.rotationY, mount: 'surface' };
    const slack = (levelWidth - width) / 2;
    return sliding(at, rightOf(placement.rotationY), [-slack, slack]);
  };
  const wallOf = (id: string) => setup.walls.find((wall) => wall.id === id);
  const targetOf = (id: string) => inRoom.find((target) => target.id === id);
  const noWall = (id: string) => ({ error: `The room has no wall "${id}"` });
  const noTarget = (id: string) => ({ error: `The room has no Original or Piece "${id}"` });

  // A wall item only hangs, and only a wall item hangs.
  const hangs = anchor.kind === 'on_wall' || anchor.kind === 'on_wall_over' || anchor.kind === 'on_wall_beside';
  if (item.mount === 'wall' && !hangs) return { error: `${item.title} hangs on a wall: use on_wall, on_wall_over or on_wall_beside` };
  if (item.mount !== 'wall' && hangs) return { error: `${item.title} stands on the floor: ${anchor.kind} is for wall items` };
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
    case 'on_wall_over': {
      const target = targetOf(anchor.target_id);
      if (!target) return noTarget(anchor.target_id);
      if (target.placement.mount === 'wall') return { error: `${target.name} hangs on a wall: use on_wall_beside` };
      const wall = anchor.wall_id === undefined ? wallBehind(setup.walls, target) : wallOf(anchor.wall_id);
      if (!wall) return anchor.wall_id === undefined ? { error: `${target.name} stands against no wall: give wall_id` } : noWall(anchor.wall_id);
      // Centered over the target, or offset to the right seen facing the wall, sliding but staying over it.
      const [from, to] = spanFromStart(wall, target.corners);
      const center = (from + to) / 2 + (startIsLeft(wall) ? 1 : -1) * (anchor.offset_m ?? 0);
      const centerHeight = anchor.center_height_m ?? Math.max(CENTER_HEIGHT, target.heights[1] + ABOVE_FURNITURE + height / 2);
      return flushTo(wall, center, { centerHeight, from: Math.max(width / 2, from), to: Math.min(wallLength(wall) - width / 2, to) });
    }
    case 'on_wall_beside': {
      const target = targetOf(anchor.target_id);
      if (!target) return noTarget(anchor.target_id);
      const wall = target.placement.mount === 'wall' ? wallOf(target.placement.wallId ?? '') : undefined;
      if (!wall) return { error: `${target.name} doesn't hang on a wall: use on_wall_over` };
      // Exactly the gap past the target's edge on that side: a gallery wall's spacing is the point, so it doesn't slide.
      const [from, to] = spanFromStart(wall, target.corners);
      const gap = anchor.gap_m ?? GALLERY_GAP;
      const center = (anchor.side === 'left') === startIsLeft(wall) ? from - gap - width / 2 : to + gap + width / 2;
      const centerHeight = anchor.center_height_m ?? (target.heights[0] + target.heights[1]) / 2;
      const beside = flushTo(wall, center, { centerHeight, from: Math.max(width / 2, center), to: Math.min(wallLength(wall) - width / 2, center) });
      const where = `${gap} m to the ${anchor.side} of ${target.name}`;
      return 'error' in beside ? beside : { ...beside, noFit: `${item.title} doesn't fit ${where}: try its other side, or another frame` };
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
      if (anchor.level !== undefined) return onLevel(target, anchor.level);
      const { placement, rect: { size: [targetWidth, targetDepth] } } = target;
      const { position: [x, , z], rotationY } = placement;
      const onBed = target.category === 'bed';
      if (width > targetWidth + EPSILON || depth > targetDepth - (onBed ? HEADBOARD_DEPTH : 0) + EPSILON) {
        return { error: `${item.title} doesn't fit on top of ${target.name}` };
      }
      // Across the top, never off its sides.
      const rest = restingHeight(target, partParams(target.id));
      const slack = (targetWidth - width) / 2;
      const across = (at: Placement) => sliding(at, rightOf(rotationY), [-slack, slack]);
      if (!onBed) return across({ position: [x, rest, z], rotationY, mount: 'surface' });
      // On a bed, it rests on the bedding, not on top of the headboard: first against the headboard,
      // as pillows go, then row by row toward the foot.
      const rows = Math.floor((targetDepth - HEADBOARD_DEPTH - depth) / STEP + EPSILON);
      const placements = Array.from({ length: rows + 1 }, (_, row) => {
        const [rowX, rowZ] = inFrameOf(placement, [0, -targetDepth / 2 + HEADBOARD_DEPTH + depth / 2 + row * STEP]);
        return across({ position: [rowX, rest, rowZ], rotationY, mount: 'surface' }).placements;
      }).flat();
      return { placements, noFit: `${item.title} doesn't fit on ${target.name}: there is no free spot left on it` };
    }
    case 'centered_under': {
      if (item.category !== 'rug') {
        return { error: `Only a rug goes centered under something: ${item.title} is a ${item.category.replace('_', ' ')}` };
      }
      const target = targetOf(anchor.target_id);
      if (!target) return noTarget(anchor.target_id);
      const { placement: { rotationY }, rect: { size: [targetWidth, targetDepth] } } = target;
      // Its long side runs across the target, as a rug goes under a bed or a sofa. A third of
      // how far it reaches out goes under the target's front, so its center is a sixth past it.
      const [reach, across, turn] = width >= depth ? [depth, width, 0] : [width, depth, Math.PI / 2];
      const [x, z] = inFrameOf(target.placement, [0, targetDepth / 2 + reach / 6]);
      // It slides further under the target, or out from it until only a sixth of it is under. Centered
      // first; but where that takes it past a wall, as under a bed in a corner, it slides across too,
      // as long as it stays under two thirds of the target's width.
      const placement: Placement = { position: [x, 0, z], rotationY: wrapped(rotationY + turn), mount: 'floor' };
      const sideways = Math.max(0, across - targetWidth) / 2 + targetWidth / 3;
      const shifts = sliding(placement, rightOf(rotationY), [-sideways, sideways]);
      return { ...shifts, placements: shifts.placements.flatMap((shifted) => sliding(shifted, frontOf(rotationY), [-Infinity, reach / 6]).placements) };
    }
    case 'open_floor': {
      const near = anchor.near_id === undefined ? undefined : targetOf(anchor.near_id);
      if (anchor.near_id !== undefined && !near) return noTarget(anchor.near_id);
      return { placements: openFloor(setup, inRoom, item, near), noFit: `No open floor fits ${item.title}` };
    }
  }
}

/**
 * How high above the floor something rests on top of a room item: on its top, or on a bed's
 * bedding, so that it doesn't float at the top of the headboard.
 */
export function restingHeight({ category, heights: [bottom, top] }: RoomItem, partParams?: PartParams): number {
  return category === 'bed' ? bottom + Math.min(top - bottom, (partParams?.beddingRange ?? BEDDING_RANGE)[1]) : top;
}

/**
 * Where a Piece `depth` deep goes in place of an item `oldDepth` deep at `placement` (spec §10.5): its
 * back-center where the old item's was, and flush against a wall that back is within 10 cm of, or
 * pushed into, facing within 20° of the wall's normal, squared up to it: as a dragged Piece snaps (§10.3).
 */
export function inPlaceOf(walls: Wall[], placement: Placement, oldDepth: number, depth: number): Placement {
  const { position: [x, y, z], rotationY } = placement;
  const [fx, fz] = frontOf(rotationY);
  const back: Vec2 = [x - (fx * oldDepth) / 2, z - (fz * oldDepth) / 2];
  const flush = walls
    .filter(({ normal: [nx, nz] }) => fx * nx + fz * nz >= Math.cos(SNAP_ANGLE))
    .map((wall) => ({ wall, along: alongFromStart(wall, back), into: distanceToWall(back, wall) }))
    .filter(({ wall, along, into }) => into <= SNAP_DISTANCE && into >= -depth && along >= 0 && along <= wallLength(wall))
    .sort((a, b) => Math.abs(a.into) - Math.abs(b.into))[0];
  if (!flush) return { ...placement, position: [back[0] + (fx * depth) / 2, y, back[1] + (fz * depth) / 2] };
  const [sx, sz] = wallPoint(flush.wall, flush.along, depth / 2);
  return { ...placement, position: [sx, y, sz], rotationY: facing(flush.wall.normal) };
}

/** How close to a wall, in meters, and how square to it, an item's back snaps flush to it (spec §10.3). */
const SNAP_DISTANCE = 0.1;
const SNAP_ANGLE = Math.PI / 9;

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

/** The wall an item's back is to, or failing that the first wall it stands against, within `distance`. */
export function wallBehind(walls: Wall[], item: RoomItem, distance = BY_WALL): Wall | undefined {
  const [fx, fz] = frontOf(item.placement.rotationY);
  const by = walls.filter((wall) => isBy(wall, item, distance));
  return by.find(({ normal: [nx, nz] }) => fx * nx + fz * nz > 0.7) ?? by[0];
}

/** The unit vector from a wall's start toward its end. */
const direction = (wall: Wall): Vec2 => {
  const length = wallLength(wall);
  return [(wall.end[0] - wall.start[0]) / length, (wall.end[1] - wall.start[1]) / length];
};

/** How far from a wall's start the center of an item `width` wide goes, at `along` it. */
function fromStart(wall: Wall, width: number, along: Along): number {
  const length = wallLength(wall);
  const left = width / 2 + (typeof along === 'number' ? along : FRACTIONS[along]) * (length - width);
  return startIsLeft(wall) ? left : length - left;
}
