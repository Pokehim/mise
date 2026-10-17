import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Document } from '@gltf-transform/core';
import { PNG } from 'pngjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ScanManifest, Vec3 } from '../shared/types';
import {
  findModel, formatSummary, importScan, io, measureScan, optimizeScan, type ScanStats, scanManifest,
} from './scan-import';

/**
 * The floor and four walls of a 3.6 × 2.6 × 4.2 m room, facing in, with no ceiling, and one PNG texture.
 * The vertices are at half size and a node scales them up, the way quantized files store them.
 */
function openRoom([width, height]: [number, number] = [4, 2]): Document {
  const document = new Document();
  const [x, y, z] = [0.9, 0.65, 1.05];
  // [corner, edge u, edge v]: two triangles each, facing u × v.
  const quads: [Vec3, Vec3, Vec3][] = [
    [[-x, -y, -z], [0, 0, 2 * z], [2 * x, 0, 0]], // floor, +Y
    [[-x, -y, -z], [2 * x, 0, 0], [0, 2 * y, 0]], // north wall, +Z
    [[x, -y, z], [-2 * x, 0, 0], [0, 2 * y, 0]], // south wall, -Z
    [[-x, -y, z], [0, 0, -2 * z], [0, 2 * y, 0]], // west wall, +X
    [[x, -y, -z], [0, 0, 2 * z], [0, 2 * y, 0]], // east wall, -X
  ];
  const positions = quads.flatMap(([[ox, oy, oz], [ux, uy, uz], [vx, vy, vz]]) => [
    [ox, oy, oz], [ox + ux, oy + uy, oz + uz], [ox + ux + vx, oy + uy + vy, oz + uz + vz], [ox + vx, oy + vy, oz + vz],
  ].flat());
  const indices = quads.flatMap((_, quad) => [0, 1, 2, 0, 2, 3].map((corner) => quad * 4 + corner));
  const png = PNG.sync.write(Object.assign(new PNG({ width, height }), { data: Buffer.from(Array.from({ length: width * height * 4 }, (_, i) => (i * 7) % 256)) }));

  const buffer = document.createBuffer();
  const primitive = document.createPrimitive()
    .setAttribute('POSITION', document.createAccessor().setType('VEC3').setArray(new Float32Array(positions)).setBuffer(buffer))
    .setIndices(document.createAccessor().setType('SCALAR').setArray(new Uint16Array(indices)).setBuffer(buffer))
    .setMaterial(document.createMaterial().setBaseColorTexture(document.createTexture().setImage(png).setMimeType('image/png')));
  const node = document.createNode().setMesh(document.createMesh().addPrimitive(primitive)).setScale([2, 2, 2]).setTranslation([0, 1.3, 0]);
  document.createScene().addChild(node);
  return document;
}

/** A bumpy n × n m floor of 2n² triangles, like a noisy scan that simplify can't flatten for free. */
function bumpyFloor(n: number): Document {
  const document = new Document();
  const positions: number[] = [];
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= n; j++) positions.push(i, 0.05 * Math.sin(i * 12.9898 + j * 78.233) * Math.sin(j * 4.1 + i), j);
  }
  const indices: number[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const corner = i * (n + 1) + j;
      indices.push(corner, corner + 1, corner + n + 2, corner, corner + n + 2, corner + n + 1);
    }
  }
  const buffer = document.createBuffer();
  const primitive = document.createPrimitive()
    .setAttribute('POSITION', document.createAccessor().setType('VEC3').setArray(new Float32Array(positions)).setBuffer(buffer))
    .setIndices(document.createAccessor().setType('SCALAR').setArray(new Uint32Array(indices)).setBuffer(buffer));
  document.createScene().addChild(document.createNode().setMesh(document.createMesh().addPrimitive(primitive)));
  return document;
}

