// Room Setup step 5 (spec §9.3): click a piece of furniture, get a box around it.
import type { Box, RoomSetup, Vec3 } from '@shared/types';
import { SPLIT, onFloor } from './classify';
import { type TriangleMesh, mm, newTriangleInfo, triangleInfo } from './mesh';
import { type AxisWall, nearAnyWall, nearestWall, withAxis } from './walls';

/** The thresholds of spec §9.3 step 5, in meters, plus the two this implementation adds. */
const AUTO_BOX = {
  /**
   * Horizontal reach from the click. Spec §9.3 says 1.0 m, which can't take in a 2.03 m twin XL
   * bed even when clicked at its middle; 1.25 m does when clicked within 20 cm of it.
   */
  radius: 1.25,
  minY: 0.03,               // above the floor
  wallGap: 0.03,            // away from every wall plane
  voxel: 0.05,
  /** Added: a box whose bottom is this close to the floor stands on it. */
  floorSnap: 0.1,
  /** Added: a box side this close to a wall is extended to touch it (the gap is where wallGap cut it). */
  wallSnap: 0.06,
};

/**
 * Which way a new box's front (+Z) faces: away from the nearest wall, or, for a bed, along its
 * length and away from the wall at its head.
 */
export type Facing = 'away-from-wall' | 'length';

/**
 * A box around the furniture under the click, or null when the click is on the bare floor or a wall.
 *
 * The triangles' surfaces are sampled every half voxel, not only their vertices, because a
 * simplified scan has few vertices on its flat tops. Samples within `radius` (horizontally) of the
 * click, above `minY`, below the ceiling and more than `wallGap` from every wall (and its ends, so
 * a room's corners too) are voxelized, leaving out the floor's bumps, which the split calls floor; and
 * the voxels touching the click's voxel are grown into a region. The region's bounds, in the room
 * frame (whose axes the walls already follow after step 1), become the box. Its front faces as
 * `facing` says.
 */
export function autoBox(
  mesh: TriangleMesh, click: Vec3, room: Pick<RoomSetup, 'walls' | 'ceilingHeight'>, facing: Facing = 'away-from-wall',
): Box | null {
  const walls = room.walls.map(withAxis);
  const voxels = new Map<number, Float64Array>();   // voxel key → [minX, minY, minZ, maxX, maxY, maxZ]
  const [clickX, , clickZ] = click;
  const maxY = room.ceilingHeight - SPLIT.ceilingBand;

  const addSample = (x: number, y: number, z: number, ny: number) => {
    if (y <= AUTO_BOX.minY || y >= maxY || onFloor(y, ny) || Math.hypot(x - clickX, z - clickZ) > AUTO_BOX.radius
      || nearAnyWall(walls, x, z, AUTO_BOX.wallGap)) return;
    const key = voxelKey(Math.floor(x / AUTO_BOX.voxel), Math.floor(y / AUTO_BOX.voxel), Math.floor(z / AUTO_BOX.voxel));
    const b = voxels.get(key);
    if (!b) voxels.set(key, Float64Array.of(x, y, z, x, y, z));
    else {
      b[0] = Math.min(b[0], x); b[1] = Math.min(b[1], y); b[2] = Math.min(b[2], z);
      b[3] = Math.max(b[3], x); b[4] = Math.max(b[4], y); b[5] = Math.max(b[5], z);
    }
  };

  const p = mesh.positions;
  const spacing = AUTO_BOX.voxel / 2;
  const info = newTriangleInfo();
  for (let t = 0; t < mesh.index.length; t += 3) {
    const a = 3 * mesh.index[t];
    const b = 3 * mesh.index[t + 1];
    const c = 3 * mesh.index[t + 2];
    // Skip triangles whose horizontal bounds are out of reach.
    const dx = Math.max(Math.min(p[a], p[b], p[c]) - clickX, 0, clickX - Math.max(p[a], p[b], p[c]));
    const dz = Math.max(Math.min(p[a + 2], p[b + 2], p[c + 2]) - clickZ, 0, clickZ - Math.max(p[a + 2], p[b + 2], p[c + 2]));
    if (Math.hypot(dx, dz) > AUTO_BOX.radius) continue;
    const edge = Math.max(distance(p, a, b), distance(p, b, c), distance(p, c, a));
    const n = Math.max(1, Math.ceil(edge / spacing));
    const { ny } = triangleInfo(mesh, t / 3, info);
    for (let i = 0; i <= n; i++) {
      for (let j = 0; i + j <= n; j++) {
        const u = i / n;
        const v = j / n;
        addSample(
          p[a] + u * (p[b] - p[a]) + v * (p[c] - p[a]),
          p[a + 1] + u * (p[b + 1] - p[a + 1]) + v * (p[c + 1] - p[a + 1]),
          p[a + 2] + u * (p[b + 2] - p[a + 2]) + v * (p[c + 2] - p[a + 2]),
          ny,
        );
      }
    }
  }

  const seed = seedVoxel(voxels, click);
  if (seed === undefined) return null;
  const bounds = growRegion(voxels, seed);

  // Stand it on the floor, and push sides that wallGap cut short back against their walls.
  if (bounds[1] < AUTO_BOX.floorSnap) bounds[1] = 0;
  for (const wall of walls) {
    if (Math.abs(wall.normal[0]) > 0.99) {
      const x = wall.start[0];
      if (wall.normal[0] > 0 && bounds[0] - x < AUTO_BOX.wallSnap && bounds[0] > x) bounds[0] = x;
      if (wall.normal[0] < 0 && x - bounds[3] < AUTO_BOX.wallSnap && bounds[3] < x) bounds[3] = x;
    } else if (Math.abs(wall.normal[1]) > 0.99) {
      const z = wall.start[1];
      if (wall.normal[1] > 0 && bounds[2] - z < AUTO_BOX.wallSnap && bounds[2] > z) bounds[2] = z;
      if (wall.normal[1] < 0 && z - bounds[5] < AUTO_BOX.wallSnap && bounds[5] < z) bounds[5] = z;
    }
  }

  const [x0, y0, z0, x1, y1, z1] = bounds;
  const center = [(x0 + x1) / 2, (z0 + z1) / 2] as const;
  const rotationY = facing === 'length'
    ? frontAlongLength(walls, bounds)
    : frontAwayFromNearestWall(walls, center[0], center[1]);
  const sideways = Math.abs(Math.sin(rotationY)) > 0.5;   // front along ±X: width runs along Z
  return {
    position: [mm(center[0]), mm(y0), mm(center[1])],
    size: sideways ? [mm(z1 - z0), mm(y1 - y0), mm(x1 - x0)] : [mm(x1 - x0), mm(y1 - y0), mm(z1 - z0)],
    rotationY,
  };
}

