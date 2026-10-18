import { checkFit } from './fit';
import { distanceToWall, footprint, type OrientedRect, pointInPolygon, rectInPolygon, rectsOverlap, wallPoint } from './geometry';
import type { Catalog, CatalogItem, Category, FitViolation, Placement, RoomSetup, RoomState, Vec2, Vec3, Wall } from './types';

/** How far, in meters, each step slides a Placement that breaks a Fit rule; also the spacing of open-floor spots. */
const STEP = 0.1;
/** How far it may slide each way. */
const MAX_SLIDE = 1;
/** The slides to try, nearest first: 0, +0.1, −0.1, +0.2, … −1. */
const SLIDES = [0, ...Array.from({ length: Math.round(MAX_SLIDE / STEP) }, (_, i) => [(i + 1) * STEP, -(i + 1) * STEP]).flat()];
/** How many open-floor spots are checked against the Fit rules, best first, before giving up: as many as a slide. */
const OPEN_FLOOR_TRIES = SLIDES.length;
/** How far apart those spots are, at least, so that they spread over the room instead of crowding the best one. */
const OPEN_FLOOR_SPREAD = 0.5;
/** How high the center of a wall item hangs unless the Anchor says otherwise: 57″, the gallery standard. */
const CENTER_HEIGHT = 1.45;
/** How far, in meters, open-floor spots may touch walls and furniture, as the Fit rules allow: so they can stand flush. */
const TOLERANCE = 0.01;
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

/** The Placements an Anchor allows, the one nearest to what it asks for first, and what to say when none fits. */
interface Request { candidates: Placement[]; noFit: string }

/** An Original or Piece in the room: where it stands now, and its [w, h, d] size. */
interface Thing { id: string; category: Category; placement: Placement; size: Vec3 }

/** The Placement an Anchor stands for, for a new Piece of `item` in the room (spec §13.2). */
export function resolveAnchor(setup: RoomSetup, catalog: Catalog, state: RoomState, item: CatalogItem, anchor: Anchor): Resolution {
  const request = requestFor(setup, thingsIn(setup, catalog, state), item, anchor);
  if ('error' in request) return { error: request.error, violations: [] };
  const withItem = { ...catalog, items: [...catalog.items, item] };
  // The new Piece goes by its Catalog id while it is checked, so that is how violations name it.
  const violations = (placement: Placement) => checkFit(setup, withItem, {
    ...state, pieces: { ...state.pieces, [item.id]: { catalogId: item.id, placement, partColors: {} } },
  }, [item.id]);
  const placement = request.candidates.find((candidate) => !violations(candidate).length);
  if (placement) return { placement };
  const [asked] = request.candidates;
  return { error: request.noFit, violations: asked ? violations(asked) : [] };
}

