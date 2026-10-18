// scripts/collision.ts — fits an item's collision boxes (#129) to its GLB: up to 12 boxes, so the Fit rules can leave
// its open spaces open, such as the knee space under a desk or the floor under a bed. Node-only: shared/ stays free of
// GLB code, and shared/collision.ts reads the result.
//
// 1. Load the GLB, decoding meshopt, which most built models use.
// 2. Drop what isn't furniture: a Master Copy's `shadow` node (ADR-0009), and a zero-thickness plane at floor level
//    that is bigger than the rest of the model. Nothing else: never by name, never for being low-poly.
// 3. Voxelize the surface at 2 cm, then fill closed interiors: what a flood from outside doesn't reach is solid.
// 4. Merge greedily into at most 12 boxes, the one that covers the most first, until they cover 97 % of the solid
//    voxels or the next box would add little; at least 85 %, or the item is one solid box. A box takes in an empty voxel only within two voxel steps of a solid one: its center within about 3 cm.
//    (#129 asked for 8 boxes, 97 % and 1 cm; that left 43 % of the Catalog one solid box, as curved parts voxelize to
//    staircases. These bounds leave about 4 %, and still keep a desk's knee space and the floor under a bed open.)
// 5. Tighten each box to the geometry inside it, and round to the millimeter.
// Else the item is one solid box: its `size`.

import { readFile } from 'node:fs/promises';
import { type Document, type mat4, NodeIO, type Primitive } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { sizeBox } from '../shared/collision';
import type { CollisionBox, Vec3 } from '../shared/types';

export const VOXEL = 0.02;
export const MAX_BOXES = 12;
export const MIN_COVERAGE = 0.85;
/**
 * Boxes are added until they cover this much, or the next would cover less than MIN_GAIN of the solid voxels: a table's
 * leg is 2 % of it, and gets a box of its own however well the top is covered.
 */
const TARGET_COVERAGE = 0.995;
const MIN_GAIN = 0.005;
/**
 * What each empty voxel a box takes in costs it, against each solid voxel it covers: a box's outer layer goes when it
 * is more than 87 % empty, so a table top's box doesn't reach down 4 cm for the top of a leg.
 */
const EMPTY_COST = 0.15;
/** How many voxel steps, face to face, an empty voxel a box takes in may be from a solid one. */
const REACH = 2;
/** The least a box measures on any axis: a flat part's box is this thick, so it still collides. */
const MIN_THICKNESS = 0.01;
/** Flagged for a look in ?boxes=1: cleaned bounds this far from `size` on any axis, or boxes filling less of it. */
export const SIZE_TOLERANCE = 0.02;
export const MIN_SIZE_FILL = 0.3;
/**
 * A model this low-poly whose boxes fill this little of its bounds is likely a stand-in: one solid box. Unless its boxes
 * cover CLEAN_COVERAGE of it, as a low-poly table of a slab on four legs does: that is clean geometry, fitted exactly.
 */
const LOW_POLY = 200;
const LOW_POLY_FILL = 0.6;
const CLEAN_COVERAGE = 0.97;
/** A floor plane: this thin, and this close to the floor. */
const FLAT = 0.001;
const FLOOR_LEVEL = 0.005;
/** Every Master Copy's soft shadow (web/src/scene/masterCopy.ts). */
const SHADOW_NODE = 'shadow';
/** How many uncovered voxels each greedy round grows candidate boxes from. */
const SEEDS = 600;

/** One primitive of the model, as triangles in the model's frame: 9 numbers per triangle. */
export interface Part { node: string; triangles: Float64Array }

export interface Bounds { min: Vec3; max: Vec3 }

/** What the fitter found for one model. `boxes` is empty when it falls back to one solid box, and `fallback` says why. */
export interface Fit {
  boxes: CollisionBox[];
  fallback?: string;
  /** Of the solid voxels, how many the boxes cover. */
  coverage: number;
  /** How much of the cleaned bounds the boxes fill. */
  fill: number;
  bounds: Bounds;
  triangles: number;
  /** The parts dropped as not furniture, by top-level node name. */
  dropped: string[];
}

/* ───────────── Loading ───────────── */

let ready: Promise<NodeIO> | undefined;

/** A NodeIO that reads every extension the Catalog's and the Scans' models use, meshopt compression included. */
export const collisionIo = () => (ready ??= MeshoptDecoder.ready.then(() =>
  new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder })));

