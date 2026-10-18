// Rebuilds a Scan's room.glb from its Main Capture and its Fill Captures (ADR-0007; .plans/fill-captures-spec.md §5.3).
// Run: npx tsx scripts/scan-merge.ts <scanId>. Room Setup's Fill Captures step runs it too, on Save.
//
// Each lined-up Fill Capture adds, as tagged primitives (extras.mise.fill):
// - a Patch per non-Kept Original: the floor and wall it saw inside the Original's box grown by 10 cm,
//   from the one Fill Capture that saw the most of it, color-matched to the Main Capture;
// - a completion per moved Original: the parts of its copy the Main Capture never saw, such as its back.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { type Document, type Material, Primitive, type Texture } from '@gltf-transform/core';
import {
  copyToDocument, createDefaultPropertyResolver, dedup, dequantize, getGLPrimitiveCount, meshopt, prune, simplify, unpartition,
  weld,
} from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import { pointInPolygon } from '../shared/geometry';
import type { RoomSetup, ScanManifest, Vec3, YawTransform } from '../shared/types';
import { IDENTITY, applyYaw, composeYaw, inGrownBox, invertYaw, sampleGrid } from '../web/src/setup/geometry/align';
import { triangleClassifier } from '../web/src/setup/geometry/classify';
import { type TriangleMesh, newTriangleInfo, triangleInfo } from '../web/src/setup/geometry/mesh';
import { io, MAX_TRIANGLES, SCANS_DIR } from './scan-import';

const MERGE = {
  /** A Patch covers the Original's box grown by this much: its contact shadow, and the wall strip behind it. */
  patchGrowth: 0.1,
  /** Patch color is compared over the floor and wall in this band outside the Patch, in 10 cm cells both Captures saw. */
  ring: [0.1, 0.3],
  ringCell: 0.1,
  maxGainSamples: 2000,
  minGainSamples: 30,
  gainRange: [0.5, 2] as const,
  /** A moved Original's copy: the triangles inside its box grown by this much, above the floor. */
  copyGrowth: 0.02,
  copyMinY: 0.02,
  /** A copy's triangle whose centroid is this close to a Main copy triangle facing the same way was seen already. */
  seen: 0.02,
  /** Main copy triangles are looked up by centroid within this; it must exceed a scan triangle's size. */
  seenSearch: 0.1,
};

/** What the merge added for one Original: a Patch or a completion. */
export interface MergedFill {
  originalId: string;
  /** Index in manifest.captures.fills. */
  capture: number;
  triangles: number;
  /** Square meters. */
  area: number;
  /** For a Patch: the share of the floor in its region that the Fill Capture saw. */
  coverage?: number;
  /** The linear RGB factor that matched it to the Main Capture. */
  gain: Vec3;
}

export interface MergeSummary {
  triangles: number;
  patches: MergedFill[];
  completions: MergedFill[];
  /** Fill Captures left out because Room Setup hasn't lined them up yet. */
  skipped: number[];
}

/** A Scan the merge can't work on yet, such as one with no Fill Captures: the caller's to fix, not a fault. */
export class MergeInputError extends Error {}

/** One triangle primitive of a Capture: its vertices in the Main Capture's frame, and its triangles in the room frame. */
interface Source {
  main: Float32Array;
  room: TriangleMesh;
  uvs: Float32Array | null;
  material: Material | null;
  /** The split's group of each triangle, by the room's setup (spec §9.4). */
  groups: Uint16Array;
}

type Rgb = [number, number, number];

/**
 * Rebuilds `room.glb` in a Scan folder from `captures.main` and each lined-up Fill Capture, using the
 * transforms Room Setup saved in the manifest and the Originals in setup.json. It always starts
 * from the Main Capture, so running it again gives the same file.
 */
