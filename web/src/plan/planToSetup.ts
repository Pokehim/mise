// A room as the Mover corrected it on its Floor Plan (ADR-0011), built as a Room Setup: the plan's
// pixels become meters with the top of the page as North (−Z), its corners become Walls, and its
// Openings are placed on them. The room starts empty, with no Originals. Pure, so Room Setup can
// rebuild it on every change.
import type { DraftOpening, DraftPoint, DraftRoom } from '@shared/floor-plan';
import type { Opening, RoomSetup, RoomSurfaces, Vec2, Wall } from '@shared/types';
import { DEFAULT_SURFACES } from '../scene/room/buildRoom';
import { wallsFromPolygon } from '../setup/geometry/walls';

/** Edges this close to straight across or down the plan are made exactly so: most rooms are rectilinear. */
const SNAP_DEGREES = 4;
/** Corners closer than this are one corner. */
const MERGE = 0.05;
/** How far an Opening's ends may be from its wall's line. */
const OPENING_REACH = 0.3;
/** A US ceiling: 8 ft. Plans seldom print one. */
export const DEFAULT_CEILING = 2.44;
/** A door: 80 in high. A window: its sill 36 in up, 48 in high. */
const DOOR_HEIGHT = 2.03;
const WINDOW = { bottom: 0.91, height: 1.22 };
export interface PlanBuild {
  metersPerPixel: number;
  ceilingHeight?: number;
  surfaces?: RoomSurfaces;
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

const round = (v: number) => Math.round(v * 1000) / 1000;

/**
 * The room as a Room Setup: its floor and walls from the plan's corners, and its Openings on them.
 * It starts empty: the Mover furnishes it from the Catalog, or asks Claude for Designs.
 * `scanId` is the Floor Plan Scan's id.
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
    version: 1, scanId, ceilingHeight, floor: { polygon }, walls, openings, originals: [],
    surfaces: build.surfaces ?? DEFAULT_SURFACES,
  };
}
