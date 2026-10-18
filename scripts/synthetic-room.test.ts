import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RoomSetup } from '../shared/types';
import { inGrownBox } from '../web/src/setup/geometry/align';
import { triangleClassifier } from '../web/src/setup/geometry/classify';
import { newTriangleInfo, triangleInfo } from '../web/src/setup/geometry/mesh';
import { io, measureScan, SCANS_DIR, scanManifest } from './scan-import';

// data/scans/synthetic/ is committed output of scripts/synthetic-room.ts, which #7 and #8 build against.
const scanFile = (file: string) => join(SCANS_DIR, 'synthetic', file);

describe('the synthetic Scan', () => {
  it('has the manifest that scan-import writes', async () => {
    const manifest = JSON.parse(await readFile(scanFile('manifest.json'), 'utf8'));
    expect(manifest).toEqual(scanManifest('synthetic', 'Synthetic dorm (3.6 × 4.2 m)'));
  });

  it('has a room.glb that fills the room its setup.json describes, in meters with +Y up and the floor at y = 0', async () => {
    const setup: RoomSetup = JSON.parse(await readFile(scanFile('setup.json'), 'utf8'));
    const { bounds } = measureScan(await io.read(scanFile('room.glb')));

    const [xs, zs] = [0, 1].map((axis) => setup.floor.polygon.map((corner) => corner[axis]));
    const roomMin = [Math.min(...xs), 0, Math.min(...zs)];
    const roomMax = [Math.max(...xs), setup.ceilingHeight, Math.max(...zs)];
    // Within 5 mm: the walls carry ±2 mm of scan-like noise, and quantization rounds a little.
    bounds.min.forEach((value, axis) => expect(value).toBeCloseTo(roomMin[axis], 2));
    bounds.max.forEach((value, axis) => expect(value).toBeCloseTo(roomMax[axis], 2));
    expect(roomMax).toEqual([1.8, 2.6, 2.1]);
  });

  it('has the floor whole under every Original, as wholeEmptyRoom says, so nothing shows a Patch', async () => {
    const setup: RoomSetup = JSON.parse(await readFile(scanFile('setup.json'), 'utf8'));
    expect(setup.wholeEmptyRoom).toBe(true);
    const { groups, classify } = triangleClassifier(setup);
    const floor = groups.findIndex(({ kind }) => kind === 'floor');
    const floorArea: Record<string, number> = Object.fromEntries(setup.originals.map(({ id }) => [id, 0]));
    const info = newTriangleInfo();
    for (const node of (await io.read(scanFile('room.glb'))).getRoot().listNodes()) {
      const m = node.getWorldMatrix();
      for (const primitive of node.getMesh()?.listPrimitives() ?? []) {
        const position = primitive.getAttribute('POSITION')!;
        const positions = new Float32Array(position.getCount() * 3);
        const v: number[] = [];
        for (let i = 0; i < position.getCount(); i++) {
          const [x, y, z] = position.getElement(i, v);
          positions.set([0, 1, 2].map((r) => m[r] * x + m[4 + r] * y + m[8 + r] * z + m[12 + r]), 3 * i);
        }
        const mesh = { positions, index: Uint32Array.from(primitive.getIndices()!.getArray()!) };
        for (let t = 0; t < mesh.index.length / 3; t++) {
          if (classify(triangleInfo(mesh, t, info)) !== floor) continue;
          for (const { id, box } of setup.originals) if (inGrownBox(box, 0)([info.cx, 0, info.cz])) floorArea[id] += info.area;
        }
      }
    }
    // Within a few percent: a 5 cm cell counts when its center is in the footprint, which doesn't line up with the cells.
    for (const { id, box: { size: [w, , d] } } of setup.originals) expect(floorArea[id] / (w * d), id).toBeCloseTo(1, 1);
  });
});
