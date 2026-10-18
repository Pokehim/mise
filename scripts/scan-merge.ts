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
  copyToDocument, createDefaultPropertyResolver, dequantize, getGLPrimitiveCount, meshopt, prune, simplify, unpartition, weld,
} from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import type { Box, RoomSetup, ScanManifest, Vec3, YawTransform } from '../shared/types';
import { applyYaw, composeYaw, invertYaw } from '../web/src/setup/geometry/align';
import { triangleClassifier } from '../web/src/setup/geometry/classify';
import { type TriangleMesh, newTriangleInfo, triangleInfo } from '../web/src/setup/geometry/mesh';
import { io, MAX_TRIANGLES, SCANS_DIR } from './scan-import';

const MERGE = {
  /** A Patch covers the Original's box grown by this much: its contact shadow, and the wall strip behind it. */
  patchGrowth: 0.1,
  /** Patch color is compared over the floor and wall in this band around the Patch. */
  ring: [0.1, 0.3],
  /** A moved Original's copy: the triangles inside its box grown by this much, above the floor. */
  copyGrowth: 0.02,
  copyMinY: 0.02,
  /** A copy's triangle within this distance of the Main copy's surface was seen already. */
  seen: 0.02,
  seenSearch: 0.05,
  gainRange: [0.5, 2] as const,
  minGainSamples: 30,
};

export interface MergePart {
  originalId: string;
  /** Index in manifest.captures.fills. */
  capture: number;
  triangles: number;
  /** Square meters. */
  area: number;
  /** The RGB factor that matched it to the Main Capture. */
  gain: Vec3;
}

export interface MergeSummary { triangles: number; patches: MergePart[]; completions: MergePart[] }

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
 * Rebuilds `room.glb` in a Scan folder from `captures.main` and each Fill Capture, using the
 * transforms Room Setup saved in the manifest and the Originals in setup.json. It always starts
 * from the Main Capture, so running it again gives the same file.
 */
