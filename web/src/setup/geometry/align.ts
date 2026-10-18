// Room Setup step 6 (ADR-0007, 0008): lining a Fill Capture up with the Main Capture, a moved
// Original's copy in it with the Original, and a Detail Capture's copy with the Originals it covers.
// Every Capture is gravity-aligned and in meters, so a turn about +Y and a translation (a
// YawTransform) is all that ever differs; except that an app's object mode can get a close-up's size
// wrong, so a Detail Capture's transform also scales.
import { pointInPolygon } from '@shared/geometry';
import type { Box, Vec2, Vec3, Wall, YawTransform } from '@shared/types';
import { SPLIT } from './classify';
import { type TriangleMesh, mm, newTriangleInfo, triangleInfo } from './mesh';
import { wallCoordinates, withAxis } from './walls';

export const IDENTITY: YawTransform = { position: [0, 0, 0], rotationY: 0 };

/**
 * A YawTransform that may first scale about the origin, as a Detail Capture's does
 * (DetailCapture.transform). Every function here takes one, and with no scale it is a plain YawTransform.
 */
export type ScaledYaw = YawTransform & { scale?: number };

/** True for scan-import's identity transform: a Capture that hasn't been lined up yet. */
export const isIdentity = ({ position, rotationY }: YawTransform) => rotationY === 0 && position.every((v) => v === 0);

/** A transform rounded the way the manifest stores it (mm, 1e-6 rad, a scale to 1e-4), so saves make small diffs. */
export const roundedYaw = ({ position, rotationY, scale }: ScaledYaw): ScaledYaw => ({
  position: position.map(mm) as Vec3,
  rotationY: Math.round(rotationY * 1e6) / 1e6 + 0,
  ...(scale !== undefined && scale !== 1 && { scale: Math.round(scale * 1e4) / 1e4 }),
});

/** A point moved by a transform: scaled, turned about +Y the three.js way (+Z toward +X), then translated. */
export function applyYaw({ position: [tx, ty, tz], rotationY, scale = 1 }: ScaledYaw, [x, y, z]: Vec3): Vec3 {
  const [c, s] = [Math.cos(rotationY), Math.sin(rotationY)];
  return [scale * (c * x + s * z) + tx, scale * y + ty, scale * (-s * x + c * z) + tz];
}

/** a ∘ b: the transform that applies b, then a. */
export function composeYaw(a: ScaledYaw, b: ScaledYaw): ScaledYaw {
  const scale = (a.scale ?? 1) * (b.scale ?? 1);
  return { position: applyYaw(a, b.position), rotationY: a.rotationY + b.rotationY, ...(scale !== 1 && { scale }) };
}

export function invertYaw({ position: [tx, ty, tz], rotationY, scale = 1 }: ScaledYaw): ScaledYaw {
  const [x, , z] = applyYaw({ position: [0, 0, 0], rotationY: -rotationY }, [tx, 0, tz]);
  return { position: [-x / scale, -ty / scale, -z / scale], rotationY: -rotationY, ...(scale !== 1 && { scale: 1 / scale }) };
}

export function transformMesh(mesh: TriangleMesh, transform: ScaledYaw): TriangleMesh {
  const positions = new Float32Array(mesh.positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    positions.set(applyYaw(transform, [mesh.positions[i], mesh.positions[i + 1], mesh.positions[i + 2]]), i);
  }
  return { positions, index: mesh.index };
}

const mean = (points: Vec2[]): Vec2 => [0, 1].map((k) => points.reduce((sum, p) => sum + p[k], 0) / points.length) as Vec2;

/**
 * The turn and floor position that carry `from` onto `to` (matching corners clicked in a Fill
 * Capture and in the room), by least squares: the 2D Procrustes fit, without scale.
 */
