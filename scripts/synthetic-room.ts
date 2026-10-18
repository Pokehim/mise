// Synthetic Scans to build against before the real ones exist. Run: npx tsx scripts/synthetic-room.ts [scanId...]
//
// - data/scans/synthetic/: a dorm, one Capture.
// - data/scans/synthetic-lounge/: a lounge with a Main Capture and a Fill Capture (ADR-0007). In the
//   Fill Capture the furniture has moved, the exposure is 10% darker, and everything is seen from
//   another frame, as a second walk-through with Polycam would see it.
// - data/scans/synthetic-study/: the real study lounge (lounge-v1) at its size, one Capture.
//
// Each room is built in the room frame (meters, +Y up, floor at y = 0), saved as a raw .glb, and
// imported with scan-import, so it goes through the same pipeline as a Polycam export. The room's true
// setup.json is written too, which Room Setup can be checked against.
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
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
  /** texture: a photo (a PNG file) spread over each face of the part, instead of its color. */
  /** noBack: leave out each box's back (−Z) face, so the part is see-through from behind (faces are one-sided). */
  parts: { name: string; color: Rgb; boxes: [Vec3, Vec3][]; raised?: boolean; texture?: string; noBack?: boolean }[];
}

/** A room: its size (width x, depth z, height y, centered on the origin), Openings, colors and furniture. */
interface Room {
  scanId: string;
  name: string;
  size: Vec3;
  openings: Opening[];
  colors: { floor: Rgb; ceiling: Rgb; walls: Rgb[] };
  furniture: Furniture[];
  /** Built-in parts of the room that aren't Originals, such as window frames, as room-frame boxes. */
  fixtures?: { name: string; color: Rgb; boxes: [Vec3, Vec3][]; texture?: string }[];
  /** Colors for openingFixtures, when the room's real ones are known. */
  fixtureColors?: { frame: Rgb; glass: Rgb; door: Rgb };
  /**
   * Photos (PNG files) for the room's surfaces, used instead of their colors: each spans its
   * whole surface, left to right along a wall from its start, and with the North end up on the floor.
   * `openings` maps an Opening id to the photo for its glass or its door slab.
   */
  textures?: { floor?: string; ceiling?: string; walls?: (string | undefined)[]; openings?: Record<string, string> };
  /**
   * The color of the room's outside: a skin 1 cm outside each wall (with its Openings cut), over the
   * ceiling and under the floor. Doors look the same on both sides. Without it, the outside isn't drawn.
   */
  exterior?: Rgb;
  /**
   * The room is empty with the furniture laid over it: the floor and walls go on unbroken behind
   * every Original, so nothing needs baking, and every Original's floorColor is the floor's color.
   * Without it, floorColor is measured around each Original, as Room Setup's Bake step does.
   */
  emptyUnderFurniture?: boolean;
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
  const shape = (name: string, color: Rgb, photo?: string): Shape => ({
    name,
    texture: photo ? PNG.sync.read(readFileSync(photo)) : noiseTexture(color.map((c) => c * exposure) as Rgb, ++seed),
    positions: [], uvs: [], indices: [],
  });

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
  function addBox(target: Shape, [x0, y0, z0]: Vec3, [x1, y1, z1]: Vec3, { position, rotationY }: Pose, raised = false, noBack = false) {
    const [dx, dy, dz] = [x1 - x0, y1 - y0, z1 - z0];
    const faces: [Vec3, Vec3, Vec3][] = [
      [[x0, y1, z1], [dx, 0, 0], [0, 0, -dz]], // top
      [[x0, y0, z1], [dx, 0, 0], [0, dy, 0]], // front
      ...(noBack ? [] : [[[x1, y0, z0], [-dx, 0, 0], [0, dy, 0]] as [Vec3, Vec3, Vec3]]), // back
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
  const floor = shape('Floor', room.colors.floor, room.textures?.floor);
  addGrid(floor, [-W / 2, 0, D / 2], [W, 0, 0], [0, 0, -D], [], occluded ? underFurniture : undefined);
  const ceiling = shape('Ceiling', room.colors.ceiling, room.textures?.ceiling);
  addGrid(ceiling, [-W / 2, H, -D / 2], [W, 0, 0], [0, 0, D]);

  const wallShapes = walls.map((wall, i) => {
    const wallShape = shape(wall.name, room.colors.walls[i], room.textures?.walls?.[i]);
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
    parts.map(({ name, color, boxes, raised, texture, noBack }) => {
      const partShape = shape(name, color, texture);
      for (const [min, max] of boxes) addBox(partShape, min, max, moved[original.id] ?? original.box, raised, noBack);
      return partShape;
    }));
  const fixtureShapes = (room.fixtures ?? []).map(({ name, color, boxes, texture }) => {
    const fixtureShape = shape(name, color, texture);
    for (const [min, max] of boxes) addBox(fixtureShape, min, max, { position: [0, 0, 0], rotationY: 0 }, true);
    return fixtureShape;
  });
  // The outside: each wall's skin faces out (its grid runs from the wall's end back to its start), so
  // the split gives it to its wall and it fades with it.
  const exteriorShapes: Shape[] = [];
  if (room.exterior) {
    const SKIN = 0.01;
    walls.forEach((wall, i) => {
      const skin = shape(`${wall.name} outside`, room.exterior!);
      const [dx, dz] = [wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]];
      const length = Math.hypot(dx, dz);
      const openingRects = room.openings
        .filter((opening) => opening.wallId === wall.id)
        .map(({ offset, width, bottom, height }): Rect => [1 - (offset + width) / length, bottom / H, 1 - offset / length, (bottom + height) / H]);
      addGrid(skin, [wall.end[0] - wall.normal[0] * SKIN, 0, wall.end[1] - wall.normal[1] * SKIN], [-dx, 0, -dz], [0, H, 0], openingRects);
      exteriorShapes.push(skin);
    });
    const top = shape('Ceiling outside', room.exterior);
    addGrid(top, [-W / 2, H + SKIN, D / 2], [W, 0, 0], [0, 0, -D]);
    const under = shape('Floor outside', room.exterior);
    addGrid(under, [-W / 2, -SKIN, -D / 2], [W, 0, 0], [0, 0, D]);
    exteriorShapes.push(top, under);
  }
  return [floor, ceiling, ...wallShapes, ...partShapes, ...fixtureShapes, ...exteriorShapes];
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
    originals: room.furniture.map(({ original }) => ({
      ...original,
      floorColor: room.emptyUnderFurniture
        ? `#${room.colors.floor.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`
        : floorColor(original.box, floorTexture, room.size),
    })),
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
  emptyUnderFurniture: true,
  furniture: [
    {
      original: {
        id: 'og_bed', label: 'Bed', category: 'bed', kept: false,
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
        id: 'og_dresser', label: 'Dresser', category: 'dresser', kept: false,
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

/** A study table: a white top on four metal legs, long side along X, at x, z in the room. */
/** Flat photos of lounge-v1's real surfaces, rendered straight-on from its mesh (see lounge-v1-textures/README.md). */
const LOUNGE_PHOTO = (name: string) => fileURLToPath(new URL(`../data/scans/real-scans/lounge-v1-textures/${name}.png`, import.meta.url));

const studyTable = (n: number, x: number, z: number): Furniture => ({
  original: {
    id: `og_table_${n}`, label: `Table ${n}`, category: 'table', kept: false,
    box: { position: [x, 0, z], size: [1.49, 0.75, 1.05], rotationY: 0 },
  },
  parts: [
    { name: `Table ${n} top`, color: [232, 216, 193], boxes: [[[-0.745, 0.72, -0.525], [0.745, 0.75, 0.525]]], raised: true, texture: LOUNGE_PHOTO('table_top') },
    { name: `Table ${n} legs`, color: [61, 54, 43], boxes: legs(1.49, 1.05, 0.05, 0.72) },
  ],
});

/** Four shell chairs around a study table, two on each long side, tucked 0.3 m under it. */
const studyChairs = (n: number, x: number, z: number): Furniture[] =>
  [[-1, 'north'], [1, 'south']].flatMap(([side, name]) => [-0.37, 0.37].map((dx, i): Furniture => ({
    // A north chair faces +Z, toward the table; a south chair faces −Z.
    original: {
      id: `og_chair_${n}_${name}_${i + 1}`, label: `Chair ${n}${name === 'north' ? 'N' : 'S'}${i + 1}`, category: 'chair', kept: false,
      box: { position: [x + dx, 0, z + (side as number) * 0.45], size: [0.45, 0.85, 0.45], rotationY: side === -1 ? 0 : Math.PI },
    },
    parts: [
      { name: 'Chair seat', color: [173, 168, 156], boxes: [[[-0.225, 0.42, -0.225], [0.225, 0.45, 0.225]]], raised: true },
      { name: 'Chair back', color: [173, 168, 156], boxes: [[[-0.225, 0.45, -0.225], [0.225, 0.85, -0.195]]] },
      { name: 'Chair legs', color: [148, 109, 69], boxes: legs(0.45, 0.45, 0.03, 0.42) },
    ],
  })));

/**
 * Frames, glass and doors for a room's Openings, as room-frame boxes. Every box stays inside its
 * Opening's outline, so the load-time split gives it to the Shell and painting the wall leaves it alone.
 * A window gets a frame, glass just outside the wall line, a mullion every 0.6–0.9 m, and a sill when
 * it doesn't reach the floor; a door gets a frame, a slab and a handle on the side away from its hinge.
 */
function openingFixtures(room: Room): NonNullable<Room['fixtures']> {
  const { walls } = roomWalls(room.size);
  const frames: [Vec3, Vec3][] = [];
  const glass: NonNullable<Room['fixtures']> = [];
  const sills: [Vec3, Vec3][] = [];
  const doors: NonNullable<Room['fixtures']> = [];
  const handles: [Vec3, Vec3][] = [];
  const F = 0.05; // frame width
  for (const { id, wallId, kind, offset, width, bottom, height, swing } of room.openings) {
    const photo = room.textures?.openings?.[id];
    const wall = walls.find((w) => w.id === wallId)!;
    const length = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]);
    const dir: Vec2 = [(wall.end[0] - wall.start[0]) / length, (wall.end[1] - wall.start[1]) / length];
    /** A box from along a0–a1, up y0–y1, out o0–o1 (out is into the room), in room-frame min–max. */
    const box = (a0: number, a1: number, y0: number, y1: number, o0: number, o1: number): [Vec3, Vec3] => {
      const at = (a: number, o: number) => [wall.start[0] + dir[0] * a + wall.normal[0] * o, wall.start[1] + dir[1] * a + wall.normal[1] * o];
      const [p, q] = [at(a0, o0), at(a1, o1)];
      return [[Math.min(p[0], q[0]), y0, Math.min(p[1], q[1])], [Math.max(p[0], q[0]), y1, Math.max(p[1], q[1])]];
    };
    const [a0, a1, y0, y1] = [offset, offset + width, bottom, bottom + height];
    if (kind === 'door') {
      frames.push(box(a0, a0 + F, y0, y1, -0.03, 0.05), box(a1 - F, a1, y0, y1, -0.03, 0.05), box(a0, a1, y1 - F, y1, -0.03, 0.05));
      doors.push({ name: `Door ${id}`, color: room.fixtureColors?.door ?? [196, 138, 72], boxes: [box(a0 + F, a1 - F, y0, y1 - F, -0.02, 0.02)], texture: photo });
      // Seen from inside, the hinge is on the right for in-right; along runs right to left from inside.
      const handleAt = swing === 'in-right' ? a0 + F + 0.06 : a1 - F - 0.11;
      handles.push(box(handleAt, handleAt + 0.05, 0.95, 1.05, 0.02, 0.07));
      continue;
    }
    frames.push(box(a0, a0 + F, y0, y1, -0.03, 0.05), box(a1 - F, a1, y0, y1, -0.03, 0.05), box(a0, a1, y1 - F, y1, -0.03, 0.05));
    if (bottom > 0) {
      frames.push(box(a0, a1, y0, y0 + F, -0.03, 0.05));
      sills.push(box(a0, a1, y0, y0 + 0.03, 0.05, 0.16));
    } else {
      frames.push(box(a0, a1, 0, 0.1, -0.03, 0.05)); // a kick rail along the floor
    }
    const panes = Math.max(1, Math.round((width - 2 * F) / 0.75));
    for (let i = 1; i < panes; i++) {
      const at = a0 + F + ((width - 2 * F) * i) / panes;
      frames.push(box(at - 0.025, at + 0.025, y0, y1, -0.03, 0.05));
    }
    glass.push({ name: `Glass ${id}`, color: room.fixtureColors?.glass ?? [168, 192, 204], boxes: [box(a0 + F, a1 - F, y0 + (bottom > 0 ? F : 0.1), y1 - F, -0.025, -0.015)], texture: photo });
  }
  return [
    { name: 'Window frames', color: room.fixtureColors?.frame ?? [74, 76, 80], boxes: frames },
    { name: 'Window sills', color: [232, 230, 222], boxes: sills },
    { name: 'Door handle', color: [150, 150, 154], boxes: handles },
    ...glass,
    ...doors,
  ].filter(({ boxes }) => boxes.length > 0) as NonNullable<Room['fixtures']>;
}

/**
 * A whiteboard on a wall: a white board in an aluminium frame with a marker tray, see-through from
 * behind. It stands 2.5 cm off the wall, so the load-time split gives its triangles to it and not to
 * the wall.
 */
const whiteboard = (position: Vec3, rotationY: number, width: number, height: number, photo?: string): Furniture => ({
  original: { id: 'og_whiteboard', label: 'Whiteboard', category: 'wall_art', kept: false, box: { position, rotationY, size: [width, height, 0.08] } },
  parts: [
    { name: 'Whiteboard surface', color: [204, 192, 175], boxes: [[[-width / 2 + 0.03, 0.03, -0.015], [width / 2 - 0.03, height - 0.03, 0.01]]], raised: true, texture: photo, noBack: true },
    {
      name: 'Whiteboard frame', color: [168, 170, 174], raised: true, noBack: true, boxes: [
        [[-width / 2, 0, -0.015], [width / 2, 0.03, 0.015]], [[-width / 2, height - 0.03, -0.015], [width / 2, height, 0.015]],
        [[-width / 2, 0.03, -0.015], [-width / 2 + 0.03, height - 0.03, 0.015]], [[width / 2 - 0.03, 0.03, -0.015], [width / 2, height - 0.03, 0.015]],
      ],
    },
    { name: 'Marker tray', color: [150, 152, 156], boxes: [[[-width / 2 + 0.2, 0, 0.015], [width / 2 - 0.2, 0.03, 0.055]]], raised: true, noBack: true },
  ],
});

/**
 * The real study lounge (lounge-v1) at its Room Setup size and in its real colors: the window at
 * the North end, the door in the South-East corner, floor-to-ceiling glass in the South-West corner,
 * the whiteboard along the East wall, and its three tables against the West wall where the splat
 * shows them.
 */
const STUDY_TABLES: [x: number, z: number][] = [[-0.784, -1.691], [-0.784, -0.307], [-0.784, 1.734]];
export const STUDY: Room = {
  scanId: 'synthetic-study',
  name: 'Synthetic study lounge (3.12 × 7.22 m)',
  size: [3.118, 7.218, 2.431],
  openings: [
    // The window at the North end, opposite the door.
    { id: 'op_1', kind: 'window', wallId: 'wl_1', offset: 0.508, width: 1.717, bottom: 0.861, height: 1.467 },
    // Floor-to-ceiling glass in the South-West corner, along the West wall (which starts at that corner).
    { id: 'op_2', kind: 'window', wallId: 'wl_4', offset: 0.053, width: 1.731, bottom: 0, height: 2.431 },
    // The door at the South end, in its South-East corner, where the splat shows it (the South wall
    // starts at that corner).
    { id: 'op_3', kind: 'door', wallId: 'wl_3', offset: 0.03, width: 0.95, bottom: 0, height: 2.15, swing: 'in-right' },
  ],
  // Median texture colors of the real lounge-v1 mesh, region by region.
  colors: { floor: [113, 97, 85], ceiling: [136, 128, 114], walls: [[102, 119, 107], [106, 121, 110], [113, 105, 77], [111, 125, 113]] },
  // The glass blacked out.
  fixtureColors: { frame: [24, 34, 40], glass: [0, 0, 0], door: [159, 121, 76] },
  exterior: [0, 0, 0],
  textures: {
    floor: LOUNGE_PHOTO('floor'),
    ceiling: LOUNGE_PHOTO('ceiling'),
    walls: ['wall_n', 'wall_e', 'wall_s', 'wall_w'].map(LOUNGE_PHOTO),
    openings: { op_3: LOUNGE_PHOTO('door') },
  },
  furniture: [
    ...STUDY_TABLES.flatMap(([x, z], i) => [studyTable(i + 1, x, z), ...studyChairs(i + 1, x, z)]),
    // The length of the East wall, at the height the mesh shows (0.85–2.02 m), with the real board's
    // writing stretched along it: facing −X, its back 2.5 cm off the wall.
    whiteboard([3.118 / 2 - 0.04, 0.851, 0], -Math.PI / 2, 7.118, 1.165, LOUNGE_PHOTO('whiteboard')),
  ],
};
STUDY.fixtures = openingFixtures(STUDY);

/** Where each non-Kept lounge Original stood during the Fill Capture: upright, and off every Original's spot. */
export const LOUNGE_FILL_MOVED: Record<string, Pose> = {
  og_sofa: { position: [0.9, 0, -1.6], rotationY: -Math.PI / 2 },   // turned around: its back faces the room
  og_coffee_table: { position: [1.2, 0, 1], rotationY: 0 },
  og_side_table: { position: [0.2, 0, 2.2], rotationY: 0 },
  og_armchair: { position: [1.9, 0, 2], rotationY: Math.PI / 2 },
};

/** The lounge's Fill Capture frame → its Main Capture's frame (here the room frame). Room Setup step 6 should recover it. */
export const LOUNGE_FILL_TRANSFORM: YawTransform = { position: [1.2, -0.8, -0.6], rotationY: 0.37 };

/** Each moved lounge Original's copy in the Fill Capture → where it stands in the Main Capture, as step 6 saves it. */
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

/** A room with one Capture: its room.glb, manifest.json and true setup.json. */
async function singleCapture(room: Room, noiseSeed: number, textureSeed: number) {
  const { corners, walls } = roomWalls(room.size);
  const shapes = captureShapes(room, walls, { noiseSeed, textureSeed, exposure: 1, moved: {} });
  const { dir, stats } = await importCapture(shapes, room, false);
  await writeJson(join(dir, 'setup.json'), roomSetup(room, walls, corners, shapes[0].texture));
  console.log(`Wrote ${dir}: room.glb, manifest.json, and setup.json\n\n${formatSummary(stats)}\n`);
}

async function main() {
  // Only the rooms named on the command line, by scan id, or all of them.
  const only = process.argv.slice(2);
  const wanted = (scanId: string) => only.length === 0 || only.includes(scanId);
  if (wanted(STUDY.scanId)) await singleCapture(STUDY, 301, 300);
  // The dorm: one Capture.
  if (wanted(DORM.scanId)) await singleCapture(DORM, 1, 0);
  // The lounge: a Main Capture, then a Fill Capture with the furniture moved, seen from another frame.
  if (wanted(LOUNGE.scanId)) {
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
    console.log(`Wrote ${dir}: room.glb (Patches: ${patches.length}, completions: ${completions.length}), ${filled.mesh}, manifest.json, and setup.json\n\n${formatSummary(stats)}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
