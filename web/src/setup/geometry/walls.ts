// Room Setup step 3 (spec §9.3): the floor polygon's edges become Walls.
import type { RoomSetup, Vec2, Wall } from '@shared/types';

// Eight compass names, counter-clockwise from East (+X) in 45° steps. North is −Z.
const COMPASS = ['East', 'Northeast', 'North', 'Northwest', 'West', 'Southwest', 'South', 'Southeast'];

/**
 * One Wall per edge of the floor polygon, in click order, with ids wl_1, wl_2, … Each normal points
 * into the room, by the polygon's winding (so it holds for rooms that aren't convex), and each wall
 * is named by the direction it faces from outside: the wall on the room's −Z side is the North wall.
 */
export function wallsFromPolygon(polygon: Vec2[], height: number): Wall[] {
  const inward = signedArea(polygon) > 0 ? 1 : -1;
  const seen = new Map<string, number>();
  return polygon.map((start, i) => {
    const end = polygon[(i + 1) % polygon.length];
    const dx = end[0] - start[0];
    const dz = end[1] - start[1];
    const length = Math.hypot(dx, dz);
    const normal: Vec2 = [(-dz / length) * inward + 0, (dx / length) * inward + 0];
    // The outward direction, −normal, as a compass angle: atan2(north, east) = atan2(−z, x).
    const sector = Math.round(Math.atan2(normal[1], -normal[0]) / (Math.PI / 4));
    const direction = COMPASS[(sector + 8) % 8];
    const count = (seen.get(direction) ?? 0) + 1;
    seen.set(direction, count);
    const name = count === 1 ? `${direction} wall` : `${direction} wall ${count}`;
    return { id: `wl_${i + 1}`, name, start, end, normal, height };
  });
}

/** The shoelace area in (x, z): positive when the corners run clockwise seen from above, North (−Z) up. */
function signedArea(polygon: Vec2[]) {
  let sum = 0;
  polygon.forEach(([x, z], i) => {
    const [nx, nz] = polygon[(i + 1) % polygon.length];
    sum += x * nz - nx * z;
  });
  return sum / 2;
}

/** A Wall's length and unit direction from start to end. */
export function wallAxis({ start, end }: Wall) {
  const dx = end[0] - start[0];
  const dz = end[1] - start[1];
  const length = Math.hypot(dx, dz);
  return { length, dx: dx / length, dz: dz / length };
}

/** A Wall with its axis worked out once, for code that measures many points against it. */
export type AxisWall = Wall & ReturnType<typeof wallAxis>;
export const withAxis = (wall: Wall): AxisWall => ({ ...wall, ...wallAxis(wall) });

/** A point's signed distance from a wall's plane (positive inside the room), and its distance along the wall from its start. */
export function wallCoordinates(wall: AxisWall, x: number, z: number) {
  const rx = x - wall.start[0];
  const rz = z - wall.start[1];
  return { depth: rx * wall.normal[0] + rz * wall.normal[1], along: rx * wall.dx + rz * wall.dz };
}

/** True when the point is within `band` of a wall's plane, beside the wall or up to `band` past its ends (a corner). */
export const nearAnyWall = (walls: AxisWall[], x: number, z: number, band: number) => walls.some((wall) => {
  const { depth, along } = wallCoordinates(wall, x, z);
  return Math.abs(depth) <= band && along >= -band && along <= wall.length + band;
});

/** The nearest wall the point is beside, and the point's distance from its plane. */
export function nearestWall(walls: AxisWall[], x: number, z: number) {
  let nearest: AxisWall | undefined;
  let distance = Infinity;
  for (const wall of walls) {
    const { depth, along } = wallCoordinates(wall, x, z);
    if (along >= 0 && along <= wall.length && Math.abs(depth) < distance) [nearest, distance] = [wall, Math.abs(depth)];
  }
  return { wall: nearest, distance };
}

/** An extent on the floor plane. */
export interface RoomBounds { minX: number; maxX: number; minZ: number; maxZ: number }

export function polygonBounds(polygon: Vec2[]): RoomBounds {
  const xs = polygon.map(([x]) => x);
  const zs = polygon.map(([, z]) => z);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
}

/**
 * The setup with a new floor polygon and its Walls. A Wall the Mover renamed keeps its name while
 * its edge is unchanged; every other Wall is named afresh, since a new corner can turn the room.
 * Wall ids are positions in click order, so a Wall whose edge changed is another wall under the same
 * id: Openings and Patch images on it are dropped, like those on Walls that no longer exist.
 */
export function withPolygon(setup: RoomSetup, polygon: Vec2[]): RoomSetup {
  const walls = polygon.length >= 3 ? wallsFromPolygon(polygon, setup.ceilingHeight) : [];
  const autoNames = new Map(wallsFromPolygon(setup.floor.polygon, setup.ceilingHeight).map((w) => [w.id, w.name]));
  const same = (a: Vec2, b: Vec2) => a[0] === b[0] && a[1] === b[1];
  const unchanged = new Set<string>();
  const named = walls.map((wall) => {
    const old = setup.walls.find((w) => w.id === wall.id && same(w.start, wall.start) && same(w.end, wall.end));
    if (!old) return wall;
    unchanged.add(old.id);
    return old.name !== autoNames.get(old.id) ? { ...wall, name: old.name } : wall;
  });
  const originals = setup.originals.map((o) => {
    const images = o.patch?.walls;
    if (!images || Object.keys(images).every((id) => unchanged.has(id))) return o;
    return { ...o, patch: { ...o.patch, walls: Object.fromEntries(Object.entries(images).filter(([id]) => unchanged.has(id))) } };
  });
  return { ...setup, floor: { polygon }, walls: named, openings: setup.openings.filter((o) => unchanged.has(o.wallId)), originals };
}

/**
 * False for a click on the last corner (a double click) or on the first (the outline closes by
 * itself): either would make a Wall of length zero.
 */
export const isNewCorner = (polygon: Vec2[], [x, z]: Vec2) =>
  ![polygon.at(-1), polygon[0]].some((p) => p !== undefined && p[0] === x && p[1] === z);
