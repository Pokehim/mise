import { type Camera, MathUtils, Plane, type Ray, Raycaster, Vector2, Vector3 } from 'three';
import { distanceToWall, footprint, gapTo, isBy, type OrientedRect, pushFootprintInside, reach, rectCorners, wallPoint } from '@shared/geometry';
import type { CatalogItem, Placement, RoomSetup, Vec2, Vec3, Wall } from '@shared/types';
import { wallLength, wallRotationY } from './floorPlan';

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

/** An angle kept in (−π, π]. */
const wrapped = (angle: number) => angle - 2 * Math.PI * Math.ceil((angle - Math.PI) / (2 * Math.PI));

/** A rotationY turned by whole 15° steps, kept in (-π, π]. */
export const turned = (rotationY: number, steps: number) => wrapped(rotationY + steps * MathUtils.degToRad(15));

/**
 * A wall item hung flush on a wall, facing into the room: centered `along` the wall at height
 * `centerY`, and kept within the wall.
 */
export function onWall(wall: Wall, along: number, centerY: number, [width, height, depth]: Vec3): Placement {
  const [x, z] = wallPoint(wall, MathUtils.clamp(along, width / 2, wallLength(wall) - width / 2), depth / 2);
  const bottom = MathUtils.clamp(centerY - height / 2, 0, wall.height - height);
  return { position: [x, bottom, z], rotationY: wallRotationY(wall), mount: 'wall', wallId: wall.id };
}

/** How near a wall, in meters, an item's back or side snaps flush against it, and how square to it it must already be. */
const SNAP_DISTANCE = 0.15;
const SNAP_ANGLE = MathUtils.degToRad(20);

/** An item's back and sides, by the turn from its front to the way each faces out: its right is its own +X. */
const SIDES = { back: Math.PI, right: Math.PI / 2, left: -Math.PI / 2 };

/** The way a rotationY turns something's front (+Z), on the floor. */
const frontOf = (rotationY: number): Vec2 => [Math.sin(rotationY), Math.cos(rotationY)];

/**
 * The placement that snaps an item flush against a wall (spec §10.3), or null when none is near: if
 * its back is within 15 cm of a wall, or pushed into it, and within 20° of square to it, its back
 * goes flat against the wall, so it faces straight into the room. Its side snaps the same way, but
 * the item still faces along the wall. Near two walls that meet, with its back to one and a side to
 * the other, it goes into their corner, flush against both.
 */
export function snapToWalls(placement: Placement, size: Vec3, walls: Wall[]): Placement | null {
  const rect = footprint(placement, size);
  const shape = { corners: rectCorners(rect) };
  const flush = walls
    .filter((wall) => isBy(wall, shape, SNAP_DISTANCE))
    .flatMap((wall) => Object.values(SIDES).flatMap((turn) => {
      const [ox, oz] = frontOf(placement.rotationY + turn);
      if (-(ox * wall.normal[0] + oz * wall.normal[1]) < Math.cos(SNAP_ANGLE)) return [];
      // Turned so that side faces straight at the wall.
      const rotationY = wrapped(Math.atan2(-wall.normal[0], -wall.normal[1]) - turn);
      return [{ wall, turn, rotationY, gap: Math.abs(gapTo(wall, shape)) }];
    }))
    .sort((a, b) => a.gap - b.gap);
  const corner = flush
    .filter(({ turn }) => turn === SIDES.back)
    .flatMap((back) => flush
      .filter((side) => side.turn !== SIDES.back && side.wall !== back.wall && Math.abs(wrapped(side.rotationY - back.rotationY)) < SNAP_ANGLE)
      .map((side) => ({ back, side, gap: back.gap + side.gap })))
    .sort((a, b) => a.gap - b.gap)[0];
  const at = (rotationY: number, [x, z]: Vec2): Placement => ({ ...placement, position: [x, placement.position[1], z], rotationY });
  if (corner) {
    const { back, side } = corner;
    return at(back.rotationY, flushInto(back.wall, side.wall, { ...rect, rotationY: back.rotationY }));
  }
  if (!flush.length) return null;
  const { wall, rotationY } = flush[0];
  return at(rotationY, flushAgainst(wall, { ...rect, rotationY }));
}

/** Where a rectangle's center goes to stand flush against two walls that meet, in their corner. */
function flushInto(a: Wall, b: Wall, rect: OrientedRect): Vec2 {
  // On both walls' flush lines, where normal · center = normal · start + reach.
  const [[ax, az], [bx, bz]] = [a.normal, b.normal];
  const da = ax * a.start[0] + az * a.start[1] + reach(rect, a.normal);
  const db = bx * b.start[0] + bz * b.start[1] + reach(rect, b.normal);
  const determinant = ax * bz - az * bx;
  return [(da * bz - az * db) / determinant, (ax * db - da * bx) / determinant];
}

/** Where a rectangle's center goes, moved straight toward or away from a wall, to stand flush against it. */
function flushAgainst(wall: Wall, rect: OrientedRect): Vec2 {
  const [[cx, cz], [nx, nz]] = [rect.center, wall.normal];
  const off = reach(rect, wall.normal) - distanceToWall(rect.center, wall);
  return [cx + nx * off, cz + nz * off];
}

/**
 * Where an item on the floor, or on something on it, stands, as walls are solid: its whole footprint
 * inside the room, moved the shortest way, then snapped flush to a wall or into a corner near it,
 * unless `snap` is off (Alt). Null when it can't fit in the room at all, so the caller can keep its
 * last good placement.
 */
export function keepInRoom(placement: Placement, size: Vec3, setup: RoomSetup, { snap = true } = {}): Placement | null {
  const { polygon } = setup.floor;
  const inside = pushFootprintInside(placement, size, polygon);
  const snapped = inside && snap && snapToWalls(inside, size, setup.walls);
  // In an L-shaped room, a spot flush against one wall can still cut the inner corner.
  return (snapped && pushFootprintInside(snapped, size, polygon)) || inside;
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