/** A primitive's triangles as vertex indices, three per triangle; none for points and lines. */
function triangleIndices(primitive: Primitive): ArrayLike<number> {
  const count = primitive.getIndices()?.getCount() ?? primitive.getAttribute('POSITION')?.getCount() ?? 0;
  const indices = primitive.getIndices()?.getArray() ?? Array.from({ length: count }, (_, i) => i);
  const mode = primitive.getMode();
  if (mode === 4) return indices;   // TRIANGLES
  const out: number[] = [];
  for (let i = 0; i + 2 < count; i++) {
    if (mode === 5) out.push(...(i % 2 ? [indices[i + 1], indices[i], indices[i + 2]] : [indices[i], indices[i + 1], indices[i + 2]]));
    if (mode === 6) out.push(indices[0], indices[i + 1], indices[i + 2]);   // TRIANGLE_FAN
  }
  return out;
}

/** Every triangle of the document's scene, in its frame, one Part per primitive drawn, named by its top-level node. */
export function readParts(doc: Document): Part[] {
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
  if (!scene) throw new Error('the glTF has no scene');
  const parts: Part[] = [];
  for (const top of scene.listChildren()) {
    top.traverse((node) => {
      const mesh = node.getMesh();
      if (!mesh) return;
      const m: mat4 = node.getWorldMatrix();
      for (const primitive of mesh.listPrimitives()) {
        const position = primitive.getAttribute('POSITION');
        const indices = triangleIndices(primitive);
        if (!position || indices.length < 3) continue;
        const world = new Float64Array(position.getCount() * 3);
        const v = [0, 0, 0];
        for (let i = 0; i < position.getCount(); i++) {
          position.getElement(i, v);   // dequantized
          world[3 * i] = m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12];
          world[3 * i + 1] = m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13];
          world[3 * i + 2] = m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14];
        }
        const triangles = new Float64Array(indices.length * 3);
        for (let k = 0; k < indices.length; k++) triangles.set(world.subarray(3 * indices[k], 3 * indices[k] + 3), 3 * k);
        parts.push({ node: top.getName(), triangles });
      }
    });
  }
  return parts;
}

/* ───────────── Cleaning ───────────── */

const EMPTY: Bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };

export function boundsOf(parts: Part[]): Bounds {
  const min = [...EMPTY.min] as Vec3;
  const max = [...EMPTY.max] as Vec3;
  for (const { triangles } of parts) {
    for (let i = 0; i < triangles.length; i += 3) {
      for (let a = 0; a < 3; a++) {
        min[a] = Math.min(min[a], triangles[i + a]);
        max[a] = Math.max(max[a], triangles[i + a]);
      }
    }
  }
  return { min, max };
}

const footprint = ({ min, max }: Bounds) => Math.max(0, max[0] - min[0]) * Math.max(0, max[2] - min[2]);

/**
 * The parts that are furniture: all but a Master Copy's `shadow` node, and a plane at floor level with near-zero
 * thickness and a bigger footprint than the rest of the model, such as a baked shadow. A rug, a slab that is the whole
 * model, stays. Nothing is dropped by its name, other than `shadow`, or for having few triangles.
 */
export function furniture(parts: Part[]): { kept: Part[]; dropped: string[] } {
  const named = parts.filter(({ node }) => node !== SHADOW_NODE);
  const dropped = parts.length > named.length ? [SHADOW_NODE] : [];
  const bounds = named.map((part) => boundsOf([part]));
  const floor = Math.min(...bounds.map(({ min }) => min[1]));
  const flat = bounds.map(({ min, max }) => max[1] - min[1] < FLAT && min[1] - floor < FLOOR_LEVEL);
  const rest = named.filter((_, i) => !flat[i]);
  if (rest.length === 0) return { kept: named, dropped };
  const restFootprint = footprint(boundsOf(rest));
  const plane = (i: number) => flat[i] && footprint(bounds[i]) > restFootprint;
  for (const [i, part] of named.entries()) if (plane(i)) dropped.push(part.node || '(floor plane)');
  return { kept: named.filter((_, i) => !plane(i)), dropped };
}

/* ───────────── Voxels ───────────── */

/** Voxel states. A padding layer of EMPTY all around lets the flood reach every outside voxel. */
const EMPTY_VOXEL = 0;
const SURFACE = 1;
const INTERIOR = 2;

/** A voxel grid over some bounds: `n` voxels a side inside, each index into `cells` padded by one voxel. */
export interface Grid {
  origin: Vec3;
  n: Vec3;
  /** Padded sizes: n + 2. */
  dims: Vec3;
  cells: Uint8Array;
}

const cellIndex = (dims: Vec3, x: number, y: number, z: number) => x + dims[0] * (y + dims[1] * z);

