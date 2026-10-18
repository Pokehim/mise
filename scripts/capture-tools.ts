// Tools for combining Captures of one room, from Polycam or KIRI Engine (ADR-0007, 0008):
// - reading a Capture's textured triangles into the room frame, and their colors;
// - one color gain that matches a whole Capture to another (captureGain);
// - the floor and wall one Capture saw where another has a hole (gapFill);
// - lining a close-up of one piece up with its copy in a room scan, scale included (registerCloseup).
// scan-merge builds room.glb with the first; scripts/capture-gain.ts, gap-fill.ts and
// register-closeup.ts run the others on their own.
import { type Document, type Material, Primitive, type Texture } from '@gltf-transform/core';
import { type createDefaultPropertyResolver, copyToDocument, dequantize } from '@gltf-transform/functions';
import sharp from 'sharp';
import type { Box, RoomSetup, Vec2, Vec3, YawTransform } from '../shared/types';
import {
  type Samples, type ScaledFit, type ScaledYaw, applyYaw, inGrownBox, registerDetail, triangleSamples,
} from '../web/src/setup/geometry/align';
import { onFloor, triangleClassifier } from '../web/src/setup/geometry/classify';
import { detectFloorHeight } from '../web/src/setup/geometry/level';
import { type TriangleInfo, type TriangleMesh, mergeMeshes, newTriangleInfo, triangleInfo } from '../web/src/setup/geometry/mesh';
import { io } from './scan-import';

type Rgb = [number, number, number];

/** A Capture's file, with float vertices so they can be added to another document and quantized again once. */
export async function readCapture(path: string): Promise<Document> {
  const document = await io.read(path);
  await document.transform(dequantize());
  return document;
}

/** One triangle primitive of a Capture: its vertices in the Main Capture's frame, and its triangles in the room frame. */
export interface Source {
  primitive: Primitive;
  main: Float32Array;
  room: TriangleMesh;
  uvs: Float32Array | null;
  material: Material | null;
  /** The split's group of each triangle, by the room's setup (spec §9.4). */
  groups: Uint16Array;
}

/**
 * A Capture's triangle primitives, in the Main Capture's frame (by `toMain`) and the room frame (by
 * meshTransform). For a Capture given straight in the room frame, pass its transform and IDENTITY.
 */
export function captureSources(
  document: Document, toMain: ScaledYaw, meshTransform: YawTransform, classify: (info: TriangleInfo) => number,
): Source[] {
  const sources: Source[] = [];
  const info = newTriangleInfo();
  for (const node of document.getRoot().listNodes()) {
    const m = node.getWorldMatrix();
    for (const primitive of node.getMesh()?.listPrimitives() ?? []) {
      if (primitive.getMode() !== Primitive.Mode.TRIANGLES) continue;
      const position = primitive.getAttribute('POSITION')!;
      const count = position.getCount();
      const main = new Float32Array(count * 3);
      const roomPositions = new Float32Array(count * 3);
      const v: number[] = [];
      for (let i = 0; i < count; i++) {
        const [x, y, z] = position.getElement(i, v);
        const inMain = applyYaw(toMain, [
          m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14],
        ]);
        main.set(inMain, 3 * i);
        roomPositions.set(applyYaw(meshTransform, inMain), 3 * i);
      }
      const indexArray = primitive.getIndices()?.getArray();
      const index = indexArray ? Uint32Array.from(indexArray) : Uint32Array.from({ length: count }, (_, i) => i);
      const roomMesh = { positions: roomPositions, index };
      const groups = new Uint16Array(index.length / 3);
      for (let t = 0; t < groups.length; t++) groups[t] = classify(triangleInfo(roomMesh, t, info));
      const uv = primitive.getAttribute('TEXCOORD_0');
      sources.push({
        primitive, main, room: roomMesh, groups,
        uvs: uv ? Float32Array.from(uv.getArray()!) : null,
        material: primitive.getMaterial(),
      });
    }
  }
  return sources;
}

/** All of a document's triangles as one mesh: in world space, then moved by `transform` (into the room frame). */
export function documentTriangles(document: Document, transform?: ScaledYaw): TriangleMesh {
  return mergeMeshes(captureSources(document, transform ?? { position: [0, 0, 0], rotationY: 0 }, { position: [0, 0, 0], rotationY: 0 }, () => 0)
    .map(({ room }) => room));
}

