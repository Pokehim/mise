// Room Setup step 6 (ADR-0007): lining a Fill Capture up with the Main Capture, and a moved
// Original's copy in it with the Original. Every Capture is gravity-aligned and in meters, so a turn about +Y and a
// translation (a YawTransform) is all that ever differs.
import { pointInPolygon } from '@shared/geometry';
import type { Box, Vec2, Vec3, Wall, YawTransform } from '@shared/types';
import { SPLIT } from './classify';
import { type TriangleMesh, newTriangleInfo, triangleInfo } from './mesh';
import { wallCoordinates, withAxis } from './walls';

export const IDENTITY: YawTransform = { position: [0, 0, 0], rotationY: 0 };

/** A point moved by a YawTransform: turned about +Y the three.js way (+Z toward +X), then translated. */
export function applyYaw({ position: [tx, ty, tz], rotationY }: YawTransform, [x, y, z]: Vec3): Vec3 {
  const [c, s] = [Math.cos(rotationY), Math.sin(rotationY)];
  return [c * x + s * z + tx, y + ty, -s * x + c * z + tz];
}

/** a ∘ b: the transform that applies b, then a. */
export const composeYaw = (a: YawTransform, b: YawTransform): YawTransform => ({
  position: applyYaw(a, b.position),
  rotationY: a.rotationY + b.rotationY,
});

export function invertYaw({ position: [tx, ty, tz], rotationY }: YawTransform): YawTransform {
  const [x, , z] = applyYaw({ position: [0, 0, 0], rotationY: -rotationY }, [tx, 0, tz]);
  return { position: [-x, -ty, -z], rotationY: -rotationY };
}

export function transformMesh(mesh: TriangleMesh, transform: YawTransform): TriangleMesh {
  const positions = new Float32Array(mesh.positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    positions.set(applyYaw(transform, [mesh.positions[i], mesh.positions[i + 1], mesh.positions[i + 2]]), i);
  }
  return { positions, index: mesh.index };
}

/**
 * The turn and floor position that carry `from` onto `to` (matching corners clicked in a Fill
 * Capture and in the room), by least squares: the 2D Procrustes fit, without scale.
 */
export function fitCorners(from: Vec2[], to: Vec2[]): { rotationY: number; offset: Vec2 } {
  const mean = (points: Vec2[]): Vec2 => [0, 1].map((k) => points.reduce((sum, p) => sum + p[k], 0) / points.length) as Vec2;
  const [fx0, fz0] = mean(from);
  const [tx0, tz0] = mean(to);
  // Maximize Σ to·R(from): c·Σ(tx fx + tz fz) + s·Σ(tx fz − tz fx), after centering both.
  let [dot, cross] = [0, 0];
  from.forEach(([fx, fz], i) => {
    const [x, z, tx, tz] = [fx - fx0, fz - fz0, to[i][0] - tx0, to[i][1] - tz0];
    dot += tx * x + tz * z;
    cross += tx * z - tz * x;
  });
  const rotationY = Math.atan2(cross, dot);
  const [rx, , rz] = applyYaw({ position: [0, 0, 0], rotationY }, [fx0, 0, fz0]);
  return { rotationY, offset: [tx0 - rx, tz0 - rz] };
}

/** Points on a surface with their normals: one per triangle, at its centroid. */
export interface Samples { points: Float64Array; normals: Float64Array; count: number }

/** A centroid and normal per triangle that `keep` accepts, thinned evenly to at most `max`. */
export function triangleSamples(mesh: TriangleMesh, keep: (info: ReturnType<typeof newTriangleInfo>) => boolean = () => true, max = 30_000): Samples {
  const info = newTriangleInfo();
  const kept: number[] = [];
  for (let t = 0; t < mesh.index.length / 3; t++) {
    triangleInfo(mesh, t, info);
    if (info.area > 1e-8 && keep(info)) kept.push(t);
  }
  const step = Math.max(1, kept.length / max);
  const count = Math.min(kept.length, Math.floor(kept.length / step));
  const points = new Float64Array(count * 3);
  const normals = new Float64Array(count * 3);
  for (let i = 0; i < count; i++) {
    triangleInfo(mesh, kept[Math.floor(i * step)], info);
    points.set([info.cx, info.cy, info.cz], 3 * i);
    normals.set([info.nx, info.ny, info.nz], 3 * i);
  }
  return { points, normals, count };
}

/**
 * Samples of a room's Surfaces, in the room frame: its floor and walls (the split's rules 3 and 4),
 * within `band` of their planes. Furniture moves between Captures and Surfaces don't, so only
 * Surfaces line Captures up. A wider band takes in a Capture that is still a few centimeters off.
 */