/** Whether a triangle overlaps an axis-aligned box: Akenine-Möller's separating axis test. */
function triangleOverlapsBox(t: ArrayLike<number>, o: number, center: Vec3, half: number): boolean {
  const v0 = [t[o] - center[0], t[o + 1] - center[1], t[o + 2] - center[2]];
  const v1 = [t[o + 3] - center[0], t[o + 4] - center[1], t[o + 5] - center[2]];
  const v2 = [t[o + 6] - center[0], t[o + 7] - center[1], t[o + 8] - center[2]];
  // The box's own axes.
  for (let a = 0; a < 3; a++) {
    if (Math.min(v0[a], v1[a], v2[a]) > half || Math.max(v0[a], v1[a], v2[a]) < -half) return false;
  }
  const e0 = [v1[0] - v0[0], v1[1] - v0[1], v1[2] - v0[2]];
  const e1 = [v2[0] - v1[0], v2[1] - v1[1], v2[2] - v1[2]];
  const e2 = [v0[0] - v2[0], v0[1] - v2[1], v0[2] - v2[2]];
  // The triangle's plane.
  const normal = [e0[1] * e1[2] - e0[2] * e1[1], e0[2] * e1[0] - e0[0] * e1[2], e0[0] * e1[1] - e0[1] * e1[0]];
  const d = normal[0] * v0[0] + normal[1] * v0[1] + normal[2] * v0[2];
  const r = half * (Math.abs(normal[0]) + Math.abs(normal[1]) + Math.abs(normal[2]));
  if (Math.abs(d) > r) return false;
  // The nine cross products of an edge and a box axis.
  for (const e of [e0, e1, e2]) {
    for (let a = 0; a < 3; a++) {
      const axis = [0, 0, 0];
      axis[(a + 1) % 3] = -e[(a + 2) % 3];
      axis[(a + 2) % 3] = e[(a + 1) % 3];
      const p0 = axis[0] * v0[0] + axis[1] * v0[1] + axis[2] * v0[2];
      const p1 = axis[0] * v1[0] + axis[1] * v1[1] + axis[2] * v1[2];
      const p2 = axis[0] * v2[0] + axis[1] * v2[1] + axis[2] * v2[2];
      const radius = half * (Math.abs(axis[0]) + Math.abs(axis[1]) + Math.abs(axis[2]));
      if (Math.min(p0, p1, p2) > radius || Math.max(p0, p1, p2) < -radius) return false;
    }
  }
  return true;
}

/** Marks every voxel the parts' surface touches as SURFACE. */
export function voxelize(parts: Part[], bounds: Bounds, voxel = VOXEL): Grid {
  const n = [0, 1, 2].map((a) => Math.max(1, Math.ceil((bounds.max[a] - bounds.min[a]) / voxel - 1e-6))) as Vec3;
  const dims = n.map((count) => count + 2) as Vec3;
  const cells = new Uint8Array(dims[0] * dims[1] * dims[2]);
  const origin = bounds.min;
  // Touching counts: a face on a voxel boundary marks both voxels, so a closed surface stays closed.
  const half = voxel / 2 + 1e-7;
  const range = (lo: number, hi: number, a: number) => [
    Math.max(0, Math.floor((lo - origin[a]) / voxel - 1e-6)),
    Math.min(n[a] - 1, Math.floor((hi - origin[a]) / voxel + 1e-6)),
  ];
  const center: Vec3 = [0, 0, 0];
  for (const { triangles } of parts) {
    for (let o = 0; o < triangles.length; o += 9) {
      const [x0, x1] = range(Math.min(triangles[o], triangles[o + 3], triangles[o + 6]), Math.max(triangles[o], triangles[o + 3], triangles[o + 6]), 0);
      const [y0, y1] = range(Math.min(triangles[o + 1], triangles[o + 4], triangles[o + 7]), Math.max(triangles[o + 1], triangles[o + 4], triangles[o + 7]), 1);
      const [z0, z1] = range(Math.min(triangles[o + 2], triangles[o + 5], triangles[o + 8]), Math.max(triangles[o + 2], triangles[o + 5], triangles[o + 8]), 2);
      for (let z = z0; z <= z1; z++) {
        center[2] = origin[2] + (z + 0.5) * voxel;
        for (let y = y0; y <= y1; y++) {
          center[1] = origin[1] + (y + 0.5) * voxel;
          for (let x = x0; x <= x1; x++) {
            const i = cellIndex(dims, x + 1, y + 1, z + 1);
            if (cells[i]) continue;
            center[0] = origin[0] + (x + 0.5) * voxel;
            if (triangleOverlapsBox(triangles, o, center, half)) cells[i] = SURFACE;
          }
        }
      }
    }
  }
  return { origin, n, dims, cells };
}

