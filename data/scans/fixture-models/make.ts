// The fixture-models test Scan (#79): lounge-v2's shape before its files exist. Run: npx tsx data/scans/fixture-models/make.ts,
// then scripts/splat.sh data/scans/fixture-models/splat.ply --scan fixture-models (only the splat.spz is committed).
//
// - room.glb: an empty box room the size of the study lounge, in lounge-v1's room frame, with its walls,
//   window and door painted into the images. Nothing stands in it: it plays the Empty Room.
// - splat.ply: a thin splat over most of the floor, a little brighter than the mesh, so the splat on top shows.
// - models/chair.glb (seat, back, legs), models/table.glb (top, legs), models/whiteboard.glb (board, frame):
//   Master Copies, each with a soft `shadow` node.
// - setup.json: the room, and Chair 1 and Chair 2, Table 1 and the Whiteboard, drawn from those files.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Document, NodeIO, type TypedArray } from '@gltf-transform/core';
import { PNG } from 'pngjs';
import type { Opening, Original, RoomSetup, ScanManifest, Vec2, Vec3, Wall } from '../../../shared/types';

const DIR = dirname(fileURLToPath(import.meta.url));
const ID = 'fixture-models';

/* ───────────── The room: lounge-v1's frame ───────────── */

const [X0, X1, Z0, Z1, H] = [-1.568, 1.55, -3.545, 3.673, 2.431];
const corners: Vec2[] = [[X0, Z0], [X1, Z0], [X1, Z1], [X0, Z1]];
const NAMES = ['North wall', 'East wall', 'South wall', 'West wall'];
const walls: Wall[] = corners.map((start, i) => {
  const end = corners[(i + 1) % 4];
  const length = Math.hypot(end[0] - start[0], end[1] - start[1]);
  const normal: Vec2 = [(start[1] - end[1]) / length, (end[0] - start[0]) / length];
  return { id: `wl_${i + 1}`, name: NAMES[i], start, end, normal, height: H };
});
const openings: Opening[] = [
  { id: 'op_1', kind: 'window', wallId: 'wl_1', offset: 0.508, width: 1.717, bottom: 0.861, height: 1.467 },
  { id: 'op_2', kind: 'door', wallId: 'wl_4', offset: 0.053, width: 1.731, bottom: 0, height: 2.247, swing: 'none' },
];

/* ───────────── Images ───────────── */

type Rgb = [number, number, number];

function seeded(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

function image(width: number, height: number, texel: (u: number, v: number) => [...Rgb, number?]): Buffer {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a = 255] = texel((x + 0.5) / width, (y + 0.5) / height);
      png.data.set([r, g, b, a].map((c) => Math.max(0, Math.min(255, Math.round(c)))), 4 * (y * width + x));
    }
  }
  return PNG.sync.write(png);
}

const shade = ([r, g, b]: Rgb, k: number): Rgb => [r * k, g * k, b * k];

/** Oak planks 12 cm wide running along z, one meter of floor per repeat: u is x, v is z. */
function plank(u: number, v: number, brighter = 1): Rgb {
  const index = Math.floor(u / 0.12);
  const tone = 0.85 + 0.3 * seeded(index * 7919 + 1)();
  const seam = (u / 0.12) % 1 < 0.04 || (v + 0.37 * index) % 1 < 0.01 ? 0.6 : 1;
  const grain = 0.94 + 0.06 * Math.sin(v * 140 + index * 3);
  return shade([176, 141, 100], tone * seam * grain * brighter);
}

const random = seeded(42);
const noise = (amount: number) => 1 + amount * (random() - 0.5);

/** A wall's image, over the whole wall: teal paint, lighter near the ceiling, with its Openings painted in. */
function wallImage(wall: Wall): Buffer {
  const length = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]);
  const mine = openings.filter((o) => o.wallId === wall.id);
  return image(Math.round(length * 128), Math.round(H * 128), (u, v) => {
    const [along, y] = [u * length, (1 - v) * H];
    for (const o of mine) {
      if (along < o.offset || along > o.offset + o.width || y < o.bottom || y > o.bottom + o.height) continue;
      const frame = along < o.offset + 0.05 || along > o.offset + o.width - 0.05 || y > o.bottom + o.height - 0.05
        || (o.kind === 'window' && y < o.bottom + 0.05);
      if (frame) return shade([228, 226, 220], noise(0.04));
      return o.kind === 'window' ? shade([214, 216, 218], (0.95 + 0.05 * y) * noise(0.02)) : shade([150, 110, 72], noise(0.06));
    }
    if (y < 0.1) return shade([240, 238, 232], noise(0.04));   // the baseboard
    return shade([74, 132, 134], (0.78 + 0.22 * (y / H)) * noise(0.05));
  });
}