/** A triangle picked from a source, with its room-frame centroid, normal and area. */
export interface Picked { source: Source; t: number; centroid: Vec3; normal: Vec3; area: number }

export function pick(sources: Source[], keep: (source: Source, t: number, centroid: Vec3, normal: Vec3) => boolean): Picked[] {
  const picked: Picked[] = [];
  const info = newTriangleInfo();
  // Reused for every triangle `keep` turns down; only kept ones get arrays of their own.
  const [centroid, normal]: Vec3[] = [[0, 0, 0], [0, 0, 0]];
  for (const source of sources) {
    for (let t = 0; t < source.groups.length; t++) {
      triangleInfo(source.room, t, info);
      [centroid[0], centroid[1], centroid[2], normal[0], normal[1], normal[2]] = [info.cx, info.cy, info.cz, info.nx, info.ny, info.nz];
      if (info.area > 0 && keep(source, t, centroid, normal)) {
        picked.push({ source, t, centroid: [...centroid], normal: [...normal], area: info.area });
      }
    }
  }
  return picked;
}

export const pickedArea = (picked: Picked[]) => picked.reduce((sum, p) => sum + p.area, 0);

/** Decoded texture pixels, read once per texture. */
export class Pixels {
  private cache = new Map<Texture, Promise<{ data: Buffer; width: number; height: number } | null>>();

  get(texture: Texture) {
    let pixels = this.cache.get(texture);
    if (!pixels) {
      const image = texture.getImage();
      pixels = image
        ? sharp(Buffer.from(image)).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
          .then(({ data, info }) => ({ data, width: info.width, height: info.height }))
        : Promise.resolve(null);
      this.cache.set(texture, pixels);
    }
    return pixels;
  }

  /**
   * A triangle's color in linear RGB, the space glTF's baseColorFactor multiplies in: its sRGB
   * texture at its UV centroid (repeating), decoded, times its material's base color.
   */
  async colorOf({ source, t }: Picked): Promise<Rgb | null> {
    const material = source.material;
    if (!material) return null;
    const factor = material.getBaseColorFactor();
    const texture = material.getBaseColorTexture();
    if (!texture || !source.uvs) return [factor[0], factor[1], factor[2]];
    const pixels = await this.get(texture);
    if (!pixels) return null;
    const index = source.room.index;
    let [u, v] = [0, 0];
    for (let k = 0; k < 3; k++) {
      u += source.uvs[2 * index[3 * t + k]] / 3;
      v += source.uvs[2 * index[3 * t + k] + 1] / 3;
    }
    // glTF UVs start at the image's top-left corner.
    const x = Math.min(pixels.width - 1, Math.floor((u - Math.floor(u)) * pixels.width));
    const y = Math.min(pixels.height - 1, Math.floor((v - Math.floor(v)) * pixels.height));
    const i = 4 * (y * pixels.width + x);
    return [0, 1, 2].map((c) => srgbToLinear(pixels.data[i + c] / 255) * factor[c]) as Rgb;
  }
}

const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

const GAIN = {
  /** A whole Capture's gain compares the floor and wall in cells this size... */
  cell: 0.25,
  maxSamples: 20_000,
  /** ...and needs at least this many cells that both Captures saw. */
  minCells: 10,
  /** Gap fill matches color in cells this size, blended between their centers... */
  gapCell: 1,
  /** ...comparing 10 cm cells inside each, of which at least this many must be shared. */
  gapSubcell: 0.1,
  minGapSamples: 30,
  range: [0.5, 2] as const,
};

const clampGain = (ratios: number[]): Vec3 => {
  const [low, high] = GAIN.range;
  return ratios.map((r) => Math.round(Math.min(high, Math.max(low, r)) * 1000) / 1000) as Vec3;
};

/** Each cell of this size that the picked triangles fall in: their summed linear color and count, from up to `max` of them. */
async function cellColors(picked: Picked[], cell: number, max: number, pixels: Pixels): Promise<Map<string, [number, number, number, number]>> {
  const sums = new Map<string, [number, number, number, number]>();
  const step = Math.max(1, picked.length / max);
  for (let k = 0; k < picked.length; k += step) {
    const p = picked[Math.floor(k)];
    const color = await pixels.colorOf(p);
    if (!color) continue;
    const key = p.centroid.map((v) => Math.floor(v / cell)).join();
    const sum = sums.get(key) ?? [0, 0, 0, 0];
    sums.set(key, [sum[0] + color[0], sum[1] + color[1], sum[2] + color[2], sum[3] + 1]);
  }
  return sums;
}