/** Marks every empty voxel that a flood from outside the grid can't reach as INTERIOR: a closed shell is solid. */
export function fillInterior({ dims, cells }: Grid) {
  const outside = new Uint8Array(cells.length);
  const queue = new Int32Array(cells.length);
  let head = 0;
  let tail = 0;
  outside[0] = 1;
  queue[tail++] = 0;
  const steps = [-1, 1, -dims[0], dims[0], -dims[0] * dims[1], dims[0] * dims[1]];
  while (head < tail) {
    const i = queue[head++];
    const x = i % dims[0];
    const y = Math.floor(i / dims[0]) % dims[1];
    const z = Math.floor(i / (dims[0] * dims[1]));
    const inGrid = [x > 0, x < dims[0] - 1, y > 0, y < dims[1] - 1, z > 0, z < dims[2] - 1];
    for (let s = 0; s < 6; s++) {
      const j = i + steps[s];
      if (!inGrid[s] || outside[j] || cells[j] !== EMPTY_VOXEL) continue;
      outside[j] = 1;
      queue[tail++] = j;
    }
  }
  for (let i = 0; i < cells.length; i++) if (cells[i] === EMPTY_VOXEL && !outside[i]) cells[i] = INTERIOR;
}

/* ───────────── Merging ───────────── */

/** A box of voxels, inclusive, in padded indices: [x0, y0, z0, x1, y1, z1]. */
type VoxelBox = [number, number, number, number, number, number];

/** A summed-volume table over the padded grid, for counting what a box of voxels holds in constant time. */
class Sums {
  private readonly table: Int32Array;
  private readonly sx: number;
  private readonly sxy: number;
  constructor(private readonly dims: Vec3, value: (i: number) => number) {
    const [nx, ny, nz] = dims;
    this.sx = nx + 1;
    this.sxy = (nx + 1) * (ny + 1);
    const t = (this.table = new Int32Array(this.sxy * (nz + 1)));
    for (let z = 0; z < nz; z++) {
      for (let y = 0; y < ny; y++) {
        for (let x = 0; x < nx; x++) {
          const at = x + 1 + this.sx * (y + 1) + this.sxy * (z + 1);
          t[at] = value(cellIndex(dims, x, y, z))
            + t[at - 1] + t[at - this.sx] + t[at - this.sxy]
            - t[at - 1 - this.sx] - t[at - 1 - this.sxy] - t[at - this.sx - this.sxy]
            + t[at - 1 - this.sx - this.sxy];
        }
      }
    }
  }

  count(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): number {
    const { table: t, sx, sxy } = this;
    const a = x0 + sx * y0 + sxy * z0;
    const dx = x1 + 1 - x0;
    const dy = (y1 + 1 - y0) * sx;
    const dz = (z1 + 1 - z0) * sxy;
    return t[a + dx + dy + dz] - t[a + dy + dz] - t[a + dx + dz] - t[a + dx + dy]
      + t[a + dz] + t[a + dy] + t[a + dx] - t[a];
  }

  box(b: VoxelBox) {
    return this.count(b[0], b[1], b[2], b[3], b[4], b[5]);
  }
}

/** The axis orders a box grows in from its seed: every order of x, y and z. */
const ORDERS = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];

/**
 * Up to MAX_BOXES boxes of voxels that cover TARGET_COVERAGE of the solid ones, each one picked to cover the most solid
 * voxels the others don't yet, and each holding only solid voxels and empty ones within REACH of a solid one. Each is
 * returned shrunk to the solid voxels it covers first.
 */