function requestFor(setup: RoomSetup, things: Thing[], item: CatalogItem, anchor: Anchor): Request | { error: string } {
  const [width, height, depth] = item.size;
  /** The Placement and its slides along `axis`, a unit vector, up to `range` each way. */
  const sliding = (placement: Placement, [ax, az]: Vec2, [min, max] = [-Infinity, Infinity]): Request => ({
    candidates: SLIDES.filter((slide) => slide >= min - EPSILON && slide <= max + EPSILON).map((slide) => {
      const [x, y, z] = placement.position;
      return { ...placement, position: [x + ax * slide, y, z + az * slide] };
    }),
    noFit: `${item.title} doesn't fit there, even slid up to ${MAX_SLIDE} m either way`,
  });
  /**
   * Back flush to a wall, `along` meters from its start, sliding along it but never past its ends:
   * on the floor, or hung with its center `centerHeight` up.
   */
  const flushTo = (wall: Wall, along: number, centerHeight?: number): Request => {
    const [x, z] = wallPoint(wall, along, depth / 2);
    const rotationY = facing(wall.normal);
    const placement: Placement = centerHeight === undefined
      ? { position: [x, 0, z], rotationY, mount: 'floor' }
      : { position: [x, centerHeight - height / 2, z], rotationY, mount: 'wall', wallId: wall.id };
    return sliding(placement, direction(wall), [width / 2 - along, wallLength(wall) - width / 2 - along]);
  };
  const thing = (id: string) => things.find((candidate) => candidate.id === id);
  const noThing = (id: string) => ({ error: `The room has no Original or Piece "${id}"` });
  const noWall = (id: string) => ({ error: `The room has no wall "${id}"` });

  if (item.mount === 'wall' && anchor.kind !== 'on_wall') return { error: `${item.title} hangs on a wall: use on_wall` };
  switch (anchor.kind) {
    case 'against_wall': {
      const wall = setup.walls.find(({ id }) => id === anchor.wall_id);
      return wall ? flushTo(wall, fromStart(wall, width, anchor.along)) : noWall(anchor.wall_id);
    }
    case 'on_wall': {
      const wall = setup.walls.find(({ id }) => id === anchor.wall_id);
      return wall ? flushTo(wall, fromStart(wall, width, anchor.along), anchor.center_height_m ?? CENTER_HEIGHT) : noWall(anchor.wall_id);
    }
    case 'under_window': {
      const window = setup.openings.find(({ id }) => id === anchor.opening_id);
      if (!window) return { error: `The room has no window "${anchor.opening_id}"` };
      if (window.kind !== 'window') return { error: `${window.id} is a ${window.kind}, not a window` };
      const wall = setup.walls.find(({ id }) => id === window.wallId);
      return wall ? flushTo(wall, window.offset + window.width / 2) : noWall(window.wallId);
    }
    case 'beside': {
      const target = thing(anchor.target_id);
      if (!target) return noThing(anchor.target_id);
      const { placement: { rotationY }, size: [targetWidth, , targetDepth] } = target;
      // Beside it, backs in line; in front of it, facing it. Either way it slides along the target's width.
      const [across, out] = anchor.side === 'front'
        ? [0, targetDepth / 2 + depth / 2]
        : [(anchor.side === 'right' ? 1 : -1) * (targetWidth / 2 + width / 2), depth / 2 - targetDepth / 2];
      const [x, z] = inFrameOf(target.placement, [across, out]);
      const turn = anchor.side === 'front' ? Math.PI : 0;
      return sliding({ position: [x, 0, z], rotationY: turned(rotationY + turn), mount: 'floor' }, rightOf(rotationY));
    }
    case 'on_top_of': {
      const target = thing(anchor.target_id);
      if (!target) return noThing(anchor.target_id);
      const { placement: { position: [x, y, z], rotationY }, size: [targetWidth, targetHeight, targetDepth] } = target;
      if (width > targetWidth + EPSILON || depth > targetDepth + EPSILON) {
        return { error: `${item.title} doesn't fit on top of ${anchor.target_id}` };
      }
      // Across the top, never off its sides.
      const room = (targetWidth - width) / 2;
      return sliding({ position: [x, y + targetHeight, z], rotationY, mount: 'surface' }, rightOf(rotationY), [-room, room]);
    }
    case 'centered_under': {
      if (item.category !== 'rug') {
        return { error: `Only a rug goes centered under something: ${item.title} is a ${item.category.replace('_', ' ')}` };
      }
      const target = thing(anchor.target_id);
      if (!target) return noThing(anchor.target_id);
      const { placement: { rotationY }, size: [, , targetDepth] } = target;
      // Its long side runs across the target, as a rug goes under a bed or a sofa. A third of
      // how far it reaches out goes under the target's front, so its center is a sixth past it.
      const longAcross = width >= depth;
      const reach = longAcross ? depth : width;
      const [x, z] = inFrameOf(target.placement, [0, targetDepth / 2 + reach / 6]);
      const turn = longAcross ? 0 : Math.PI / 2;
      // It slides further under the target or out from it, staying centered.
      return sliding({ position: [x, 0, z], rotationY: turned(rotationY + turn), mount: 'floor' }, frontOf(rotationY));
    }
    case 'open_floor': {
      const near = anchor.near_id === undefined ? undefined : thing(anchor.near_id);
      if (anchor.near_id !== undefined && !near) return noThing(anchor.near_id);
      return { candidates: openFloor(setup, things, item, near), noFit: `No open floor fits ${item.title}` };
    }
  }
}

