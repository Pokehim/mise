// Synthetic Scans to build against before the real ones exist. Run: npx tsx scripts/synthetic-room.ts
//
// - data/scans/synthetic/: a dorm, one Capture.
// - data/scans/synthetic-lounge/: a lounge with a Main Capture and a Fill Capture (ADR-0007). In the
//   Fill Capture the furniture has moved, the exposure is 10% darker, and everything is seen from
//   another frame, as a second walk-through with Polycam would see it.
//
// Each room is built in the room frame (meters, +Y up, floor at y = 0), saved as a raw .glb, and
// imported with scan-import, so it goes through the same pipeline as a Polycam export. The room's true
// setup.json is written too, which Room Setup can be checked against.
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Document, type TypedArray } from '@gltf-transform/core';
import { PNG } from 'pngjs';
import type { Box, Hex, Opening, Original, RoomSetup, ScanManifest, Vec2, Vec3, Wall, YawTransform } from '../shared/types';
import { applyYaw, composeYaw, invertYaw } from '../web/src/setup/geometry/align';
import { formatSummary, importScan, io, writeJson } from './scan-import';
import { mergeScan } from './scan-merge';

const CELL = 0.05; // Room Setup's auto-box grows over 5 cm voxels of vertices, so no gap may be wider
const NOISE = 0.002; // ±2 mm along the normal, like a scan, so simplify can't flatten the cells away
const TEXTURE_SIZE = 128;

type Rgb = [r: number, g: number, b: number];
/** A rectangle in a grid's 0–1 coordinates. */
type Rect = [s0: number, t0: number, s1: number, t1: number];
type Pose = Pick<Box, 'position' | 'rotationY'>;

/** One primitive of the room (the floor, the ceiling, a wall, or an Original's Part), with its own noise texture. */
interface Shape { name: string; texture: PNG; positions: number[]; uvs: number[]; indices: number[] }

/** An Original, with its Parts as boxes in its own frame: bottom-center origin, +Z front. */
interface Furniture {
  original: Omit<Original, 'floorColor'>;
  parts: { name: string; color: Rgb; boxes: [Vec3, Vec3][]; raised?: boolean }[];
}

/** A room: its size (width x, depth z, height y, centered on the origin), Openings, colors and furniture. */
interface Room {
  scanId: string;
  name: string;
  size: Vec3;
  openings: Opening[];
  colors: { floor: Rgb; ceiling: Rgb; walls: Rgb[] };
  furniture: Furniture[];
}

/** How one Capture of a room differs from another: its random seeds, its exposure, and where moved furniture stood. */
interface Capture {
  /** Seeds for the scan noise and the textures, so two Captures of one room differ like two walk-throughs. */
  noiseSeed: number;
  textureSeed: number;
  exposure: number;
  /** Original id → where it stood during this Capture, when it wasn't in its usual place. */
  moved: Record<string, Pose>;
  /**
   * Leave out what a scanner can't see: the floor under furniture that rests on it, the wall behind
   * furniture that stands within 10 cm of it (and 6 cm either side), and furniture faces that face a
   * wall from less than 10 cm away.
   */
  occluded?: boolean;
}

/** Deterministic random numbers in [0, 1), so re-running gives the same files (mulberry32). */
function seededRandom(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
}

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
/** Rotates about +Y the three.js way: +Z turns toward +X for a positive angle. */
const rotateY = ([x, y, z]: Vec3, angle: number): Vec3 => [
  x * Math.cos(angle) + z * Math.sin(angle), y, -x * Math.sin(angle) + z * Math.cos(angle),
];