export async function mergeScan(dir: string, { maxTriangles = MAX_TRIANGLES } = {}): Promise<MergeSummary> {
  const manifest: ScanManifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
  const setup: RoomSetup = JSON.parse(await readFile(join(dir, 'setup.json'), 'utf8'));
  if (!manifest.captures) throw new Error(`${manifest.id} has no Fill Captures: import one with scan-import --fill.`);
  await Promise.all([MeshoptEncoder.ready, MeshoptSimplifier.ready]);

  const classifier = triangleClassifier(setup);
  const isSurface = (group: number) => ['floor', 'wall'].includes(classifier.groups[group].kind);
  const originalGroup = new Map(setup.originals.map(({ id }) => [id, classifier.groups.findIndex((g) => 'id' in g && g.id === id)]));

  const room = await readCapture(join(dir, manifest.captures.main));
  const mainSources = captureSources(room, { position: [0, 0, 0], rotationY: 0 }, manifest.meshTransform, classifier.classify);
  const pixels = new Pixels();
  const patches: MergePart[] = [];
  const completions: MergePart[] = [];

  // Each Fill Capture's candidate Patches, and its moved Originals' completions.
  const fills = await Promise.all(manifest.captures.fills.map(async (fill) => {
    const document = await readCapture(join(dir, fill.mesh));
    return { fill, document, sources: captureSources(document, fill.transform, manifest.meshTransform, classifier.classify) };
  }));

  for (const original of setup.originals) {
    if (original.kept) continue;
    // The Fill Capture that saw the most floor and wall in the Patch region.
    const inPatch = inBox(original.box, MERGE.patchGrowth);
    let best: { capture: number; picked: Picked[]; area: number } | null = null;
    fills.forEach(({ sources }, capture) => {
      const picked = pick(sources, (s, t, c) => isSurface(s.groups[t]) && inPatch(c));
      const area = pickedArea(picked);
      if (area > 0 && (!best || area > best.area)) best = { capture, picked, area };
    });
    if (!best) continue;
    const { capture, picked, area } = best as { capture: number; picked: Picked[]; area: number };
    const [r0, r1] = MERGE.ring;
    const inRing = (c: Vec3) => inBox(original.box, r1)(c) && !inBox(original.box, r0)(c);
    const gain = await gainOf(
      pick(mainSources, (s, t, c) => isSurface(s.groups[t]) && inRing(c)),
      pick(fills[capture].sources, (s, t, c) => isSurface(s.groups[t]) && inRing(c)),
      pixels,
    );
    const triangles = addParts(room, fills[capture].document, picked, gain, { kind: 'patch', originalId: original.id, capture });
    patches.push({ originalId: original.id, capture, triangles, area: round(area), gain });
  }

  for (const [capture, { fill, document, sources }] of fills.entries()) {
    for (const moved of fill.moved) {
      const original = setup.originals.find((o) => o.id === moved.originalId);
      if (!original || original.kept) continue;
      // The moved transform maps the copy to the Original's place, in the Main Capture's frame; the box is in the room frame.
      const toPlace = composeYaw(manifest.meshTransform, composeYaw(moved.transform, invertYaw(manifest.meshTransform)));
      const copyPose = composeYaw(invertYaw(toPlace), { position: original.box.position, rotationY: original.box.rotationY });
      const inCopy = inBox({ ...original.box, ...copyPose }, MERGE.copyGrowth);
      const copy = pick(sources, (_s, _t, c) => c[1] > MERGE.copyMinY && inCopy(c));
      // Keep what the Main copy never saw; what both saw tells the color gain.
      const seen = seenSurface(mainSources, originalGroup.get(original.id)!);
      const unseen: Picked[] = [];
      const pairs: { fill: Picked[]; main: Picked[] } = { fill: [], main: [] };
      const turn = { position: [0, 0, 0] as Vec3, rotationY: toPlace.rotationY };
      for (const p of copy) {
        const match = seen.match(applyYaw(toPlace, p.centroid), applyYaw(turn, p.normal));
        if (match) {
          pairs.fill.push(p);
          pairs.main.push(match);
        } else {
          unseen.push(p);
        }
      }
      if (unseen.length === 0) continue;
      const gain = await gainOf(pairs.main, pairs.fill, pixels);
      const triangles = addParts(room, document, unseen, gain, { kind: 'completion', originalId: original.id, capture }, moved.transform);
      completions.push({ originalId: original.id, capture, triangles, area: round(pickedArea(unseen)), gain });
    }
  }

  // The budget covers the Main Capture and the fill together, with no cap on either (spec §2.3).
  let total = countTriangles(room);
  if (total > maxTriangles) {
    await room.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio: maxTriangles / total, error: 1 }));
    total = countTriangles(room);
  }
  await room.transform(prune(), meshopt({ encoder: MeshoptEncoder, level: 'high' }), unpartition());
  await io.write(join(dir, manifest.mesh), room);
  return { triangles: total, patches, completions };
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

/** A triangle picked from a source, with its room-frame centroid and area. */
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

/** A test for room-frame points inside a box grown by `growth` on every side, its bottom included. */
function inBox({ position: [px, py, pz], size: [w, h, d], rotationY }: Box, growth: number) {
  const [c, s] = [Math.cos(rotationY), Math.sin(rotationY)];
  return ([x, y, z]: Vec3) => {
    const [dx, dz] = [x - px, z - pz];
    const [lx, lz] = [c * dx - s * dz, s * dx + c * dz];
    return Math.abs(lx) <= w / 2 + growth && Math.abs(lz) <= d / 2 + growth && y - py >= -growth && y - py <= h + growth;
  };
}

