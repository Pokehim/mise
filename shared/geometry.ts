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

/** How far a rectangle reaches from its center along the unit vector [ax, az]. */
export function reach({ size: [width, depth], rotationY }: OrientedRect, [ax, az]: Vec2): number {
  const [cos, sin] = [Math.cos(rotationY), Math.sin(rotationY)];
  return (width / 2) * Math.abs(ax * cos - az * sin) + (depth / 2) * Math.abs(ax * sin + az * cos);
}

/** How far inside a polygon's edges, in meters, `pushInside` stops a rectangle, so that floating point can't leave it a hair outside. */
const PUSH_SLACK = 1e-6;

/**
 * The rectangle moved the shortest distance that puts it wholly inside a polygon, such as a room's
 * floor, without turning it: the rectangle itself when it already is inside, or null when it can't
 * fit anywhere. The polygon need not be convex.
 */
export function pushInside(rect: OrientedRect, polygon: Vec2[]): OrientedRect | null {
  const fits = (center: Vec2) => rectInPolygon({ ...rect, center }, polygon);
  if (fits(rect.center)) return rect;
  // The centers that fit make a polygon whose edges lie on these lines; the nearest of them is on
  // one edge, where the center projects onto its line, or at a corner, where two lines cross.
  const lines = flushLines(rect, polygon);
  const candidates: Vec2[] = lines.map((line) => projectOnto(rect.center, line));
  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      const crossing = intersection(lines[i], lines[j]);
      if (crossing) candidates.push(crossing);
    }
  }
  const [cx, cz] = rect.center;
  const nearest = candidates
    .map((center) => ({ center, distance: Math.hypot(center[0] - cx, center[1] - cz) }))
    .sort((a, b) => a.distance - b.distance)
    .find(({ center }) => fits(center));
  return nearest ? { ...rect, center: nearest.center } : null;
}

/**
 * A Placement or a Box moved the shortest distance that puts its whole footprint inside a polygon,
 * such as a room's floor, as `pushInside` moves a rectangle: itself when it already is, or null when it can't fit.
 */
export function pushFootprintInside<T extends Pick<Box, 'position' | 'rotationY'>>(placed: T, size: Vec3, polygon: Vec2[]): T | null {
  const rect = footprint(placed, size);
  const pushed = pushInside(rect, polygon);
  if (pushed === rect || !pushed) return pushed && placed;
  return { ...placed, position: [pushed.center[0], placed.position[1], pushed.center[1]] };
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

/* ───────────── Walls, measured as Anchors measure them: from the left end, seen from inside the room ───────────── */

/** How long a wall is, in meters. */
export const wallLength = ({ start: [sx, sz], end: [ex, ez] }: Pick<Wall, 'start' | 'end'>) => Math.hypot(ex - sx, ez - sz);

/** Whether a wall's left end, seen from inside the room facing it, is its start. Right is then [nz, −nx]. */
export const startIsLeft = ({ start: [sx, sz], end: [ex, ez], normal: [nx, nz] }: Wall) => (ex - sx) * nz - (ez - sz) * nx > 0;

/** How far along a wall from its start a floor point is. */
export function alongFromStart(wall: Wall, [x, z]: Vec2): number {
  const { start: [sx, sz], end: [ex, ez] } = wall;
  return ((x - sx) * (ex - sx) + (z - sz) * (ez - sz)) / wallLength(wall);
}

/** How far along a wall, from its start, some floor points reach: [from, to]. */
export function spanFromStart(wall: Wall, points: Vec2[]): [number, number] {
  const along = points.map((point) => alongFromStart(wall, point));
  return [Math.min(...along), Math.max(...along)];
}

/** A span along a wall measured from its start, measured from its left end instead: [from, to]. */
export function fromLeft(wall: Wall, [from, to]: [number, number]): [number, number] {
  const length = wallLength(wall);
  return startIsLeft(wall) ? [from, to] : [length - to, length - from];
}

/** How far along a wall, from its left end, some floor points reach. */
export const spanFromLeft = (wall: Wall, points: Vec2[]) => fromLeft(wall, spanFromStart(wall, points));

/** How far a shape is from a wall's plane, at its nearest corner. */
export const gapTo = (wall: Wall, { corners }: { corners: Vec2[] }) => Math.min(...corners.map((corner) => distanceToWall(corner, wall)));

/** Whether a shape stands along a wall: no more than `distance` from it, and not past its ends. */
export function isBy(wall: Wall, shape: { corners: Vec2[] }, distance: number) {
  return gapTo(wall, shape) <= distance && overlapLength(spanFromStart(wall, shape.corners), [0, wallLength(wall)]) > 0;
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

/** A line on the floor: the points p where normal · p = offset, with `normal` a unit vector. */
interface Line { normal: Vec2; offset: number }

/**
 * The lines a rectangle's center is on when it stands flush against one of a polygon's edges, inside
 * it, or when one of its own sides touches one of the polygon's corners, as an inner corner of an
 * L-shaped room can cut into it; each moved `PUSH_SLACK` further in.
 */
function flushLines(rect: OrientedRect, polygon: Vec2[]): Line[] {
  const area = polygon.reduce((sum, [x, z], i) => {
    const [nx, nz] = polygon[(i + 1) % polygon.length];
    return sum + x * nz - nx * z;
  }, 0);
  const lines: Line[] = [];
  for (let i = 0; i < polygon.length; i++) {
    const [[px, pz], [qx, qz]] = [polygon[i], polygon[(i + 1) % polygon.length]];
    const length = Math.hypot(qx - px, qz - pz);
    if (length === 0) continue;
    // The edge's normal into the polygon, whichever way round its corners go.
    const sign = area > 0 ? 1 : -1;
    const normal: Vec2 = [(sign * -(qz - pz)) / length, (sign * (qx - px)) / length];
    lines.push({ normal, offset: normal[0] * px + normal[1] * pz + reach(rect, normal) + PUSH_SLACK });
  }
  const { size: [width, depth], rotationY } = rect;
  const [right, front]: Vec2[] = [[Math.cos(rotationY), -Math.sin(rotationY)], [Math.sin(rotationY), Math.cos(rotationY)]];
  for (const [x, z] of polygon) {
    for (const [[ax, az], half] of [[right, width / 2], [front, depth / 2]] as const) {
      const along = ax * x + az * z;
      lines.push({ normal: [ax, az], offset: along - half - PUSH_SLACK }, { normal: [ax, az], offset: along + half + PUSH_SLACK });
    }
  }
  return lines;
}

/** The point on a line nearest to a floor point. */
function projectOnto([x, z]: Vec2, { normal: [nx, nz], offset }: Line): Vec2 {
  const off = offset - (x * nx + z * nz);
  return [x + nx * off, z + nz * off];
}

/** Where two lines cross, or null when they are parallel. */
function intersection({ normal: [ax, az], offset: a }: Line, { normal: [bx, bz], offset: b }: Line): Vec2 | null {
  const determinant = ax * bz - az * bx;
  if (Math.abs(determinant) < 1e-9) return null;
  return [(a * bz - az * b) / determinant, (ax * b - a * bx) / determinant];
}