/** The shapes one Capture of a room sees. */
function captureShapes(room: Room, walls: Wall[], { noiseSeed, textureSeed, exposure, moved, occluded }: Capture): Shape[] {
  const noise = seededRandom(noiseSeed);
  let seed = textureSeed;
  const shape = (name: string, color: Rgb): Shape =>
    ({ name, texture: noiseTexture(color.map((c) => c * exposure) as Rgb, ++seed), positions: [], uvs: [], indices: [] });

  /**
   * Adds the rectangle corner + s·u + t·v (s, t in 0–1) as a grid of cells no larger than CELL, facing u × v.
   * Cells whose center is in one of the Openings are left out. The texture spans the whole rectangle.
   */
  function addGrid(target: Shape, corner: Vec3, u: Vec3, v: Vec3, openingRects: Rect[] = [], hidden?: (center: Vec3) => boolean) {
    const [nu, nv] = [u, v].map((edge) => Math.ceil(Math.hypot(...edge) / CELL - 1e-9));
    const normal = cross(u, v);
    const unitNormal = scale(normal, 1 / Math.hypot(...normal));
    const first = target.positions.length / 3;
    for (let j = 0; j <= nv; j++) {
      for (let i = 0; i <= nu; i++) {
        const edge = i === 0 || j === 0 || i === nu || j === nv; // edges stay put, so boxes and walls meet exactly
        const offset = edge ? 0 : NOISE * (2 * noise() - 1);
        target.positions.push(...add(add(corner, add(scale(u, i / nu), scale(v, j / nv))), scale(unitNormal, offset)));
        target.uvs.push(i / nu, 1 - j / nv);
      }
    }
    for (let j = 0; j < nv; j++) {
      for (let i = 0; i < nu; i++) {
        const [s, t] = [(i + 0.5) / nu, (j + 0.5) / nv];
        if (openingRects.some(([s0, t0, s1, t1]) => s > s0 && s < s1 && t > t0 && t < t1)) continue;
        if (hidden?.(add(corner, add(scale(u, s), scale(v, t))))) continue;
        const a = first + j * (nu + 1) + i;
        const c = a + nu + 2;
        target.indices.push(a, a + 1, c, a, c, c - 1);
      }
    }
  }

  /** Adds the outside of the box min–max, given in an Original's frame, placed where it stands. */
  function addBox(target: Shape, [x0, y0, z0]: Vec3, [x1, y1, z1]: Vec3, { position, rotationY }: Pose, raised = false) {
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
    for (const [corner, u, v] of faces) {
      const [c, ru, rv] = [add(rotateY(corner, rotationY), position), rotateY(u, rotationY), rotateY(v, rotationY)];
      if (occluded && facesNearbyWall(add(c, scale(add(ru, rv), 0.5)), cross(ru, rv))) continue;
      addGrid(target, c, ru, rv);
    }
  }

  /** True when a face centered at `center`, facing `normal`, faces a wall less than 10 cm away. */
  function facesNearbyWall([x, , z]: Vec3, normal: Vec3) {
    const length = Math.hypot(...normal);
    return walls.some(({ start: [sx, sz], normal: [wx, wz] }) =>
      (x - sx) * wx + (z - sz) * wz < 0.1 && (normal[0] * wx + normal[2] * wz) / length < -0.7);
  }

  // Every furniture box where it stands during this Capture, as room-frame bounds (the poses are quarter turns).
  const bounds = room.furniture.flatMap(({ original, parts }) => parts.flatMap(({ boxes }) => boxes.map(([min, max]) => {
    const { position, rotationY } = moved[original.id] ?? original.box;
    const corners = [min[0], max[0]].flatMap((x) => [min[2], max[2]].map((z) => add(rotateY([x, 0, z], rotationY), position)));
    const xs = corners.map((c) => c[0]);
    const zs = corners.map((c) => c[2]);
    return { x0: Math.min(...xs), x1: Math.max(...xs), y0: min[1], y1: max[1], z0: Math.min(...zs), z1: Math.max(...zs) };
  })));
  /** Under a box that rests on the floor. */
  const underFurniture = ([x, , z]: Vec3) => bounds.some((b) => b.y0 === 0 && x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1);
  /**
   * On a wall that runs along X (or Z, with `alongZ`), behind a box less than 10 cm from it: the box's
   * shadow, 6 cm wider than the box on each side.
   */
  const behindFurniture = (alongZ: boolean) => ([x, y, z]: Vec3) => bounds.some((b) => {
    const [along, across] = alongZ ? [z, x] : [x, z];
    const [a0, a1, c0, c1] = alongZ ? [b.z0, b.z1, b.x0, b.x1] : [b.x0, b.x1, b.z0, b.z1];
    return along > a0 - 0.06 && along < a1 + 0.06 && across > c0 - 0.1 && across < c1 + 0.1 && y > b.y0 && y < b.y1;
  });

  const [W, D, H] = room.size;
  const floor = shape('Floor', room.colors.floor);
  addGrid(floor, [-W / 2, 0, D / 2], [W, 0, 0], [0, 0, -D], [], occluded ? underFurniture : undefined);
  const ceiling = shape('Ceiling', room.colors.ceiling);
  addGrid(ceiling, [-W / 2, H, -D / 2], [W, 0, 0], [0, 0, D]);

  const wallShapes = walls.map((wall, i) => {
    const wallShape = shape(wall.name, room.colors.walls[i]);
    const [dx, dz] = [wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]];
    const length = Math.hypot(dx, dz);
    const openingRects = room.openings
      .filter((opening) => opening.wallId === wall.id)
      .map(({ offset, width, bottom, height }): Rect => [offset / length, bottom / H, (offset + width) / length, (bottom + height) / H]);
    // Along the wall from start to end, then up: that faces the inward normal.
    addGrid(wallShape, [wall.start[0], 0, wall.start[1]], [dx, 0, dz], [0, H, 0], openingRects,
      occluded ? behindFurniture(Math.abs(dz) > Math.abs(dx)) : undefined);
    return wallShape;
  });

  const partShapes = room.furniture.flatMap(({ original, parts }) =>
    parts.map(({ name, color, boxes, raised }) => {
      const partShape = shape(name, color);
      for (const [min, max] of boxes) addBox(partShape, min, max, moved[original.id] ?? original.box, raised);
      return partShape;
    }));
  return [floor, ceiling, ...wallShapes, ...partShapes];
}

