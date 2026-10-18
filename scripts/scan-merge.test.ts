import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Document } from '@gltf-transform/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ScanManifest, YawTransform } from '../shared/types';
import { composeYaw, invertYaw } from '../web/src/setup/geometry/align';
import { type MergeSummary, mergeScan } from './scan-merge';
import { io, measureScan, SCANS_DIR, writeJson } from './scan-import';
import { LOUNGE, LOUNGE_FILL_MOVED, LOUNGE_FILL_TRANSFORM } from './synthetic-room';

/** Where an Original stands, as a transform from its own frame. */
const pose = ({ position, rotationY }: { position: YawTransform['position']; rotationY: number }): YawTransform => ({ position, rotationY });
const sofa = LOUNGE.furniture.find((f) => f.original.id === 'og_sofa')!.original;

/** The synthetic lounge, copied, with its Fill Capture lined up as Room Setup step 6 would: the shell, and the moved sofa. */
async function alignedLounge(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'scan-merge-'));
  await cp(join(SCANS_DIR, 'synthetic-lounge'), dir, { recursive: true });
  const manifest: ScanManifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
  manifest.captures!.fills[0] = {
    ...manifest.captures!.fills[0],
    transform: LOUNGE_FILL_TRANSFORM,
    moved: [{ originalId: 'og_sofa', transform: composeYaw(pose(sofa.box), invertYaw(pose(LOUNGE_FILL_MOVED.og_sofa))) }],
  };
  await writeJson(join(dir, 'manifest.json'), manifest);
  return dir;
}

/** The triangles of the meshes the merge tagged with this kind and Original, in the room frame (meshTransform is identity here). */
function taggedTriangles(document: Document, kind: string, originalId: string) {
  const triangles: { c: number[]; n: number[]; area: number }[] = [];
  for (const node of document.getRoot().listNodes()) {
    const tag = node.getMesh()?.getExtras()?.mise as { fill?: { kind: string; originalId: string } } | undefined;
    if (tag?.fill?.kind !== kind || tag.fill.originalId !== originalId) continue;
    const m = node.getWorldMatrix();
    for (const primitive of node.getMesh()!.listPrimitives()) {
      const position = primitive.getAttribute('POSITION')!;
      const world = (i: number) => {
        const [x, y, z] = position.getElement(i, [] as number[]);
        return [0, 1, 2].map((k) => m[k] * x + m[4 + k] * y + m[8 + k] * z + m[12 + k]);
      };
      const index = primitive.getIndices()!.getArray()!;
      for (let t = 0; t < index.length; t += 3) {
        const [a, b, c] = [world(index[t]), world(index[t + 1]), world(index[t + 2])];
        const u = [0, 1, 2].map((k) => b[k] - a[k]);
        const v = [0, 1, 2].map((k) => c[k] - a[k]);
        const cross = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
        const length = Math.hypot(...cross);
        triangles.push({ c: [0, 1, 2].map((k) => (a[k] + b[k] + c[k]) / 3), n: cross.map((x) => x / length), area: length / 2 });
      }
    }
  }
  return triangles;
}

const area = (triangles: { area: number }[]) => triangles.reduce((sum, t) => sum + t.area, 0);

describe('mergeScan on the synthetic lounge', () => {
  let dir: string;
  let summary: MergeSummary;
  let room: Document;
  beforeAll(async () => {
    dir = await alignedLounge();
    summary = await mergeScan(dir);
    room = await io.read(join(dir, 'room.glb'));
  }, 60_000);
  afterAll(() => rm(dir, { recursive: true, force: true }));

  it('gives every non-Kept Original a Patch from the Fill Capture, and the Kept bench none', () => {
    expect(summary.patches.map((p) => [p.originalId, p.capture])).toEqual([
      ['og_sofa', 0], ['og_coffee_table', 0], ['og_side_table', 0], ['og_armchair', 0],
    ]);
  });

  it('makes a Patch of floor and wall only, covering the spot the sofa stood on', () => {
    const patch = taggedTriangles(room, 'patch', 'og_sofa');
    const floor = patch.filter(({ c, n }) => Math.abs(c[1]) < 0.06 && n[1] > 0.8);
    const westWall = patch.filter(({ c, n }) => Math.abs(c[0] + 2.7) < 0.04 && n[0] > 0.7);
    expect(floor.length + westWall.length).toBe(patch.length);
    // The sofa's footprint grown by 10 cm, cut by the West wall: x from −2.7 to −1.67, z from −1.15 to 1.15.
    expect(area(floor)).toBeGreaterThan(0.95 * 1.03 * 2.3);
    expect(area(westWall)).toBeGreaterThan(0.95 * 2.3 * 0.95);
  });

  it('color-matches each Patch to the Main Capture: the Fill Capture was exposed 10% darker', () => {
    for (const { gain } of summary.patches) for (const channel of gain) expect(channel).toBeCloseTo(1 / 0.9, 1);
  });

  it('completes the sofa with the back the Main Capture never saw, and nothing it did see', () => {
    const completion = taggedTriangles(room, 'completion', 'og_sofa');
    // The sofa faces +X from the West wall, so its back faces −X.
    expect(area(completion.filter(({ n }) => n[0] < -0.7))).toBeGreaterThan(0.9 * 2.1 * 0.85);
    expect(area(completion.filter(({ n }) => n[1] > 0.7))).toBeLessThan(0.05);
    expect(summary.completions.map((c) => c.originalId)).toEqual(['og_sofa']);
  });

  it('rebuilds room.glb the same way every time, from the Main Capture', async () => {
    const first = await readFile(join(dir, 'room.glb'));
    await mergeScan(dir);
    expect(await readFile(join(dir, 'room.glb'))).toEqual(first);
  }, 60_000);

  it('keeps room.glb within the triangle budget', async () => {
    await mergeScan(dir, { maxTriangles: 90_000 });
    expect(measureScan(await io.read(join(dir, 'room.glb'))).triangles).toBeLessThanOrEqual(90_000);
  }, 60_000);
});