/**
 * One gain that matches a whole Capture to a reference Capture of the same room (ADR-0008): the
 * per-channel median, over the floor and wall cells both saw, of each cell's reference ÷ other
 * color, in linear RGB (where glTF's baseColorFactor multiplies). A median, so the few cells where the
 * light really changed between the Captures (a lamp, the sun) don't shift it. 1 when they share too
 * little. `reference` and `other` are their floor and wall triangles, in the same room frame.
 */
export async function captureGain(reference: Picked[], other: Picked[], pixels = new Pixels()): Promise<{ gain: Vec3; cells: number }> {
  const [r, o] = await Promise.all([reference, other].map((picked) => cellColors(picked, GAIN.cell, GAIN.maxSamples, pixels)));
  const ratios: number[][] = [[], [], []];
  for (const [key, [rr, rg, rb, rn]] of r) {
    const oc = o.get(key);
    if (!oc) continue;
    const [mean, otherMean] = [[rr / rn, rg / rn, rb / rn], [oc[0] / oc[3], oc[1] / oc[3], oc[2] / oc[3]]];
    if (otherMean.every((c) => c > 1e-4)) for (let c = 0; c < 3; c++) ratios[c].push(mean[c] / otherMean[c]);
  }
  const cells = ratios[0].length;
  if (cells < GAIN.minCells) return { gain: [1, 1, 1], cells };
  return { gain: clampGain(ratios.map((list) => list.sort((a, b) => a - b)[Math.floor(list.length / 2)])), cells };
}

/** The floor and wall triangles of a Capture's sources, by the split's groups. */
export function surfaces(sources: Source[], setup: RoomSetup): Picked[] {
  const { groups } = triangleClassifier(setup);
  return pick(sources, (s, t) => groups[s.groups[t]].kind === 'floor' || groups[s.groups[t]].kind === 'wall');
}

const GAP = {
  /**
   * A Capture's floor or wall triangle fills a gap where the reference has no surface facing the
   * same way within `across` of it along the surface and `deep` in front of or behind it: two
   * Captures can put one wall a few centimeters apart (drift, glass, noise), and that's no gap.
   */
  across: 0.03,
  deep: 0.08,
  /** It must face the way its floor or wall does, within about 35°, so slanted noise stays out... */
  facing: 0.8,
  /** ...and belong to a connected piece of at least this many square meters: smaller ones are specks. */
  minPiece: 0.005,
};

/** What one Capture fills of a reference's gaps: the triangles, and the color gain at any room point. */
export interface GapPiece {
  /** Index in the `others` passed to gapFill. */
  capture: number;
  triangles: Picked[];
  gainAt: (point: Vec3) => Vec3;
}

/**
 * Gap fill: the floor and wall the reference Capture never saw, from each other Capture in turn, so
 * a later one only fills what the ones before it left. Only floor and wall, facing the way it does:
 * furniture may stand elsewhere in another Capture, and a copy of it would float in the room. The
 * split's floor and wall tests keep it inside the room: within the floor polygon, or 4 cm of a wall,
 * and below the ceiling. When in doubt it leaves a triangle out. Each piece is color-matched to the
 * reference per 1 m cell, falling back to the Capture's global gain, and blended between cells.
 * All sources are classified by `setup` (captureSources with triangleClassifier(setup).classify).
 */
export async function gapFill(setup: RoomSetup, reference: Source[], others: Source[][], pixels = new Pixels()): Promise<GapPiece[]> {
  const { groups } = triangleClassifier(setup);
  const facing = groups.map((group): Vec3 | null => {
    if (group.kind === 'floor') return [0, 1, 0];
    if (group.kind !== 'wall') return null;
    const [nx, nz] = setup.walls.find((w) => w.id === group.id)!.normal;
    return [nx, 0, nz];
  });
  const referenceSurfaces = surfaces(reference, setup);
  const covered = surfaceIndex(Math.max(GAP.across, GAP.deep), pick(reference, () => true));
  const pieces: GapPiece[] = [];
  for (const [capture, sources] of others.entries()) {
    const otherSurfaces = surfaces(sources, setup);
    const triangles = droppingSpecks(otherSurfaces.filter((p) => {
      const n = facing[p.source.groups[p.t]]!;
      return p.normal[0] * n[0] + p.normal[1] * n[1] + p.normal[2] * n[2] > GAP.facing
        && !covered.covers(p.centroid, p.normal, GAP.across, GAP.deep);
    }), GAP.minPiece);
    if (triangles.length === 0) continue;
    covered.add(triangles);
    const { gain } = await captureGain(referenceSurfaces, otherSurfaces, pixels);
    pieces.push({ capture, triangles, gainAt: await cellGains(referenceSurfaces, otherSurfaces, triangles, gain, pixels) });
  }
  return pieces;
}