export function mergeBoxes({ dims, cells }: Grid): { boxes: VoxelBox[]; coverage: number } {
  const solid = (i: number) => cells[i] !== EMPTY_VOXEL;
  const total = cells.reduce((sum, cell) => sum + Number(cell !== EMPTY_VOXEL), 0);
  // An empty voxel a box may take in: one within REACH face-to-face steps of a solid voxel. The padding never.
  const steps = [1, -1, dims[0], -dims[0], dims[0] * dims[1], -dims[0] * dims[1]];
  let allowed = Uint8Array.from(cells, (cell) => Number(cell !== EMPTY_VOXEL));
  for (let step = 0; step < REACH; step++) {
    const grown = new Uint8Array(cells.length);
    for (let z = 1; z < dims[2] - 1; z++) {
      for (let y = 1; y < dims[1] - 1; y++) {
        for (let x = 1; x < dims[0] - 1; x++) {
          const i = cellIndex(dims, x, y, z);
          grown[i] = Number(allowed[i] || steps.some((offset) => allowed[i + offset]));
        }
      }
    }
    allowed = grown;
  }
  const blocked = new Sums(dims, (i) => 1 - allowed[i]);
  const empty = new Sums(dims, (i) => Number(!solid(i)));
  const uncovered = new Uint8Array(cells.length);
  for (let i = 0; i < cells.length; i++) uncovered[i] = Number(solid(i));
  const boxes: VoxelBox[] = [];
  let covered = 0;
  while (boxes.length < MAX_BOXES && covered < TARGET_COVERAGE * total) {
    const gain = new Sums(dims, (i) => uncovered[i]);
    const seeds: number[] = [];
    for (let i = 0; i < cells.length; i++) if (uncovered[i]) seeds.push(i);
    const stride = Math.max(1, Math.floor(seeds.length / SEEDS));
    const score = (b: VoxelBox) => gain.box(b) - EMPTY_COST * empty.box(b);
    let best: VoxelBox | undefined;
    let bestScore = 0;
    for (let s = 0; s < seeds.length; s += stride) {
      const i = seeds[s];
      const seed = [i % dims[0], Math.floor(i / dims[0]) % dims[1], Math.floor(i / (dims[0] * dims[1]))];
      for (const box of grow(seed, dims, blocked, gain)) {
        trim(box, score);
        const value = score(box);
        if (value > bestScore) [best, bestScore] = [box, value];
      }
    }
    const bestGain = best ? gain.box(best) : 0;
    if (!best || bestGain < MIN_GAIN * total) break;
    // The box keeps only the voxels it is the first to cover: a leg's box stops where the top's box starts.
    const own = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity] as VoxelBox;
    for (let z = best[2]; z <= best[5]; z++) {
      for (let y = best[1]; y <= best[4]; y++) {
        for (let x = best[0]; x <= best[3]; x++) {
          const i = cellIndex(dims, x, y, z);
          if (!uncovered[i]) continue;
          uncovered[i] = 0;
          [x, y, z].forEach((v, a) => {
            own[a] = Math.min(own[a], v);
            own[a + 3] = Math.max(own[a + 3], v);
          });
        }
      }
    }
    boxes.push(own);
    covered += bestGain;
  }
  return { boxes, coverage: total ? covered / total : 1 };
}

/** Takes off a box's outer layers, one at a time, while a layer costs it more than it covers. */
function trim(box: VoxelBox, score: (b: VoxelBox) => number) {
  for (;;) {
    let worst = -1;
    let worstValue = 0;
    for (let face = 0; face < 6; face++) {
      const a = face % 3;
      if (box[a] === box[a + 3]) continue;
      const layer = [...box] as VoxelBox;
      if (face < 3) layer[a + 3] = box[a];
      else layer[a] = box[a + 3];
      const value = score(layer);
      if (value < worstValue) [worst, worstValue] = [face, value];
    }
    if (worst < 0) return;
    box[worst] += worst < 3 ? 1 : -1;
  }
}

/**
 * The maximal boxes grown from a seed voxel through allowed voxels: one per axis order, each face pushed out as far as
 * it goes before the next, and one pushed out a voxel at a time, always on the face that takes in the most uncovered.
 */
function grow(seed: number[], dims: Vec3, blocked: Sums, gain: Sums): VoxelBox[] {
  // Inside the padding, which is blocked, and holding no blocked voxel.
  const fits = (b: VoxelBox) => b[0] > 0 && b[1] > 0 && b[2] > 0 && b[3] < dims[0] - 1 && b[4] < dims[1] - 1 && b[5] < dims[2] - 1
    && blocked.box(b) === 0;
  const grown: VoxelBox[] = [];
  for (const order of ORDERS) {
    const box = [...seed, ...seed] as VoxelBox;
    for (const a of order) {
      // Push the low face, then the high face, by binary search: a box holds no blocked voxel or a bigger one would.
      for (const [face, dir] of [[a, -1], [a + 3, 1]]) {
        let lo = 0;
        let hi = 1;
        const at = (k: number) => {
          const b = [...box] as VoxelBox;
          b[face] += dir * k;
          return b;
        };
        while (fits(at(hi))) [lo, hi] = [hi, hi * 2];
        while (hi - lo > 1) {
          const mid = (lo + hi) >> 1;
          if (fits(at(mid))) lo = mid;
          else hi = mid;
        }
        box[face] += dir * lo;
      }
    }
    grown.push(box);
  }
  const box = [...seed, ...seed] as VoxelBox;
  for (;;) {
    let bestFace = -1;
    let bestGain = 0;
    for (let face = 0; face < 6; face++) {
      const b = [...box] as VoxelBox;
      b[face] += face < 3 ? -1 : 1;
      if (!fits(b)) continue;
      const g = gain.box(b);
      if (bestFace < 0 || g > bestGain) [bestFace, bestGain] = [face, g];
    }
    if (bestFace < 0 || bestGain === gain.box(box)) break;
    box[bestFace] += bestFace < 3 ? -1 : 1;
  }
  grown.push(box);
  return grown;
}