/**
 * Spots on open floor that `item` fits in, back to the nearest wall, best first: the farthest from
 * walls and furniture, or the nearest to `near`. Open floor is floor no furniture stands on, and
 * for a rug, no other rug lies on. The Fit rules, the walkway among them, then pick among them.
 */
function openFloor(setup: RoomSetup, things: Thing[], item: CatalogItem, near?: Thing): Placement[] {
  const { polygon } = setup.floor;
  const obstacles = things
    .filter(({ category, placement }) => placement.mount === 'floor' && (category !== 'rug' || item.category === 'rug'))
    .map(({ placement, size }) => footprint(placement, size));
  const nearRect = near && footprint(near.placement, near.size);
  const [minX, minZ] = [Math.min(...polygon.map(([x]) => x)), Math.min(...polygon.map(([, z]) => z))];
  const [cols, rows] = [Math.max(...polygon.map(([x]) => x)) - minX, Math.max(...polygon.map(([, z]) => z)) - minZ].map((extent) => Math.floor(extent / STEP));
  const spots: { placement: Placement; clearance: number; nearness: number }[] = [];
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const point: Vec2 = [minX + (i + 0.5) * STEP, minZ + (j + 0.5) * STEP];
      if (!pointInPolygon(point, polygon)) continue;
      // The walls it faces, by the distance to their planes: in a room with an inner corner, a
      // wall's plane can pass nearer than the wall itself, which only makes the spot look smaller.
      const walls = setup.walls.map((wall) => ({ wall, distance: distanceToWall(point, wall) })).filter(({ distance }) => distance >= 0);
      if (!walls.length) continue;
      const nearest = walls.reduce((a, b) => (b.distance < a.distance ? b : a));
      const placement: Placement = { position: [point[0], 0, point[1]], rotationY: facing(nearest.wall.normal), mount: 'floor' };
      const rect = footprint(placement, item.size);
      if (!rectInPolygon(rect, polygon, TOLERANCE) || obstacles.some((obstacle) => rectsOverlap(rect, obstacle, TOLERANCE))) continue;
      const clearance = Math.min(nearest.distance, ...obstacles.map((obstacle) => distanceToRect(point, obstacle)));
      spots.push({ placement, clearance, nearness: nearRect ? distanceToRect(point, nearRect) : 0 });
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

/** The visible Originals and the Pieces of a room. */
function thingsIn(setup: RoomSetup, catalog: Catalog, state: RoomState): Thing[] {
  const catalogItems = new Map(catalog.items.map((catalogItem) => [catalogItem.id, catalogItem]));
  return [
    ...setup.originals
      .filter(({ id }) => state.originals[id]?.visible)
      .map(({ id, category, box }) => ({ id, category, placement: state.originals[id].placement, size: box.size })),
    ...Object.entries(state.pieces).flatMap(([id, { catalogId, placement }]) => {
      const catalogItem = catalogItems.get(catalogId);
      return catalogItem ? [{ id, category: catalogItem.category, placement, size: catalogItem.size }] : [];
    }),
  ];
}

/** The rotationY that turns an item's front (+Z) toward `direction`. */
const facing = ([x, z]: Vec2) => Math.atan2(x, z);

/** An angle turned into the range −π to π. */
const turned = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));

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

const FRACTIONS = { left: 0, center: 0.5, right: 1 };

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
