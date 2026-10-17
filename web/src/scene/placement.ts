import type { Ray } from 'three';
import type { Placement, Vec2, Vec3, Wall } from '@shared/types';
import { wallCoordinates, wallLength, wallPoint } from './floorPlan';

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));

/** Where a ray meets the floor (y = 0), if it points down at it. */
export function floorHit(ray: Ray): Vec2 | null {
  const { origin, direction } = ray;
  if (direction.y > -1e-6) return null;
  const t = -origin.y / direction.y;
  return [origin.x + direction.x * t, origin.z + direction.z * t];
}

/** The rotationY that turns a Piece's front (+Z) from one floor point toward another, to the nearest quarter turn. */
export function facing(from: Vec2, to: Vec2) {
  const quarter = Math.PI / 2;
  return Math.round(Math.atan2(to[0] - from[0], to[1] - from[1]) / quarter) * quarter;
}

/** A rotationY turned by whole 15° steps, kept in (-π, π]. */
export function turned(rotationY: number, steps: number) {
  const angle = rotationY + (steps * Math.PI) / 12;
  return angle - 2 * Math.PI * Math.ceil((angle - Math.PI) / (2 * Math.PI));
}

/**
 * A wall item hung flush on a wall, facing into the room: centered `along` the wall at height
 * `centerY`, and kept within the wall.
 */
export function onWall(wall: Wall, along: number, centerY: number, [width, height, depth]: Vec3): Placement {
  const [x, z] = wallPoint(wall, clamp(along, width / 2, wallLength(wall) - width / 2), depth / 2);
  const bottom = clamp(centerY - height / 2, 0, wall.height - height);
  return { position: [x, bottom, z], rotationY: Math.atan2(wall.normal[0], wall.normal[1]), mount: 'wall', wallId: wall.id };
}

const SNAP_DISTANCE = 0.1;
const SNAP_ANGLE = (20 * Math.PI) / 180;

/**
 * If the Piece's back is within 10 cm of a wall, or pushed into it, and the Piece faces within 20°
 * of the wall's normal: the placement that puts it flush against that wall, squared up (spec §10.3).
 */
export function snapToWall(placement: Placement, depth: number, walls: Wall[]): Placement | null {
  const [x, y, z] = placement.position;
  const front: Vec2 = [Math.sin(placement.rotationY), Math.cos(placement.rotationY)];
  const back: Vec2 = [x - (front[0] * depth) / 2, z - (front[1] * depth) / 2];
  let best: { wall: Wall; along: number; gap: number } | null = null;
  for (const wall of walls) {
    if (front[0] * wall.normal[0] + front[1] * wall.normal[1] < Math.cos(SNAP_ANGLE)) continue;
    const { along, into, length } = wallCoordinates(back, wall);
    if (into > SNAP_DISTANCE || into < -depth || along < 0 || along > length) continue;
    if (!best || Math.abs(into) < best.gap) best = { wall, along, gap: Math.abs(into) };
  }
  if (!best) return null;
  const [sx, sz] = wallPoint(best.wall, best.along, depth / 2);
  return { ...placement, position: [sx, y, sz], rotationY: Math.atan2(best.wall.normal[0], best.wall.normal[1]) };
}

/** Floor points spiraling out from a center in rings `step` apart, about `step` apart along each ring. */
export function* spiral([cx, cz]: Vec2, step: number, maxRadius: number): Generator<Vec2> {
  yield [cx, cz];
  for (let radius = step; radius <= maxRadius; radius += step) {
    const count = Math.ceil((2 * Math.PI * radius) / step);
    for (let i = 0; i < count; i++) {
      const angle = (2 * Math.PI * i) / count;
      yield [cx + radius * Math.cos(angle), cz + radius * Math.sin(angle)];
    }
  }
}