export async function mergeScan(dir: string, { maxTriangles = MAX_TRIANGLES } = {}): Promise<MergeSummary> {
  const manifest: ScanManifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
  if (!manifest.captures) throw new MergeInputError(`${manifest.id} has no Fill Captures: import one with scan-import --fill.`);
  const setup: RoomSetup = JSON.parse(await readFile(join(dir, 'setup.json'), 'utf8').catch(() => {
    throw new MergeInputError(`${manifest.id} has no Room Setup yet: mark its walls and Originals first.`);
  }));
  await Promise.all([MeshoptEncoder.ready, MeshoptSimplifier.ready]);

  const classifier = triangleClassifier(setup);
  const isSurface = (group: number) => ['floor', 'wall'].includes(classifier.groups[group].kind);
  const originalGroup = new Map(setup.originals.map(({ id }) => [id, classifier.groups.findIndex((g) => 'id' in g && g.id === id)]));

  const room = await readCapture(join(dir, manifest.captures.main));
  const mainSources = captureSources(room, IDENTITY, manifest.meshTransform, classifier.classify);
  const pixels = new Pixels();
  const summary: MergeSummary = { triangles: 0, patches: [], completions: [], skipped: [] };

  // Fill Captures not lined up yet still have scan-import's identity transform, which would put them anywhere.
  const fills = (await Promise.all(manifest.captures.fills.map(async (fill, capture) => {
    if (fill.transform.rotationY === 0 && fill.transform.position.every((v) => v === 0)) {
      summary.skipped.push(capture);
      return null;
    }
    const document = await readCapture(join(dir, fill.mesh));
    return {
      fill, capture, document,
      // One resolver per Fill Capture, so a texture several Patches use is copied once.
      resolve: createDefaultPropertyResolver(room, document),
      sources: captureSources(document, fill.transform, manifest.meshTransform, classifier.classify),
    };
  }))).filter((f) => f !== null);

  for (const original of setup.originals) {
    if (original.kept) continue;
    // The Fill Capture that saw the most floor and wall in the Patch region.
    const inPatch = inGrownBox(original.box, MERGE.patchGrowth);
    let best: { fill: (typeof fills)[number]; picked: Picked[]; area: number } | null = null;
    for (const fill of fills) {
      const picked = pick(fill.sources, (s, t, c) => isSurface(s.groups[t]) && inPatch(c));
      const area = pickedArea(picked);
      if (area > 0 && (!best || area > best.area)) best = { fill, picked, area };
    }
    if (!best) continue;
    const { fill, picked, area } = best;
    const [near, far] = MERGE.ring.map((r) => inGrownBox(original.box, MERGE.patchGrowth + r));
    const inRing = (c: Vec3) => far(c) && !near(c);
    const gain = await ringGain(
      pick(mainSources, (s, t, c) => isSurface(s.groups[t]) && inRing(c)),
      pick(fill.sources, (s, t, c) => isSurface(s.groups[t]) && inRing(c)),
      pixels,
    );
    const triangles = addFill(room, fill.document, fill.resolve, picked, gain, { kind: 'patch', originalId: original.id, capture: fill.capture });
    // Triangles are picked by their centroids, so the area can run a little past the region's.
    const coverage = round(Math.min(1, pickedArea(picked.filter((p) => p.normal[1] > 0.8)) / floorArea(inPatch, setup)));
    summary.patches.push({ originalId: original.id, capture: fill.capture, triangles, area: round(area), coverage, gain });
  }

  for (const { fill, capture, document, resolve, sources } of fills) {
    for (const moved of fill.moved) {
      const original = setup.originals.find((o) => o.id === moved.originalId);
      if (!original || original.kept) continue;
      // The moved transform maps the copy to the Original's place, in the Main Capture's frame; the box is in the room frame.
      const toPlace = composeYaw(manifest.meshTransform, composeYaw(moved.transform, invertYaw(manifest.meshTransform)));
      const copyPose = composeYaw(invertYaw(toPlace), { position: original.box.position, rotationY: original.box.rotationY });
      const inCopy = inGrownBox({ ...original.box, ...copyPose }, MERGE.copyGrowth);
      const copy = pick(sources, (_s, _t, c) => c[1] > MERGE.copyMinY && inCopy(c));
      // Keep what the Main copy never saw; the triangles both saw tell the color gain.
      const mainCopy = mainCopyOf(mainSources, originalGroup.get(original.id)!);
      const unseen: Picked[] = [];
      const pairs: [main: Picked, fill: Picked][] = [];
      const turn = { position: [0, 0, 0] as Vec3, rotationY: toPlace.rotationY };
      for (const p of copy) {
        const match = mainCopy.seen(applyYaw(toPlace, p.centroid), applyYaw(turn, p.normal));
        if (match) pairs.push([match, p]);
        else unseen.push(p);
      }
      if (unseen.length === 0) continue;
      const gain = await pairGain(pairs, pixels);
      const triangles = addFill(room, document, resolve, unseen, gain, { kind: 'completion', originalId: original.id, capture }, moved.transform);
      summary.completions.push({ originalId: original.id, capture, triangles, area: round(pickedArea(unseen)), gain });
    }
  }

  // The budget covers the Main Capture and the fill together, with no cap on either (spec §2.3). Each
  // pass targets it; a pass can stop short where UV seams lock the mesh, so try again while it shrinks.
  let total = countTriangles(room);
  for (let before = Infinity; total > maxTriangles && total < before;) {
    await room.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio: maxTriangles / total, error: 1 }));
    [before, total] = [total, countTriangles(room)];
  }
  summary.triangles = total;
  await room.transform(dedup(), prune(), meshopt({ encoder: MeshoptEncoder, level: 'high' }), unpartition());
  await io.write(join(dir, manifest.mesh), room);
  return summary;
}

