// A room as the Mover corrected it on its Floor Plan (ADR-0011), built as a Room Setup: the plan's
// pixels become meters with the top of the page as North (−Z), its corners become Walls, and its
// Openings and furniture are placed on them. Pure, so Room Setup can rebuild it on every change.
import type { DraftFurniture, DraftOpening, DraftPoint, DraftRoom } from '@shared/floor-plan';
import type { Category, Opening, Original, RoomSetup, RoomSurfaces, Vec2, Wall } from '@shared/types';
import { DEFAULT_SURFACES } from '../scene/room/buildRoom';
import { wallsFromPolygon } from '../setup/geometry/walls';

/** Edges this close to straight across or down the plan are made exactly so: most rooms are rectilinear. */
const SNAP_DEGREES = 4;
/** Corners closer than this are one corner. */
const MERGE = 0.05;
/** How much nearer a wall must be to a piece's side than to its back for the piece to turn its back to it. */
const CORNER_TIE = 0.05;
/** How far an Opening's ends may be from its wall's line. */
const OPENING_REACH = 0.3;
/** A US ceiling: 8 ft. Plans seldom print one. */
export const DEFAULT_CEILING = 2.44;
/** A door: 80 in high. A window: its sill 36 in up, 48 in high. */
const DOOR_HEIGHT = 2.03;
const WINDOW = { bottom: 0.91, height: 1.22 };
/** How tall each kind of furniture is when its Stand-in doesn't say: a plan shows only its footprint. */
export const FURNITURE_HEIGHT: Record<Category, number> = {
  bed: 0.6, desk: 0.76, chair: 0.85, table: 0.76, nightstand: 0.6, dresser: 0.9, wardrobe: 1.9, shelf: 1.8,
  storage: 0.8, sofa: 0.85, rug: 0.01, lamp: 1.5, wall_art: 0.6, mirror: 1, plant: 1, decor: 0.3,
};

/** What the Mover chose for one piece of the plan's furniture in Room Setup. */
export interface PieceChoice {
  kept?: boolean;
  /** The Catalog item drawn in its place. */
  standInId?: string;
  /** Its height, usually its Stand-in's. */
  height?: number;
  /** Quarter turns the Mover gave it, on top of the way it faces by default. */
  turns?: number;
}

export interface PlanBuild {
  metersPerPixel: number;
  ceilingHeight?: number;
  surfaces?: RoomSurfaces;
  /** By the furniture's index in the draft room. */
  pieces?: (PieceChoice | undefined)[];
}

/** Where a plan's pixel lands on the room's floor: centered on the room's corners, in meters, with +y down the page as +Z. */
export function planFrame(room: DraftRoom, metersPerPixel: number) {
  const xs = room.corners.map(({ x }) => x);
  const ys = room.corners.map(({ y }) => y);
  const [cx, cy] = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
  return {
    toRoom: ({ x, y }: DraftPoint): Vec2 => [(x - cx) * metersPerPixel, (y - cy) * metersPerPixel],
    toPlan: ([x, z]: Vec2): DraftPoint => ({ x: x / metersPerPixel + cx, y: z / metersPerPixel + cy }),
  };
}

/* ───────────── The floor polygon ───────────── */

/**
 * Makes each nearly horizontal or vertical edge exactly so. Corners joined by a run of such edges
 * (a straight wall drawn as several edges) all move to the run's average, so the run stays straight.
 */
function snapToAxes(points: Vec2[]): Vec2[] {
  const n = points.length;
  const tolerance = Math.sin((SNAP_DEGREES * Math.PI) / 180);
  const runs = [Array.from({ length: n }, (_, i) => i), Array.from({ length: n }, (_, i) => i)];   // by axis: 0 = z equal, 1 = x equal
  const root = (run: number[], i: number): number => (run[i] === i ? i : (run[i] = root(run, run[i])));
  points.forEach((a, i) => {
    const b = points[(i + 1) % n];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (length < 1e-9) return;
    const axis = Math.abs(b[1] - a[1]) / length < tolerance ? 0 : Math.abs(b[0] - a[0]) / length < tolerance ? 1 : -1;
    if (axis >= 0) runs[axis][root(runs[axis], i)] = root(runs[axis], (i + 1) % n);
  });
  const out = points.map(([x, z]): Vec2 => [x, z]);
  for (const [axis, coordinate] of [[0, 1], [1, 0]] as const) {
    const groups = new Map<number, number[]>();
    points.forEach((_, i) => groups.set(root(runs[axis], i), [...(groups.get(root(runs[axis], i)) ?? []), i]));
    for (const members of groups.values()) {
      if (members.length < 2) continue;
      const mean = members.reduce((sum, i) => sum + points[i][coordinate], 0) / members.length;
      for (const i of members) out[i][coordinate] = mean;
    }
  }
  return out;
}

