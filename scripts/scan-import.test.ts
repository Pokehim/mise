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

/** A Document whose scene is one node with one mesh of these triangles. */
function meshDocument(positions: number[], indices: number[]) {
  const document = new Document();
  const buffer = document.createBuffer();
  const primitive = document.createPrimitive()
    .setAttribute('POSITION', document.createAccessor().setType('VEC3').setArray(new Float32Array(positions)).setBuffer(buffer))
    .setIndices(document.createAccessor().setType('SCALAR').setArray(new Uint32Array(indices)).setBuffer(buffer));
  const node = document.createNode().setMesh(document.createMesh().addPrimitive(primitive));
  document.createScene().addChild(node);
  return { document, primitive, node };
}

/**
 * The floor and four walls of a 3.6 × 2.6 × 4.2 m room, facing in, with no ceiling, and one PNG texture.
 * The vertices are at half size and a node scales them up, the way quantized files store them.
 */
function openRoom([width, height]: [number, number] = [4, 2]): Document {
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
  // Not one solid color, which prune would turn into a plain material color.
  const pixels = Buffer.from(Array.from({ length: width * height * 4 }, (_, i) => (i * 7) % 256));
  const png = PNG.sync.write(Object.assign(new PNG({ width, height }), { data: pixels }));

  const { document, primitive, node } = meshDocument(positions, indices);
  const texture = document.createTexture().setImage(png).setMimeType('image/png');
  primitive.setMaterial(document.createMaterial().setBaseColorTexture(texture));
  node.setScale([2, 2, 2]).setTranslation([0, 1.3, 0]);
  return document;
}

/** A bumpy n × n m floor of 2n² triangles, like a noisy scan that simplify can't flatten for free. */
function bumpyFloor(n: number, bumps = 0.05): Document {
  const positions: number[] = [];
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= n; j++) positions.push(i, bumps * Math.sin(i * 12.9898 + j * 78.233) * Math.sin(j * 4.1 + i), j);
  }
  const indices: number[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const corner = i * (n + 1) + j;
      indices.push(corner, corner + 1, corner + n + 2, corner, corner + n + 2, corner + n + 1);
    }
  }
  return meshDocument(positions, indices).document;
}

