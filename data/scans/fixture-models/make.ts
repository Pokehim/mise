// The fixture-models test Scan (#79): lounge-v2's shape, made of the real lounge's images, before its files exist.
// Run: npx tsx data/scans/fixture-models/make.ts
//
// Every image is a photo of the real study lounge:
// - sources/: straight-on renders of the chair Detail Captures (real-scans/POLYCAM_CHAIR_1, _2): carpet, paint,
//   baseboard, an outlet, the vent, and the chair's seat fabric, white shell and oak leg (sources/README.md).
// - real-scans/lounge-v1-textures/: the East wall, ceiling, door, tabletop and whiteboard (its README).
// - data/materials/brushed-metal.jpg: the table legs' and the whiteboard frame's metal.
//
// It writes:
// - room.glb: the Empty Room, in synthetic-study's room frame (the lounge at its measured size). The floor
//   is real carpet tiles; the walls are real paint with the real baseboard, outlets and vent; the East
//   wall, ceiling and door are lounge-v1's own images; every glass area is a frosted pane (spec §3).
// - models/chair.glb (seat, back, legs), models/table.glb (top, legs), models/whiteboard.glb (board, frame):
//   Master Copies with real images and a soft `shadow` node, darkest where the legs touch the floor.
// - setup.json: 12 chairs, 3 tables and the whiteboard where synthetic-study has them, as Chair 1–12,
//   Table 1–3 and Whiteboard (spec §3).
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Document, NodeIO, TextureInfo, type TypedArray } from '@gltf-transform/core';
import sharp from 'sharp';
import type { Hex, Opening, Original, RoomSetup, ScanManifest, Vec2, Vec3, Wall } from '../../../shared/types';

const DIR = dirname(fileURLToPath(import.meta.url));
const DATA = join(DIR, '../..');
const SOURCES = join(DIR, 'sources');
const LOUNGE = join(DATA, 'scans/real-scans/lounge-v1-textures');
const METAL = join(DATA, 'materials/brushed-metal.jpg');
const ID = 'fixture-models';

/* ───────────── The room: synthetic-study's frame ───────────── */

const [W, D, H] = [3.118, 7.218, 2.431];
const [X0, X1, Z0, Z1] = [-W / 2, W / 2, -D / 2, D / 2];
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
  // The floor-to-ceiling glass in the South-West corner, with the main door in it (spec §6: "the main door on the West wall").
  { id: 'op_2', kind: 'door', wallId: 'wl_4', offset: 0.053, width: 1.731, bottom: 0, height: H, swing: 'none' },
  { id: 'op_3', kind: 'door', wallId: 'wl_3', offset: 0.03, width: 0.95, bottom: 0, height: 2.15, swing: 'in-right' },
];
const wallLength = (wall: Wall) => Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]);

/* ───────────── Images: RGB, 0–255, as floats ───────────── */

type RGB = [number, number, number];
interface Img { w: number; h: number; d: Float32Array }

const blank = (w: number, h: number, [r, g, b]: RGB = [0, 0, 0]): Img => {
  const d = new Float32Array(w * h * 3);
  for (let i = 0; i < w * h; i++) d.set([r, g, b], 3 * i);
  return { w, h, d };
};

/** An image file, scaled by `size` (or to [w, h]). */
async function read(file: string | Buffer, size?: number | [number, number]): Promise<Img> {
  let image = sharp(file).removeAlpha();
  if (typeof size === 'number') {
    const { width, height } = await sharp(file).metadata();
    image = image.resize(Math.round(width! * size), Math.round(height! * size));
  } else if (size) image = image.resize(size[0], size[1], { fit: 'fill' });
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
  return { w: info.width, h: info.height, d: Float32Array.from(data) };
}

const jpeg = (img: Img) => sharp(Buffer.from(Uint8ClampedArray.from(img.d)), { raw: { width: img.w, height: img.h, channels: 3 } })
  .jpeg({ quality: 90, chromaSubsampling: '4:4:4' }).toBuffer();
const jpegOf = (file: string) => sharp(file).jpeg({ quality: 92, chromaSubsampling: '4:4:4' }).toBuffer();

function mean(img: Img, [x0, y0, x1, y1] = [0, 0, img.w, img.h]): RGB {
  const sum: RGB = [0, 0, 0];
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) for (let k = 0; k < 3; k++) sum[k] += img.d[3 * (y * img.w + x) + k];
  const n = (x1 - x0) * (y1 - y0);
  return sum.map((s) => s / n) as RGB;
}

function crop(img: Img, x0: number, y0: number, w: number, h: number): Img {
  const out = blank(w, h);
  for (let y = 0; y < h; y++) out.d.set(img.d.subarray(3 * ((y0 + y) * img.w + x0), 3 * ((y0 + y) * img.w + x0 + w)), 3 * y * w);
  return out;
}

const scaled = (img: Img, k: number | RGB): Img => {
  const gain = typeof k === 'number' ? [k, k, k] : k;
  return { ...img, d: img.d.map((v, i) => v * gain[i % 3]) };
};

