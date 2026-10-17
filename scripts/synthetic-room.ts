// A synthetic dorm Scan to build against before the real one exists: data/scans/synthetic/.
// Run: npx tsx scripts/synthetic-room.ts
//
// It builds the room in the room frame (meters, +Y up, floor at y = 0), saves it as a raw .glb, and imports
// that with scan-import, so room.glb goes through the same pipeline as a Polycam export. It also writes the
// room's true setup.json, which Room Setup (#8) can be checked against.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Document, type TypedArray } from '@gltf-transform/core';
import { PNG } from 'pngjs';
import type { Box, Hex, Opening, Original, RoomSetup, Vec2, Vec3, Wall } from '../shared/types';
import { formatSummary, importScan, io, writeJson } from './scan-import';

const SCAN_ID = 'synthetic';
const NAME = 'Synthetic dorm (3.6 × 4.2 m)';
const [W, D, H] = [3.6, 4.2, 2.6]; // room width (x), depth (z), height (y), centered on the origin
const CELL = 0.05; // Room Setup's auto-box grows over 5 cm voxels of vertices, so no gap may be wider
const NOISE = 0.002; // ±2 mm along the normal, like a scan, so simplify can't flatten the cells away
const TEXTURE_SIZE = 128;

type Rgb = [r: number, g: number, b: number];
/** A rectangle in a grid's 0–1 coordinates. */
type Rect = [s0: number, t0: number, s1: number, t1: number];

/** One primitive of the room (the floor, the ceiling, a wall, or an Original's Part), with its own noise texture. */
interface Shape { name: string; texture: PNG; positions: number[]; uvs: number[]; indices: number[] }

/** Deterministic random numbers in [0, 1), so re-running gives the same files (mulberry32). */
function seededRandom(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
}
const noise = seededRandom(1);

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
/** Rotates about +Y the three.js way: +Z turns toward +X for a positive angle. */
const rotateY = ([x, y, z]: Vec3, angle: number): Vec3 => [
  x * Math.cos(angle) + z * Math.sin(angle), y, -x * Math.sin(angle) + z * Math.cos(angle),
];

/**
 * Adds the rectangle corner + s·u + t·v (s, t in 0–1) as a grid of cells no larger than CELL, facing u × v.
 * Cells whose center is in one of the Openings are left out. The texture spans the whole rectangle.
 */
function addGrid(shape: Shape, corner: Vec3, u: Vec3, v: Vec3, openingRects: Rect[] = []) {
  const [nu, nv] = [u, v].map((edge) => Math.ceil(Math.hypot(...edge) / CELL - 1e-9));
  const normal = cross(u, v);
  const unitNormal = scale(normal, 1 / Math.hypot(...normal));
  const first = shape.positions.length / 3;
  for (let j = 0; j <= nv; j++) {
    for (let i = 0; i <= nu; i++) {
      const edge = i === 0 || j === 0 || i === nu || j === nv; // edges stay put, so boxes and walls meet exactly
      const offset = edge ? 0 : NOISE * (2 * noise() - 1);
      shape.positions.push(...add(add(corner, add(scale(u, i / nu), scale(v, j / nv))), scale(unitNormal, offset)));
      shape.uvs.push(i / nu, 1 - j / nv);
    }
  }
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const [s, t] = [(i + 0.5) / nu, (j + 0.5) / nv];
      if (openingRects.some(([s0, t0, s1, t1]) => s > s0 && s < s1 && t > t0 && t < t1)) continue;
      const a = first + j * (nu + 1) + i;
      const c = a + nu + 2;
      shape.indices.push(a, a + 1, c, a, c, c - 1);
    }
  }
}

/** Adds the outside of the box min–max, given in an Original's frame, placed by its Box. */
function addBox(shape: Shape, [x0, y0, z0]: Vec3, [x1, y1, z1]: Vec3, { position, rotationY }: Box, raised = false) {
  const [dx, dy, dz] = [x1 - x0, y1 - y0, z1 - z0];
  const faces: [Vec3, Vec3, Vec3][] = [
    [[x0, y1, z1], [dx, 0, 0], [0, 0, -dz]], // top
    [[x0, y0, z1], [dx, 0, 0], [0, dy, 0]], // front
    [[x1, y0, z0], [-dx, 0, 0], [0, dy, 0]], // back
    [[x1, y0, z1], [0, 0, -dz], [0, dy, 0]], // right
    [[x0, y0, z0], [0, 0, dz], [0, dy, 0]], // left
  ];
  // Only a raised box has a bottom: a scanner never sees the bottom of one that rests on something.
  if (raised) faces.push([[x0, y0, z0], [dx, 0, 0], [0, 0, dz]]);
  for (const [corner, u, v] of faces) addGrid(shape, add(rotateY(corner, rotationY), position), rotateY(u, rotationY), rotateY(v, rotationY));
}

/* ───────────── The room, as Room Setup should find it ───────────── */