describe('optimizeScan', () => {
  it('simplifies a mesh over the triangle limit until it is under it', async () => {
    const document = bumpyFloor(100);
    expect(measureScan(document).triangles).toBe(20_000);

    await optimizeScan(document, 5_000);

    expect(measureScan(document).triangles).toBeLessThanOrEqual(5_000);
    expect(measureScan(document).triangles).toBeGreaterThan(2_500);
  });

  it('converts textures to WebP no larger than 2048 px, keeping their aspect ratio', async () => {
    const document = openRoom([4096, 8]);

    await optimizeScan(document);

    expect(measureScan(document).textures).toEqual([{ width: 2048, height: 4, mimeType: 'image/webp', bytes: expect.any(Number) }]);
  });
});

describe('measureScan', () => {
  it('measures the triangles, the textures, and the bounds in world space', () => {
    const stats = measureScan(openRoom());
    expect(stats.triangles).toBe(10);
    expect(stats.textures).toEqual([{ width: 4, height: 2, mimeType: 'image/png', bytes: expect.any(Number) }]);
    expect(stats.bounds.min.map((v) => +v.toFixed(6))).toEqual([-1.8, 0, -2.1]);
    expect(stats.bounds.max.map((v) => +v.toFixed(6))).toEqual([1.8, 2.6, 2.1]);
  });
});

// A 3.6 × 2.6 × 4.2 m dorm, as the summary sees it.
const dorm: ScanStats = {
  triangles: 86_559,
  textures: [
    { width: 2048, height: 2048, mimeType: 'image/webp', bytes: 812_400 },
    { width: 512, height: 288, mimeType: 'image/webp', bytes: 6_100 },
  ],
  bounds: { min: [-1.8, 0, -2.1], max: [1.8, 2.6, 2.1] },
};

describe('formatSummary', () => {
  it('prints the triangle count, the textures and their sizes, the bounding box, and the size along each axis', () => {
    const summary = formatSummary(dorm);
    expect(summary).toContain('86,559 triangles');
    expect(summary).toContain('Textures  2: 2048×2048 webp (812 KB), 512×288 webp (6 KB)');
    expect(summary).toContain('min (-1.80, 0.00, -2.10) m, max (1.80, 2.60, 2.10) m');
    expect(summary).toContain('X 3.60 m, Y 2.60 m (up), Z 4.20 m');
    expect(summary).not.toContain('⚠');
  });

  it.each([
    ['Z up, as from Blender', { min: [-1.8, -2.1, 0], max: [1.8, 2.1, 2.6] }, '4.20'],
    ['centimeters', { min: [-180, 0, -210], max: [180, 260, 210] }, '260.00'],
    ['too flat for a room', { min: [-1.8, 0, -2.1], max: [1.8, 1.2, 2.1] }, '1.20'],
  ] as const)('warns when the Y extent is outside 2.0–3.5 m: %s', (_, bounds, height) => {
    const summary = formatSummary({ ...dorm, bounds: { min: [...bounds.min], max: [...bounds.max] } });
    expect(summary).toContain(`⚠ The Y extent is ${height} m, outside 2.0–3.5 m for a room. Check that +Y is up and the units are meters.`);
  });

  it('prints tiny textures in bytes, and scan noise just below zero as 0.00', () => {
    const summary = formatSummary({
      ...dorm,
      textures: [{ width: 128, height: 128, mimeType: 'image/webp', bytes: 116 }],
      bounds: { min: [-1.8, -0.002, -2.1], max: [1.8, 2.6, 2.1] },
    });
    expect(summary).toContain('Textures  1: 128×128 webp (116 B)');
    expect(summary).toContain('min (-1.80, 0.00, -2.10) m');
  });

  it('warns when simplify could not bring the mesh under 300k triangles', () => {
    expect(formatSummary({ ...dorm, triangles: 312_000 })).toContain('⚠ 312,000 triangles is over the limit of 300,000.');
  });

});

describe('scanManifest', () => {
  it('points at room.glb with an identity meshTransform, which Room Setup step 1 replaces', () => {
    const manifest: ScanManifest = scanManifest('dorm-v1', 'Maple Hall 412');
    expect(manifest).toEqual({
      version: 1,
      id: 'dorm-v1',
      name: 'Maple Hall 412',
      mesh: 'room.glb',
      meshTransform: { position: [0, 0, 0], rotationY: 0 },
    });
  });
});