/** The Main copy of an Original, for finding which triangles of a moved copy it already has. */
function seenSurface(mainSources: Source[], group: number) {
  const cell = MERGE.seenSearch;
  const cells = new Map<string, Picked[]>();
  const key = (x: number, y: number, z: number) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
  for (const p of pick(mainSources, (s, t) => s.groups[t] === group)) {
    const k = key(...p.centroid);
    if (!cells.has(k)) cells.set(k, []);
    cells.get(k)!.push(p);
  }
  return {
    /**
     * The nearby Main copy triangle that faces the same way and whose plane passes within MERGE.seen
     * of the point: the same surface, seen already. Null when there is none.
     */
    match([x, y, z]: Vec3, [nx, ny, nz]: Vec3): Picked | null {
      const [gx, gy, gz] = [Math.floor(x / cell), Math.floor(y / cell), Math.floor(z / cell)];
      let best: Picked | null = null;
      let bestSq = cell * cell;
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dz = -1; dz <= 1; dz++) {
            for (const q of cells.get(`${gx + dx},${gy + dy},${gz + dz}`) ?? []) {
              const [ex, ey, ez] = [x - q.centroid[0], y - q.centroid[1], z - q.centroid[2]];
              const sq = ex * ex + ey * ey + ez * ez;
              const plane = Math.abs(ex * q.normal[0] + ey * q.normal[1] + ez * q.normal[2]);
              const facing = nx * q.normal[0] + ny * q.normal[1] + nz * q.normal[2];
              if (sq < bestSq && plane < MERGE.seen && facing > 0.7) [best, bestSq] = [q, sq];
            }
          }
        }
      }
      return best;
    },
  };
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

  /** A triangle's color: its texture at its UV centroid (repeating), times its material's base color. */
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
    return [0, 1, 2].map((c) => (pixels.data[i + c] / 255) * factor[c]) as Rgb;
  }
}

/** The per-channel factor that turns the Fill Capture's colors into the Main Capture's, from samples of the same surfaces. */
async function gainOf(main: Picked[], fill: Picked[], pixels: Pixels): Promise<Vec3> {
  const mean = async (picked: Picked[]) => {
    const colors = (await Promise.all(picked.map((p) => pixels.colorOf(p)))).filter((c): c is Rgb => c !== null);
    return { count: colors.length, rgb: [0, 1, 2].map((c) => colors.reduce((sum, color) => sum + color[c], 0) / colors.length) };
  };
  const [m, f] = await Promise.all([mean(main), mean(fill)]);
  if (m.count < MERGE.minGainSamples || f.count < MERGE.minGainSamples) return [1, 1, 1];
  const [low, high] = MERGE.gainRange;
  return [0, 1, 2].map((c) => round(Math.min(high, Math.max(low, m.rgb[c] / f.rgb[c])), 3)) as Vec3;
}

/**
 * Adds the picked triangles to the room as one tagged primitive per source, with the source's
 * material copied over and multiplied by the gain. `transform` moves them within the Main Capture's
 * frame (a moved Original's copy to its place). Returns how many triangles were added.
 */
function addParts(
  room: Document, from: Document, picked: Picked[], gain: Vec3,
  tag: { kind: 'patch' | 'completion'; originalId: string; capture: number }, transform?: YawTransform,
): number {
  const resolve = createDefaultPropertyResolver(room, from);
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
  const { triangles, patches, completions } = await mergeScan(join(SCANS_DIR, scanId));
  const line = ({ originalId, capture, triangles: n, area, gain }: MergePart) =>
    `  ${originalId.padEnd(18)} Fill Capture ${capture + 1}  ${n.toLocaleString('en-US').padStart(7)} triangles  ${area.toFixed(2)} m²  gain ${gain.join(' / ')}`;
  console.log(`Rebuilt data/scans/${scanId}/room.glb: ${triangles.toLocaleString('en-US')} triangles.`);
  console.log(`\nPatches:\n${patches.map(line).join('\n') || '  none'}`);
  console.log(`\nCompleted Originals:\n${completions.map(line).join('\n') || '  none'}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: Error) => {
    console.error(`scan-merge: ${error.message}`);
    process.exitCode = 1;
  });
}