/* ───────────── Tightening ───────────── */

/** The points of a triangle inside a box: Sutherland–Hodgman against its six faces. */
function clipTriangle(t: ArrayLike<number>, o: number, min: Vec3, max: Vec3): number[][] {
  let polygon = [[t[o], t[o + 1], t[o + 2]], [t[o + 3], t[o + 4], t[o + 5]], [t[o + 6], t[o + 7], t[o + 8]]];
  for (let a = 0; a < 3 && polygon.length; a++) {
    for (const [limit, sign] of [[min[a], 1], [max[a], -1]]) {
      const inside = (p: number[]) => sign * (p[a] - limit) >= 0;
      const out: number[][] = [];
      for (let k = 0; k < polygon.length; k++) {
        const p = polygon[k];
        const q = polygon[(k + 1) % polygon.length];
        if (inside(p)) out.push(p);
        if (inside(p) !== inside(q)) {
          const f = (limit - p[a]) / (q[a] - p[a]);
          out.push(p.map((value, b) => (b === a ? limit : value + f * (q[b] - value))));
        }
      }
      polygon = out;
      if (!polygon.length) break;
    }
  }
  return polygon;
}

/**
 * A box of voxels as meters, tightened to what it holds: the surface clipped to it, and its interior voxels. Its empty
 * margin goes, and so does the rest of each surface voxel, which only touches the surface somewhere.
 */
function tighten(box: VoxelBox, grid: Grid, parts: Part[], bounds: Bounds, voxel: number): CollisionBox | undefined {
  const { origin, dims, cells } = grid;
  const min = [0, 1, 2].map((a) => Math.max(bounds.min[a], origin[a] + (box[a] - 1) * voxel)) as Vec3;
  const max = [0, 1, 2].map((a) => Math.min(bounds.max[a], origin[a] + box[a + 3] * voxel)) as Vec3;
  const tight: Bounds = { min: [...EMPTY.min] as Vec3, max: [...EMPTY.max] as Vec3 };
  const add = (p: ArrayLike<number>) => {
    for (let a = 0; a < 3; a++) {
      tight.min[a] = Math.min(tight.min[a], p[a]);
      tight.max[a] = Math.max(tight.max[a], p[a]);
    }
  };
  for (let z = box[2]; z <= box[5]; z++) {
    for (let y = box[1]; y <= box[4]; y++) {
      for (let x = box[0]; x <= box[3]; x++) {
        if (cells[cellIndex(dims, x, y, z)] !== INTERIOR) continue;
        add([origin[0] + (x - 1) * voxel, origin[1] + (y - 1) * voxel, origin[2] + (z - 1) * voxel]);
        add([origin[0] + x * voxel, origin[1] + y * voxel, origin[2] + z * voxel]);
      }
    }
  }
  for (const { triangles } of parts) {
    for (let o = 0; o < triangles.length; o += 9) {
      let outside = false;
      for (let a = 0; a < 3 && !outside; a++) {
        outside = Math.max(triangles[o + a], triangles[o + 3 + a], triangles[o + 6 + a]) < min[a]
          || Math.min(triangles[o + a], triangles[o + 3 + a], triangles[o + 6 + a]) > max[a];
      }
      if (!outside) for (const point of clipTriangle(triangles, o, min, max)) add(point);
    }
  }
  if (tight.min[0] > tight.max[0]) return undefined;
  // A flat part, such as a sheet of glass, still takes up MIN_THICKNESS, within the model's bounds.
  for (let a = 0; a < 3; a++) {
    const thickness = Math.min(MIN_THICKNESS, bounds.max[a] - bounds.min[a]);
    if (tight.max[a] - tight.min[a] >= thickness) continue;
    const center = Math.min(bounds.max[a] - thickness / 2, Math.max(bounds.min[a] + thickness / 2, (tight.min[a] + tight.max[a]) / 2));
    [tight.min[a], tight.max[a]] = [center - thickness / 2, center + thickness / 2];
  }
  return tight;
}

/** The volume of the union of some boxes: exact, over the grid their faces make. */
export function unionVolume(boxes: CollisionBox[]): number {
  const cuts = [0, 1, 2].map((a) => [...new Set(boxes.flatMap(({ min, max }) => [min[a], max[a]]))].sort((p, q) => p - q));
  let volume = 0;
  for (let i = 0; i + 1 < cuts[0].length; i++) {
    for (let j = 0; j + 1 < cuts[1].length; j++) {
      for (let k = 0; k + 1 < cuts[2].length; k++) {
        const mid = [(cuts[0][i] + cuts[0][i + 1]) / 2, (cuts[1][j] + cuts[1][j + 1]) / 2, (cuts[2][k] + cuts[2][k + 1]) / 2];
        if (boxes.some(({ min, max }) => mid.every((v, a) => v > min[a] && v < max[a]))) {
          volume += (cuts[0][i + 1] - cuts[0][i]) * (cuts[1][j + 1] - cuts[1][j]) * (cuts[2][k + 1] - cuts[2][k]);
        }
      }
    }
  }
  return volume;
}