/** Lays `src` on `dst` at (x, y), fading it in over `feather` px from its edges, its color scaled by `gain`. */
function blit(dst: Img, src: Img, x: number, y: number, feather = 0, gain: RGB = [1, 1, 1]) {
  for (let sy = 0; sy < src.h; sy++) {
    const dy = y + sy;
    if (dy < 0 || dy >= dst.h) continue;
    for (let sx = 0; sx < src.w; sx++) {
      const dx = x + sx;
      if (dx < 0 || dx >= dst.w) continue;
      const edge = Math.min(sx + 1, sy + 1, src.w - sx, src.h - sy);
      const a = feather > 0 ? Math.min(1, edge / feather) : 1;
      const [di, si] = [3 * (dy * dst.w + dx), 3 * (sy * src.w + sx)];
      for (let k = 0; k < 3; k++) dst.d[di + k] = dst.d[di + k] * (1 - a) + src.d[si + k] * gain[k] * a;
    }
  }
}

function seeded(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}
const random = seeded(7);

/**
 * Covers a rectangle of `dst` with overlapping blocks cut at random from the sources, each made the
 * target color on average but keeping the source's own grain and shading: real material, without repeats.
 */
function quilt(dst: Img, sources: Img[], [rx, ry, rw, rh]: number[], block: number, target: RGB) {
  const overlap = Math.round(block / 4);
  const step = block - overlap;
  const fits = sources.filter((s) => s.w >= block && s.h >= block);
  for (let y = ry - overlap; y < ry + rh; y += step) {
    for (let x = rx - overlap; x < rx + rw; x += step) {
      const src = fits[Math.floor(random() * fits.length)];
      const piece = crop(src, Math.floor(random() * (src.w - block + 1)), Math.floor(random() * (src.h - block + 1)), block, block);
      const m = mean(piece);
      blit(dst, piece, x, y, overlap, target.map((t, k) => t / m[k]) as RGB);
    }
  }
}

/** An image's fine texture only: divided by its own blur, so a sample's lighting doesn't tile into blocks. Mean 128. */
async function fineTexture(img: Img, sigma: number): Promise<Img> {
  const raw = (i: Img) => sharp(Buffer.from(Uint8ClampedArray.from(i.d)), { raw: { width: i.w, height: i.h, channels: 3 } });
  const blurred = await read(await raw(img).blur(sigma).png().toBuffer());
  return { ...img, d: img.d.map((v, i) => (128 * v) / Math.max(1, blurred.d[i])) };
}

const hex = (color: RGB) => `#${color.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}` as Hex;

/* ───────────── The Empty Room's images ───────────── */

const FLOOR_PX = 500;   // 2 mm per texel: the spec's aim near eye level
const WALL_PX = 300;

/** The ceiling's lights, in the room frame: the brightest spots of the ceiling photo (up = South, seen from below). */
async function ceilingLights(): Promise<Vec2[]> {
  const ceiling = await read(join(LOUNGE, 'ceiling.png'), 0.25);
  const seen = new Uint8Array(ceiling.w * ceiling.h);
  const bright = (i: number) => ceiling.d[3 * i] + ceiling.d[3 * i + 1] + ceiling.d[3 * i + 2] > 3 * 245;
  const lights: Vec2[] = [];
  for (let start = 0; start < seen.length; start++) {
    if (seen[start] || !bright(start)) continue;
    const stack = [start];
    seen[start] = 1;
    let [n, sx, sy] = [0, 0, 0];
    while (stack.length) {
      const i = stack.pop()!;
      const [x, y] = [i % ceiling.w, Math.floor(i / ceiling.w)];
      n++;
      sx += x;
      sy += y;
      for (const j of [i - 1, i + 1, i - ceiling.w, i + ceiling.w]) {
        if (j >= 0 && j < seen.length && !seen[j] && bright(j) && Math.abs((j % ceiling.w) - x) <= 1) {
          seen[j] = 1;
          stack.push(j);
        }
      }
    }
    if (n >= 3) lights.push([X1 - ((sx / n + 0.5) / ceiling.w) * W, Z1 - ((sy / n + 0.5) / ceiling.h) * D]);
  }
  return lights;
}

/**
 * The floor: real carpet tiles, 0.5 m square, each a little lighter or darker as real tiles are, lit in
 * pools under the ceiling's lights and a little darker along the walls. Up = North, right = East.
 */
async function floorImage(lights: Vec2[]): Promise<{ image: Img; color: RGB }> {
  const sources = await Promise.all([1, 2, 3, 4, 5, 6].map((i) => read(join(SOURCES, `carpet-${i}.jpg`), FLOOR_PX / 800)));
  const means = sources.map((s) => mean(s));
  const target = [0, 1, 2].map((k) => means.reduce((sum, m) => sum + m[k], 0) / means.length) as RGB;
  const image = blank(Math.round(W * FLOOR_PX), Math.round(D * FLOOR_PX), target);
  quilt(image, sources, [0, 0, image.w, image.h], 140, target);
  const tile = 0.5 * FLOOR_PX;
  const tileGain = Array.from({ length: 64 * 64 }, () => 0.94 + 0.12 * random());
  for (let y = 0; y < image.h; y++) {
    for (let x = 0; x < image.w; x++) {
      const [px, pz] = [X0 + (x + 0.5) / FLOOR_PX, Z0 + (y + 0.5) / FLOOR_PX];
      const seam = x % tile === 0 || y % tile === 0 ? 0.9 : 1;
      const pools = lights.reduce((sum, [lx, lz]) => sum + Math.exp(-((px - lx) ** 2 + (pz - lz) ** 2) / (2 * 0.9 ** 2)), 0);
      const wall = Math.min(px - X0, X1 - px, pz - Z0, Z1 - pz);
      const gain = tileGain[Math.floor(y / tile) * 64 + Math.floor(x / tile)] * seam
        * (0.94 + 0.09 * Math.min(pools, 1.4)) * (1 - 0.14 * Math.exp(-wall / 0.12));
      for (let k = 0; k < 3; k++) image.d[3 * (y * image.w + x) + k] *= gain;
    }
  }
  return { image, color: target };
}