describe('optimizeScan', () => {
  it('simplifies a mesh over the triangle limit until it is under it', async () => {
    const document = bumpyFloor(100);
    expect(measureScan(document).triangles).toBe(20_000);

    await optimizeScan(document, 5_000);

    expect(measureScan(document).triangles).toBeLessThanOrEqual(5_000);
    expect(measureScan(document).triangles).toBeGreaterThan(2_500);
  });

  it('keeps the edge two textured parts share in place, so the parts never crack apart', async () => {
    // Two bumpy 20 × 40 m halves of a floor, each with its own texture, meeting along x = 20.
    const document = new Document();
    const buffer = document.createBuffer();
    const scene = document.createScene();
    for (const [x0, seed] of [[0, 1], [20, 2]]) {
      const half = bumpyFloor(20);
      const primitive = half.getRoot().listMeshes()[0].listPrimitives()[0];
      const positions = primitive.getAttribute('POSITION')!.getArray()!.slice();
      for (let i = 0; i < positions.length; i += 3) [positions[i], positions[i + 2]] = [positions[i] + x0, positions[i + 2] * 2];
      const pixels = Buffer.from(Array.from({ length: 16 * 4 }, (_, i) => (i * 37 * seed) % 256));
      const texture = document.createTexture().setMimeType('image/png')
        .setImage(PNG.sync.write(Object.assign(new PNG({ width: 4, height: 4 }), { data: pixels })));
      const uvs = new Float32Array((positions.length / 3) * 2).map((_, i) => (i % 2 === 0 ? positions[(i / 2) * 3] : positions[((i - 1) / 2) * 3 + 2]) / 40);
      const part = document.createPrimitive()
        .setAttribute('POSITION', document.createAccessor().setType('VEC3').setArray(positions).setBuffer(buffer))
        .setAttribute('TEXCOORD_0', document.createAccessor().setType('VEC2').setArray(uvs).setBuffer(buffer))
        .setIndices(document.createAccessor().setType('SCALAR').setArray(primitive.getIndices()!.getArray()!.slice()).setBuffer(buffer))
        .setMaterial(document.createMaterial().setBaseColorTexture(texture));
      scene.addChild(document.createNode().setMesh(document.createMesh().addPrimitive(part)));
    }

    await optimizeScan(document, 600);

    // Where each part's vertices lie on the shared edge, in world space.
    const onEdge = document.getRoot().listNodes().filter((node) => node.getMesh()).map((node) => {
      const m = node.getWorldMatrix();
      const position = node.getMesh()!.listPrimitives()[0].getAttribute('POSITION')!;
      const zs: number[] = [];
      for (let i = 0; i < position.getCount(); i++) {
        const [x, y, z] = position.getElement(i, [] as number[]);
        if (Math.abs(m[0] * x + m[4] * y + m[8] * z + m[12] - 20) < 0.01) zs.push(+(m[2] * x + m[6] * y + m[10] * z + m[14]).toFixed(2));
      }
      return zs.sort((a, b) => a - b);
    });
    expect(measureScan(document).triangles).toBeLessThan(1_600);
    expect(onEdge).toHaveLength(2);
    expect(onEdge[0]).toEqual(onEdge[1]);
  });

  it('converts textures to WebP no larger than 4096 px, keeping their aspect ratio', async () => {
    const document = openRoom([8192, 8]);

    await optimizeScan(document);

    expect(measureScan(document).textures).toEqual([{ width: 4096, height: 4, mimeType: 'image/webp', bytes: expect.any(Number) }]);
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

  it.each<[string, ScanStats['bounds'], string]>([
    ['Z up, as from Blender', { min: [-1.8, -2.1, 0], max: [1.8, 2.1, 2.6] }, '4.20'],
    ['centimeters', { min: [-180, 0, -210], max: [180, 260, 210] }, '260.00'],
    ['too flat for a room', { min: [-1.8, 0, -2.1], max: [1.8, 1.2, 2.1] }, '1.20'],
  ])('warns when the Y extent is outside 2.0–3.5 m: %s', (_, bounds, height) => {
    const summary = formatSummary({ ...dorm, bounds });
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

  it("doesn't hold a Detail Capture, a close-up of a chair or table, to a room's height", () => {
    const chair = { ...dorm, triangles: 80_000, bounds: { min: [-0.46, 0, -0.55], max: [0.44, 0.75, 0.36] } as ScanStats['bounds'] };
    expect(formatSummary(chair, 'detail')).not.toContain('⚠');
  });

  it('warns when simplify could not bring the mesh under 500k triangles', () => {
    expect(formatSummary({ ...dorm, triangles: 512_000 })).toContain('⚠ 512,000 triangles is over the limit of 500,000.');
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

  it("finds KIRI Engine's OBJ beside its MTL and texture", () => {
    expect(findModel(['model.jpg', 'model.mtl', 'model.obj'])).toBe('model.obj');
  });

  it('fails when the export has no model', () => {
    expect(() => findModel(['scene.mtl', 'texture.png'])).toThrow('No .gltf, .glb or .obj file in the export');
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

  /** Zips paths in tmp into tmp/<zip>. */
  function zip(name: string, ...paths: string[]) {
    execFileSync('zip', ['-qr', name, ...paths], { cwd: tmp });
    return join(tmp, name);
  }

  /** The room as a glTF export: scene.gltf, scene.bin, and a texture, zipped inside a top folder. */
  async function zippedExport() {
    await mkdir(join(tmp, 'polycam-gltf'));
    await io.write(join(tmp, 'polycam-gltf/scene.gltf'), openRoom());
    return zip('polycam-gltf.zip', 'polycam-gltf');
  }

  /**
   * A KIRI Engine LiDAR export, zipped: model.obj, model.mtl and model.png. Its OBJ holds the room's
   * 10 triangles plus a 2 m square of floor beyond the room (x 3–5 m), like the hallway KIRI also saw.
   */
  async function kiriExport() {
    const room = openRoom();
    const [primitive] = room.getRoot().listMeshes()[0].listPrimitives();
    const matrix = room.getRoot().listNodes()[0].getWorldMatrix();
    const position = primitive.getAttribute('POSITION')!;
    const vertices = Array.from({ length: position.getCount() }, (_, i) => {
      const [x, y, z] = position.getElement(i, [] as number[]);
      return [0, 1, 2].map((k) => matrix[k] * x + matrix[4 + k] * y + matrix[8 + k] * z + matrix[12 + k]);
    });
    vertices.push([3, 0, -1], [3, 0, 1], [5, 0, 1], [5, 0, -1]);
    const faces = [...primitive.getIndices()!.getArray()!, 20, 21, 22, 20, 22, 23];
    const obj = [
      'mtllib model.mtl',
      ...vertices.map((v) => `v ${v.join(' ')}`),
      ...vertices.map((_, i) => `vt ${(i % 4) / 4} ${(i % 3) / 3}`),
      'usemtl material_0',
      ...Array.from({ length: faces.length / 3 }, (_, f) => `f ${[0, 1, 2].map((k) => `${faces[3 * f + k] + 1}/${faces[3 * f + k] + 1}`).join(' ')}`),
    ];
    await mkdir(join(tmp, 'kiri'));
    await writeFile(join(tmp, 'kiri/model.obj'), `${obj.join('\n')}\n`);
    // KIRI writes "Tr 1" for its opaque material; the import must not turn the room transparent.
    await writeFile(join(tmp, 'kiri/model.mtl'), 'newmtl material_0\nKd 1 1 1\nTr 1.000000\nillum 1\nmap_Kd model.png\n');
    await writeFile(join(tmp, 'kiri/model.png'), Buffer.from(room.getRoot().listTextures()[0].getImage()!));
    return zip('Scene 1_lidarDataSet.zip', 'kiri');
  }

  it("imports KIRI Engine's zipped OBJ export, with its MTL and texture, as an opaque textured mesh", async () => {
    const { dir, stats } = await importScan({ input: await kiriExport(), scanId: 'kiri-room', scansDir: join(tmp, 'scans') });

    expect(stats.triangles).toBe(12);
    expect(stats.textures.map((texture) => texture.mimeType)).toEqual(['image/webp']);
    expect(stats.bounds.min.map((v) => +v.toFixed(3) + 0)).toEqual([-1.8, 0, -2.1]);
    expect(stats.bounds.max.map((v) => +v.toFixed(3) + 0)).toEqual([5, 2.6, 2.1]);
    const [material] = (await io.read(join(dir, 'room.glb'))).getRoot().listMaterials();
    expect(material.getAlphaMode()).toBe('OPAQUE');
    expect(material.getAlpha()).toBe(1);
  });

  it("crops off what lies outside a floor rectangle in the Capture's own frame, such as the hallway KIRI saw", async () => {
    const { stats } = await importScan({
      input: await kiriExport(), scanId: 'kiri-room', scansDir: join(tmp, 'scans'), crop: [-2, -2.5, 2, 2.5],
    });

    expect(stats.triangles).toBe(10);
    expect(stats.bounds.max.map((v) => +v.toFixed(3) + 0)).toEqual([1.8, 2.6, 2.1]);
  });

  it('turns a zipped glTF export into a Scan folder with room.glb and manifest.json', async () => {
    const { dir, stats } = await importScan({
      input: await zippedExport(), scanId: 'test-room', name: 'Test room', scansDir: join(tmp, 'scans'),
    });

    expect(dir).toBe(join(tmp, 'scans/test-room'));
    expect(JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'))).toEqual({
      version: 1, id: 'test-room', name: 'Test room', mesh: 'room.glb', meshTransform: { position: [0, 0, 0], rotationY: 0 },
    });
    expect(stats.triangles).toBe(10);
    expect(stats.textures.map((texture) => texture.mimeType)).toEqual(['image/webp']);
  });

  it('unpacks the Raw Data zip into raw/ without its top folder, so raw/ holds keyframes/ for msplat-train', async () => {
    await mkdir(join(tmp, 'rawdata/keyframes/images'), { recursive: true });
    await writeFile(join(tmp, 'rawdata/keyframes/images/1.jpg'), 'jpeg');
    // A zip made on a Mac also holds __MACOSX/, which would hide that rawdata/ is the only folder.
    await mkdir(join(tmp, '__MACOSX/rawdata'), { recursive: true });
    await writeFile(join(tmp, '__MACOSX/rawdata/._keyframes'), 'resource fork');
    const raw = zip('rawdata.zip', 'rawdata', '__MACOSX');

    const { dir } = await importScan({ input: await zippedExport(), scanId: 'test-room', raw, scansDir: join(tmp, 'scans') });

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

  it('adds Fill Captures to an existing Scan, keeping the Main Capture as captures/main.glb', async () => {
    const options = { input: await zippedExport(), scanId: 'test-room', scansDir: join(tmp, 'scans') };
    await importScan(options);
    const dir = join(tmp, 'scans/test-room');
    const leveled = { ...JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8')), meshTransform: { position: [0, -1, 0], rotationY: 0.5 } };
    await writeFile(join(dir, 'manifest.json'), JSON.stringify(leveled));
    const room = await readFile(join(dir, 'room.glb'));

    const first = await importScan({ ...options, fill: true });
    const second = await importScan({ ...options, fill: true });

    expect([first.mesh, second.mesh]).toEqual(['captures/fill-1.glb', 'captures/fill-2.glb']);
    const identity = { position: [0, 0, 0], rotationY: 0 };
    expect(JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'))).toEqual({
      ...leveled,
      captures: {
        main: 'captures/main.glb',
        fills: [
          { mesh: 'captures/fill-1.glb', transform: identity, moved: [] },
          { mesh: 'captures/fill-2.glb', transform: identity, moved: [] },
        ],
      },
    });
    expect(await readFile(join(dir, 'captures/main.glb'))).toEqual(room);
    expect(await readFile(join(dir, 'room.glb'))).toEqual(room);
    expect(second.stats.triangles).toBe(10);
  });

  it('adds a Detail Capture, decimated to at most 80,000 triangles, to an existing Scan', async () => {
    const options = { input: await zippedExport(), scanId: 'test-room', scansDir: join(tmp, 'scans') };
    await importScan(options);
    const dir = join(tmp, 'scans/test-room');
    // 88,200 triangles, too rough for the import's near-lossless first pass to remove many.
    await io.write(join(tmp, 'close-up.glb'), bumpyFloor(210, 5));

    const { mesh, stats } = await importScan({ ...options, input: join(tmp, 'close-up.glb'), detail: true });

    expect(mesh).toBe('captures/detail-1.glb');
    expect(stats.triangles).toBeLessThanOrEqual(80_000);
    expect(stats.triangles).toBeGreaterThan(60_000);
    expect(JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8')).captures).toEqual({
      main: 'captures/main.glb',
      fills: [],
      details: [{ mesh: 'captures/detail-1.glb', transform: { position: [0, 0, 0], rotationY: 0 }, originalIds: [] }],
    });
    expect(await readFile(join(dir, 'captures/main.glb'))).toEqual(await readFile(join(dir, 'room.glb')));
  });

  it('refuses a Fill Capture for a Scan that has no Main Capture yet', async () => {
    await expect(importScan({ input: await zippedExport(), scanId: 'nowhere', scansDir: join(tmp, 'scans'), fill: true }))
      .rejects.toThrow('There is no Scan "nowhere" yet. Import its Main Capture first, without --fill.');
  });
});