const corners: Vec2[] = [[-W / 2, -D / 2], [W / 2, -D / 2], [W / 2, D / 2], [-W / 2, D / 2]];
const walls: Wall[] = ['North', 'East', 'South', 'West'].map((facing, i) => {
  const [start, end] = [corners[i], corners[(i + 1) % 4]];
  const length = Math.hypot(end[0] - start[0], end[1] - start[1]);
  // Corners go clockwise seen from above, so the inward normal is the edge direction turned right.
  const normal: Vec2 = [-(end[1] - start[1]) / length, (end[0] - start[0]) / length];
  return { id: `wl_${i + 1}`, name: `${facing} wall`, start, end, normal, height: H };
});
const openings: Opening[] = [
  { id: 'op_1', kind: 'window', wallId: 'wl_1', offset: 1.8, width: 1.2, bottom: 0.9, height: 1.2 },
  { id: 'op_2', kind: 'door', wallId: 'wl_3', offset: 0.3, width: 0.9, bottom: 0, height: 2.05, swing: 'in-right' },
];

/** An Original, with its Parts as boxes in its own frame: bottom-center origin, +Z front. */
interface Furniture {
  original: Omit<Original, 'floorColor'>;
  parts: { name: string; color: Rgb; boxes: [Vec3, Vec3][]; raised?: boolean }[];
}

/** Four legs of a square section, inset from a w × d footprint. */
const legs = (w: number, d: number, side: number, height: number): [Vec3, Vec3][] =>
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz]) => {
    const [x, z] = [sx * ((w - side) / 2 - 0.02), sz * ((d - side) / 2 - 0.02)];
    return [[x - side / 2, 0, z - side / 2], [x + side / 2, height, z + side / 2]];
  });

// Furniture stands 3 cm off the walls, as in a real room.
const furniture: Furniture[] = [
  {
    original: {
      id: 'og_bed', label: 'Bed', category: 'bed', kept: true,
      box: { position: [-1.27, 0, -1.045], size: [1, 0.6, 2.05], rotationY: 0 },
    },
    parts: [
      { name: 'Bed frame', color: [107, 79, 58], boxes: [[[-0.5, 0, -1.025], [0.5, 0.4, 1.025]]] },
      { name: 'Mattress', color: [196, 208, 222], boxes: [[[-0.495, 0.4, -1.015], [0.495, 0.6, 1.015]]] },
    ],
  },
  {
    original: {
      id: 'og_desk', label: 'Desk', category: 'desk', kept: false,
      box: { position: [0.6, 0, -1.77], size: [1.2, 0.75, 0.6], rotationY: 0 },
    },
    parts: [
      { name: 'Desk top', color: [190, 150, 105], boxes: [[[-0.6, 0.72, -0.3], [0.6, 0.75, 0.3]]], raised: true },
      { name: 'Desk legs', color: [60, 60, 64], boxes: legs(1.2, 0.6, 0.04, 0.72) },
    ],
  },
  {
    // Faces the desk, so its front is -Z in the room.
    original: {
      id: 'og_chair', label: 'Chair', category: 'chair', kept: false,
      box: { position: [0.6, 0, -1.145], size: [0.45, 0.9, 0.45], rotationY: Math.PI },
    },
    parts: [
      { name: 'Chair seat', color: [60, 84, 120], boxes: [[[-0.225, 0.4, -0.225], [0.225, 0.45, 0.225]]], raised: true },
      { name: 'Chair back', color: [70, 94, 130], boxes: [[[-0.225, 0.45, -0.225], [0.225, 0.9, -0.195]]] },
      { name: 'Chair legs', color: [48, 48, 52], boxes: legs(0.45, 0.45, 0.03, 0.4) },
    ],
  },
  {
    // Against the East wall, so its front is -X in the room.
    original: {
      id: 'og_dresser', label: 'Dresser', category: 'dresser', kept: true,
      box: { position: [1.52, 0, 0], size: [0.8, 0.75, 0.5], rotationY: -Math.PI / 2 },
    },
    parts: [{ name: 'Dresser', color: [120, 88, 62], boxes: [[[-0.4, 0, -0.25], [0.4, 0.75, 0.25]]] }],
  },
];

/* ───────────── Geometry and textures ───────────── */

let textureSeed = 0;
const shape = (name: string, color: Rgb): Shape =>
  ({ name, texture: noiseTexture(color, ++textureSeed), positions: [], uvs: [], indices: [] });

function buildShapes(): Shape[] {
  const floor = shape('Floor', [176, 141, 106]);
  addGrid(floor, [-W / 2, 0, D / 2], [W, 0, 0], [0, 0, -D]);
  const ceiling = shape('Ceiling', [236, 234, 228]);
  addGrid(ceiling, [-W / 2, H, -D / 2], [W, 0, 0], [0, 0, D]);

  const wallColors: Rgb[] = [[224, 218, 206], [218, 214, 204], [226, 220, 210], [220, 216, 206]];
  const wallShapes = walls.map((wall, i) => {
    const wallShape = shape(wall.name, wallColors[i]);
    const [dx, dz] = [wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]];
    const length = Math.hypot(dx, dz);
    const openingRects = openings
      .filter((opening) => opening.wallId === wall.id)
      .map(({ offset, width, bottom, height }): Rect => [offset / length, bottom / H, (offset + width) / length, (bottom + height) / H]);
    // Along the wall from start to end, then up: that faces the inward normal.
    addGrid(wallShape, [wall.start[0], 0, wall.start[1]], [dx, 0, dz], [0, H, 0], openingRects);
    return wallShape;
  });

  const partShapes = furniture.flatMap(({ original, parts }) =>
    parts.map(({ name, color, boxes, raised }) => {
      const partShape = shape(name, color);
      for (const [min, max] of boxes) addBox(partShape, min, max, original.box, raised);
      return partShape;
    }));
  return [floor, ceiling, ...wallShapes, ...partShapes];
}

