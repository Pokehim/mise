import { type Camera, MathUtils, Plane, type Ray, Raycaster, Vector2, Vector3 } from 'three';
import { wallPoint } from '@shared/geometry';
import type { CatalogItem, Placement, Vec2, Vec3, Wall } from '@shared/types';
import { wallCoordinates, wallLength, wallRotationY } from './floorPlan';

/** Rugs lie flat: they stay on the floor, nothing rests on them, and they cast no blob shadow. */
export const liesFlat = (item: Pick<CatalogItem, 'category'>) => item.category === 'rug';

/** Where a ray meets the horizontal plane at height y (the floor by default), if it points at it. */
export function floorHit(ray: Ray, y = 0): Vec2 | null {
  const hit = ray.intersectPlane(new Plane(new Vector3(0, 1, 0), -y), new Vector3());
  return hit && [hit.x, hit.z];
}

/**
 * The floor point under a point of the view, given in normalized device coordinates (the view
 * center by default), or the point under the camera when that looks above the floor.
 */
export function floorPointInView(camera: Camera, at = new Vector2(0, 0)): Vec2 {
  const raycaster = new Raycaster();
  raycaster.setFromCamera(at, camera);
  return floorHit(raycaster.ray) ?? [camera.position.x, camera.position.z];
}

/** The rotationY that turns a Piece's front (+Z) from one floor point toward another, to the nearest quarter turn. */
export function facing(from: Vec2, to: Vec2) {
  const quarter = Math.PI / 2;
  return Math.round(Math.atan2(to[0] - from[0], to[1] - from[1]) / quarter) * quarter;
}

/** A rotationY turned by whole 15° steps, kept in (-π, π]. */
export function turned(rotationY: number, steps: number) {
  const angle = rotationY + steps * MathUtils.degToRad(15);
  return angle - 2 * Math.PI * Math.ceil((angle - Math.PI) / (2 * Math.PI));
}

/**
 * A wall item hung flush on a wall, facing into the room: centered `along` the wall at height
 * `centerY`, and kept within the wall.
 */
export function onWall(wall: Wall, along: number, centerY: number, [width, height, depth]: Vec3): Placement {
  const [x, z] = wallPoint(wall, MathUtils.clamp(along, width / 2, wallLength(wall) - width / 2), depth / 2);
  const bottom = MathUtils.clamp(centerY - height / 2, 0, wall.height - height);
  return { position: [x, bottom, z], rotationY: wallRotationY(wall), mount: 'wall', wallId: wall.id };
}

const SNAP_DISTANCE = 0.1;
const SNAP_ANGLE = MathUtils.degToRad(20);

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
  return { ...placement, position: [sx, y, sz], rotationY: wallRotationY(best.wall) };
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
