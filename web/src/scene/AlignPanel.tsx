// The Align panel's solver (spec §12, ADR-0005): fits the splat to the room from matching points.
// The panel itself (clicking points, the fine-tune sliders, saving splatTransform) waits for a real
// splat.spz from #12.
import type { ScanManifest, Vec3 } from '@shared/types';

export type SplatTransform = NonNullable<ScanManifest['splatTransform']>;

export interface PointPairFit {
  transform: SplatTransform;
  /** Root-mean-square distance, in meters, between each room point and its fitted splat point. */
  rms: number;
}

/**
 * Solves for the yaw, uniform scale and translation that best carry `splat` points onto the matching
 * `room` points, in the least-squares sense (a 2D Umeyama fit about +Y). The splat is already level
 * (#12), so there is no tilt.
 *
 * The transform composes like an Object3D's: room = position + rotateY(rotationY, scale · splat),
 * which is how splatTransform is applied to the SplatMesh.
 *
 * Throws unless there are at least 2 pairs, the same number on each side, and the splat points
 * aren't all the same point.
 */
export function fitPointPairs(splat: Vec3[], room: Vec3[]): PointPairFit {
  if (splat.length !== room.length) throw new Error('Click the same number of points on the splat and on the mesh');
  if (splat.length < 2) throw new Error('Click at least 2 matching points');

  const ps = centroid(splat);
  const pr = centroid(room);
  let cos = 0;
  let sin = 0;
  let spread = 0;
  for (let i = 0; i < splat.length; i++) {
    const [ax, ay, az] = sub(splat[i], ps);
    const [bx, , bz] = sub(room[i], pr);
    cos += ax * bx + az * bz;
    sin += az * bx - ax * bz;
    spread += ax * ax + ay * ay + az * az;
  }
  if (spread < 1e-12) throw new Error('The splat points are all the same point');

  const rotationY = Math.atan2(sin, cos);
  // Σ b · R(a) over all three axes, so height differences count toward the scale too.
  let along = 0;
  for (let i = 0; i < splat.length; i++) {
    const a = sub(splat[i], ps);
    const b = sub(room[i], pr);
    const ra = rotateY(a, rotationY);
    along += b[0] * ra[0] + b[1] * ra[1] + b[2] * ra[2];
  }
  const scale = along / spread;
  const rp = rotateY(ps, rotationY);
  const position: Vec3 = [pr[0] - scale * rp[0], pr[1] - scale * rp[1], pr[2] - scale * rp[2]];
  const transform = { position, rotationY, scale };

  let squared = 0;
  for (let i = 0; i < splat.length; i++) {
    const [dx, dy, dz] = sub(applySplatTransform(transform, splat[i]), room[i]);
    squared += dx * dx + dy * dy + dz * dz;
  }
  return { transform, rms: Math.sqrt(squared / splat.length) };
}

/** Carries a point from the splat frame to the room frame. */
export function applySplatTransform({ position, rotationY, scale }: SplatTransform, point: Vec3): Vec3 {
  const [x, y, z] = rotateY(point, rotationY);
  return [position[0] + scale * x, position[1] + scale * y, position[2] + scale * z];
}

// Same convention as three's Matrix4.makeRotationY.
function rotateY([x, y, z]: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [c * x + s * z, y, -s * x + c * z];
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

function centroid(points: Vec3[]): Vec3 {
  const sum: Vec3 = [0, 0, 0];
  for (const [x, y, z] of points) { sum[0] += x; sum[1] += y; sum[2] += z; }
  return [sum[0] / points.length, sum[1] / points.length, sum[2] / points.length];
}