/** The four walls of a rectangular room, North (−Z) first, clockwise seen from above. */
function roomWalls([W, D, H]: Vec3): { corners: Vec2[]; walls: Wall[] } {
  const corners: Vec2[] = [[-W / 2, -D / 2], [W / 2, -D / 2], [W / 2, D / 2], [-W / 2, D / 2]];
  const walls = ['North', 'East', 'South', 'West'].map((facing, i): Wall => {
    const [start, end] = [corners[i], corners[(i + 1) % 4]];
    const length = Math.hypot(end[0] - start[0], end[1] - start[1]);
    // Corners go clockwise seen from above, so the inward normal is the edge direction turned right.
    const normal: Vec2 = [-(end[1] - start[1]) / length, (end[0] - start[0]) / length];
    return { id: `wl_${i + 1}`, name: `${facing} wall`, start, end, normal, height: H };
  });
  return { corners, walls };
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

/** The shapes as a glTF document, with every vertex moved by `frame`: the room as this Capture's frame sees it. */
function buildDocument(shapes: Shape[], frame?: YawTransform): Document {
  const document = new Document();
  const buffer = document.createBuffer();
  const scene = document.createScene('Room');
  const accessor = (type: 'VEC3' | 'VEC2' | 'SCALAR', array: TypedArray) =>
    document.createAccessor().setType(type).setArray(array).setBuffer(buffer);
  for (const { name, texture: png, positions, uvs, indices } of shapes) {
    const placed = new Float32Array(positions);
    if (frame) {
      for (let i = 0; i < placed.length; i += 3) placed.set(applyYaw(frame, [placed[i], placed[i + 1], placed[i + 2]]), i);
    }
    const texture = document.createTexture(name).setImage(PNG.sync.write(png)).setMimeType('image/png');
    const primitive = document.createPrimitive()
      .setAttribute('POSITION', accessor('VEC3', placed))
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
function floorColor({ position, size, rotationY }: Box, floorTexture: PNG, [W, D]: Vec3): Hex {
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

/** The room's true setup.json. */
function roomSetup(room: Room, walls: Wall[], corners: Vec2[], floorTexture: PNG): RoomSetup {
  return {
    version: 1,
    scanId: room.scanId,
    ceilingHeight: room.size[2],
    floor: { polygon: corners },
    walls,
    openings: room.openings,
    originals: room.furniture.map(({ original }) => ({ ...original, floorColor: floorColor(original.box, floorTexture, room.size) })),
  };
}

/* ───────────── The rooms ───────────── */

/** Four legs of a square section, inset from a w × d footprint. */
const legs = (w: number, d: number, side: number, height: number): [Vec3, Vec3][] =>
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz]) => {
    const [x, z] = [sx * ((w - side) / 2 - 0.02), sz * ((d - side) / 2 - 0.02)];
    return [[x - side / 2, 0, z - side / 2], [x + side / 2, height, z + side / 2]];
  });

/** A sofa or armchair w wide and d deep: a seat base, a back along −Z, and two arms. */
const seating = (w: number, d: number, height: number, color: Rgb, label: string): Furniture['parts'] => [
  { name: `${label} base`, color, boxes: [[[-w / 2, 0, -d / 2], [w / 2, 0.42, d / 2]]] },
  { name: `${label} back`, color: color.map((c) => c * 0.9) as Rgb, boxes: [[[-w / 2, 0.42, -d / 2], [w / 2, height, -d / 2 + 0.22]]] },
  {
    name: `${label} arms`, color: color.map((c) => c * 0.95) as Rgb, boxes: [
      [[-w / 2, 0.42, -d / 2 + 0.22], [-w / 2 + 0.16, 0.62, d / 2]],
      [[w / 2 - 0.16, 0.42, -d / 2 + 0.22], [w / 2, 0.62, d / 2]],
    ],
  },
];

// Furniture stands 3 cm off the walls, as in a real room.
const DORM: Room = {
  scanId: 'synthetic',
  name: 'Synthetic dorm (3.6 × 4.2 m)',
  size: [3.6, 4.2, 2.6],
  openings: [
    { id: 'op_1', kind: 'window', wallId: 'wl_1', offset: 1.8, width: 1.2, bottom: 0.9, height: 1.2 },
    { id: 'op_2', kind: 'door', wallId: 'wl_3', offset: 0.3, width: 0.9, bottom: 0, height: 2.05, swing: 'in-right' },
  ],
  colors: { floor: [176, 141, 106], ceiling: [236, 234, 228], walls: [[224, 218, 206], [218, 214, 204], [226, 220, 210], [220, 216, 206]] },
  furniture: [
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
  ],
};

export const LOUNGE: Room = {
  scanId: 'synthetic-lounge',
  name: 'Synthetic lounge (5.4 × 6 m)',
  size: [5.4, 6, 2.7],
  openings: [
    { id: 'op_1', kind: 'window', wallId: 'wl_1', offset: 1, width: 1.2, bottom: 0.9, height: 1.3 },
    { id: 'op_2', kind: 'window', wallId: 'wl_1', offset: 3.2, width: 1.2, bottom: 0.9, height: 1.3 },
    { id: 'op_3', kind: 'door', wallId: 'wl_3', offset: 0.6, width: 0.9, bottom: 0, height: 2.05, swing: 'in-right' },
  ],
  colors: { floor: [118, 124, 134], ceiling: [238, 236, 232], walls: [[226, 222, 212], [220, 216, 206], [228, 224, 214], [222, 218, 208]] },
  furniture: [
    {
      // Against the West wall, so its front is +X in the room.
      original: {
        id: 'og_sofa', label: 'Sofa', category: 'sofa', kept: false,
        box: { position: [-2.22, 0, 0], size: [2.1, 0.85, 0.9], rotationY: Math.PI / 2 },
      },
      parts: seating(2.1, 0.9, 0.85, [72, 112, 122], 'Sofa'),
    },
    {
      original: {
        id: 'og_coffee_table', label: 'Coffee table', category: 'table', kept: false,
        box: { position: [-0.9, 0, 0], size: [1.1, 0.42, 0.6], rotationY: Math.PI / 2 },
      },
      parts: [
        { name: 'Coffee table top', color: [172, 132, 92], boxes: [[[-0.55, 0.38, -0.3], [0.55, 0.42, 0.3]]], raised: true },
        { name: 'Coffee table legs', color: [52, 52, 56], boxes: legs(1.1, 0.6, 0.04, 0.38) },
      ],
    },
    {
      original: {
        id: 'og_side_table', label: 'Side table', category: 'table', kept: false,
        box: { position: [-2.25, 0, 1.5], size: [0.45, 0.55, 0.45], rotationY: Math.PI / 2 },
      },
      parts: [
        { name: 'Side table top', color: [110, 80, 60], boxes: [[[-0.225, 0.52, -0.225], [0.225, 0.55, 0.225]]], raised: true },
        { name: 'Side table legs', color: [46, 46, 50], boxes: legs(0.45, 0.45, 0.03, 0.52) },
      ],
    },
    {
      // Faces the coffee table, so its front is −Z in the room.
      original: {
        id: 'og_armchair', label: 'Armchair', category: 'chair', kept: false,
        box: { position: [-0.9, 0, 1.9], size: [0.8, 0.85, 0.8], rotationY: Math.PI },
      },
      parts: seating(0.8, 0.8, 0.85, [188, 150, 62], 'Armchair'),
    },
    {
      // Built in against the East wall, so it is Kept, and its front is −X in the room.
      original: {
        id: 'og_bench', label: 'Built-in bench', category: 'storage', kept: true,
        box: { position: [2.47, 0, 0], size: [1.6, 0.45, 0.4], rotationY: -Math.PI / 2 },
      },
      parts: [{ name: 'Bench', color: [150, 150, 145], boxes: [[[-0.8, 0, -0.2], [0.8, 0.45, 0.2]]] }],
    },
  ],
};

/** Where each non-Kept lounge piece stood during the Fill Capture: upright, and off every Original's spot. */
export const LOUNGE_FILL_MOVED: Record<string, Pose> = {
  og_sofa: { position: [0.9, 0, -1.6], rotationY: -Math.PI / 2 },   // turned around: its back faces the room
  og_coffee_table: { position: [1.2, 0, 1], rotationY: 0 },
  og_side_table: { position: [0.2, 0, 2.2], rotationY: 0 },
  og_armchair: { position: [1.9, 0, 2], rotationY: Math.PI / 2 },
};

/** The lounge's Fill Capture frame → its Main Capture's frame (here the room frame). Room Setup step 6 should recover it. */
export const LOUNGE_FILL_TRANSFORM: YawTransform = { position: [1.2, -0.8, -0.6], rotationY: 0.37 };

/** Each moved lounge piece's copy in the Fill Capture → where it stands in the Main Capture, as step 6 saves it. */
export const LOUNGE_FILL_MOVED_TRANSFORMS = Object.entries(LOUNGE_FILL_MOVED).map(([originalId, pose]) => {
  const { position, rotationY } = LOUNGE.furniture.find((f) => f.original.id === originalId)!.original.box;
  return { originalId, transform: composeYaw({ position, rotationY }, invertYaw(pose)) };
});

/** Imports one Capture's shapes, through a temporary raw .glb, as `scan-import` would. */
async function importCapture(shapes: Shape[], room: Room, fill: boolean, frame?: YawTransform) {
  const exportDir = await mkdtemp(join(tmpdir(), 'synthetic-room-'));
  try {
    await io.write(join(exportDir, 'capture.glb'), buildDocument(shapes, frame));
    return await importScan({ input: join(exportDir, 'capture.glb'), scanId: room.scanId, name: room.name, force: !fill, fill });
  } finally {
    await rm(exportDir, { recursive: true, force: true });
  }
}

async function main() {
  // The dorm: one Capture.
  {
    const { corners, walls } = roomWalls(DORM.size);
    const shapes = captureShapes(DORM, walls, { noiseSeed: 1, textureSeed: 0, exposure: 1, moved: {} });
    const { dir, stats } = await importCapture(shapes, DORM, false);
    await writeJson(join(dir, 'setup.json'), roomSetup(DORM, walls, corners, shapes[0].texture));
    console.log(`Wrote ${dir}: room.glb, manifest.json, and setup.json\n\n${formatSummary(stats)}\n`);
  }
  // The lounge: a Main Capture, then a Fill Capture with the furniture moved, seen from another frame.
  {
    const { corners, walls } = roomWalls(LOUNGE.size);
    const main = captureShapes(LOUNGE, walls, { noiseSeed: 101, textureSeed: 100, exposure: 1, moved: {}, occluded: true });
    const fill = captureShapes(LOUNGE, walls, { noiseSeed: 202, textureSeed: 200, exposure: 0.9, moved: LOUNGE_FILL_MOVED, occluded: true });
    const { dir, stats } = await importCapture(main, LOUNGE, false);
    await rm(join(dir, 'captures'), { recursive: true, force: true });
    const filled = await importCapture(fill, LOUNGE, true, invertYaw(LOUNGE_FILL_TRANSFORM));
    await writeJson(join(dir, 'setup.json'), roomSetup(LOUNGE, walls, corners, main[0].texture));
    // Lined up as Room Setup step 6 would (it recovers these), then merged, so the editor shows its Patches.
    const manifest: ScanManifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
    manifest.captures!.fills[0] = { ...manifest.captures!.fills[0], transform: LOUNGE_FILL_TRANSFORM, moved: LOUNGE_FILL_MOVED_TRANSFORMS };
    await writeJson(join(dir, 'manifest.json'), manifest);
    const { patches, completions } = await mergeScan(dir);
    console.log(`Wrote ${dir}: room.glb (with ${patches.length} Patches and ${completions.length} completions), ${filled.mesh}, manifest.json, and setup.json\n\n${formatSummary(stats)}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