export function surfaceSamples(mesh: TriangleMesh, walls: Wall[], polygon: Vec2[], band = { floor: SPLIT.floorBand, wall: SPLIT.wallBand }): Samples {
  const axisWalls = walls.map(withAxis);
  return triangleSamples(mesh, ({ cx, cy, cz, nx, ny, nz }) => {
    if (Math.abs(cy) < band.floor && ny > SPLIT.floorNormalY) return pointInPolygon([cx, cz], polygon);
    return axisWalls.some((wall) => {
      const { depth, along } = wallCoordinates(wall, cx, cz);
      return Math.abs(depth) < band.wall && along >= 0 && along <= wall.length && cy <= wall.height
        && Math.abs(nx * wall.normal[0] + nz * wall.normal[1]) > SPLIT.wallNormalDot;
    });
  });
}

/** The same samples seen from another frame: each point and normal moved by `transform`. */
export function moveSamples({ points, normals, count }: Samples, transform: YawTransform): Samples {
  const turn = { position: [0, 0, 0] as Vec3, rotationY: transform.rotationY };
  const moved = { points: new Float64Array(points.length), normals: new Float64Array(normals.length), count };
  for (let i = 0; i < count; i++) {
    moved.points.set(applyYaw(transform, [points[3 * i], points[3 * i + 1], points[3 * i + 2]]), 3 * i);
    moved.normals.set(applyYaw(turn, [normals[3 * i], normals[3 * i + 1], normals[3 * i + 2]]), 3 * i);
  }
  return moved;
}

/** A test for room-frame points inside a box grown by `growth` on every side, its bottom included. */
export function inGrownBox({ position: [px, py, pz], size: [w, h, d], rotationY }: Box, growth: number) {
  const [c, s] = [Math.cos(rotationY), Math.sin(rotationY)];
  return ([x, y, z]: Vec3) => {
    const [dx, dz] = [x - px, z - pz];
    const [lx, lz] = [c * dx - s * dz, s * dx + c * dz];
    return Math.abs(lx) <= w / 2 + growth && Math.abs(lz) <= d / 2 + growth && y - py >= -growth && y - py <= h + growth;
  };
}

export interface Fit {
  transform: YawTransform;
  /** The median point-to-plane distance of the matched samples, in meters. */
  residual: number;
  /** The share of source samples that found a match. */
  matched: number;
  /** The mean distance with each unmatched sample counted as the match distance: lower fits better. */
  cost: number;
}

const ICP = {
  iterations: 40,
  /** Match distances shrink from the first to the last, so a rough start still finds its matches. */
  firstDistance: 0.3,
  lastDistance: 0.05,
  /** Matched surfaces must face the same way within about 45°. */
  normalDot: 0.7,
};

/**
 * Point-to-plane ICP: refines `start`, which carries `source` onto `target`. With `dof` 4 it solves
 * the turn and all three translations; with 3, the turn and the floor position only (a piece of
 * furniture standing on the floor).
 */
export function refineAlignment(source: Samples, target: Samples, start: YawTransform, dof: 3 | 4 = 4): Fit {
  let transform = start;
  for (let k = 0; k < ICP.iterations; k++) {
    const maxDistance = Math.max(ICP.lastDistance, ICP.firstDistance * 0.8 ** k);
    const { delta } = solveStep(source, target, transform, maxDistance, dof);
    if (!delta) break;
    transform = composeYaw(delta, transform);
    if (Math.abs(delta.rotationY) < 1e-7 && Math.hypot(...delta.position) < 1e-6 && maxDistance === ICP.lastDistance) break;
  }
  return { transform, ...fitQuality(source, target, transform, ICP.lastDistance) };
}

/**
 * Where an Original that a Fill Capture saw somewhere else stands in the Main Capture: tries the four
 * quarter turns about the two copies' centers (a box fits furniture four ways), refines each, and
 * keeps the best fit (the lowest cost, so a turn that matches less of the copy loses).
 */
export function registerMoved(source: Samples, target: Samples, sourceCenter: Vec2, targetCenter: Vec2): Fit {
  let best: Fit | null = null;
  for (let quarter = 0; quarter < 4; quarter++) {
    const turn: YawTransform = { position: [0, 0, 0], rotationY: (quarter * Math.PI) / 2 };
    const start = composeYaw(
      { position: [targetCenter[0], 0, targetCenter[1]], rotationY: 0 },
      composeYaw(turn, { position: [-sourceCenter[0], 0, -sourceCenter[1]], rotationY: 0 }),
    );
    const fit = refineAlignment(source, target, start, 3);
    if (!best || fit.cost < best.cost) best = fit;
  }
  return best!;
}