/** A frosted pane in its frame: opaque, neutral light grey, a little lighter toward the top (spec §3). */
function frosted(img: Img, [x0, y0, x1, y1]: number[], frame: RGB, mullions: number[] = []) {
  const f = Math.round(0.045 * WALL_PX);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const inFrame = x < x0 + f || x >= x1 - f || y < y0 + f || y >= y1 - f || mullions.some((m) => Math.abs(y - m) < f / 2);
      const t = (y - y0) / (y1 - y0);
      const color = inFrame
        ? frame.map((c) => c * (1 + 0.04 * (random() - 0.5)))
        : [214, 217, 219].map((c) => c * (1.04 - 0.08 * t) * (1 + 0.012 * (random() - 0.5)));
      img.d.set(color, 3 * (y * img.w + x));
    }
  }
}

interface WallParts { paint: { sources: Img[]; color: RGB }; baseboard: Img; outlet: Img; vent: Img }

/** One wall's image, over the whole wall, seen from inside: left = the wall's start, top = the ceiling. */
async function wallImage(wall: Wall, { paint, baseboard, outlet, vent }: WallParts, lights: Vec2[]): Promise<Img> {
  const [w, h] = [Math.round(wallLength(wall) * WALL_PX), Math.round(H * WALL_PX)];
  const px = (meters: number) => Math.round(meters * WALL_PX);
  const row = (up: number) => h - px(up);
  if (wall.name === 'East wall') {
    // lounge-v1's own East wall, with real paint where its whiteboard was painted out (0–6.2 m along, 0.70–2.30 m
    // up), down to just above the outlets (their tops are 0.52 m up), so the tray's shadow left under it (0.62–0.71 m) goes too.
    const image = await read(join(LOUNGE, 'wall_e.png'), [w, h]);
    // The real wall is lighter low down: the fill goes from the paint just below it (2 cm, column by column,
    // smoothed over 0.3 m) to the paint beside the board, over its lowest half meter.
    const beside = mean(image, [px(6.3), row(2.2), px(7.0), row(0.9)]);
    const patch = blank(px(6.25), row(0.545) - row(2.33), beside);
    quilt(patch, paint.sources, [0, 0, patch.w, patch.h], 80, beside);
    const strip = Array.from({ length: patch.w }, (_, x) => mean(image, [x, row(0.545), x + 1, row(0.525)]));
    const half = px(0.15);
    const below = strip.map((_, x) => {
      const near = strip.slice(Math.max(0, x - half), x + half + 1);
      return [0, 1, 2].map((k) => near.reduce((sum, c) => sum + c[k], 0) / near.length);
    });
    for (let y = 0; y < patch.h; y++) {
      const t = Math.min(1, (patch.h - y) / px(0.5));
      for (let x = 0; x < patch.w; x++) {
        for (let k = 0; k < 3; k++) patch.d[3 * (y * patch.w + x) + k] *= (below[x][k] + (beside[k] - below[x][k]) * t) / beside[k];
      }
    }
    blit(image, patch, 0, row(2.33), 8);
    return image;
  }
  const image = blank(w, h, paint.color);
  quilt(image, paint.sources, [0, 0, w, h], 80, paint.color);
  // The room's light: each ceiling light brightens the wall near it, falling off with distance, as on the real East wall.
  const [sx, sz] = wall.start;
  const [ux, uz] = [(wall.end[0] - sx) / wallLength(wall), (wall.end[1] - sz) / wallLength(wall)];
  const light = (x: number, y: number) => {
    const [wx, wy, wz] = [sx + ux * (x / WALL_PX), H - y / WALL_PX, sz + uz * (x / WALL_PX)];
    return lights.reduce((sum, [lx, lz]) => sum + 1 / (1 + ((wx - lx) ** 2 + (wy - H) ** 2 + (wz - lz) ** 2) / 1.5), 0);
  };
  let total = 0;
  for (let y = 0; y < h; y += 8) for (let x = 0; x < w; x += 8) total += light(x, y);
  const average = total / (Math.ceil(h / 8) * Math.ceil(w / 8));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const gain = 0.86 + 0.14 * (light(x, y) / average);
      for (let k = 0; k < 3; k++) image.d[3 * (y * w + x) + k] *= gain;
    }
  }
  // The real baseboard along the bottom, in lengths faded into each other.
  for (let x = -8; x < w; x += baseboard.w - 16) blit(image, baseboard, x, h - baseboard.h, 8);
  const fixture = (img: Img, along: number, up: number) => blit(image, img, px(along) - Math.round(img.w / 2), row(up) - img.h, 4);
  if (wall.name === 'North wall') fixture(outlet, 2.75, 0.3);
  if (wall.name === 'South wall') fixture(outlet, 2.2, 0.3);
  if (wall.name === 'West wall') fixture(vent, 4.6, 0.14);
  for (const o of openings.filter((it) => it.wallId === wall.id)) {
    const box = [px(o.offset), row(o.bottom + o.height), px(o.offset + o.width), row(o.bottom)];
    if (o.height >= H - 0.01) {
      // The glass wall with the main door: frosted panes in aluminum, with a rail at handle height and one at the door's head.
      frosted(image, box, [150, 153, 156], [row(1.0), row(2.15)]);
    } else if (o.kind === 'door') {
      // The real door slab (0.85 × 2.10 m) in a plain frame.
      frosted(image, box, [205, 204, 199]);
      const slab = await read(join(LOUNGE, 'door.png'), [px(0.85), px(2.1)]);
      blit(image, slab, box[0] + Math.round((box[2] - box[0] - slab.w) / 2), row(2.1));
    } else {
      frosted(image, box, [233, 232, 227]);
      for (let y = box[3]; y < box[3] + px(0.03); y++) for (let x = box[0] - 6; x < box[2] + 6; x++) image.d.set([226, 225, 220], 3 * (y * w + x));
    }
  }
  return image;
}