/** Drops corners within MERGE of the one before, and corners on a straight line between their neighbors. */
function simplify(points: Vec2[]): Vec2[] {
  const kept = points.filter((p, i) => {
    const previous = points[(i - 1 + points.length) % points.length];
    return i === 0 || Math.hypot(p[0] - previous[0], p[1] - previous[1]) >= MERGE;
  });
  if (kept.length > 1 && Math.hypot(kept[0][0] - kept.at(-1)![0], kept[0][1] - kept.at(-1)![1]) < MERGE) kept.pop();
  return kept.filter((p, i) => {
    const [a, b] = [kept[(i - 1 + kept.length) % kept.length], kept[(i + 1) % kept.length]];
    const [ux, uz, vx, vz] = [p[0] - a[0], p[1] - a[1], b[0] - p[0], b[1] - p[1]];
    const cross = ux * vz - uz * vx;
    return Math.abs(cross) > 1e-4 * Math.hypot(ux, uz) * Math.hypot(vx, vz) || ux * vx + uz * vz < 0;
  });
}

/** The room's floor polygon from the plan's corners: in meters, snapped to the axes, with no stray corners. */
export function planPolygon(room: DraftRoom, metersPerPixel: number): Vec2[] {
  const { toRoom } = planFrame(room, metersPerPixel);
  return simplify(snapToAxes(room.corners.map(toRoom)));
}

/* ───────────── Openings ───────────── */

/** Where a point is on a wall's line: how far along it from the wall's start, and how far off the line. */
function onWall([x, z]: Vec2, { start: [sx, sz], end: [ex, ez] }: Wall) {
  const length = Math.hypot(ex - sx, ez - sz);
  const [dx, dz] = [(ex - sx) / length, (ez - sz) / length];
  return { along: (x - sx) * dx + (z - sz) * dz, off: Math.abs(-(x - sx) * dz + (z - sz) * dx), length };
}

/**
 * An Opening of the plan on its wall, clamped to it: of the walls whose line both its ends are near,
 * the one it overlaps most. Null when no wall is near, or what's left on the wall is a sliver.
 */
function placeOpening(opening: DraftOpening, id: string, walls: Wall[], toRoom: (p: DraftPoint) => Vec2): Opening | null {
  const [a, b] = [toRoom(opening.from), toRoom(opening.to)];
  const best = walls
    .map((wall) => {
      const ends = [onWall(a, wall), onWall(b, wall)];
      const [s0, s1] = ends.map(({ along, length }) => Math.min(length, Math.max(0, along))).sort((p, q) => p - q);
      return { wall, s0, s1, off: Math.max(...ends.map((end) => end.off)) };
    })
    .filter(({ off, s0, s1 }) => off <= OPENING_REACH && s1 - s0 >= 0.2)
    .sort((p, q) => (q.s1 - q.s0) - (p.s1 - p.s0) || p.off - q.off)[0];
  if (!best) return null;
  const { s0, s1 } = best;
  const door = opening.kind === 'door';
  return {
    id, kind: opening.kind, wallId: best.wall.id, offset: round(s0), width: round(s1 - s0),
    bottom: door ? 0 : WINDOW.bottom, height: door ? DOOR_HEIGHT : WINDOW.height,
    ...(door && { swing: opening.swing ?? 'in-right' }),
  };
}

/* ───────────── Furniture ───────────── */

/** How far from a point, along a direction on the floor, the first wall it heads out through is. */
function distanceToWall([x, z]: Vec2, [dx, dz]: Vec2, walls: Wall[]) {
  let nearest = Infinity;
  for (const { start: [sx, sz], end: [ex, ez], normal: [nx, nz] } of walls) {
    const toward = dx * nx + dz * nz;
    if (toward > -1e-9) continue;
    const t = ((x - sx) * nx + (z - sz) * nz) / -toward;
    const [hx, hz] = [x + dx * t, z + dz * t];
    const length = Math.hypot(ex - sx, ez - sz);
    const along = ((hx - sx) * (ex - sx) + (hz - sz) * (ez - sz)) / length;
    if (t >= 0 && along >= -1e-6 && along <= length + 1e-6) nearest = Math.min(nearest, t);
  }
  return nearest;
}

interface Footprint { center: Vec2; width: number; depth: number; across: Vec2; along: Vec2 }

/** A piece's footprint in the room: its center, its size in meters, and its width and depth axes. */
function footprintOf(piece: DraftFurniture, toRoom: (p: DraftPoint) => Vec2, metersPerPixel: number): Footprint {
  const theta = (piece.rotation * Math.PI) / 180;
  // Down the page is +Z, so clockwise on the page turns +X toward +Z.
  const across: Vec2 = [Math.cos(theta), Math.sin(theta)];
  return {
    center: toRoom(piece.center), width: piece.width * metersPerPixel, depth: piece.depth * metersPerPixel,
    across, along: [-across[1], across[0]],
  };
}