/**
 * Gap fill's gain at any point: in each 1 m cell around the gaps, the ratio of the floor and wall both
 * Captures saw there (over 10 cm cells), or the Capture's global gain where they share too little.
 * Blended between cell centers, so neighboring cells meet without a step.
 */
async function cellGains(reference: Picked[], other: Picked[], gaps: Picked[], global: Vec3, pixels: Pixels): Promise<(point: Vec3) => Vec3> {
  const size = GAIN.gapCell;
  const key = (i: number[]) => i.join();
  const byCell = (picked: Picked[]) => {
    const cells = new Map<string, Picked[]>();
    for (const p of picked) {
      const k = key(p.centroid.map((v) => Math.floor(v / size)));
      if (cells.has(k)) cells.get(k)!.push(p);
      else cells.set(k, [p]);
    }
    return cells;
  };
  const [r, o] = [byCell(reference), byCell(other)];
  // The cells whose centers a gap's vertices blend between: those around each gap's own cell.
  const needed = new Set<string>();
  for (const { centroid } of gaps) {
    const [x, y, z] = centroid.map((v) => Math.floor(v / size));
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) needed.add(key([x + dx, y + dy, z + dz]));
  }
  const gains = new Map<string, Vec3>();
  for (const k of needed) {
    const [rc, oc] = await Promise.all([r.get(k) ?? [], o.get(k) ?? []].map((picked) => cellColors(picked, GAIN.gapSubcell, 2000, pixels)));
    const [rt, ot] = [[0, 0, 0], [0, 0, 0]];
    let samples = 0;
    for (const [sub, [rr, rg, rb, rn]] of rc) {
      const other = oc.get(sub);
      if (!other) continue;
      [rt[0], rt[1], rt[2]] = [rt[0] + rr / rn, rt[1] + rg / rn, rt[2] + rb / rn];
      [ot[0], ot[1], ot[2]] = [ot[0] + other[0] / other[3], ot[1] + other[1] / other[3], ot[2] + other[2] / other[3]];
      samples += Math.min(rn, other[3]);
    }
    gains.set(k, samples < GAIN.minGapSamples ? global : clampGain([0, 1, 2].map((c) => rt[c] / ot[c])));
  }
  return (point) => {
    const u = point.map((v) => v / size - 0.5);
    const base = u.map(Math.floor);
    const gain: Vec3 = [0, 0, 0];
    for (let corner = 0; corner < 8; corner++) {
      const offset = [corner & 1, (corner >> 1) & 1, (corner >> 2) & 1];
      const weight = offset.reduce((w, o, a) => w * (o ? u[a] - base[a] : 1 - (u[a] - base[a])), 1);
      const g = gains.get(key(base.map((b, a) => b + offset[a]))) ?? global;
      for (let c = 0; c < 3; c++) gain[c] += weight * g[c];
    }
    return gain;
  };
}

/** The picked triangles without the connected pieces (sharing vertices) smaller than `minArea` square meters. */
function droppingSpecks(picked: Picked[], minArea: number): Picked[] {
  // Union-find over the triangles, joined through each vertex they share in their source.
  const parent = picked.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const byVertex = new Map<Source, Map<number, number>>();
  picked.forEach((p, i) => {
    if (!byVertex.has(p.source)) byVertex.set(p.source, new Map());
    const owners = byVertex.get(p.source)!;
    for (let k = 0; k < 3; k++) {
      const v = p.source.room.index[3 * p.t + k];
      const other = owners.get(v);
      if (other === undefined) owners.set(v, i);
      else parent[find(i)] = find(other);
    }
  });
  const area = new Map<number, number>();
  picked.forEach((p, i) => area.set(find(i), (area.get(find(i)) ?? 0) + p.area));
  return picked.filter((_, i) => area.get(find(i))! >= minArea);
}