/** A Part's image: its color, lit from above, so a Recolor has light and shade to keep. */
const partImage = (color: Rgb, grain = 0.06) => image(64, 64, (_u, v) => shade(color, (1.15 - 0.4 * v) * noise(grain)));

/** A soft shadow: black, darkest in the middle, clear at the edge. */
const shadowImage = (darkest: number) => image(128, 128, (u, v) => {
  const r = Math.hypot(2 * u - 1, 2 * v - 1);
  const t = Math.min(Math.max((r - 0.35) / 0.65, 0), 1);
  return [0, 0, 0, 255 * darkest * (1 - t * t * (3 - 2 * t))];
});

/* ───────────── Geometry ───────────── */

interface Shape { positions: number[]; uvs: number[]; indices: number[] }
const empty = (): Shape => ({ positions: [], uvs: [], indices: [] });

/** A grid of quads from `origin` along `u` and `v`, facing `normal`, with UVs from uvOf(s, t) over 0–1. */
function grid(shape: Shape, origin: Vec3, u: Vec3, v: Vec3, normal: Vec3, step: number, uvOf: (s: number, t: number) => Vec2) {
  const len = (a: Vec3) => Math.hypot(...a);
  const [nu, nv] = [Math.max(1, Math.ceil(len(u) / step)), Math.max(1, Math.ceil(len(v) / step))];
  const cross: Vec3 = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const flip = cross[0] * normal[0] + cross[1] * normal[1] + cross[2] * normal[2] < 0;
  const base = shape.positions.length / 3;
  for (let j = 0; j <= nv; j++) {
    for (let i = 0; i <= nu; i++) {
      const [s, t] = [i / nu, j / nv];
      shape.positions.push(...[0, 1, 2].map((k) => origin[k] + u[k] * s + v[k] * t));
      shape.uvs.push(...uvOf(s, t));
    }
  }
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const [a, b, c, d] = [j * (nu + 1) + i, j * (nu + 1) + i + 1, (j + 1) * (nu + 1) + i + 1, (j + 1) * (nu + 1) + i].map((n) => n + base);
      shape.indices.push(...(flip ? [a, c, b, a, d, c] : [a, b, c, a, c, d]));
    }
  }
}

/** A box from min to max, each face with UVs over its whole image. */
function box(shape: Shape, [x0, y0, z0]: Vec3, [x1, y1, z1]: Vec3) {
  const [w, h, d] = [x1 - x0, y1 - y0, z1 - z0];
  const uv = (s: number, t: number): Vec2 => [s, t];
  grid(shape, [x0, y1, z0], [w, 0, 0], [0, 0, d], [0, 1, 0], 10, uv);
  grid(shape, [x0, y0, z0], [w, 0, 0], [0, 0, d], [0, -1, 0], 10, uv);
  grid(shape, [x0, y1, z1], [w, 0, 0], [0, -h, 0], [0, 0, 1], 10, uv);
  grid(shape, [x0, y1, z0], [w, 0, 0], [0, -h, 0], [0, 0, -1], 10, uv);
  grid(shape, [x1, y1, z0], [0, 0, d], [0, -h, 0], [1, 0, 0], 10, uv);
  grid(shape, [x0, y1, z0], [0, 0, d], [0, -h, 0], [-1, 0, 0], 10, uv);
}

/** A flat quad: on the floor (y up) or, with `upright`, standing in the z = `at` plane facing +Z. */
function quad(width: number, depth: number, at: number, upright = false): Shape {
  const shape = empty();
  const uv = (s: number, t: number): Vec2 => [s, t];
  if (upright) grid(shape, [-width / 2, at + depth / 2, 0], [width, 0, 0], [0, -depth, 0], [0, 0, 1], 10, uv);
  else grid(shape, [-width / 2, at, -depth / 2], [width, 0, 0], [0, 0, depth], [0, 1, 0], 10, uv);
  return shape;
}

/* ───────────── glTF ───────────── */

interface Node { name: string; shape: Shape; image: Buffer; blend?: boolean; translation?: Vec3 }