async function readCapture(path: string): Promise<Document> {
  const document = await io.read(path);
  // Float vertices, so the merge can add to them and quantize everything again once at the end.
  await document.transform(dequantize());
  return document;
}

/** A Capture's triangle primitives, in the Main Capture's frame (by `toMain`) and the room frame (by meshTransform). */
function captureSources(
  document: Document, toMain: YawTransform, meshTransform: YawTransform, classify: (info: ReturnType<typeof newTriangleInfo>) => number,
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
        main, room: roomMesh, groups,
        uvs: uv ? Float32Array.from(uv.getArray()!) : null,
        material: primitive.getMaterial(),
      });
    }
  }
  return sources;
}

/** A triangle picked from a source, with its room-frame centroid, normal and area. */
interface Picked { source: Source; t: number; centroid: Vec3; normal: Vec3; area: number }

function pick(sources: Source[], keep: (source: Source, t: number, centroid: Vec3) => boolean): Picked[] {
  const picked: Picked[] = [];
  const info = newTriangleInfo();
  for (const source of sources) {
    for (let t = 0; t < source.groups.length; t++) {
      triangleInfo(source.room, t, info);
      const centroid: Vec3 = [info.cx, info.cy, info.cz];
      if (info.area > 0 && keep(source, t, centroid)) picked.push({ source, t, centroid, normal: [info.nx, info.ny, info.nz], area: info.area });
    }
  }
  return picked;
}

const pickedArea = (picked: Picked[]) => picked.reduce((sum, p) => sum + p.area, 0);

/** The floor area inside a region: the room's floor polygon, sampled every 5 cm. */
function floorArea(inRegion: (point: Vec3) => boolean, { floor: { polygon } }: RoomSetup) {
  const step = 0.05;
  const xs = polygon.map(([x]) => x);
  const zs = polygon.map(([, z]) => z);
  let cells = 0;
  for (let x = Math.min(...xs) + step / 2; x < Math.max(...xs); x += step) {
    for (let z = Math.min(...zs) + step / 2; z < Math.max(...zs); z += step) {
      if (inRegion([x, 0, z]) && pointInPolygon([x, z], polygon)) cells++;
    }
  }
  return Math.max(cells * step * step, 1e-6);
}

/** The Main copy of an Original, to tell which triangles of a moved copy it has already. */
function mainCopyOf(mainSources: Source[], group: number) {
  const triangles = pick(mainSources, (s, t) => s.groups[t] === group);
  const points = Float64Array.from(triangles.flatMap((p) => p.centroid));
  const grid = sampleGrid({ points, count: triangles.length }, MERGE.seenSearch);
  return {
    /** A Main copy triangle facing the same way within MERGE.seen of the point: the same surface, seen already. Null when none is. */
    seen(point: Vec3, [nx, ny, nz]: Vec3): Picked | null {
      let found: Picked | null = null;
      grid.near(point, (i) => {
        const q = triangles[i];
        if (found || nx * q.normal[0] + ny * q.normal[1] + nz * q.normal[2] < 0.7) return;
        if (distanceToTriangle(point, q) < MERGE.seen) found = q;
      });
      return found;
    },
  };
}