describe('findModel', () => {
  it('finds the .gltf in an unzipped export, at any depth', () => {
    expect(findModel(['scene/textures/0.jpg', 'scene/scene.bin', 'scene/scene.gltf'])).toBe('scene/scene.gltf');
  });

  it('ignores the metadata files that macOS adds to zips', () => {
    expect(findModel(['__MACOSX/._Room.GLB', '._Room.GLB', 'Room.GLB'])).toBe('Room.GLB');
  });

  it('fails when the export has no model', () => {
    expect(() => findModel(['scene.obj', 'texture.png'])).toThrow('No .gltf or .glb file in the export');
  });

  it('fails on the Raw Data export, which holds a raw.glb but belongs in --raw', () => {
    expect(() => findModel(['raw/keyframes/images/1.jpg', 'raw/mesh_info.json', 'raw/raw.glb'])).toThrow(
      'This is the Raw Data export (it has keyframes/). Pass the glTF export here, and this one with --raw.',
    );
  });

  it('fails when the export has several models, and names them so one can be picked', () => {
    expect(() => findModel(['a/scene.gltf', 'b/scene.glb'])).toThrow(
      'The export has 2 models (a/scene.gltf, b/scene.glb). Pass the one to import instead of the whole export.',
    );
  });
});

describe('importScan', () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'scan-import-'));
  });
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  /** Zips the files io.write makes for the room, inside a top folder, as Polycam's glTF export does. */
  async function zippedExport() {
    await mkdir(join(tmp, 'export/Room'), { recursive: true });
    await io.write(join(tmp, 'export/Room/scene.gltf'), openRoom());
    execFileSync('zip', ['-qr', '../polycam-gltf.zip', 'Room'], { cwd: join(tmp, 'export') });
    return join(tmp, 'polycam-gltf.zip');
  }

  it('turns a zipped glTF export into a Scan folder with room.glb and manifest.json', async () => {
    const { dir, stats } = await importScan({
      input: await zippedExport(), scanId: 'test-room', name: 'Test room', scansDir: join(tmp, 'scans'),
    });

    expect(dir).toBe(join(tmp, 'scans/test-room'));
    expect(JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'))).toEqual({
      version: 1, id: 'test-room', name: 'Test room', mesh: 'room.glb', meshTransform: { position: [0, 0, 0], rotationY: 0 },
    });
    expect(measureScan(await io.read(join(dir, 'room.glb')))).toEqual(stats);
    expect(stats.triangles).toBe(10);
    expect(stats.textures.map((texture) => texture.mimeType)).toEqual(['image/webp']);
  });

  it('unpacks the Raw Data zip into raw/ without its top folder, so raw/ holds keyframes/ for msplat-train', async () => {
    await mkdir(join(tmp, 'rawdata/Room/keyframes/images'), { recursive: true });
    await writeFile(join(tmp, 'rawdata/Room/keyframes/images/1.jpg'), 'jpeg');
    execFileSync('zip', ['-qr', '../rawdata.zip', 'Room'], { cwd: join(tmp, 'rawdata') });

    const { dir } = await importScan({
      input: await zippedExport(), scanId: 'test-room', raw: join(tmp, 'rawdata.zip'), scansDir: join(tmp, 'scans'),
    });

    expect(await readFile(join(dir, 'raw/keyframes/images/1.jpg'), 'utf8')).toBe('jpeg');
  });

  it('refuses to replace an existing Scan, whose Room Setup was made on the old mesh, unless forced', async () => {
    const options = { input: await zippedExport(), scanId: 'test-room', scansDir: join(tmp, 'scans') };
    await importScan(options);
    await writeFile(join(tmp, 'scans/test-room/setup.json'), '{}');

    await expect(importScan(options)).rejects.toThrow('already exists. Pass --force to replace it');
    await importScan({ ...options, name: 'Renamed', force: true });

    expect(JSON.parse(await readFile(join(tmp, 'scans/test-room/manifest.json'), 'utf8')).name).toBe('Renamed');
    expect(existsSync(join(tmp, 'scans/test-room/setup.json'))).toBe(true);
  });
});