/** One Gauss-Newton step of point-to-plane ICP: the small extra transform that best closes the matched gaps. */
function solveStep(source: Samples, target: Samples, transform: YawTransform, maxDistance: number, dof: 3 | 4) {
  const n = dof;
  const ata = new Float64Array(n * n);
  const atb = new Float64Array(n);
  const row = new Float64Array(n);
  let matches = 0;
  forEachMatch(source, target, transform, maxDistance, (p, q, normal) => {
    const [nx, ny, nz] = normal;
    const r = nx * (p[0] - q[0]) + ny * (p[1] - q[1]) + nz * (p[2] - q[2]);
    // d/dθ of the turned point is (z, 0, −x); a translation moves it along itself.
    row[0] = nx * p[2] - nz * p[0];
    if (dof === 4) row.set([nx, ny, nz], 1);
    else row.set([nx, nz], 1);
    for (let i = 0; i < n; i++) {
      atb[i] -= row[i] * r;
      for (let j = 0; j < n; j++) ata[i * n + j] += row[i] * row[j];
    }
    matches++;
  });
  if (matches < dof * 3) return { delta: null };
  const x = solve(ata, atb, n);
  if (!x) return { delta: null };
  const delta: YawTransform = dof === 4
    ? { rotationY: x[0], position: [x[1], x[2], x[3]] }
    : { rotationY: x[0], position: [x[1], 0, x[2]] };
  return { delta };
}

function fitQuality(source: Samples, target: Samples, transform: YawTransform, maxDistance: number) {
  const distances: number[] = [];
  forEachMatch(source, target, transform, maxDistance, (p, q, [nx, ny, nz]) => {
    distances.push(Math.abs(nx * (p[0] - q[0]) + ny * (p[1] - q[1]) + nz * (p[2] - q[2])));
  });
  distances.sort((a, b) => a - b);
  const unmatched = source.count - distances.length;
  return {
    residual: distances.length > 0 ? distances[Math.floor(distances.length / 2)] : Infinity,
    matched: source.count > 0 ? distances.length / source.count : 0,
    cost: source.count > 0 ? (distances.reduce((a, b) => a + b, 0) + unmatched * maxDistance) / source.count : Infinity,
  };
}

/**
 * Calls `visit` with each source sample, moved by `transform`, and its nearest target sample within
 * `maxDistance` that faces the same way, with that target's normal.
 */
function forEachMatch(
  source: Samples, target: Samples, transform: YawTransform, maxDistance: number,
  visit: (point: Vec3, match: Vec3, normal: Vec3) => void,
) {
  const grid = sampleGrid(target, maxDistance);
  const [c, s] = [Math.cos(transform.rotationY), Math.sin(transform.rotationY)];
  for (let i = 0; i < source.count; i++) {
    const p = applyYaw(transform, [source.points[3 * i], source.points[3 * i + 1], source.points[3 * i + 2]]);
    const [snx, sny, snz] = [source.normals[3 * i], source.normals[3 * i + 1], source.normals[3 * i + 2]];
    const normal: Vec3 = [c * snx + s * snz, sny, -s * snx + c * snz];
    const j = grid.nearest(p, (k) =>
      target.normals[3 * k] * normal[0] + target.normals[3 * k + 1] * normal[1] + target.normals[3 * k + 2] * normal[2] > ICP.normalDot);
    if (j < 0) continue;
    visit(p, [target.points[3 * j], target.points[3 * j + 1], target.points[3 * j + 2]],
      [target.normals[3 * j], target.normals[3 * j + 1], target.normals[3 * j + 2]]);
  }
}

/** A hash grid of sample points, for queries within one cell size of a point. */
export function sampleGrid({ points, count }: Pick<Samples, 'points' | 'count'>, cell: number) {
  const cells = new Map<string, number[]>();
  const key = (x: number, y: number, z: number) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
  for (let i = 0; i < count; i++) {
    const k = key(points[3 * i], points[3 * i + 1], points[3 * i + 2]);
    let list = cells.get(k);
    if (!list) cells.set(k, (list = []));
    list.push(i);
  }
  /** Calls `visit` with every sample in the 27 cells around the point: all those within one cell size, and some farther. */
  function near([x, y, z]: Vec3, visit: (index: number) => void) {
    const [gx, gy, gz] = [Math.floor(x / cell), Math.floor(y / cell), Math.floor(z / cell)];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) for (const i of cells.get(`${gx + dx},${gy + dy},${gz + dz}`) ?? []) visit(i);
      }
    }
  }
  return {
    near,
    /** The nearest sample within one cell size that `accept` takes, or −1. */
    nearest(p: Vec3, accept: (index: number) => boolean): number {
      let best = -1;
      let bestSq = cell * cell;
      near(p, (i) => {
        const sq = (points[3 * i] - p[0]) ** 2 + (points[3 * i + 1] - p[1]) ** 2 + (points[3 * i + 2] - p[2]) ** 2;
        if (sq < bestSq && accept(i)) [best, bestSq] = [i, sq];
      });
      return best;
    },
  };
}

/** Solves the n × n system A x = b by Gaussian elimination with partial pivoting; null when singular. */
function solve(a: Float64Array, b: Float64Array, n: number): number[] | null {
  const m = Array.from({ length: n }, (_, i) => [...a.subarray(i * n, i * n + n), b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
    if (Math.abs(m[pivot][col]) < 1e-12) return null;
    [m[col], m[pivot]] = [m[pivot], m[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = m[r][col] / m[col][col];
      for (let k = col; k <= n; k++) m[r][k] -= f * m[col][k];
    }
  }
  return m.map((r, i) => r[n] / r[i]);
}

