// Where a baked Patch image (spec §11.2) lies in the room. bakePatches draws the image and Patch.tsx
// hangs it back up, and both derive its frame from the Original's box and the Wall alone, so the
// contract needs no coordinates.
import { distanceToWall, footprint, overlapLength, rectCorners } from '@shared/geometry';
import type { Box, Vec2, Vec3, Wall } from '@shared/types';

/** Patch images are square pixels' worth of this many pixels per side. */
export const IMAGE_SIZE = 512;
/** The Patch region: the Original's box grown by this on every side (ADR-0007, D3). */
export const REGION_GROW = 0.1;
/** An image reaches this far past the Original's footprint (§11.2 step 1). */
export const IMAGE_MARGIN = 0.4;
/** A Wall gets an image when it is within this of the grown box (§11.2 step 4). */
export const WALL_REACH = 0.1;
/** How far in from its edge a Patch image fades from solid to clear. */
export const FEATHER = 0.05;
/** An Original whose bottom is higher than this hangs on a wall, so it has no spot on the floor (replay.ts's ABOVE_FLOOR). */
const FLOOR_STANDING = 0.1;

/** The floor image: an axis-aligned square, North (−Z) up, whose top row is its smallest z. */
export interface FloorFrame { center: Vec2; side: number }

/** The Wall image: the strip `along` the Wall (meters from its start) and `up` (meters above the floor), seen from inside the room. */
export interface WallFrame { along: [number, number]; up: [number, number] }

/** The floor image of an Original, or null for one that hangs on a wall. */
export function floorFrame(box: Box): FloorFrame | null {
  if (box.position[1] > FLOOR_STANDING) return null;
  const [width, , depth] = box.size;
  const [cos, sin] = [Math.abs(Math.cos(box.rotationY)), Math.abs(Math.sin(box.rotationY))];
  const half = Math.max(cos * width + sin * depth, sin * width + cos * depth) / 2;
  return { center: [box.position[0], box.position[2]], side: 2 * (half + IMAGE_MARGIN) };
}

/** How far along a Wall, and how far into the room, a floor point is. */
function onWall([x, z]: Vec2, wall: Wall) {
  const { start: [sx, sz], end: [ex, ez] } = wall;
  const length = Math.hypot(ex - sx, ez - sz);
  return { along: ((x - sx) * (ex - sx) + (z - sz) * (ez - sz)) / length, into: distanceToWall([x, z], wall), length };
}

/**
 * The image behind an Original on a Wall, or null when the Wall is not within WALL_REACH of the
 * Original's grown box, or the box is nowhere along it. It spans the grown box plus IMAGE_MARGIN
 * along the Wall, and from the floor to IMAGE_MARGIN above the grown box.
 */
export function wallFrame(box: Box, wall: Wall): WallFrame | null {
  const grown = rectCorners(footprint(box, [box.size[0] + 2 * REGION_GROW, box.size[1], box.size[2] + 2 * REGION_GROW]))
    .map((corner) => onWall(corner, wall));
  const length = grown[0].length;
  const span: [number, number] = [Math.min(...grown.map((c) => c.along)), Math.max(...grown.map((c) => c.along))];
  if (Math.min(...grown.map((c) => c.into)) > WALL_REACH || overlapLength(span, [0, length]) <= 0) return null;
  const top = box.position[1] + box.size[1] + REGION_GROW + IMAGE_MARGIN;
  return {
    along: [Math.max(0, span[0] - IMAGE_MARGIN), Math.min(length, span[1] + IMAGE_MARGIN)],
    up: [0, Math.min(wall.height, top)],
  };
}

/** Whether a point lies in the Original's Patch region: its box grown by REGION_GROW on every side. */
export function inRegion(box: Box, [x, y, z]: Vec3): boolean {
  const [cos, sin] = [Math.cos(box.rotationY), Math.sin(box.rotationY)];
  const [dx, dz] = [x - box.position[0], z - box.position[2]];
  // The box's own axes are [cos, −sin] and [sin, cos] on the floor (shared/geometry.ts rectCorners).
  const [localX, localZ] = [dx * cos - dz * sin, dx * sin + dz * cos];
  return Math.abs(localX) <= box.size[0] / 2 + REGION_GROW
    && Math.abs(localZ) <= box.size[2] / 2 + REGION_GROW
    && y >= box.position[1] - REGION_GROW
    && y <= box.position[1] + box.size[1] + REGION_GROW;
}