/* ───────────── Geometry ───────────── */

interface Shape { positions: number[]; uvs: number[]; indices: number[] }
const empty = (): Shape => ({ positions: [], uvs: [], indices: [] });

/** Adds a grid of vertices pos(s, t) over s, t ∈ [0, 1], with UVs uv(s, t); `flip` turns its faces around. */
function surface(shape: Shape, ns: number, nt: number, pos: (s: number, t: number) => Vec3, uv: (s: number, t: number) => Vec2, flip = false) {
  const base = shape.positions.length / 3;
  for (let j = 0; j <= nt; j++) {
    for (let i = 0; i <= ns; i++) {
      shape.positions.push(...pos(i / ns, j / nt));
      shape.uvs.push(...uv(i / ns, j / nt));
    }
  }
  for (let j = 0; j < nt; j++) {
    for (let i = 0; i < ns; i++) {
      const [a, b, c, d] = [j * (ns + 1) + i, j * (ns + 1) + i + 1, (j + 1) * (ns + 1) + i + 1, (j + 1) * (ns + 1) + i].map((n) => n + base);
      shape.indices.push(...(flip ? [a, c, b, a, d, c] : [a, b, c, a, c, d]));
    }
  }
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** A flat rectangle from `origin` along u and v, facing `normal`, at most `step` meters per cell. */
function plane(shape: Shape, origin: Vec3, u: Vec3, v: Vec3, normal: Vec3, step: number, uv: (s: number, t: number) => Vec2) {
  const [ns, nt] = [Math.max(1, Math.ceil(Math.hypot(...u) / step)), Math.max(1, Math.ceil(Math.hypot(...v) / step))];
  surface(shape, ns, nt, (s, t) => [0, 1, 2].map((k) => origin[k] + u[k] * s + v[k] * t) as Vec3, uv, dot(cross(u, v), normal) < 0);
}

/** UVs over a face: its whole image, or with `repeat`, an image every `repeat` meters. */
const faceUv = (lu: number, lv: number, repeat?: number) => (s: number, t: number): Vec2 => (repeat ? [(s * lu) / repeat, (t * lv) / repeat] : [s, t]);

/** A box from min to max: its top face goes in `top`, the other five in `sides`. */
function box(top: Shape, sides: Shape, [x0, y0, z0]: Vec3, [x1, y1, z1]: Vec3, repeat?: number) {
  const [w, h, d] = [x1 - x0, y1 - y0, z1 - z0];
  plane(top, [x0, y1, z0], [w, 0, 0], [0, 0, d], [0, 1, 0], 10, faceUv(w, d, repeat));
  plane(sides, [x0, y0, z0], [w, 0, 0], [0, 0, d], [0, -1, 0], 10, faceUv(w, d, repeat));
  plane(sides, [x0, y1, z1], [w, 0, 0], [0, -h, 0], [0, 0, 1], 10, faceUv(w, h, repeat));
  plane(sides, [x1, y1, z0], [-w, 0, 0], [0, -h, 0], [0, 0, -1], 10, faceUv(w, h, repeat));
  plane(sides, [x1, y1, z1], [0, 0, -d], [0, -h, 0], [1, 0, 0], 10, faceUv(d, h, repeat));
  plane(sides, [x0, y1, z0], [0, 0, d], [0, -h, 0], [-1, 0, 0], 10, faceUv(d, h, repeat));
}

/** A tapered round leg from `top` to `bottom`, closed at the foot; its image wraps around it `wraps` times and repeats every `repeat` meters along it. */
function leg(shape: Shape, top: Vec3, bottom: Vec3, r0: number, r1: number, repeat: number, wraps = 2) {
  const axis = sub(bottom, top);
  const length = Math.hypot(...axis);
  const a = axis.map((c) => c / length) as Vec3;
  const side = cross(a, Math.abs(a[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1]);
  const n1 = side.map((c) => c / Math.hypot(...side)) as Vec3;
  const n2 = cross(a, n1);
  const ring = (center: Vec3, r: number, s: number) => {
    const angle = s * 2 * Math.PI;
    return [0, 1, 2].map((k) => center[k] + r * (Math.cos(angle) * n1[k] + Math.sin(angle) * n2[k])) as Vec3;
  };
  surface(shape, 12, 4, (s, t) => ring([0, 1, 2].map((k) => top[k] + axis[k] * t) as Vec3, r0 + (r1 - r0) * t, s), (s, t) => [wraps * s, (t * length) / repeat]);
  surface(shape, 12, 1, (s, t) => ring(bottom, r1 * t, s), () => [0.5, 0.5], true);
}

/** A flat quad on the floor at height `at`, or, `upright`, standing in the z = 0 plane centered `at` high, facing +Z. */
function quad(width: number, depth: number, at: number, upright = false): Shape {
  const shape = empty();
  if (upright) plane(shape, [-width / 2, at + depth / 2, 0], [width, 0, 0], [0, -depth, 0], [0, 0, 1], 10, (s, t) => [s, t]);
  else plane(shape, [-width / 2, at, -depth / 2], [width, 0, 0], [0, 0, depth], [0, 1, 0], 10, (s, t) => [s, t]);
  return shape;
}

/* ───────────── glTF ───────────── */

interface Primitive { shape: Shape; image: Buffer; png?: boolean; mirror?: boolean }
interface Node { name: string; parts: Primitive[]; translation?: Vec3 }

async function glb(nodes: Node[]) {
  const document = new Document();
  const buffer = document.createBuffer();
  const scene = document.createScene();
  const accessor = (type: 'VEC3' | 'VEC2' | 'SCALAR', array: TypedArray) => document.createAccessor().setType(type).setArray(array).setBuffer(buffer);
  const textures = new Map<Buffer, ReturnType<Document['createTexture']>>();
  for (const { name, parts, translation } of nodes) {
    const mesh = document.createMesh(name);
    for (const [i, { shape, image, png, mirror }] of parts.entries()) {
      let texture = textures.get(image);
      if (!texture) textures.set(image, (texture = document.createTexture(`${name}-${i}`).setImage(image).setMimeType(png ? 'image/png' : 'image/jpeg')));
      const material = document.createMaterial(`${name}-${i}`).setBaseColorTexture(texture).setMetallicFactor(0).setRoughnessFactor(1);
      // A shadow is see-through; everything else opaque.
      if (png) material.setAlphaMode('BLEND');
      const wrap = mirror ? TextureInfo.WrapMode.MIRRORED_REPEAT : TextureInfo.WrapMode.REPEAT;
      material.getBaseColorTextureInfo()!.setWrapS(wrap).setWrapT(wrap);
      mesh.addPrimitive(document.createPrimitive()
        .setAttribute('POSITION', accessor('VEC3', new Float32Array(shape.positions)))
        .setAttribute('TEXCOORD_0', accessor('VEC2', new Float32Array(shape.uvs)))
        .setIndices(accessor('SCALAR', new Uint32Array(shape.indices)))
        .setMaterial(material));
    }
    const node = document.createNode(name).setMesh(mesh);
    if (translation) node.setTranslation(translation);
    scene.addChild(node);
  }
  return new NodeIO().writeBinary(document);
}

/* ───────────── The Empty Room ───────────── */

async function roomNodes(): Promise<{ nodes: Node[]; floorColor: RGB }> {
  const lights = await ceilingLights();
  const floor = await floorImage(lights);
  const eastWall = await read(join(LOUNGE, 'wall_e.png'));
  // Every wall is the real paint's color, from lounge-v1's East wall past the whiteboard (6.35–7.0 m along, 0.3–1.5 m up).
  const paintColor = mean(eastWall, [Math.round(6.35 * 200), eastWall.h - Math.round(1.5 * 200), Math.round(7.0 * 200), eastWall.h - Math.round(0.3 * 200)]);
  const parts: WallParts = {
    paint: { sources: [await fineTexture(await read(join(SOURCES, 'paint.jpg'), WALL_PX / 400), 12)], color: paintColor },
    baseboard: await read(join(SOURCES, 'baseboard.jpg'), WALL_PX / 400),
    outlet: await read(join(SOURCES, 'outlet.jpg'), WALL_PX / 800),
    vent: await read(join(SOURCES, 'vent.jpg'), WALL_PX / 800),
  };

  const floorShape = empty();
  plane(floorShape, [X0, 0, Z0], [W, 0, 0], [0, 0, D], [0, 1, 0], 0.25, (s, t) => [s, t]);
  const ceilingShape = empty();
  // The ceiling photo is up = South, seen from below: u runs East → West, v South → North.
  plane(ceilingShape, [X0, H, Z0], [W, 0, 0], [0, 0, D], [0, -1, 0], 0.25, (s, t) => [1 - s, 1 - t]);
  const nodes: Node[] = [
    { name: 'Floor', parts: [{ shape: floorShape, image: await jpeg(floor.image) }] },
    { name: 'Ceiling', parts: [{ shape: ceilingShape, image: await jpegOf(join(LOUNGE, 'ceiling.png')) }] },
  ];
  for (const wall of walls) {
    const shape = empty();
    const [sx, sz] = wall.start;
    plane(shape, [sx, H, sz], [wall.end[0] - sx, 0, wall.end[1] - sz], [0, -H, 0], [wall.normal[0], 0, wall.normal[1]], 0.25, (s, t) => [s, t]);
    nodes.push({ name: wall.name, parts: [{ shape, image: await jpeg(await wallImage(wall, parts, lights)) }] });
  }
  return { nodes, floorColor: floor.color };
}

/* ───────────── Shadows: soft, darkest where the legs touch ───────────── */

interface Footprint { rect: [x0: number, y0: number, x1: number, y1: number]; alpha: number; blur: number }

/**
 * A shadow image `size` meters across, 200 px per meter: a soft shade of `alpha` over each footprint, and
 * darker contact spots at the feet. Positions are meters from the image's center, x right and y down.
 */
async function shadowImage(size: Vec2, footprints: Footprint[], feet: Vec2[] = [], footAlpha = 0) {
  const PX = 200;
  const [w, h] = [Math.round(size[0] * PX), Math.round(size[1] * PX)];
  const layer = async (paint: (x: number, y: number) => boolean, blur: number) => {
    const grey = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) grey[y * w + x] = paint((x + 0.5) / PX - size[0] / 2, (y + 0.5) / PX - size[1] / 2) ? 255 : 0;
    const blurred = await sharp(Buffer.from(grey), { raw: { width: w, height: h, channels: 1 } }).blur(Math.max(0.3, blur * PX)).raw().toBuffer();
    return Float32Array.from(blurred, (v) => v / 255);
  };
  let alpha = new Float32Array(w * h);
  for (const { rect: [x0, y0, x1, y1], alpha: a, blur } of footprints) {
    const shade = await layer((x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1, blur);
    alpha = alpha.map((v, i) => 1 - (1 - v) * (1 - a * shade[i]));
  }
  if (feet.length) {
    const spots = await layer((x, y) => feet.some(([fx, fy]) => Math.hypot(x - fx, y - fy) < 0.02), 0.015);
    alpha = alpha.map((v, i) => 1 - (1 - v) * (1 - Math.min(1, footAlpha * spots[i] * 2.5)));
  }
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) rgba[4 * i + 3] = Math.round(255 * alpha[i]);
  return sharp(Buffer.from(rgba), { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
}

/* ───────────── Master Copies: meters, +Y up, +Z front, origin at the footprint's center ───────────── */

/**
 * The oak leg's image, wrapped once round the leg: its grain along it, and the light falling off round
 * it, brightest on one side, so on average it is the real legs' color as the captures show them (162, 98, 42).
 */
async function roundLeg(strip: Img): Promise<Img> {
  const out = blank(128, strip.h);
  for (let y = 0; y < out.h; y++) {
    for (let x = 0; x < out.w; x++) {
      const light = 0.62 + 0.38 * Math.max(0, Math.cos(2 * Math.PI * ((x + 0.5) / out.w - 0.5)));
      const source = 3 * (y * strip.w + (x % strip.w));
      for (let k = 0; k < 3; k++) out.d[3 * (y * out.w + x) + k] = strip.d[source + k] * light;
    }
  }
  const [m, real] = [mean(out), [162, 98, 42]];
  return scaled(out, real.map((c, k) => c / m[k]) as RGB);
}

/**
 * The real tabletop's photo, without the scan's smudges (spec §3: "with smudges removed"): the dark blots
 * are filled from the laminate around them. At twice the photo's size, with the laminate's fine grain.
 */
async function cleanLaminate(file: string): Promise<Img> {
  const img = await read(file, 2);
  const lum = Array.from({ length: img.w * img.h }, (_, i) => 0.2126 * img.d[3 * i] + 0.7152 * img.d[3 * i + 1] + 0.0722 * img.d[3 * i + 2]);
  const median = lum.toSorted((a, b) => a - b)[Math.floor(lum.length / 2)];
  const blot = new Uint8Array(img.w * img.h);
  const R = 6;
  lum.forEach((l, i) => {
    if (l > median - 10) return;
    const [x, y] = [i % img.w, Math.floor(i / img.w)];
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) if (x + dx >= 0 && x + dx < img.w && y + dy >= 0 && y + dy < img.h) blot[(y + dy) * img.w + x + dx] = 1;
  });
  // Fill each blot with the blurred laminate around it: blur(color × keep) / blur(keep).
  const blur = async (values: Float32Array | number[]) => Float32Array.from(await sharp(Buffer.from(Uint8ClampedArray.from(values)), { raw: { width: img.w, height: img.h, channels: 1 } }).blur(14).raw().toBuffer());
  const keep = await blur(Array.from(blot, (b) => (b ? 0 : 255)));
  for (let k = 0; k < 3; k++) {
    const kept = await blur(Array.from({ length: img.w * img.h }, (_, i) => (blot[i] ? 0 : img.d[3 * i + k])));
    for (let i = 0; i < img.w * img.h; i++) if (blot[i] && keep[i] > 4) img.d[3 * i + k] = (kept[i] / keep[i]) * 255;
  }
  // The scan's banding goes, the laminate's real shading stays; then the laminate's own fine grain.
  const smooth = await read(await sharp(Buffer.from(Uint8ClampedArray.from(img.d)), { raw: { width: img.w, height: img.h, channels: 3 } }).blur(3).png().toBuffer());
  for (let i = 0; i < img.w * img.h; i++) {
    const grain = 1 + 0.03 * (random() - 0.5);
    for (let k = 0; k < 3; k++) smooth.d[3 * i + k] *= grain;
  }
  return smooth;
}

const metal = (gain: number | RGB, size = 256) => read(METAL, [size, size]).then((img) => jpeg(scaled(img, gain)));

/** The lounge's chair: a white plastic shell, a sage seat pad in its triangle-grid fabric, four splayed oak legs. */
async function chair(): Promise<Node[]> {
  const fabric = await read(join(SOURCES, 'fabric.jpg'));
  const shell = await read(join(SOURCES, 'shell.jpg'));
  // The pad's and the shell's sides face away from the room's light, so they are darker, as the captures show them.
  // The shell keeps the real plastic's tone and fine texture, lit from above; not the capture's shading of its own
  // curves, which would read as shapes on this simpler back. The faces away from the light are darker.
  const fine = await fineTexture(shell, 10);
  const tone = mean(shell);
  const plastic = { ...fine, d: fine.d.map((v, i) => (v / 128) * tone[i % 3] * (1.05 - 0.1 * (Math.floor(i / 3 / fine.w) / fine.h))) };
  const [fabricTop, fabricSide, shellLit, shellShade] = await Promise.all([jpeg(fabric), jpeg(scaled(fabric, 0.62)), jpeg(plastic), jpeg(scaled(plastic, 0.8))]);
  const oak = await jpeg(await roundLeg(await read(join(SOURCES, 'oak.jpg'))));
  const plateMetal = await metal([0.32, 0.33, 0.35]);

  const [padTop, padSides, shellTop, shellSides] = [empty(), empty(), empty(), empty()];
  box(padTop, padSides, [-0.2, 0.425, -0.19], [0.2, 0.465, 0.21]);
  box(shellTop, shellSides, [-0.21, 0.405, -0.205], [0.21, 0.425, 0.22]);

  // The back: a shell curved round the sitter (a 0.40 m radius about a point in front of it), rising from the
  // seat's shell and leaning back 6°; white in front, shaded behind, 12 mm thick. It reaches 0.25 m behind
  // the chair's middle, so two chairs standing back to back between tables still clear each other.
  const [front, rear] = [empty(), empty()];
  const R = 0.4;
  const backAt = (s: number, t: number, offset: number): Vec3 => {
    const phi = (s - 0.5) * (0.42 / R);
    const y = 0.41 + 0.42 * t;
    return [(R + offset) * Math.sin(phi), y, -0.19 + R - (R + offset) * Math.cos(phi) - (y - 0.41) * Math.tan((6 * Math.PI) / 180)];
  };
  surface(front, 16, 6, (s, t) => backAt(s, t, 0), (s, t) => [s, 1 - t]);
  surface(rear, 16, 6, (s, t) => backAt(s, t, 0.012), (s, t) => [s, 1 - t], true);
  surface(rear, 16, 1, (s, t) => backAt(s, 1, 0.012 * t), (s) => [s, 0]);   // its top edge

  const legs = empty();
  const feet: Vec2[] = [];
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    leg(legs, [0.165 * x, 0.405, 0.155 * z], [0.205 * x, 0, 0.195 * z], 0.015, 0.011, 0.143, 1);
    feet.push([0.205 * x, 0.195 * z]);
  }
  const [plateTop, plate] = [empty(), empty()];
  box(plateTop, plate, [-0.15, 0.395, -0.14], [0.15, 0.405, 0.14], 0.2);

  return [
    { name: 'seat', parts: [{ shape: padTop, image: fabricTop }, { shape: padSides, image: fabricSide }, { shape: shellTop, image: shellLit }, { shape: shellSides, image: shellShade }] },
    { name: 'back', parts: [{ shape: front, image: shellLit }, { shape: rear, image: shellShade }] },
    { name: 'legs', parts: [{ shape: legs, image: oak, mirror: true }, { shape: plate, image: plateMetal, mirror: true }, { shape: plateTop, image: plateMetal, mirror: true }] },
    { name: 'shadow', parts: [{ shape: quad(0.8, 0.8, 0.002), png: true, image: await shadowImage([0.8, 0.8], [{ rect: [-0.2, -0.2, 0.2, 0.21], alpha: 0.34, blur: 0.05 }], feet, 0.5) }] },
  ];
}

/** The lounge's table: the real tabletop's photo on a light laminate slab, four charcoal legs on casters. */
async function table(): Promise<Node[]> {
  const [w, d, h] = [1.49, 1.05, 0.75];
  const laminate = await cleanLaminate(join(LOUNGE, 'table_top.png'));
  const [topPhoto, edge] = await Promise.all([jpeg(laminate), jpeg(scaled(laminate, 0.82))]);
  const [charcoal, black] = await Promise.all([metal([0.3, 0.31, 0.33]), metal(0.12, 64)]);

  const [top, edges] = [empty(), empty()];
  box(top, edges, [-w / 2, h - 0.028, -d / 2], [w / 2, h, d / 2]);
  const [legTops, legs, casters] = [empty(), empty(), empty()];
  const feet: Vec2[] = [];
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const [cx, cz] = [x * (w / 2 - 0.07), z * (d / 2 - 0.07)];
    box(legTops, legs, [cx - 0.02, 0.07, cz - 0.02], [cx + 0.02, h - 0.028, cz + 0.02], 0.25);
    box(casters, casters, [cx - 0.025, 0.05, cz - 0.03], [cx + 0.025, 0.07, cz + 0.03]);
    leg(casters, [cx - 0.012, 0.025, cz], [cx + 0.012, 0.025, cz], 0.025, 0.025, 1);
    feet.push([cx, cz]);
  }
  // Rails under the top along its long sides.
  for (const z of [-1, 1]) box(legTops, legs, [-w / 2 + 0.09, h - 0.07, z * (d / 2 - 0.07) - 0.015], [w / 2 - 0.09, h - 0.028, z * (d / 2 - 0.07) + 0.015], 0.25);

  return [
    { name: 'top', parts: [{ shape: top, image: topPhoto }, { shape: edges, image: edge }] },
    { name: 'legs', parts: [{ shape: legs, image: charcoal, mirror: true }, { shape: legTops, image: charcoal, mirror: true }, { shape: casters, image: black }] },
    { name: 'shadow', parts: [{ shape: quad(1.9, 1.45, 0.002), png: true, image: await shadowImage([1.9, 1.45], [{ rect: [-w / 2, -d / 2, w / 2, d / 2], alpha: 0.26, blur: 0.12 }], feet, 0.55) }] },
  ];
}