function glb(nodes: Node[]) {
  const document = new Document();
  const buffer = document.createBuffer();
  const scene = document.createScene();
  const accessor = (type: 'VEC3' | 'VEC2' | 'SCALAR', array: TypedArray) => document.createAccessor().setType(type).setArray(array).setBuffer(buffer);
  for (const { name, shape, image: png, blend, translation } of nodes) {
    const texture = document.createTexture(name).setImage(png).setMimeType('image/png');
    const material = document.createMaterial(name).setBaseColorTexture(texture).setMetallicFactor(0).setRoughnessFactor(1);
    if (blend) material.setAlphaMode('BLEND');
    const primitive = document.createPrimitive()
      .setAttribute('POSITION', accessor('VEC3', new Float32Array(shape.positions)))
      .setAttribute('TEXCOORD_0', accessor('VEC2', new Float32Array(shape.uvs)))
      .setIndices(accessor('SCALAR', new Uint32Array(shape.indices)))
      .setMaterial(material);
    const node = document.createNode(name).setMesh(document.createMesh(name).addPrimitive(primitive));
    if (translation) node.setTranslation(translation);
    scene.addChild(node);
  }
  return new NodeIO().writeBinary(document);
}

function roomNodes(): Node[] {
  const [W, D] = [X1 - X0, Z1 - Z0];
  const floor = empty();
  grid(floor, [X0, 0, Z0], [W, 0, 0], [0, 0, D], [0, 1, 0], 0.25, (s, t) => [X0 + s * W, Z0 + t * D]);
  const ceiling = empty();
  grid(ceiling, [X0, H, Z0], [W, 0, 0], [0, 0, D], [0, -1, 0], 0.25, (s, t) => [s * W, t * D]);
  const nodes: Node[] = [
    { name: 'Floor', shape: floor, image: image(256, 256, (u, v) => plank(u, v)) },
    { name: 'Ceiling', shape: ceiling, image: image(64, 64, () => shade([236, 234, 228], noise(0.03))) },
  ];
  for (const wall of walls) {
    const shape = empty();
    const [sx, sz] = wall.start;
    grid(shape, [sx, H, sz], [wall.end[0] - sx, 0, wall.end[1] - sz], [0, -H, 0], [wall.normal[0], 0, wall.normal[1]], 0.25, (s, t) => [s, t]);
    nodes.push({ name: wall.name, shape, image: wallImage(wall) });
  }
  return nodes;
}

/** A thin splat over the floor, flat and a little brighter than the mesh, with a 60 cm hole by the door where the mesh shows. */
function floorSplat(): Buffer {
  const SH_C0 = 0.28209479177387814;
  const STEP = 0.025;
  const rows: number[][] = [];
  for (let x = X0 + STEP / 2; x < X1; x += STEP) {
    for (let z = Z0 + STEP / 2; z < Z1; z += STEP) {
      if (x < X0 + 0.9 && z > Z1 - 1.2 && z < Z1 - 0.6) continue;
      const color = plank(((x % 1) + 1) % 1, ((z % 1) + 1) % 1, 1.12);
      rows.push([
        x, 0, z, ...color.map((c) => (Math.min(c, 255) / 255 - 0.5) / SH_C0),
        Math.log(0.95 / 0.05), Math.log(STEP * 0.6), Math.log(0.001), Math.log(STEP * 0.6), 1, 0, 0, 0,
      ]);
    }
  }
  const properties = ['x', 'y', 'z', 'f_dc_0', 'f_dc_1', 'f_dc_2', 'opacity', 'scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3'];
  const header = ['ply', 'format binary_little_endian 1.0', `element vertex ${rows.length}`, ...properties.map((p) => `property float ${p}`), 'end_header', ''].join('\n');
  return Buffer.concat([Buffer.from(header, 'latin1'), Buffer.from(new Float32Array(rows.flat()).buffer)]);
}

/* ───────────── Master Copies: meters, +Y up, +Z front, origin at the footprint's center ───────────── */

function chair(): Node[] {
  const seat = empty();
  box(seat, [-0.23, 0.43, -0.22], [0.23, 0.48, 0.22]);
  const back = empty();
  box(back, [-0.22, 0.5, -0.24], [0.22, 0.9, -0.2]);
  const legs = empty();
  for (const [x, z] of [[-0.2, -0.19], [0.2, -0.19], [-0.2, 0.19], [0.2, 0.19]]) box(legs, [x - 0.015, 0, z - 0.015], [x + 0.015, 0.43, z + 0.015]);
  box(legs, [-0.2, 0.46, -0.235], [0.2, 0.5, -0.2]);   // the bracket that holds the back
  return [
    { name: 'seat', shape: seat, image: partImage([58, 92, 140], 0.12) },
    { name: 'back', shape: back, image: partImage([58, 92, 140], 0.12) },
    { name: 'legs', shape: legs, image: partImage([70, 70, 72]) },
    { name: 'shadow', shape: quad(0.75, 0.75, 0.002), image: shadowImage(0.5), blend: true },
  ];
}