/** The distance from a point to a picked triangle's surface (Ericson, Real-Time Collision Detection §5.1.5). */
function distanceToTriangle(p: Vec3, { source, t }: Picked): number {
  const vertex = (k: number): Vec3 => {
    const v = 3 * source.room.index[3 * t + k];
    return [source.room.positions[v], source.room.positions[v + 1], source.room.positions[v + 2]];
  };
  const [a, b, c] = [vertex(0), vertex(1), vertex(2)];
  const sub = (u: Vec3, w: Vec3): Vec3 => [u[0] - w[0], u[1] - w[1], u[2] - w[2]];
  const dot = (u: Vec3, w: Vec3) => u[0] * w[0] + u[1] * w[1] + u[2] * w[2];
  const at = (s: number, r: number): Vec3 => [0, 1, 2].map((k) => a[k] + s * (b[k] - a[k]) + r * (c[k] - a[k])) as Vec3;
  const [ab, ac, ap] = [sub(b, a), sub(c, a), sub(p, a)];
  const [d1, d2] = [dot(ab, ap), dot(ac, ap)];
  let closest: Vec3;
  if (d1 <= 0 && d2 <= 0) closest = a;
  else {
    const bp = sub(p, b);
    const [d3, d4] = [dot(ab, bp), dot(ac, bp)];
    const cp = sub(p, c);
    const [d5, d6] = [dot(ab, cp), dot(ac, cp)];
    const [va, vb, vc] = [d3 * d6 - d5 * d4, d5 * d2 - d1 * d6, d1 * d4 - d3 * d2];
    if (d3 >= 0 && d4 <= d3) closest = b;
    else if (d6 >= 0 && d5 <= d6) closest = c;
    else if (vc <= 0 && d1 >= 0 && d3 <= 0) closest = at(d1 / (d1 - d3), 0);
    else if (vb <= 0 && d2 >= 0 && d6 <= 0) closest = at(0, d2 / (d2 - d6));
    else if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
      const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
      closest = [0, 1, 2].map((k) => b[k] + w * (c[k] - b[k])) as Vec3;
    } else {
      const denominator = 1 / (va + vb + vc);
      closest = at(vb * denominator, vc * denominator);
    }
  }
  return Math.hypot(...sub(p, closest));
}

/** Decoded texture pixels, read once per texture. */
class Pixels {
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

/**
 * The per-channel factor that turns the Fill Capture's colors into the Main Capture's, from the
 * floor and wall around a Patch: only the 10 cm cells both Captures saw count, so a part of the
 * ring one of them missed can't tip the balance.
 */
async function ringGain(main: Picked[], fill: Picked[], pixels: Pixels): Promise<Vec3> {
  const cellOf = ([x, y, z]: Vec3) => [x, y, z].map((v) => Math.floor(v / MERGE.ringCell)).join();
  const sums = async (picked: Picked[]) => {
    const cells = new Map<string, number[]>();
    const step = Math.max(1, picked.length / MERGE.maxGainSamples);
    for (let k = 0; k < picked.length; k += step) {
      const p = picked[Math.floor(k)];
      const color = await pixels.colorOf(p);
      if (!color) continue;
      const sum = cells.get(cellOf(p.centroid)) ?? [0, 0, 0, 0];
      cells.set(cellOf(p.centroid), [sum[0] + color[0], sum[1] + color[1], sum[2] + color[2], sum[3] + 1]);
    }
    return cells;
  };
  const [m, f] = await Promise.all([sums(main), sums(fill)]);
  // Each shared cell's mean color counts once, however many triangles either Capture has there.
  const [mt, ft] = [[0, 0, 0], [0, 0, 0]];
  let samples = 0;
  for (const [key, [mr, mg, mb, mn]] of m) {
    const other = f.get(key);
    if (!other) continue;
    const [fr, fg, fb, fn] = other;
    [mt[0], mt[1], mt[2]] = [mt[0] + mr / mn, mt[1] + mg / mn, mt[2] + mb / mn];
    [ft[0], ft[1], ft[2]] = [ft[0] + fr / fn, ft[1] + fg / fn, ft[2] + fb / fn];
    samples += Math.min(mn, fn);
  }
  return samples < MERGE.minGainSamples ? [1, 1, 1] : clampGain([0, 1, 2].map((c) => mt[c] / ft[c]));
}

/** The per-channel factor from pairs of the same surface, as the Main copy and a moved copy saw it. */
async function pairGain(pairs: [main: Picked, fill: Picked][], pixels: Pixels): Promise<Vec3> {
  const step = Math.max(1, pairs.length / MERGE.maxGainSamples);
  const [m, f] = [[0, 0, 0], [0, 0, 0]];
  let count = 0;
  for (let k = 0; k < pairs.length; k += step) {
    const [main, fill] = pairs[Math.floor(k)];
    const [mc, fc] = await Promise.all([pixels.colorOf(main), pixels.colorOf(fill)]);
    if (!mc || !fc) continue;
    for (let c = 0; c < 3; c++) [m[c], f[c]] = [m[c] + mc[c], f[c] + fc[c]];
    count++;
  }
  return count < MERGE.minGainSamples ? [1, 1, 1] : clampGain([0, 1, 2].map((c) => m[c] / f[c]));
}

const clampGain = (ratios: number[]) => {
  const [low, high] = MERGE.gainRange;
  return ratios.map((r) => round(Math.min(high, Math.max(low, r)), 3)) as Vec3;
};

/**
 * Adds the picked triangles to the room as one tagged primitive per source, with the source's
 * material copied over and multiplied by the gain. `transform` moves them within the Main Capture's
 * frame (a moved Original's copy to its place). Returns how many triangles were added.
 */
function addFill(
  room: Document, from: Document, resolve: ReturnType<typeof createDefaultPropertyResolver>, picked: Picked[], gain: Vec3,
  tag: { kind: 'patch' | 'completion'; originalId: string; capture: number }, transform?: YawTransform,
): number {
  const scene = room.getRoot().getDefaultScene() ?? room.getRoot().listScenes()[0];
  const buffer = room.getRoot().listBuffers()[0] ?? room.createBuffer();
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
    for (const [v, n] of remap) {
      const p: Vec3 = [source.main[3 * v], source.main[3 * v + 1], source.main[3 * v + 2]];
      positions.set(transform ? applyYaw(transform, p) : p, 3 * n);
      if (uvs) uvs.set([source.uvs![2 * v], source.uvs![2 * v + 1]], 2 * n);
    }
    const name = `${tag.kind === 'patch' ? 'Patch' : 'Completion'} ${tag.originalId} (Fill Capture ${tag.capture + 1})`;
    const primitive = room.createPrimitive()
      .setAttribute('POSITION', room.createAccessor().setType('VEC3').setArray(positions).setBuffer(buffer))
      .setIndices(room.createAccessor().setType('SCALAR').setArray(index).setBuffer(buffer));
    if (uvs) primitive.setAttribute('TEXCOORD_0', room.createAccessor().setType('VEC2').setArray(uvs).setBuffer(buffer));
    if (source.material) {
      const copied = copyToDocument(room, from, [source.material], resolve).get(source.material) as Material;
      const [r, g, b, a] = copied.getBaseColorFactor();
      primitive.setMaterial(copied.clone().setName(name).setBaseColorFactor([r * gain[0], g * gain[1], b * gain[2], a]));
    }
    const mesh = room.createMesh(name).addPrimitive(primitive).setExtras({ mise: { fill: tag } });
    scene.addChild(room.createNode(name).setMesh(mesh));
    added += triangles.length;
  }
  return added;
}