const OFFSET = 1 << 9;
const voxelKey = (ix: number, iy: number, iz: number) => ((ix + OFFSET) * 1024 + (iy + OFFSET)) * 1024 + (iz + OFFSET);

/** The click's voxel, or the nearest filled voxel within two voxels of it. */
function seedVoxel(voxels: Map<number, Float64Array>, [x, y, z]: Vec3): number | undefined {
  const [ix, iy, iz] = [x, y, z].map((v) => Math.floor(v / AUTO_BOX.voxel));
  let best: number | undefined;
  let bestDistance = Infinity;
  for (let ox = -2; ox <= 2; ox++) {
    for (let oy = -2; oy <= 2; oy++) {
      for (let oz = -2; oz <= 2; oz++) {
        const key = voxelKey(ix + ox, iy + oy, iz + oz);
        const d = ox * ox + oy * oy + oz * oz;
        if (d < bestDistance && voxels.has(key)) [best, bestDistance] = [key, d];
      }
    }
  }
  return best;
}

/** The bounds of the samples in every filled voxel connected to the seed (26-neighborhood). */
function growRegion(voxels: Map<number, Float64Array>, seed: number): number[] {
  const bounds = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  const seen = new Set([seed]);
  const queue = [seed];
  while (queue.length > 0) {
    const key = queue.pop()!;
    const b = voxels.get(key)!;
    for (let k = 0; k < 3; k++) {
      bounds[k] = Math.min(bounds[k], b[k]);
      bounds[k + 3] = Math.max(bounds[k + 3], b[k + 3]);
    }
    for (let ox = -1; ox <= 1; ox++) {
      for (let oy = -1; oy <= 1; oy++) {
        for (let oz = -1; oz <= 1; oz++) {
          const next = key + (ox * 1024 + oy) * 1024 + oz;
          if (!seen.has(next) && voxels.has(next)) {
            seen.add(next);
            queue.push(next);
          }
        }
      }
    }
  }
  return bounds;
}

/** The rotationY that turns a box's +Z front to the inward normal of the nearest wall, snapped to an axis. */
function frontAwayFromNearestWall(walls: AxisWall[], x: number, z: number) {
  const front = nearestWall(walls, x, z).wall?.normal ?? [0, 1];
  const [fx, fz] = Math.abs(front[0]) > Math.abs(front[1]) ? [Math.sign(front[0]), 0] : [0, Math.sign(front[1])];
  return Math.atan2(fx, fz);
}

/** The rotationY that turns a box's +Z front along its longer side, toward the end farther from a wall. */
function frontAlongLength(walls: AxisWall[], [x0, , z0, x1, , z1]: number[]) {
  const [cx, cz] = [(x0 + x1) / 2, (z0 + z1) / 2];
  if (x1 - x0 > z1 - z0) {
    const headAtLowX = nearestWall(walls, x0, cz).distance <= nearestWall(walls, x1, cz).distance;
    return Math.atan2(headAtLowX ? 1 : -1, 0);
  }
  const headAtLowZ = nearestWall(walls, cx, z0).distance <= nearestWall(walls, cx, z1).distance;
  return headAtLowZ ? 0 : Math.PI;
}

const distance = (p: Float32Array, a: number, b: number) => Math.hypot(p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]);