function table(): Node[] {
  const top = empty();
  box(top, [-0.6, 0.72, -0.375], [0.6, 0.75, 0.375]);
  const legs = empty();
  for (const [x, z] of [[-0.55, -0.32], [0.55, -0.32], [-0.55, 0.32], [0.55, 0.32]]) box(legs, [x - 0.02, 0, z - 0.02], [x + 0.02, 0.72, z + 0.02]);
  return [
    { name: 'top', shape: top, image: partImage([214, 206, 190], 0.04) },
    { name: 'legs', shape: legs, image: partImage([150, 152, 156]) },
    { name: 'shadow', shape: quad(1.45, 1.0, 0.002), image: shadowImage(0.45), blend: true },
  ];
}

function whiteboard(): Node[] {
  const board = empty();
  box(board, [-0.88, 0.02, -0.02], [0.88, 1.18, 0]);
  const frame = empty();
  box(frame, [-0.9, 0, -0.02], [0.9, 0.02, 0.01]);
  box(frame, [-0.9, 1.18, -0.02], [0.9, 1.2, 0.01]);
  box(frame, [-0.9, 0.02, -0.02], [-0.88, 1.18, 0.01]);
  box(frame, [0.88, 0.02, -0.02], [0.9, 1.18, 0.01]);
  box(frame, [-0.6, -0.02, -0.02], [0.6, 0, 0.06]);   // the tray
  return [
    { name: 'board', shape: board, image: partImage([246, 246, 244], 0.03) },
    { name: 'frame', shape: frame, image: partImage([190, 192, 196]) },
    { name: 'shadow', shape: quad(2.0, 1.45, 0.55, true), image: shadowImage(0.35), blend: true, translation: [0, 0, -0.019] },
  ];
}

/* ───────────── Setup ───────────── */

const original = (id: string, label: string, category: Original['category'], model: string, position: Vec3, size: Vec3, rotationY: number): Original =>
  ({ id, label, category, model, box: { position, size, rotationY }, kept: false, floorColor: '#b08d64' });

const setup: RoomSetup = {
  version: 1,
  scanId: ID,
  ceilingHeight: H,
  floor: { polygon: corners },
  walls,
  openings,
  originals: [
    original('og_chair_1', 'Chair 1', 'chair', 'models/chair.glb', [-0.15, 0, -1.9], [0.5, 0.9, 0.5], -Math.PI / 2),
    original('og_chair_2', 'Chair 2', 'chair', 'models/chair.glb', [-0.15, 0, -1.3], [0.5, 0.9, 0.5], -Math.PI / 2),
    original('og_table_1', 'Table 1', 'table', 'models/table.glb', [-0.8, 0, -1.6], [1.2, 0.75, 0.75], Math.PI / 2),
    original('og_whiteboard', 'Whiteboard', 'wall_art', 'models/whiteboard.glb', [1.53, 0.9, 0], [1.8, 1.24, 0.08], -Math.PI / 2),
  ],
};

const manifest: ScanManifest = {
  version: 1,
  id: ID,
  name: 'Test room with Master Copies',
  mesh: 'room.glb',
  meshTransform: { position: [0, 0, 0], rotationY: 0 },
  splat: 'splat.spz',
  splatTransform: { position: [0, 0, 0], rotationY: 0, scale: 1 },
};

await mkdir(join(DIR, 'models'), { recursive: true });
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
await writeFile(join(DIR, 'manifest.json'), json(manifest));
await writeFile(join(DIR, 'setup.json'), json(setup));
await writeFile(join(DIR, 'room.glb'), await glb(roomNodes()));
await writeFile(join(DIR, 'splat.ply'), floorSplat());
await writeFile(join(DIR, 'models/chair.glb'), await glb(chair()));
await writeFile(join(DIR, 'models/table.glb'), await glb(table()));
await writeFile(join(DIR, 'models/whiteboard.glb'), await glb(whiteboard()));
console.log(`Wrote ${ID}: room.glb, splat.ply, models/{chair,table,whiteboard}.glb, setup.json, manifest.json`);