function countTriangles(document: Document) {
  let triangles = 0;
  for (const mesh of document.getRoot().listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      if (primitive.getMode() === Primitive.Mode.TRIANGLES) triangles += getGLPrimitiveCount(primitive);
    }
  }
  return triangles;
}

const round = (v: number, digits = 2) => Math.round(v * 10 ** digits) / 10 ** digits;

async function main() {
  const scanId = process.argv[2];
  if (!scanId || scanId.startsWith('-')) {
    console.log('Usage: npx tsx scripts/scan-merge.ts <scanId>\n\nRebuilds data/scans/<scanId>/room.glb from its Main Capture and its lined-up Fill Captures (ADR-0007).');
    process.exitCode = scanId ? 0 : 1;
    return;
  }
  const { triangles, patches, completions, skipped } = await mergeScan(join(SCANS_DIR, scanId));
  const line = ({ originalId, capture, triangles: n, area, coverage, gain }: MergedFill) =>
    `  ${originalId.padEnd(18)} Fill Capture ${capture + 1}  ${n.toLocaleString('en-US').padStart(7)} triangles  ${area.toFixed(2)} m²`
    + `${coverage === undefined ? '' : `  ${Math.round(coverage * 100)}% of its floor`}  gain ${gain.join(' / ')}`;
  console.log(`Rebuilt data/scans/${scanId}/room.glb: ${triangles.toLocaleString('en-US')} triangles.`);
  console.log(`\nPatches:\n${patches.map(line).join('\n') || '  none'}`);
  console.log(`\nCompleted Originals:\n${completions.map(line).join('\n') || '  none'}`);
  if (skipped.length > 0) console.log(`\nNot lined up yet, so left out: Fill Capture ${skipped.map((i) => i + 1).join(', ')}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: Error) => {
    console.error(`scan-merge: ${error.message}`);
    process.exitCode = 1;
  });
}