/**
 * Which way a piece faces, as a unit vector on the floor: away from the wall its back is nearest
 * (a bed only toward its long ends, as its head goes against a wall), or, for a chair, toward the
 * desk or table it's drawn at.
 */
function facing(piece: DraftFurniture, own: Footprint, others: { piece: DraftFurniture; footprint: Footprint }[], walls: Wall[]): Vec2 {
  const { center, width, depth, across, along } = own;
  const sides = [
    { dir: along, extent: depth / 2 }, { dir: [-along[0], -along[1]] as Vec2, extent: depth / 2 },
    { dir: across, extent: width / 2 }, { dir: [-across[0], -across[1]] as Vec2, extent: width / 2 },
  ];
  if (piece.category === 'chair') {
    const desk = others
      .filter(({ piece: other }) => other.category === 'desk' || other.category === 'table')
      .map(({ footprint }) => ({ to: [footprint.center[0] - center[0], footprint.center[1] - center[1]] as Vec2 }))
      .map(({ to }) => ({ to, distance: Math.hypot(...to) }))
      .sort((a, b) => a.distance - b.distance)[0];
    if (desk && desk.distance < 1.5) {
      return sides.map(({ dir }) => dir).sort((a, b) => (b[0] * desk.to[0] + b[1] * desk.to[1]) - (a[0] * desk.to[0] + a[1] * desk.to[1]))[0];
    }
  }
  const candidates = piece.category === 'bed' ? (depth >= width ? sides.slice(0, 2) : sides.slice(2)) : sides;
  // In a corner, against two walls, its back is the one the plan draws as its depth.
  const back = candidates
    .map((side, i) => ({ ...side, gap: distanceToWall(center, side.dir, walls) - side.extent + (i >= 2 ? CORNER_TIE : 0) }))
    .sort((a, b) => a.gap - b.gap)[0];
  return [-back.dir[0], -back.dir[1]];
}

/** "Desk chair (north)" → "desk_chair_north". */
const slug = (label: string) => label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'item';

/** The plan's furniture as Originals, each facing its way, drawn with its Stand-in. */
function placeFurniture(room: DraftRoom, walls: Wall[], build: PlanBuild, toRoom: (p: DraftPoint) => Vec2): Original[] {
  const footprints = room.furniture.map((piece) => ({ piece, footprint: footprintOf(piece, toRoom, build.metersPerPixel) }));
  const used = new Set<string>();
  return footprints.map(({ piece, footprint }, i) => {
    const choice = build.pieces?.[i] ?? {};
    let front = facing(piece, footprint, footprints.filter((_, j) => j !== i), walls);
    for (let turn = 0; turn < (((choice.turns ?? 0) % 4) + 4) % 4; turn++) front = [-front[1], front[0]];
    // The box's depth runs along the way it faces.
    const alongFront = Math.abs(front[0] * footprint.along[0] + front[1] * footprint.along[1]) > 0.5;
    const [width, depth] = alongFront ? [footprint.width, footprint.depth] : [footprint.depth, footprint.width];
    let id = `og_${slug(piece.label)}`;
    for (let n = 2; used.has(id); n++) id = `og_${slug(piece.label)}_${n}`;
    used.add(id);
    return {
      id, label: piece.label, category: piece.category, kept: choice.kept ?? piece.builtIn,
      box: {
        position: [round(footprint.center[0]), 0, round(footprint.center[1])],
        size: [round(width), choice.height ?? FURNITURE_HEIGHT[piece.category], round(depth)],
        rotationY: Math.atan2(front[0], front[1]),
      },
      // A Floor Plan Scan never shows a Patch (nothing was hidden under its furniture), so any color does.
      floorColor: '#8a8580',
      ...(choice.standInId && { standInId: choice.standInId }),
    };
  });
}

const round = (v: number) => Math.round(v * 1000) / 1000;

/**
 * The room as a Room Setup: its floor and walls from the plan's corners, its Openings on them, and
 * its furniture as Originals drawn with Stand-ins. `scanId` is the Floor Plan Scan's id.
 */
export function planToSetup(scanId: string, room: DraftRoom, build: PlanBuild): RoomSetup {
  const ceilingHeight = build.ceilingHeight ?? DEFAULT_CEILING;
  const polygon = planPolygon(room, build.metersPerPixel);
  const walls = polygon.length >= 3 ? wallsFromPolygon(polygon, ceilingHeight) : [];
  const { toRoom } = planFrame(room, build.metersPerPixel);
  const openings = room.openings
    .map((opening, i) => placeOpening(opening, `op_${i + 1}`, walls, toRoom))
    .filter((opening): opening is Opening => opening !== null);
  return {
    version: 1, scanId, ceilingHeight, floor: { polygon }, walls, openings,
    originals: walls.length ? placeFurniture(room, walls, build, toRoom) : [],
    surfaces: build.surfaces ?? DEFAULT_SURFACES,
  };
}
