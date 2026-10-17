// Room Setup steps 1 and 2 (spec §9.3): floor height, yaw and ceiling height from histograms.
import type { YawTransform } from '@shared/types';
import { type TriangleMesh, newTriangleInfo, triangleInfo } from './mesh';

/** Weights per bin, with each bin's weighted sum of values so a peak can be located inside its bin. */
export interface Histogram { start: number; binSize: number; weights: Float64Array; sums: Float64Array }

export const LEVEL = {
  /** A triangle faces up (floor) when normal.y > this, and down (ceiling) when normal.y < −this. */
  facing: 0.9,
  heightBin: 0.01,
  /** A peak is strong when its weight is at least this share of the biggest peak's. */
  strongPeak: 0.3,
};

/**
 * The heights of the triangles that face up (or down), weighted by area. Area, not vertex count,
 * because a scan's flat floor has few, large triangles while its clutter has many small ones.
 */
export function heightHistogram(mesh: TriangleMesh, facing: 'up' | 'down'): Histogram | null {
  const sign = facing === 'up' ? 1 : -1;
  const info = newTriangleInfo();
  const count = mesh.index.length / 3;
  let min = Infinity;
  let max = -Infinity;
  for (let t = 0; t < count; t++) {
    triangleInfo(mesh, t, info);
    if (sign * info.ny <= LEVEL.facing) continue;
    min = Math.min(min, info.cy);
    max = Math.max(max, info.cy);
  }
  if (min > max) return null;
  const histogram = emptyHistogram(min, max, LEVEL.heightBin);
  for (let t = 0; t < count; t++) {
    triangleInfo(mesh, t, info);
    if (sign * info.ny > LEVEL.facing) add(histogram, info.cy, info.area);
  }
  return histogram;
}

/** The floor's height: the lowest strong peak of up-facing heights, below desk and bed tops. */
export function detectFloorHeight(mesh: TriangleMesh): number | null {
  const histogram = heightHistogram(mesh, 'up');
  return histogram && strongPeak(histogram, 'lowest');
}

/** The ceiling's height: the highest strong peak of down-facing heights, above shelf and desk undersides. */
export function detectCeilingHeight(mesh: TriangleMesh): number | null {
  const histogram = heightHistogram(mesh, 'down');
  return histogram && strongPeak(histogram, 'highest');
}

/**
 * The rotationY, in [−π/4, π/4), that turns the walls to face along the X and Z axes: the peak of a
 * histogram of the directions of near-vertical triangles (normal.y within ±0.3), weighted by area.
 *
 * Walls repeat every 90°, so each direction φ is binned as 4φ on a full circle; that keeps
 * directions just either side of an axis (−0.3° and 89.7°) in neighboring bins.
 */
export function detectYaw(mesh: TriangleMesh): number | null {
  const bins = 180;                          // 2° of 4φ, so 0.5° of φ
  const weights = new Float64Array(bins);
  const cos = new Float64Array(bins);
  const sin = new Float64Array(bins);
  const info = newTriangleInfo();
  for (let t = 0; t < mesh.index.length / 3; t++) {
    triangleInfo(mesh, t, info);
    if (Math.abs(info.ny) >= 0.3) continue;
    const theta = 4 * Math.atan2(info.nz, info.nx);
    const weight = info.area * Math.hypot(info.nx, info.nz);
    const bin = Math.floor(((theta / (2 * Math.PI)) % 1 + 1) % 1 * bins) % bins;
    weights[bin] += weight;
    cos[bin] += weight * Math.cos(theta);
    sin[bin] += weight * Math.sin(theta);
  }
  let peak = 0;
  let best = 0;
  for (let b = 0; b < bins; b++) {
    const around = weights[(b + bins - 1) % bins] + 2 * weights[b] + weights[(b + 1) % bins];
    if (around > best) [peak, best] = [b, around];
  }
  if (best === 0) return null;
  let x = 0;
  let y = 0;
  for (const b of [peak - 1, peak, peak + 1]) {
    x += cos[(b + bins) % bins];
    y += sin[(b + bins) % bins];
  }
  // Rotating by r turns a direction φ into φ − r, so r = φ lines that wall up with an axis.
  const phi = Math.atan2(y, x) / 4;          // (−π/4, π/4]
  return phi >= Math.PI / 4 ? phi - Math.PI / 2 : phi;
}

/**
 * The meshTransform (capture frame → room frame) that rotates by `rotationY`, puts the floor at
 * y = 0, and centers the floor (its up-facing triangles within 5 cm of `floorHeight`) on the origin.
 */
export function levelTransform(mesh: TriangleMesh, floorHeight: number, rotationY: number): YawTransform {
  const c = Math.cos(rotationY);
  const s = Math.sin(rotationY);
  const bounds = [Infinity, Infinity, -Infinity, -Infinity];
  const info = newTriangleInfo();
  for (let t = 0; t < mesh.index.length / 3; t++) {
    triangleInfo(mesh, t, info);
    if (info.ny <= LEVEL.facing || Math.abs(info.cy - floorHeight) > 0.05) continue;
    for (let k = 0; k < 3; k++) {
      const v = 3 * mesh.index[3 * t + k];
      const x = c * mesh.positions[v] + s * mesh.positions[v + 2];
      const z = -s * mesh.positions[v] + c * mesh.positions[v + 2];
      bounds[0] = Math.min(bounds[0], x);
      bounds[1] = Math.min(bounds[1], z);
      bounds[2] = Math.max(bounds[2], x);
      bounds[3] = Math.max(bounds[3], z);
    }
  }
  const [x0, z0, x1, z1] = bounds[0] <= bounds[2] ? bounds : [0, 0, 0, 0];
  return { position: [-(x0 + x1) / 2, -floorHeight, -(z0 + z1) / 2], rotationY };
}

function emptyHistogram(min: number, max: number, binSize: number): Histogram {
  const bins = Math.floor((max - min) / binSize) + 1;
  return { start: min, binSize, weights: new Float64Array(bins), sums: new Float64Array(bins) };
}

function add(h: Histogram, value: number, weight: number) {
  const bin = Math.min(h.weights.length - 1, Math.floor((value - h.start) / h.binSize));
  h.weights[bin] += weight;
  h.sums[bin] += weight * value;
}

/** The value at the lowest (or highest) bin whose smoothed weight is strong, refined to its local maximum. */
function strongPeak(h: Histogram, which: 'lowest' | 'highest'): number | null {
  const smooth = smoothed(h.weights);
  const threshold = LEVEL.strongPeak * Math.max(...smooth);
  if (!(threshold > 0)) return null;
  const step = which === 'lowest' ? 1 : -1;
  let bin = which === 'lowest' ? 0 : smooth.length - 1;
  while (smooth[bin] < threshold) bin += step;
  while (smooth[bin + step] >= smooth[bin]) bin += step;
  let weight = 0;
  let sum = 0;
  for (let b = Math.max(0, bin - 1); b <= Math.min(smooth.length - 1, bin + 1); b++) {
    weight += h.weights[b];
    sum += h.sums[b];
  }
  return sum / weight;
}

/** Weights blurred with a [1 2 1] kernel, so a peak split across two bins still counts as one. */
function smoothed(weights: Float64Array): Float64Array {
  const out = new Float64Array(weights.length);
  for (let i = 0; i < weights.length; i++) {
    out[i] = (2 * weights[i] + (weights[i - 1] ?? 0) + (weights[i + 1] ?? 0)) / 4;
  }
  return out;
}