/**
 * Triangles to look up by point: each is filed under every cell its bounds, grown by `reach`, touch.
 * So a query finds a triangle within `reach` of a point however large it is: a scan's flat floor and
 * walls have triangles tens of centimeters across, whose centroids can lie far from the point.
 */
export function surfaceIndex(reach: number, triangles: Picked[], cellSize = 0.1) {
  const cells = new Map<number, Picked[]>();
  const cell = (v: number) => Math.floor(v / cellSize);
  // A hash of the cell; two cells sharing one only add candidates, which the distance tests sort out.
  const key = (ix: number, iy: number, iz: number) => (ix * 73856093) ^ (iy * 19349663) ^ (iz * 83492791);
  const add = (more: Picked[]) => {
    for (const p of more) {
      const { positions, index } = p.source.room;
      const min = [Infinity, Infinity, Infinity];
      const max = [-Infinity, -Infinity, -Infinity];
      for (let k = 0; k < 3; k++) {
        const v = 3 * index[3 * p.t + k];
        for (let a = 0; a < 3; a++) [min[a], max[a]] = [Math.min(min[a], positions[v + a]), Math.max(max[a], positions[v + a])];
      }
      for (let ix = cell(min[0] - reach); ix <= cell(max[0] + reach); ix++) {
        for (let iy = cell(min[1] - reach); iy <= cell(max[1] + reach); iy++) {
          for (let iz = cell(min[2] - reach); iz <= cell(max[2] + reach); iz++) {
            const k = key(ix, iy, iz);
            const list = cells.get(k);
            if (list) list.push(p);
            else cells.set(k, [p]);
          }
        }
      }
    }
  };
  add(triangles);
  const near = ([x, y, z]: Vec3) => cells.get(key(cell(x), cell(y), cell(z))) ?? [];
  const sameWay = (n: Vec3, q: Picked) => n[0] * q.normal[0] + n[1] * q.normal[1] + n[2] * q.normal[2] >= 0.7;
  return {
    add,
    /** A triangle facing the same way within `reach` of the point: the same surface, seen already. Null when none is. */
    seen(point: Vec3, normal: Vec3): Picked | null {
      for (const q of near(point)) if (sameWay(normal, q) && distanceToTriangle(point, q) < reach) return q;
      return null;
    },
    /**
     * Whether a triangle facing the same way lies within `across` of the point along a surface with
     * this normal, and `deep` in front of or behind it: the same surface, though seen a little off.
     */
    covers(point: Vec3, normal: Vec3, across: number, deep: number): boolean {
      for (const q of near(point)) {
        if (!sameWay(normal, q)) continue;
        const c = closestOnTriangle(point, q);
        const [dx, dy, dz] = [c[0] - point[0], c[1] - point[1], c[2] - point[2]];
        const depth = dx * normal[0] + dy * normal[1] + dz * normal[2];
        if (Math.abs(depth) > deep) continue;
        const [ex, ey, ez] = [dx - depth * normal[0], dy - depth * normal[1], dz - depth * normal[2]];
        if (ex * ex + ey * ey + ez * ez <= across * across) return true;
      }
      return false;
    },
  };
}

/** The distance from a point to a picked triangle's surface. */
export function distanceToTriangle(p: Vec3, triangle: Picked): number {
  const c = closestOnTriangle(p, triangle);
  return Math.hypot(c[0] - p[0], c[1] - p[1], c[2] - p[2]);
}

const closest = new Float64Array(3);

/**
 * The point of a picked triangle's surface closest to a point (Ericson, Real-Time Collision Detection
 * §5.1.5), in a buffer reused by every call: it runs millions of times in gap fill.
 */