/** The lounge's whiteboard: the real board's photo, writing and all, in an aluminum frame with a tray. */
async function whiteboard(): Promise<Node[]> {
  const [w, h] = [6.06, 1.17];
  const [board, aluminum, aluminumShade] = await Promise.all([jpegOf(join(LOUNGE, 'whiteboard.png')), metal(1.3), metal(0.9)]);
  // The board's face, 0.055–1.225 m up, facing +Z just in front of its backing.
  const [face, sides] = [empty(), empty()];
  plane(face, [-w / 2, 0.055 + h, -0.025], [w, 0, 0], [0, -h, 0], [0, 0, 1], 10, (s, t) => [s, t]);
  box(sides, sides, [-w / 2, 0.055, -0.04], [w / 2, 0.055 + h, -0.027]);
  const [frameFront, frameRest] = [empty(), empty()];
  const f = 0.025;
  for (const [x0, y0, x1, y1] of [[-w / 2 - f, 0.03, w / 2 + f, 0.055], [-w / 2 - f, 0.055 + h, w / 2 + f, 0.08 + h], [-w / 2 - f, 0.055, -w / 2, 0.055 + h], [w / 2, 0.055, w / 2 + f, 0.055 + h]]) {
    plane(frameFront, [x0, y1, -0.018], [x1 - x0, 0, 0], [0, -(y1 - y0), 0], [0, 0, 1], 10, faceUv(x1 - x0, y1 - y0, 0.25));
    box(frameRest, frameRest, [x0, y0, -0.04], [x1, y1, -0.018], 0.25);
  }
  // The tray along the bottom.
  box(frameFront, frameRest, [-w / 2 + 0.2, 0, -0.04], [w / 2 - 0.2, 0.03, 0.04], 0.25);
  // Its shadow on the wall behind: the board's, a little low, and the tray's, below it. The board's middle is 0.64 m up.
  const shadow = await shadowImage([6.4, 1.6], [
    { rect: [-w / 2 - 0.02, -0.57, w / 2 + 0.02, 0.62], alpha: 0.2, blur: 0.02 },
    { rect: [-w / 2 + 0.2, 0.62, w / 2 - 0.2, 0.68], alpha: 0.32, blur: 0.025 },
  ]);
  return [
    { name: 'board', parts: [{ shape: face, image: board }, { shape: sides, image: aluminumShade, mirror: true }] },
    { name: 'frame', parts: [{ shape: frameFront, image: aluminum, mirror: true }, { shape: frameRest, image: aluminumShade, mirror: true }] },
    { name: 'shadow', parts: [{ shape: quad(6.4, 1.6, 0.64, true), png: true, image: shadow }], translation: [0, 0, -0.039] },
  ];
}