export function fitCorners(from: Vec2[], to: Vec2[]): { rotationY: number; offset: Vec2 } {
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

/**
 * fitCorners with a uniform scale as well: what carries points clicked on a Detail Capture onto the
 * same points of the Originals in the room (2D Procrustes with scale, after Umeyama).
 */
export function fitSimilar(from: Vec2[], to: Vec2[]): { rotationY: number; offset: Vec2; scale: number } {
  const { rotationY } = fitCorners(from, to);
  const [f0, t0] = [mean(from), mean(to)];
  // The scale that best fits the turned, centered points: Σ to·R(from) / Σ |from|².
  let [fit, size] = [0, 0];
  from.forEach(([fx, fz], i) => {
    const [x, , z] = applyYaw({ position: [0, 0, 0], rotationY }, [fx - f0[0], 0, fz - f0[1]]);
    fit += (to[i][0] - t0[0]) * x + (to[i][1] - t0[1]) * z;
    size += x * x + z * z;
  });
  const scale = size > 0 ? fit / size : 1;
  const [rx, , rz] = applyYaw({ position: [0, 0, 0], rotationY, scale }, [f0[0], 0, f0[1]]);
  return { rotationY, offset: [t0[0] - rx, t0[1] - rz], scale };
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

/** How far ICP may take a Detail Capture's scale from its estimate: clicked points or the copies' heights tell it that well. */
const SCALE_RANGE = 1.1;

/** A fit whose transform always has a scale. */
export type ScaledFit = Fit & { transform: ScaledYaw & { scale: number } };

/**
 * Point-to-plane ICP for a Detail Capture's copy of furniture standing on the floor: refines the turn,
 * the floor position and the scale of `start`, which carries `source` onto `target` in the room frame
 * (floor at y = 0). It scales about the copy's middle on the floor, so the copy stays standing on it,
 * and keeps the scale within 10% of the estimate `around` (by default the start's): a copy shrunk to a
 * speck matches any small target, and one grown a lot can take in a table it's tucked under.
 */
export function refineScaled(source: Samples, target: Samples, start: ScaledYaw, around = start.scale ?? 1): ScaledFit {
  let transform = { ...start, scale: start.scale ?? 1 };
  const [minScale, maxScale] = [around / SCALE_RANGE, around * SCALE_RANGE];
  for (let k = 0; k < ICP.iterations; k++) {
    const maxDistance = Math.max(ICP.lastDistance, ICP.firstDistance * 0.8 ** k);
    const matches: [p: Vec3, q: Vec3, n: Vec3][] = [];
    forEachMatch(source, target, transform, maxDistance, (p, q, n) => matches.push([p, q, n]));
    if (matches.length < 12) break;
    // Scale about the middle of the copy where the solve sees it, on the floor.
    const [cx, cz] = [0, 2].map((a) => matches.reduce((sum, [p]) => sum + p[a], 0) / matches.length);
    const ata = new Float64Array(16);
    const atb = new Float64Array(4);
    for (const [p, q, [nx, ny, nz]] of matches) {
      const [vx, vy, vz] = [p[0] - cx, p[1], p[2] - cz];
      const r = nx * (p[0] - q[0]) + ny * (p[1] - q[1]) + nz * (p[2] - q[2]);
      // d/dθ of the turned point is (z, 0, −x); d/ds of the scaled one is its offset from the middle.
      const row = [nx * vz - nz * vx, nx, nz, nx * vx + ny * vy + nz * vz];
      for (let i = 0; i < 4; i++) {
        atb[i] -= row[i] * r;
        for (let j = 0; j < 4; j++) ata[i * 4 + j] += row[i] * row[j];
      }
    }
    const x = solve(ata, atb, 4);
    if (!x) break;
    const [dTheta, dx, dz] = x;
    const ds = Math.min(maxScale, Math.max(minScale, transform.scale * (1 + x[3]))) / transform.scale - 1;
    // p'' = c + (1 + ds)·R(dθ)·(p' − c) + d, folded into the transform.
    const [tx, ty, tz] = applyYaw({ position: [0, 0, 0], rotationY: dTheta }, [
      (1 + ds) * (transform.position[0] - cx), (1 + ds) * transform.position[1], (1 + ds) * (transform.position[2] - cz),
    ]);
    transform = { position: [tx + cx + dx, ty, tz + cz + dz], rotationY: transform.rotationY + dTheta, scale: transform.scale * (1 + ds) };
    if (Math.abs(dTheta) < 1e-7 && Math.hypot(dx, dz) < 1e-6 && Math.abs(ds) < 1e-7 && maxDistance === ICP.lastDistance) break;
  }
  return { transform, ...fitQuality(source, target, transform, ICP.lastDistance) };
}

/** registerDetail tries its turns on at most this many of the copy's samples, then refines the best on all of them. */
const SWEEP_SAMPLES = 1500;

/**
 * Where a Detail Capture's copy of furniture stands among the Originals, with no points clicked:
 * starting from the two copies' middles on the floor and a rough scale (such as the ratio of their
 * heights), tries a turn every 15°, refines each with refineScaled, and keeps the lowest cost. The
 * copy's floor is at `floorHeight` in its own frame; the room's is at 0.
 */
export function registerDetail(source: Samples, target: Samples, sourceCenter: Vec2, targetCenter: Vec2, scale: number, floorHeight = 0): ScaledFit {
  const sweep = thinSamples(source, SWEEP_SAMPLES);
  let best: ScaledFit | null = null;
  for (let turn = 0; turn < 24; turn++) {
    const rotationY = (turn * Math.PI) / 12;
    const [rx, , rz] = applyYaw({ position: [0, 0, 0], rotationY, scale }, [sourceCenter[0], 0, sourceCenter[1]]);
    const start: ScaledYaw = { position: [targetCenter[0] - rx, -floorHeight * scale, targetCenter[1] - rz], rotationY, scale };
    const fit = refineScaled(sweep, target, start, scale);
    if (!best || fit.cost < best.cost) best = fit;
  }
  return refineScaled(source, target, best!.transform, scale);
}

/** Samples thinned evenly to at most `max`. */
function thinSamples({ points, normals, count }: Samples, max: number): Samples {
  if (count <= max) return { points, normals, count };
  const step = count / max;
  const thin = { points: new Float64Array(max * 3), normals: new Float64Array(max * 3), count: max };
  for (let i = 0; i < max; i++) {
    const j = Math.floor(i * step);
    thin.points.set(points.subarray(3 * j, 3 * j + 3), 3 * i);
    thin.normals.set(normals.subarray(3 * j, 3 * j + 3), 3 * i);
  }
  return thin;
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
  const cells = new Map<number, number[]>();
  // A hash of the cell: two cells sharing one only add candidates, which the callers' distance tests sort out.
  const hash = (ix: number, iy: number, iz: number) => (ix * 73856093) ^ (iy * 19349663) ^ (iz * 83492791);
  for (let i = 0; i < count; i++) {
    const k = hash(Math.floor(points[3 * i] / cell), Math.floor(points[3 * i + 1] / cell), Math.floor(points[3 * i + 2] / cell));
    let list = cells.get(k);
    if (!list) cells.set(k, (list = []));
    list.push(i);
  }
  /** Calls `visit` with every sample in the 27 cells around the point: all those within one cell size, and some farther. */
  function near([x, y, z]: Vec3, visit: (index: number) => void) {
    const [gx, gy, gz] = [Math.floor(x / cell), Math.floor(y / cell), Math.floor(z / cell)];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) for (const i of cells.get(hash(gx + dx, gy + dy, gz + dz)) ?? []) visit(i);
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

