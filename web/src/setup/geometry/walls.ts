// Room Setup step 3 (spec §9.3): the floor polygon's edges become Walls.
import type { Vec2, Wall } from '@shared/types';

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