/* ───────────── Setup ───────────── */

/**
 * synthetic-study's tables, and its four chairs at each: two on the North side facing South, two on the South
 * side facing North, tucked 0.43 m from the table's middle (synthetic-study has 0.45 m, where the backs of the
 * chairs between two tables would touch).
 */
const tables: Vec2[] = [[-0.784, -1.691], [-0.784, -0.307], [-0.784, 1.734]];
const chairs = tables.flatMap(([, z]) => [-1, 1].flatMap((side) => [-1.154, -0.414].map((x): [number, number, number] => [x, z + side * 0.43, side < 0 ? 0 : Math.PI])));

async function main() {
  const { nodes, floorColor } = await roomNodes();
  const original = (id: string, label: string, category: Original['category'], model: string, position: Vec3, size: Vec3, rotationY: number): Original =>
    ({ id, label, category, model, box: { position, size, rotationY }, kept: false, floorColor: hex(floorColor) });
  const setup: RoomSetup = {
    version: 1,
    scanId: ID,
    ceilingHeight: H,
    floor: { polygon: corners },
    walls,
    openings,
    originals: [
      ...tables.map(([x, z], i) => original(`og_table_${i + 1}`, `Table ${i + 1}`, 'table', 'models/table.glb', [x, 0, z], [1.49, 0.75, 1.05], 0)),
      ...chairs.map(([x, z, r], i) => original(`og_chair_${i + 1}`, `Chair ${i + 1}`, 'chair', 'models/chair.glb', [x, 0, z], [0.45, 0.85, 0.5], r)),
      // The real board: 0–6.06 m along the East wall from its North end, 0.85–2.02 m up, with its frame and tray.
      original('og_whiteboard', 'Whiteboard', 'wall_art', 'models/whiteboard.glb', [X1 - 0.04, 0.795, Z0 + 3.03], [6.11, 1.25, 0.08], -Math.PI / 2),
    ],
  };
  const manifest: ScanManifest = { version: 1, id: ID, name: 'Test room with Master Copies', mesh: 'room.glb', meshTransform: { position: [0, 0, 0], rotationY: 0 } };

  await mkdir(join(DIR, 'models'), { recursive: true });
  const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
  await writeFile(join(DIR, 'manifest.json'), json(manifest));
  await writeFile(join(DIR, 'setup.json'), json(setup));
  await writeFile(join(DIR, 'room.glb'), await glb(nodes));
  await writeFile(join(DIR, 'models/chair.glb'), await glb(await chair()));
  await writeFile(join(DIR, 'models/table.glb'), await glb(await table()));
  await writeFile(join(DIR, 'models/whiteboard.glb'), await glb(await whiteboard()));
  console.log(`Wrote ${ID}: room.glb, models/{chair,table,whiteboard}.glb, setup.json, manifest.json`);
}

await main();