function closestOnTriangle([px, py, pz]: Vec3, { source: { room: { positions: P, index } }, t }: Picked): Float64Array {
  const [a, b, c] = [3 * index[3 * t], 3 * index[3 * t + 1], 3 * index[3 * t + 2]];
  const [ax, ay, az, bx, by, bz, cx, cy, cz] = [P[a], P[a + 1], P[a + 2], P[b], P[b + 1], P[b + 2], P[c], P[c + 1], P[c + 2]];
  const [abx, aby, abz, acx, acy, acz] = [bx - ax, by - ay, bz - az, cx - ax, cy - ay, cz - az];
  const set = (x: number, y: number, z: number) => ((closest[0] = x), (closest[1] = y), (closest[2] = z), closest);
  const d1 = abx * (px - ax) + aby * (py - ay) + abz * (pz - az);
  const d2 = acx * (px - ax) + acy * (py - ay) + acz * (pz - az);
  if (d1 <= 0 && d2 <= 0) return set(ax, ay, az);
  const d3 = abx * (px - bx) + aby * (py - by) + abz * (pz - bz);
  const d4 = acx * (px - bx) + acy * (py - by) + acz * (pz - bz);
  if (d3 >= 0 && d4 <= d3) return set(bx, by, bz);
  const d5 = abx * (px - cx) + aby * (py - cy) + abz * (pz - cz);
  const d6 = acx * (px - cx) + acy * (py - cy) + acz * (pz - cz);
  if (d6 >= 0 && d5 <= d6) return set(cx, cy, cz);
  const [va, vb, vc] = [d3 * d6 - d5 * d4, d5 * d2 - d1 * d6, d1 * d4 - d3 * d2];
  let [s, r] = [0, 0];
  if (vc <= 0 && d1 >= 0 && d3 <= 0) s = d1 / (d1 - d3);
  else if (vb <= 0 && d2 >= 0 && d6 <= 0) r = d2 / (d2 - d6);
  else if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
    return set(bx + w * (cx - bx), by + w * (cy - by), bz + w * (cz - bz));
  } else [s, r] = [vb / (va + vb + vc), vc / (va + vb + vc)];
  return set(ax + s * abx + r * acx, ay + s * aby + r * acy, az + s * abz + r * acz);
}

/**
 * Adds picked triangles to `target` as one primitive per source, each in a mesh and node of its own
 * named `name` with these extras, its material copied from `from` and multiplied by the gain: one for
 * all of them, or one per room point, which goes in as vertex colors. Vertex colors are stored 0–1
 * (meshopt quantizes them), so they hold the gain divided by the primitive's largest, which goes in
 * the material's factor. `transform` moves them within the Main Capture's frame. Returns the count.
 */
export function addPieces(
  target: Document, from: Document, resolve: ReturnType<typeof createDefaultPropertyResolver>, picked: Picked[],
  gain: Vec3 | ((point: Vec3) => Vec3), name: string, extras: Record<string, unknown>, transform?: ScaledYaw,
): number {
  const scene = target.getRoot().getDefaultScene() ?? target.getRoot().listScenes()[0];
  const buffer = target.getRoot().listBuffers()[0] ?? target.createBuffer();
  const bySource = new Map<Source, number[]>();
  for (const p of picked) {
    if (!bySource.has(p.source)) bySource.set(p.source, []);
    bySource.get(p.source)!.push(p.t);
  }
  let added = 0;
  for (const [source, triangles] of bySource) {
    // Only the vertices these triangles use, renumbered.
    const remap = new Map<number, number>();
    const index = new Uint32Array(triangles.length * 3);
    triangles.forEach((t, i) => {
      for (let k = 0; k < 3; k++) {
        const v = source.room.index[3 * t + k];
        if (!remap.has(v)) remap.set(v, remap.size);
        index[3 * i + k] = remap.get(v)!;
      }
    });
    const positions = new Float32Array(remap.size * 3);
    const uvs = source.uvs && new Float32Array(remap.size * 2);
    const vertexGains = typeof gain === 'function' ? new Float32Array(remap.size * 3) : null;
    for (const [v, n] of remap) {
      const p: Vec3 = [source.main[3 * v], source.main[3 * v + 1], source.main[3 * v + 2]];
      positions.set(transform ? applyYaw(transform, p) : p, 3 * n);
      if (uvs) uvs.set([source.uvs![2 * v], source.uvs![2 * v + 1]], 2 * n);
      if (vertexGains) vertexGains.set((gain as (point: Vec3) => Vec3)([source.room.positions[3 * v], source.room.positions[3 * v + 1], source.room.positions[3 * v + 2]]), 3 * n);
    }
    let factor = gain as Vec3;
    if (vertexGains) {
      factor = [0, 1, 2].map((c) => vertexGains.reduce((m, g, i) => (i % 3 === c ? Math.max(m, g) : m), 1e-6)) as Vec3;
      for (let i = 0; i < vertexGains.length; i++) vertexGains[i] /= factor[i % 3];
    }
    const primitive = target.createPrimitive()
      .setAttribute('POSITION', target.createAccessor().setType('VEC3').setArray(positions).setBuffer(buffer))
      .setIndices(target.createAccessor().setType('SCALAR').setArray(index).setBuffer(buffer));
    if (uvs) primitive.setAttribute('TEXCOORD_0', target.createAccessor().setType('VEC2').setArray(uvs).setBuffer(buffer));
    if (vertexGains) primitive.setAttribute('COLOR_0', target.createAccessor().setType('VEC3').setArray(vertexGains).setBuffer(buffer));
    if (source.material) {
      const copied = copyToDocument(target, from, [source.material], resolve).get(source.material) as Material;
      const [r, g, b, a] = copied.getBaseColorFactor();
      primitive.setMaterial(copied.clone().setName(name).setBaseColorFactor([r * factor[0], g * factor[1], b * factor[2], a]));
    }
    const mesh = target.createMesh(name).addPrimitive(primitive).setExtras(extras);
    scene.addChild(target.createNode(name).setMesh(mesh));
    added += triangles.length;
  }
  return added;
}