const volumeOf = ({ min, max }: Bounds) => (max[0] - min[0]) * (max[1] - min[1]) * (max[2] - min[2]);
const mm = (meters: number) => Math.round(meters * 1000) / 1000 || 0;

/* ───────────── Fitting ───────────── */

/** Fits collision boxes to a model's parts. Boxes are in the model's frame, unrounded. */
export function fitParts(parts: Part[], voxel = VOXEL): Fit {
  const { kept, dropped } = furniture(parts);
  const triangles = kept.reduce((sum, { triangles: t }) => sum + t.length / 9, 0);
  const bounds = boundsOf(kept);
  if (!triangles) return { boxes: [], fallback: 'no triangles', coverage: 0, fill: 1, bounds, triangles, dropped };
  const grid = voxelize(kept, bounds, voxel);
  fillInterior(grid);
  const merged = mergeBoxes(grid);
  const boxes = merged.boxes.flatMap((box) => tighten(box, grid, kept, bounds, voxel) ?? []);
  const fill = volumeOf(bounds) > 0 ? unionVolume(boxes) / volumeOf(bounds) : 1;
  const fit = { boxes, coverage: merged.coverage, fill, bounds, triangles, dropped };
  const percent = (fraction: number) => `${Math.floor(fraction * 1000) / 10}%`;
  if (merged.coverage < MIN_COVERAGE) return { ...fit, boxes: [], fallback: `${merged.boxes.length} boxes cover only ${percent(merged.coverage)}` };
  if (fill < LOW_POLY_FILL && triangles < LOW_POLY && merged.coverage < CLEAN_COVERAGE) return { ...fit, boxes: [], fallback: `${triangles} triangles, boxes fill ${percent(fill)}` };
  return fit;
}

/** Fits collision boxes to a GLB file. */
export async function fitModel(file: string, voxel = VOXEL): Promise<Fit> {
  return fitParts(readParts(await (await collisionIo()).read(file)), voxel);
}

/**
 * Boxes as stored: in the size box, to the millimeter. `scale` maps the fitted bounds onto the size box first, about
 * the pivot, for a Master Copy that is a little off its Original's box.size.
 */
export function placeInSize(boxes: CollisionBox[], size: Vec3, scale?: Vec3): CollisionBox[] {
  const { min: lo, max: hi } = sizeBox(size);
  const place = (point: Vec3) => point.map((v, a) => mm(Math.min(hi[a], Math.max(lo[a], v * (scale?.[a] ?? 1))))) as Vec3;
  return boxes.map(({ min, max }) => ({ min: place(min), max: place(max) }));
}

/* ───────────── Overrides and the report ───────────── */

/**
 * scripts/catalog/collision-overrides.json: by item id, or `<scan>/<originalId>`, boxes to use instead of the fitter's,
 * or "solid"; and a corrected `size`, set after a look in ?boxes=1 (#129's size audit). Always beats the fitter.
 */
export type CollisionOverride = CollisionBox[] | 'solid' | { collision?: CollisionBox[] | 'solid'; size?: Vec3 };
export type CollisionOverrides = Record<string, CollisionOverride>;

/** What an item gets: its boxes (none: one solid box), its size, and its report line. */
export interface Collision {
  collision?: CollisionBox[];
  size: Vec3;
  result: 'fitted' | 'solid fallback' | 'override';
  /** Why it is flagged for a look in ?boxes=1: its cleaned bounds are off `size`, or its boxes fill little of it. */
  flags: string[];
  line: string;
}

const round3 = (v: Vec3) => v.map(mm) as Vec3;
const extent = ({ min, max }: Bounds) => [0, 1, 2].map((a) => max[a] - min[a]) as Vec3;

/**
 * An item's collision, from its fit and any override, with the report line. `size` is never changed, only by an
 * override. With `scaleToSize`, boxes are scaled from the cleaned bounds to `size`, as for a Master Copy.
 */
