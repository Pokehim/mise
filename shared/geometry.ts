import type { Box, Vec2, Vec3, Wall } from './types';

/** A rectangle on the floor plane: its center, its [width, depth] in its own frame, and its yaw. */
export interface OrientedRect {
  center: Vec2;
  size: Vec2;
  /** three.js rotationY: the rectangle's own +X axis points along [cos θ, −sin θ]. */
  rotationY: number;
}

/** The floor rectangle under a box, from its bottom-center position, yaw and [w, h, d] size. Takes a Box or a Placement. */
export function footprint({ position: [x, , z], rotationY }: Pick<Box, 'position' | 'rotationY'>, [width, , depth]: Vec3): OrientedRect {
  return { center: [x, z], size: [width, depth], rotationY };
}

/** The four corners of a rectangle, in order around it: the first two are its back edge (−Z), the last two its front (+Z). */
export function rectCorners({ center: [cx, cz], size: [width, depth], rotationY }: OrientedRect): Vec2[] {
  const [cos, sin] = [Math.cos(rotationY), Math.sin(rotationY)];
  return ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as const).map(([sx, sz]): Vec2 => {
    const [x, z] = [(sx * width) / 2, (sz * depth) / 2];
    return [cx + x * cos + z * sin, cz - x * sin + z * cos];
  });
}

/** True when two rectangles overlap by more than `tolerance` meters. Touching isn't overlapping. */
export function rectsOverlap(a: OrientedRect, b: OrientedRect, tolerance = 0): boolean {
  return polygonsOverlap(rectCorners(a), rectCorners(b), tolerance);
}

/**
 * True when two convex polygons, each given as its corners in order, overlap by more than `tolerance`
 * meters. By the separating axis theorem, they do unless their shadows on the normal of some edge
 * overlap by no more than that.
 */
export function polygonsOverlap(a: Vec2[], b: Vec2[], tolerance = 0): boolean {
  for (const polygon of [a, b]) {
    for (let i = 0; i < polygon.length; i++) {
      const [[px, pz], [qx, qz]] = [polygon[i], polygon[(i + 1) % polygon.length]];
      const length = Math.hypot(qx - px, qz - pz);
      if (length === 0) continue;
      const [ax, az] = [(pz - qz) / length, (qx - px) / length];
      if (overlapLength(shadow(a, ax, az), shadow(b, ax, az)) <= tolerance) return false;
    }
  }
  return true;
}

/**
 * True when a rectangle lies inside a polygon, such as a room's floor, which need not be convex.
 * The rectangle may reach `tolerance` meters past the polygon's edges.
 */
export function rectInPolygon({ center, size: [width, depth], rotationY }: OrientedRect, polygon: Vec2[], tolerance = 0): boolean {
  const corners = rectCorners({ center, size: [Math.max(0, width - 2 * tolerance), Math.max(0, depth - 2 * tolerance)], rotationY });
  // Corners inside aren't enough when the polygon isn't convex: one of its inner corners can cut into the rectangle.
  return corners.every((corner) => pointInPolygon(corner, polygon)) && !polygon.some((corner) => pointInPolygon(corner, corners));
}

/** True when a point is inside a polygon, such as a room's floor; the polygon need not be convex. */
export function pointInPolygon([x, z]: Vec2, polygon: Vec2[]): boolean {
  // Cast a ray toward +x and count the edges it crosses: an odd count means inside.
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [[xi, zi], [xj, zj]] = [polygon[i], polygon[j]];
    if (zi > z !== zj > z && x < xi + ((z - zi) * (xj - xi)) / (zj - zi)) inside = !inside;
  }
  return inside;
}

/** How far a floor point is from a wall's plane: positive inside the room, negative behind the wall. */
export function distanceToWall([x, z]: Vec2, { start: [sx, sz], normal: [nx, nz] }: Wall): number {
  return (x - sx) * nx + (z - sz) * nz;
}

/** The floor point `along` meters from a wall's start toward its end, and `out` meters from the wall into the room. */
export function wallPoint({ start: [sx, sz], end: [ex, ez], normal: [nx, nz] }: Wall, along: number, out = 0): Vec2 {
  const length = Math.hypot(ex - sx, ez - sz);
  return [sx + ((ex - sx) / length) * along + nx * out, sz + ((ez - sz) / length) * along + nz * out];
}

/** How much two intervals [start, end] overlap: their shared length, or ≤ 0 when they don't. */
export function overlapLength([a0, a1]: [number, number], [b0, b1]: [number, number]): number {
  return Math.min(a1, b1) - Math.max(a0, b0);
}

/** The interval a polygon covers along the unit axis [ax, az]. */
function shadow(polygon: Vec2[], ax: number, az: number): [number, number] {
  let [min, max] = [Infinity, -Infinity];
  for (const [x, z] of polygon) {
    const distance = x * ax + z * az;
    min = Math.min(min, distance);
    max = Math.max(max, distance);
  }
  return [min, max];
}