/** A close-up lined up with its copy in a room scan: the fit, and the scale the two copies' heights gave to start from. */
export type CloseupFit = ScaledFit & { heightScale: number };

/**
 * Lines a close-up of one piece of furniture up with its copy in a room scan, scale included, since an
 * app's object mode can get a close-up's size wrong by 10–40% (ADR-0008). `closeup` is in its own frame,
 * standing on its floor; `room` is in the room frame (floor at y = 0); `box` is the piece in the room,
 * such as an Original's or a Layout's box. The copy in the room is what's in the box grown by 5 cm
 * above the floor. Starting from the ratio of the two copies' heights, registerDetail tries a turn
 * every 15° and refines the turn, floor position and scale. The fit's transform carries the
 * close-up's frame into the room frame.
 */
export function registerCloseup(closeup: TriangleMesh, room: TriangleMesh, box: Box): CloseupFit {
  const floorHeight = detectFloorHeight(closeup) ?? 0;
  const source = triangleSamples(closeup, ({ cy, ny }) => cy - floorHeight > 0.03 && !onFloor(cy - floorHeight, ny));
  const inBox = inGrownBox(box, 0.05);
  const target = triangleSamples(room, ({ cx, cy, cz, ny }) => cy > 0.03 && !onFloor(cy, ny) && inBox([cx, cy, cz]));
  if (source.count === 0 || target.count === 0) throw new Error('No furniture to line up: the close-up or the box is empty.');
  const heightScale = top(target) / (top(source) - floorHeight);
  const fit = registerDetail(source, target, middle(source), [box.position[0], box.position[2]], heightScale, floorHeight);
  return { ...fit, heightScale };
}

/** The height that 99.5% of the samples are under: the top of the piece, past a few stray points. */
const top = ({ points, count }: Samples) => Array.from({ length: count }, (_, i) => points[3 * i + 1]).sort((a, b) => a - b)[Math.floor(count * 0.995)];

/** The samples' middle on the floor plane. */
const middle = ({ points, count }: Samples): Vec2 => [0, 2].map((a) => {
  let sum = 0;
  for (let i = 0; i < count; i++) sum += points[3 * i + a];
  return sum / count;
}) as Vec2;

/**
 * A transform given on a command line: JSON, such as a manifest's meshTransform
 * ({"position":[x,y,z],"rotationY":r}, optionally with "scale"), or "x,y,z,rotationY[,scale]".
 */
export function parseTransform(text: string): ScaledYaw {
  if (text.trim().startsWith('{')) {
    const { position, rotationY, scale } = JSON.parse(text) as ScaledYaw;
    if (position?.length !== 3 || typeof rotationY !== 'number') throw new Error(`Not a transform: ${text}`);
    return { position, rotationY, ...(scale !== undefined && { scale }) };
  }
  const v = text.split(',').map(Number);
  if ((v.length !== 4 && v.length !== 5) || v.some((n) => !Number.isFinite(n))) {
    throw new Error(`A transform is JSON or "x,y,z,rotationY[,scale]", not "${text}".`);
  }
  return { position: [v[0], v[1], v[2]], rotationY: v[3], ...(v.length === 5 && { scale: v[4] }) };
}