/**
 * Noise around the shape's color under a soft brightness gradient, so luminance sampling reads something.
 * The grains are 2 px and ±10%: finer or fainter noise doesn't survive WebP on dark colors.
 */
function noiseTexture(color: Rgb, seed: number): PNG {
  const png = new PNG({ width: TEXTURE_SIZE, height: TEXTURE_SIZE });
  const random = seededRandom(seed);
  const grains = Array.from({ length: (TEXTURE_SIZE / 2) ** 2 }, () => 0.9 + 0.2 * random());
  for (let y = 0; y < TEXTURE_SIZE; y++) {
    for (let x = 0; x < TEXTURE_SIZE; x++) {
      const grain = grains[(y >> 1) * (TEXTURE_SIZE / 2) + (x >> 1)];
      const brightness = (0.8 + (0.2 * (x + y)) / (2 * (TEXTURE_SIZE - 1))) * grain;
      const i = (y * TEXTURE_SIZE + x) * 4;
      color.forEach((channel, c) => (png.data[i + c] = Math.min(255, Math.round(channel * brightness))));
      png.data[i + 3] = 255;
    }
  }
  return png;
}

function buildDocument(shapes: Shape[]): Document {
  const document = new Document();
  const buffer = document.createBuffer();
  const scene = document.createScene('Room');
  const accessor = (type: 'VEC3' | 'VEC2' | 'SCALAR', array: TypedArray) =>
    document.createAccessor().setType(type).setArray(array).setBuffer(buffer);
  for (const { name, texture: png, positions, uvs, indices } of shapes) {
    const texture = document.createTexture(name).setImage(PNG.sync.write(png)).setMimeType('image/png');
    const primitive = document.createPrimitive()
      .setAttribute('POSITION', accessor('VEC3', new Float32Array(positions)))
      .setAttribute('TEXCOORD_0', accessor('VEC2', new Float32Array(uvs)))
      .setIndices(accessor('SCALAR', new Uint32Array(indices)))
      .setMaterial(document.createMaterial(name).setBaseColorTexture(texture).setMetallicFactor(0).setRoughnessFactor(1));
    scene.addChild(document.createNode(name).setMesh(document.createMesh(name).addPrimitive(primitive)));
  }
  return document;
}

/**
 * The average floor color within 15 cm of an Original's footprint, as Room Setup's Bake step measures it.
 * The floor's texture spans the room: u runs with +X, v with +Z.
 */
function floorColor({ position, size, rotationY }: Box, floorTexture: PNG): Hex {
  const sum = [0, 0, 0];
  let count = 0;
  for (let x = -W / 2; x <= W / 2; x += 0.01) {
    for (let z = -D / 2; z <= D / 2; z += 0.01) {
      const [lx, , lz] = rotateY([x - position[0], 0, z - position[2]], -rotationY);
      const distance = Math.hypot(Math.max(Math.abs(lx) - size[0] / 2, 0), Math.max(Math.abs(lz) - size[2] / 2, 0));
      if (distance === 0 || distance > 0.15) continue;
      const [px, py] = [(x + W / 2) / W, (z + D / 2) / D].map((t) => Math.round(t * (TEXTURE_SIZE - 1)));
      for (let c = 0; c < 3; c++) sum[c] += floorTexture.data[(py * TEXTURE_SIZE + px) * 4 + c];
      count++;
    }
  }
  return `#${sum.map((channel) => Math.round(channel / count).toString(16).padStart(2, '0')).join('')}`;
}

const shapes = buildShapes();
const floorTexture = shapes.find((s) => s.name === 'Floor')!.texture;
const setup: RoomSetup = {
  version: 1,
  scanId: SCAN_ID,
  ceilingHeight: H,
  floor: { polygon: corners },
  walls,
  openings,
  originals: furniture.map(({ original }) => ({ ...original, floorColor: floorColor(original.box, floorTexture) })),
};

const exportDir = await mkdtemp(join(tmpdir(), 'synthetic-room-'));
try {
  await io.write(join(exportDir, 'synthetic.glb'), buildDocument(shapes));
  const { dir, stats } = await importScan({ input: join(exportDir, 'synthetic.glb'), scanId: SCAN_ID, name: NAME, force: true });
  await writeJson(join(dir, 'setup.json'), setup);
  console.log(`Wrote ${dir}: room.glb, manifest.json, and setup.json\n\n${formatSummary(stats)}`);
} finally {
  await rm(exportDir, { recursive: true, force: true });
}
