import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { RoomSetup } from '../shared/types';
import { io, measureScan } from './scan-import';

// data/scans/synthetic/ is committed output of scripts/synthetic-room.ts, which #7 and #8 build against.
const scanFile = (file: string) => fileURLToPath(new URL(`../data/scans/synthetic/${file}`, import.meta.url));

describe('the synthetic Scan', () => {
  it('has the manifest that scan-import writes', async () => {
    expect(JSON.parse(await readFile(scanFile('manifest.json'), 'utf8'))).toEqual({
      version: 1,
      id: 'synthetic',
      name: 'Synthetic dorm (3.6 × 4.2 m)',
      mesh: 'room.glb',
      meshTransform: { position: [0, 0, 0], rotationY: 0 },
    });
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
});
