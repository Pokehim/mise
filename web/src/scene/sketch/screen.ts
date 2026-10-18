import { type Camera, type Object3D, Vector3 } from 'three';
import type { Vec3 } from '@shared/types';

interface View { width: number; height: number }

/**
 * A point given in `object`'s frame, as pixels on a canvas (x right, y down), written back into
 * `point`. Its z is past 1 when the point is behind the camera.
 */
export function toScreen(point: Vector3, object: Object3D, camera: Camera, { width, height }: View) {
  point.applyMatrix4(object.matrixWorld).project(camera);
  return point.set(((point.x + 1) / 2) * width, ((1 - point.y) / 2) * height, point.z);
}

const corner = new Vector3();

/**
 * Where an item's box (its bottom-center at `object`'s origin) lies on screen, in pixels from the
 * screen point `from`, and whether any of its corners is behind the camera.
 */
export function screenBox(object: Object3D, [width, height, depth]: Vec3, from: Vector3, camera: Camera, view: View) {
  const box = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity, behind: false };
  for (let i = 0; i < 8; i++) {
    const { x, y, z } = toScreen(corner.set(i & 1 ? width / 2 : -width / 2, i & 2 ? height : 0, i & 4 ? depth / 2 : -depth / 2), object, camera, view);
    box.behind ||= z > 1;
    box.left = Math.min(box.left, x - from.x);
    box.top = Math.min(box.top, y - from.y);
    box.right = Math.max(box.right, x - from.x);
    box.bottom = Math.max(box.bottom, y - from.y);
  }
  return box;
}