export function decide(id: string, fit: Fit, size: Vec3, override?: CollisionOverride, scaleToSize = false): Collision {
  const entry = typeof override === 'string' || Array.isArray(override) ? { collision: override } : override ?? {};
  const finalSize = entry.size ?? size;
  const cleaned = extent(fit.bounds);
  const scale = scaleToSize ? cleaned.map((e, a) => (e > 0 ? size[a] / e : 1)) as Vec3 : undefined;
  const result: Collision['result'] = entry.collision ? 'override' : fit.boxes.length ? 'fitted' : 'solid fallback';
  const collision = entry.collision === 'solid' ? undefined
    : entry.collision ? placeInSize(entry.collision, finalSize)
    : fit.boxes.length ? placeInSize(fit.boxes, finalSize, scale) : undefined;
  const fill = collision ? unionVolume(collision) / volumeOf(sizeBox(finalSize)) : 1;
  const flags: string[] = [];
  if (fit.triangles && cleaned.some((e, a) => Math.abs(e - size[a]) > SIZE_TOLERANCE)) {
    flags.push(`bounds ${round3(cleaned).join(' × ')} m, size ${size.join(' × ')} m`);
  }
  if (fill < MIN_SIZE_FILL) flags.push(`boxes fill ${Math.round(fill * 100)}% of size`);
  const percent = (fraction: number) => `${(fraction * 100).toFixed(1)}%`.padStart(6);
  const what = result === 'solid fallback' ? `solid fallback: ${fit.fallback}` : result;
  const line = [
    id.padEnd(28),
    `${collision?.length ?? 1} box${collision?.length === 1 || !collision ? ' ' : 'es'}`,
    `coverage ${percent(fit.coverage)}`,
    `fill ${percent(fill)}`,
    what,
    ...(fit.dropped.length ? [`dropped ${fit.dropped.join(', ')}`] : []),
    ...flags.map((flag) => `⚑ ${flag}`),
  ].join('  ');
  return { ...(collision && { collision }), size: finalSize, result, flags, line };
}

/**
 * A copy of an object with `collision` set, or removed when undefined, right after the field `after`, where a reader of
 * the JSON looks for it: after a Catalog item's `size`, after an Original's `model`.
 */
export function withCollision<T extends { collision?: CollisionBox[] }>(object: T, collision: CollisionBox[] | undefined, after: keyof T): T {
  const entries = Object.entries(object).filter(([key]) => key !== 'collision');
  const at = entries.findIndex(([key]) => key === after) + 1;
  if (collision) entries.splice(at || entries.length, 0, ['collision', collision]);
  return Object.fromEntries(entries) as T;
}

/** Reads scripts/catalog/collision-overrides.json. */
export const readOverrides = async (file: string): Promise<CollisionOverrides> => JSON.parse(await readFile(file, 'utf8'));

/**
 * The report's closing summary: how many items were fitted, fell back or were overridden, then the fallbacks, the
 * flagged items, and every `size` an override changed by more than SIZE_TOLERANCE, before and after.
 */
export function summary(results: { id: string; before: Vec3; collision: Collision }[]): string {
  const count = (result: Collision['result']) => results.filter(({ collision }) => collision.result === result).length;
  const fallbacks = results.filter(({ collision }) => collision.result === 'solid fallback').map(({ id }) => id);
  const flagged = results.filter(({ collision }) => collision.flags.length);
  const resized = results.filter(({ before, collision }) => collision.size.some((v, a) => Math.abs(v - before[a]) > SIZE_TOLERANCE));
  return [
    `Collision boxes: ${count('fitted')} fitted, ${count('solid fallback')} solid fallback, ${count('override')} override, of ${results.length}.`,
    `Solid fallbacks (${fallbacks.length}): ${fallbacks.join(', ') || 'none'}`,
    `Flagged for a look in ?boxes=1 (${flagged.length}): ${flagged.map(({ id, collision }) => `${id} (${collision.flags.join('; ')})`).join(', ') || 'none'}`,
    `Sizes changed by more than ${SIZE_TOLERANCE * 100} cm (${resized.length}): ${resized.map(({ id, before, collision }) => `${id} ${before.join(' × ')} → ${collision.size.join(' × ')}`).join(', ') || 'none'}`,
  ].join('\n');
}

/**
 * JSON as the repo writes it, two-space indents, but each collision box on one line, so a Catalog of 600 items with
 * up to 12 boxes each stays readable and small.
 */
export function toJson(value: unknown): string {
  const boxes: string[] = [];
  const text = JSON.stringify(value, (key, v) => (key === 'collision' && Array.isArray(v)
    ? v.map(({ min, max }: CollisionBox) => `\u0000${boxes.push(`{ "min": [${min.join(', ')}], "max": [${max.join(', ')}] }`) - 1}`)
    : v), 2);
  return `${text.replace(/"\\u0000(\d+)"/g, (_, i) => boxes[Number(i)])}\n`;
}
