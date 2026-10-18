// scripts/objects-build.ts — Catalog items no free model covers, modeled here from boxes and cylinders: record players,
// a vinyl wall display, a record crate. scripts/objects-build.ts → data/catalog/objects/.
//
//   npx tsx scripts/objects-build.ts [--only <id,id…>]
//
// Poly Haven, Google Scanned Objects and ABO have no record player and no modern flat-screen TV or monitor (Objaverse's
// TVs are mostly old CRTs, and its monitors carry brands; checked October 2026), so these are simple originals with no
// brand on them. Writes data/catalog/objects/<id>.glb and <id>.jpg (rendered from the GLB), and
// data/catalog/objects.json (a Catalog).

import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { Document, type Material, type TypedArray } from '@gltf-transform/core';
import { getBounds } from '@gltf-transform/functions';
import sharp from 'sharp';
import type { Catalog, CatalogItem, Category, Hex, Vec3 } from '../shared/types';
import { optimizeModel } from './catalog-build';
import { writeGlb } from './catalog/gso';
import { renderThumbnails } from './catalog/thumbnail';

/* ───────────── Geometry ───────────── */

/** Triangles for one glTF primitive. */
export interface Mesh { positions: number[]; normals: number[]; uvs: number[]; indices: number[] }
const emptyMesh = (): Mesh => ({ positions: [], normals: [], uvs: [], indices: [] });

/** A point turned `angle` radians about +Y (counterclockwise from above) around `pivot`. */
function turnY([x, y, z]: Vec3, angle: number, [px, , pz]: Vec3 = [0, 0, 0]): Vec3 {
  const [c, s] = [Math.cos(angle), Math.sin(angle)];
  const [dx, dz] = [x - px, z - pz];
  return [px + dx * c + dz * s, y, pz - dx * s + dz * c];
}

/** Adds one quad, corners counterclockwise seen from the side its normal faces, with planar UVs from `uv`. */
function quad(mesh: Mesh, corners: Vec3[], normal: Vec3, uv: (p: Vec3) => [number, number]) {
  const start = mesh.positions.length / 3;
  for (const p of corners) {
    mesh.positions.push(...p);
    mesh.normals.push(...normal);
    mesh.uvs.push(...uv(p));
  }
  mesh.indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
}

/** A point tipped `angle` radians about +Z (counterclockwise seen from the front) around `pivot`. */
function tipZ([x, y, z]: Vec3, angle: number, [px, py]: Vec3 = [0, 0, 0]): Vec3 {
  const [c, s] = [Math.cos(angle), Math.sin(angle)];
  const [dx, dy] = [x - px, y - py];
  return [px + dx * c - dy * s, py + dx * s + dy * c, z];
}

/**
 * Adds a box: `center` is its bottom center, `size` [w, h, d], tipped `lean` radians about +Z around its bottom
 * center, as a book leaning on its neighbor, then turned `turn` radians about +Y. Its UVs tile every `tile` m, so a
 * wood or leather texture keeps its scale on every face; `upright` runs the texture's u up the box, as the grain runs
 * up a bookcase's sides. Its faces are front, back, right, left, top and bottom, four corners each, so a caller can map
 * each face to its own part of a texture.
 */
export function addBox(mesh: Mesh, center: Vec3, [w, h, d]: Vec3, { turn = 0, lean = 0, tile = 0.3, upright = false }:
  { turn?: number; lean?: number; tile?: number; upright?: boolean } = {}) {
  const [cx, cy, cz] = center;
  const p = (x: number, y: number, z: number) => turnY(tipZ([cx + x, cy + y, cz + z], lean, center), turn, center);
  const n = (normal: Vec3) => turnY(tipZ(normal, lean), turn);
  const [x0, x1, z0, z1] = [-w / 2, w / 2, -d / 2, d / 2];
  const uvXY = (a: number, b: number) => (q: Vec3) => (upright && b === 1 ? [-q[b] / tile, q[a] / tile] : [q[a] / tile, -q[b] / tile]) as [number, number];
  quad(mesh, [p(x0, 0, z1), p(x1, 0, z1), p(x1, h, z1), p(x0, h, z1)], n([0, 0, 1]), uvXY(0, 1));    // front
  quad(mesh, [p(x1, 0, z0), p(x0, 0, z0), p(x0, h, z0), p(x1, h, z0)], n([0, 0, -1]), uvXY(0, 1));   // back
  quad(mesh, [p(x1, 0, z1), p(x1, 0, z0), p(x1, h, z0), p(x1, h, z1)], n([1, 0, 0]), uvXY(2, 1));    // right
  quad(mesh, [p(x0, 0, z0), p(x0, 0, z1), p(x0, h, z1), p(x0, h, z0)], n([-1, 0, 0]), uvXY(2, 1));   // left
  quad(mesh, [p(x0, h, z1), p(x1, h, z1), p(x1, h, z0), p(x0, h, z0)], n([0, 1, 0]), uvXY(0, 2));    // top
  quad(mesh, [p(x0, 0, z0), p(x1, 0, z0), p(x1, 0, z1), p(x0, 0, z1)], n([0, -1, 0]), uvXY(0, 2));   // bottom
}

/**
 * Adds a cylinder standing on `base` (its bottom center), or, with `facing: 'z'`, lying with its axis along +Z and its
 * back face at base's z. Its top (or front) cap's UVs map a square texture onto the disc, as a record's label needs.
 */
export function addCylinder(mesh: Mesh, base: Vec3, radius: number, height: number, { facing = 'y', segments = 48, caps = true }: { facing?: 'y' | 'z'; segments?: number; caps?: boolean } = {}) {
  // Built standing, about the origin; `place` moves each point to where it goes.
  const place = ([x, y, z]: Vec3): Vec3 => (facing === 'y' ? [base[0] + x, base[1] + y, base[2] + z] : [base[0] + x, base[1] - z, base[2] + y]);
  const turn = ([x, y, z]: Vec3): Vec3 => (facing === 'y' ? [x, y, z] : [x, -z, y]);
  const ring = (t: number): Vec3 => [radius * Math.cos(t), 0, -radius * Math.sin(t)];
  const capUv = ([x, , z]: Vec3): [number, number] => [x / (2 * radius) + 0.5, z / (2 * radius) + 0.5];
  for (let i = 0; i < segments; i++) {
    const [a, b] = [(i / segments) * Math.PI * 2, ((i + 1) / segments) * Math.PI * 2];
    const [pa, pb] = [ring(a), ring(b)];
    const start = mesh.positions.length / 3;
    for (const [p, y] of [[pa, 0], [pb, 0], [pb, height], [pa, height]] as const) {
      mesh.positions.push(...place([p[0], y, p[2]]));
      mesh.normals.push(...turn([p[0] / radius, 0, p[2] / radius]));
      mesh.uvs.push((p === pa ? i : i + 1) / segments, y === 0 ? 1 : 0);
    }
    mesh.indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
    if (!caps) continue;
    for (const [y, normal, order] of [[height, [0, 1, 0], [0, 1, 2]], [0, [0, -1, 0], [0, 2, 1]]] as const) {
      const first = mesh.positions.length / 3;
      for (const p of [[0, 0, 0] as Vec3, pa, pb]) {
        mesh.positions.push(...place([p[0], y, p[2]]));
        mesh.normals.push(...turn(normal as unknown as Vec3));
        mesh.uvs.push(...capUv(p));
      }
      mesh.indices.push(...order.map((k) => first + k));
    }
  }
}

/**
 * Adds a surface turned about +Y through `base`: `profile` is [radius, height] pairs from its bottom up, as a lampshade,
 * a globe or a vase is drawn on a lathe. A point given twice makes a crease there. With `pleats`, the radius folds in
 * by `fold` that many times around, as a pleated shade does, and each fold is shaded flat. Its UVs run once around in
 * u, and from its top (0) to its bottom (1) in v.
 */
export function addLathe(mesh: Mesh, base: Vec3, profile: [radius: number, y: number][], { segments = 48, pleats = 0, fold = 0.08 }: { segments?: number; pleats?: number; fold?: number } = {}) {
  const around = pleats ? pleats * 2 : segments;
  const angle = (i: number) => (i / around) * Math.PI * 2;
  const at = (i: number, [r, y]: [number, number]): Vec3 => {
    const radius = r * (pleats && i % 2 ? 1 - fold : 1);
    return [base[0] + radius * Math.cos(angle(i)), base[1] + y, base[2] - radius * Math.sin(angle(i))];
  };
  // The profile's outward normal at each point, from the points on either side, as [radial, y].
  // At a crease, the first of the two points takes the way in, the second the way out.
  const last = profile.length - 1;
  const same = (j: number, k: number) => profile[k] && profile[j][0] === profile[k][0] && profile[j][1] === profile[k][1];
  const outward = profile.map((_, j) => {
    const from = same(j, j - 1) ? j : Math.max(j - 1, 0);
    const to = same(j, j + 1) ? j : Math.min(j + 1, last);
    const [dr, dy] = [profile[to][0] - profile[from][0], profile[to][1] - profile[from][1]];
    const length = Math.hypot(dr, dy) || 1;
    return [dy / length, -dr / length];
  });
  for (let i = 0; i < around; i++) {
    for (let j = 0; j < last; j++) {
      const corners = [at(i, profile[j]), at(i + 1, profile[j]), at(i + 1, profile[j + 1]), at(i, profile[j + 1])];
      const start = mesh.positions.length / 3;
      // A pleat is shaded flat: one normal for its face. A smooth surface takes each point's normal on the profile.
      const [a, b, , c] = corners;
      const [ux, uy, uz, vx, vy, vz] = [b[0] - a[0], b[1] - a[1], b[2] - a[2], c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const flat: Vec3 = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
      const flatLength = Math.hypot(...flat) || 1;
      for (const [k, [ii, jj]] of [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]].entries()) {
        mesh.positions.push(...corners[k]);
        const [radial, up] = outward[jj];
        mesh.normals.push(...(pleats
          ? flat.map((value) => value / flatLength)
          : [radial * Math.cos(angle(ii)), up, -radial * Math.sin(angle(ii))]));
        mesh.uvs.push(ii / around, jj / last);
      }
      mesh.indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
    }
  }
}

/** A lathe profile of a sphere of `radius` resting on its bottom, in `steps` from the bottom pole to the top. */
const sphere = (radius: number, steps = 16): [number, number][] =>
  Array.from({ length: steps + 1 }, (_, k) => {
    const polar = (k / steps) * Math.PI;
    return [radius * Math.sin(polar), radius * (1 - Math.cos(polar))] as [number, number];
  });

const plus = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const minus = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const times = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: Vec3): Vec3 => times(a, 1 / (Math.hypot(...a) || 1));

/**
 * Adds a tube of `radius` along `path`, as a wire, a vine, a cord or a neon tube is drawn: a ring of `sides` points
 * about each point of the path, each ring turned from the last one with the path, so the tube doesn't twist. Its ends
 * are open.
 */
export function addTube(mesh: Mesh, path: Vec3[], radius: number, { sides = 8 }: { sides?: number } = {}) {
  const tangents = path.map((_, i) => unit(minus(path[Math.min(i + 1, path.length - 1)], path[Math.max(i - 1, 0)])));
  let normal = unit(cross(tangents[0], Math.abs(tangents[0][1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
  const first = mesh.positions.length / 3;
  for (const [i, p] of path.entries()) {
    const t = tangents[i];
    normal = unit(minus(normal, times(t, dot(normal, t))));
    const binormal = cross(t, normal);
    for (let k = 0; k <= sides; k++) {
      const angle = (k / sides) * Math.PI * 2;
      const n = plus(times(normal, Math.cos(angle)), times(binormal, Math.sin(angle)));
      mesh.positions.push(...plus(p, times(n, radius)));
      mesh.normals.push(...n);
      mesh.uvs.push(i / (path.length - 1), k / sides);
    }
  }
  for (let i = 0; i < path.length - 1; i++) {
    for (let k = 0; k < sides; k++) {
      const [a, b] = [first + i * (sides + 1) + k, first + (i + 1) * (sides + 1) + k];
      mesh.indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
}

/** A wire hung from `from` to `to`, sagging `sag` at its middle as a swag of lights or a garland does, in `steps`. */
function swag(from: Vec3, to: Vec3, sag: number, steps = 24): Vec3[] {
  return Array.from({ length: steps + 1 }, (_, k) => {
    const t = k / steps;
    return plus(plus(from, times(minus(to, from), t)), [0, -4 * sag * t * (1 - t), 0]);
  });
}

/** Points every `spacing` m along `path`, the first `start` m along it, with the way the path runs there: bulbs on a wire, leaves on a vine. */
function every(path: Vec3[], spacing: number, start = spacing / 2): { at: Vec3; along: Vec3 }[] {
  const points: { at: Vec3; along: Vec3 }[] = [];
  let [next, walked] = [start, 0];
  for (let i = 0; i < path.length - 1; i++) {
    const step = minus(path[i + 1], path[i]);
    const length = Math.hypot(...step);
    if (!length) continue;
    for (; next <= walked + length; next += spacing) points.push({ at: plus(path[i], times(step, (next - walked) / length)), along: unit(step) });
    walked += length;
  }
  return points;
}

/**
 * Adds a leaf, or a plume: a card `length` long from `base` along `along`, stem to tip, and `width` wide, facing `facing`
 * as nearly as it can, its sides folded toward it by `fold` of its half width, as a leaf cups along its midrib. Its
 * texture is the leaf pointing up with its stem at the bottom middle, cut out by its alpha; its material shows both sides.
 */
function addLeaf(mesh: Mesh, base: Vec3, along: Vec3, facing: Vec3, length: number, width: number, fold = 0.3) {
  const up = unit(along);
  const across = times(unit(cross(up, facing)), width / 2);
  const lift = times(unit(cross(across, up)), (fold * width) / 2);
  const tip = plus(base, times(up, length));
  const halves: [Vec3[], number][] = [
    [[plus(minus(base, across), lift), base, tip, plus(minus(tip, across), lift)], 0],
    [[base, plus(plus(base, across), lift), plus(plus(tip, across), lift), tip], 0.5],
  ];
  for (const [corners, u] of halves) {
    const normal = unit(cross(minus(corners[1], corners[0]), minus(corners[3], corners[0])));
    const start = mesh.positions.length / 3;
    corners.forEach((p, k) => {
      mesh.positions.push(...p);
      mesh.normals.push(...normal);
      mesh.uvs.push(u + (k === 1 || k === 2 ? 0.5 : 0), k < 2 ? 1 : 0);
    });
    mesh.indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
  }
}

/** Keeps every point of `mesh` in front of the wall, `z` m or more out: leaves that grew behind a wall piece lie flat on the wall. */
function clearOfWall(mesh: Mesh, z = 0.003) {
  for (let i = 2; i < mesh.positions.length; i += 3) mesh.positions[i] = Math.max(mesh.positions[i], z);
}

/** A seeded random number in [0, 1), the same on every build, so each object's books keep their colors and sizes. */
function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ───────────── Textures ───────────── */

/** A wood grain texture from SVG noise stretched along u, as posters-build draws its oak frames. */
async function woodTexture(light: Hex, dark: Hex): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">
    <filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="0.003 0.08" numOctaves="4" seed="11"/>
      <feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -0.9 0.75"/></filter>
    <rect width="512" height="512" fill="${light}"/><rect width="512" height="512" fill="${dark}" filter="url(#grain)"/></svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 86 }).toBuffer();
}

/** A record seen from above: fine grooves, a lead-in band, and a label in `label` with a lighter ring, no words. */
async function vinylTexture(label: Hex, ring: Hex): Promise<Buffer> {
  const grooves = Array.from({ length: 70 }, (_, i) => {
    const r = 168 + i * 4.8;
    return `<circle cx="512" cy="512" r="${r.toFixed(1)}" fill="none" stroke="${i % 9 === 0 ? '#2a2a2a' : i % 2 ? '#141414' : '#1c1c1c'}" stroke-width="${i % 9 === 0 ? 3 : 2.4}"/>`;
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">
    <rect width="1024" height="1024" fill="#161616"/>
    <circle cx="512" cy="512" r="510" fill="#121212"/>${grooves.join('')}
    <circle cx="512" cy="512" r="166" fill="${label}"/>
    <circle cx="512" cy="512" r="120" fill="none" stroke="${ring}" stroke-width="10"/>
    <circle cx="512" cy="512" r="60" fill="none" stroke="${ring}" stroke-width="4" opacity="0.7"/>
    <circle cx="512" cy="512" r="12" fill="#0b0b0b"/></svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 88 }).toBuffer();
}

/** Leatherette: a color with a fine pebbled grain. */
async function leatherTexture(color: Hex): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256">
    <filter id="g"><feTurbulence type="fractalNoise" baseFrequency="0.35" numOctaves="2" seed="4"/>
      <feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -0.5 0.32"/></filter>
    <rect width="256" height="256" fill="${color}"/><rect width="256" height="256" filter="url(#g)"/></svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 86 }).toBuffer();
}

/** A screen's wallpaper: soft blurred blobs of color on a dark field, like a lock screen, no words or logos. */
async function wallpaper(colors: Hex[], [w, h]: [number, number]): Promise<Buffer> {
  const blobs = colors.map((color, i) => {
    const [cx, cy] = [[0.25, 0.7], [0.7, 0.35], [0.55, 0.85], [0.15, 0.2]][i % 4];
    return `<ellipse cx="${cx * w}" cy="${cy * h}" rx="${w * 0.42}" ry="${h * 0.5}" fill="${color}" opacity="0.85"/>`;
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <filter id="b" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${w / 9}"/></filter>
    <rect width="${w}" height="${h}" fill="#0d0f1a"/><g filter="url(#b)">${blobs.join('')}</g></svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 88 }).toBuffer();
}

/** A speaker grille: fine dark mesh. */
async function grilleTexture(): Promise<Buffer> {
  const dots = Array.from({ length: 32 * 32 }, (_, i) => `<circle cx="${(i % 32) * 8 + 4}" cy="${Math.floor(i / 32) * 8 + 4}" r="2.2" fill="#0a0a0a"/>`);
  return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#2a2a2a"/>${dots.join('')}</svg>`)).jpeg({ quality: 86 }).toBuffer();
}

/** Adds a flat quad facing +Z at depth z, `w` × `h` with its bottom center at (x, y), its texture upright on it. */
function addScreen(mesh: Mesh, [x, y, z]: Vec3, w: number, h: number) {
  quad(mesh, [[x - w / 2, y, z], [x + w / 2, y, z], [x + w / 2, y + h, z], [x - w / 2, y + h, z]], [0, 0, 1], ([px, py]) => [(px - (x - w / 2)) / w, 1 - (py - y) / h]);
}

/**
 * Adds a panel curved about a vertical axis behind it (an ultrawide monitor): `w` wide along the arc, `h` tall, its
 * front face's middle at (x, y, z), bending back by `sag` at its ends. Its front carries the texture; `depth` thick.
 */
function addCurvedPanel(mesh: Mesh, [x, y, z]: Vec3, w: number, h: number, depth: number, sag: number, front: boolean, segments = 24) {
  const r = (w * w) / (8 * sag) + sag / 2;   // a circle through the middle and both ends, for a chord of about w
  const half = w / (2 * r);
  const at = (t: number, inset: number): Vec3 => {
    const angle = -half + t * 2 * half;
    return [x + (r - inset) * Math.sin(angle), y, z - r + (r - inset) * Math.cos(angle)];
  };
  for (let i = 0; i < segments; i++) {
    const [t0, t1] = [i / segments, (i + 1) / segments];
    const inset = front ? 0 : depth;
    const [a, b] = [at(t0, inset), at(t1, inset)];
    const mid = (t0 + t1) / 2;
    const angle = -half + mid * 2 * half;
    const normal: Vec3 = front ? [Math.sin(angle), 0, Math.cos(angle)] : [-Math.sin(angle), 0, -Math.cos(angle)];
    const corners: Vec3[] = front
      ? [[a[0], y, a[2]], [b[0], y, b[2]], [b[0], y + h, b[2]], [a[0], y + h, a[2]]]
      : [[b[0], y, b[2]], [a[0], y, a[2]], [a[0], y + h, a[2]], [b[0], y + h, b[2]]];
    const start = mesh.positions.length / 3;
    corners.forEach((p, k) => {
      mesh.positions.push(...p);
      mesh.normals.push(...normal);
      const u = front ? (k === 0 || k === 3 ? t0 : t1) : (k === 0 || k === 3 ? t1 : t0);
      mesh.uvs.push(u, k < 2 ? 1 : 0);
    });
    mesh.indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
  }
}

/** A record sleeve's spine: a flat color with a band, as a crate of records shows them from above. */
async function sleeveTexture(colors: Hex[]): Promise<Buffer> {
  const bands = colors.map((color, i) => `<rect x="${i * (512 / colors.length)}" width="${512 / colors.length}" height="64" fill="${color}"/>`);
  return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="64">${bands.join('')}</svg>`)).png().toBuffer();
}

/** How a book's spine is dressed: gilt bands and a label (a hardcover), a publisher's band (a paperback), or nothing. */
interface Spine { color: Hex; trim: Hex; style: 'gilt' | 'band' | 'plain' }

/** Each column of the spine atlas, in px: books take one each, then one for the pages. */
const SPINE_PX: [width: number, height: number] = [64, 512];
/**
 * Spines side by side, then a column of cream pages, no words: a title is a few bars of the trim color. A book's
 * covers take the column's plain edge, so every face of a book comes from its own column.
 */
async function spineTexture(spines: Spine[]): Promise<Buffer> {
  const [w, h] = SPINE_PX;
  const column = ({ color, trim, style }: Spine, i: number) => {
    const x = i * w;
    const bars = (y0: number, count: number, gap: number) => Array.from({ length: count }, (_, k) =>
      `<rect x="${x + 22}" y="${y0 + k * gap}" width="20" height="${gap * 0.55}" rx="3" fill="${trim}"/>`).join('');
    const parts = {
      gilt: `<rect x="${x}" y="34" width="${w}" height="5" fill="${trim}"/><rect x="${x}" y="46" width="${w}" height="3" fill="${trim}"/>
        <rect x="${x + 12}" y="88" width="40" height="110" fill="#1d1712" stroke="${trim}" stroke-width="3"/>${bars(104, 4, 22)}
        <rect x="${x}" y="452" width="${w}" height="3" fill="${trim}"/><rect x="${x}" y="462" width="${w}" height="5" fill="${trim}"/>`,
      band: `<rect x="${x}" y="0" width="${w}" height="70" fill="${trim}"/>${bars(110, 9, 30)}
        <rect x="${x + 20}" y="440" width="24" height="24" rx="12" fill="${trim}"/>`,
      plain: `${bars(70, 6, 26)}`,
    };
    return `<rect x="${x}" width="${w}" height="${h}" fill="${color}"/>${parts[style]}`;
  };
  const pages = spines.length * w;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${pages + w}" height="${h}">${spines.map(column).join('')}
    <rect x="${pages}" width="${w}" height="${h}" fill="#efe6d2"/></svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer();
}

/** Rice paper over a lantern's ribs: warm white, a soft fiber, and a rib every `ribs`th of its height. */
async function paperTexture(ribs: number): Promise<Buffer> {
  const lines = Array.from({ length: ribs }, (_, i) => `<rect y="${((i + 0.5) / ribs) * 512 - 2}" width="512" height="4" fill="#c9bea6"/>`);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">
    <filter id="f"><feTurbulence type="fractalNoise" baseFrequency="0.02 0.4" numOctaves="3" seed="7"/>
      <feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -0.4 0.22"/></filter>
    <rect width="512" height="512" fill="#f6efe0"/><rect width="512" height="512" filter="url(#f)"/>${lines.join('')}</svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 86 }).toBuffer();
}

/** Stained glass, as a Tiffany-style shade: rows of panes in `colors`, a band of `band` round the rim, lead between. */
async function stainedGlassTexture(colors: Hex[], band: Hex): Promise<Buffer> {
  const random = seeded(23);
  const rows = [22, 24, 26, 28, 30, 32, 34, 36, 38, 40, 44];
  let y = 0;
  const panes: string[] = [];
  for (const [r, rowHeight] of rows.entries()) {
    const across = 22 + r * 4;
    for (let k = 0; k < across; k++) {
      const color = r === rows.length - 1 ? band : colors[Math.floor(random() * colors.length)];
      panes.push(`<rect x="${(k / across) * 1024}" y="${y}" width="${1024 / across}" height="${rowHeight}" fill="${color}" stroke="#2a1f14" stroke-width="5"/>`);
    }
    y += rowHeight;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="${y}">${panes.join('')}</svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 88 }).toBuffer();
}

/** An image from each pixel's u and v (0 to 1, v down) as RGBA from 0 to 1: a glow's smooth falloff, which SVG's gradients would band. */
async function pixelTexture([w, h]: [number, number], pixel: (u: number, v: number) => [number, number, number, number]): Promise<Buffer> {
  const data = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      pixel((x + 0.5) / w, (y + 0.5) / h).forEach((value, c) => {
        data[(y * w + x) * 4 + c] = Math.round(Math.min(Math.max(value, 0), 1) * 255);
      });
    }
  }
  return sharp(data, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
}

/** The rainbow's color `t` (0 to 1) of the way round it, as an RGB strip shows its colors along it. */
const rainbow = (t: number): Vec3 => [0, 4, 2].map((offset) => Math.min(Math.max(Math.abs(((t * 6 + offset) % 6) - 3) - 1, 0), 1)) as Vec3;

/** The light an LED strip throws on the wall it's on: brightest along its middle, fading above and below it and at its ends. */
const stripGlowTexture = (color: (u: number) => Vec3) => pixelTexture([512, 64], (u, v) => {
  const ends = Math.min(u / 0.03, (1 - u) / 0.03, 1);
  return [...color(u), 0.8 * ends * Math.exp(-((((v - 0.5) * 2) / 0.42) ** 2))];
});

/** The round glow a bulb or a sign throws on the wall behind it, `peak` opaque at its middle. */
const roundGlowTexture = (color: Vec3, peak = 0.7) => pixelTexture([64, 64], (u, v) =>
  [...color, peak * Math.exp(-(((Math.hypot(u - 0.5, v - 0.5) * 2) / 0.45) ** 2))]);

/**
 * The light a neon sign throws on the wall behind it: each tube's path, blurred wide, in its color. `frame` is the part
 * of the wall the texture covers: its left, bottom, width and height, in meters.
 */
async function neonGlowTexture(tubes: NeonTube[], [left, bottom, w, h]: [number, number, number, number]): Promise<Buffer> {
  const [tw, th] = [256, Math.round((256 * h) / w)];
  const px = ([x, y]: [number, number]) => `${(((x - left) / w) * tw).toFixed(1)},${(((bottom + h - y) / h) * th).toFixed(1)}`;
  const rgb = (color: Vec3) => `rgb(${color.map((c) => Math.round(c * 255)).join(',')})`;
  const strokes = tubes.map(({ path, color }) => `<polyline points="${path.map(px).join(' ')}" stroke="${rgb(color)}" fill="none" stroke-linejoin="round"/>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${tw}" height="${th}">
    <filter id="wide" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${tw / 14}"/></filter>
    <filter id="near" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${tw / 50}"/></filter>
    <g filter="url(#wide)" stroke-width="${tw / 18}" opacity="0.55">${strokes}</g>
    <g filter="url(#near)" stroke-width="${tw / 40}" opacity="0.6">${strokes}</g></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/** A five-lobed ivy leaf in `fill`, pointing up, its stem at the bottom middle, with paler veins; transparent around it. */
async function ivyLeafTexture(fill: Hex, vein: Hex): Promise<Buffer> {
  const leaf = 'M128 250 C110 232 64 236 30 204 C52 190 40 162 14 142 C48 130 60 110 70 84 C92 94 104 60 128 10 C152 60 164 94 186 84 C196 110 208 130 242 142 C216 162 204 190 226 204 C192 236 146 232 128 250 Z';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256">
    <radialGradient id="g" cx="0.5" cy="0.75" r="0.7"><stop offset="0" stop-color="${vein}" stop-opacity="0.35"/><stop offset="1" stop-color="${vein}" stop-opacity="0"/></radialGradient>
    <path d="${leaf}" fill="${fill}"/><path d="${leaf}" fill="url(#g)"/>
    <path d="M128 244 L128 36 M128 206 L44 150 M128 206 L212 150 M128 190 L82 96 M128 190 L174 96" stroke="${vein}" stroke-width="5" stroke-linecap="round" fill="none" opacity="0.75"/></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/** A heart-shaped pothos leaf in `fill`, pointing up, its stem at the bottom middle, streaked with `streak` as golden pothos is. */
async function pothosLeafTexture(fill: Hex, streak: Hex, seed: number): Promise<Buffer> {
  const random = seeded(seed);
  const leaf = 'M128 226 C92 252 18 232 24 158 C30 98 92 52 128 8 C164 52 226 98 232 158 C238 232 164 252 128 226 Z';
  const streaks = Array.from({ length: 9 }, () => {
    const [y, side] = [60 + random() * 160, random() < 0.5 ? -1 : 1];
    const reach = 40 + random() * 70;
    return `<path d="M128 ${y.toFixed(0)} Q${(128 + side * reach * 0.5).toFixed(0)} ${(y - 20).toFixed(0)} ${(128 + side * reach).toFixed(0)} ${(y - 50).toFixed(0)}" stroke="${streak}" stroke-width="${(3 + random() * 8).toFixed(1)}" fill="none" stroke-linecap="round"/>`;
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256">
    <clipPath id="leaf"><path d="${leaf}"/></clipPath>
    <path d="${leaf}" fill="${fill}"/><g clip-path="url(#leaf)" opacity="0.6">${streaks.join('')}</g>
    <path d="M128 226 Q125 120 128 18" stroke="${streak}" stroke-width="4" fill="none" opacity="0.7"/></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/** A pampas grass plume, pointing up, its stem at the bottom middle: fine strands fanning up and out, widest below its middle. */
async function plumeTexture(colors: Hex[]): Promise<Buffer> {
  const random = seeded(31);
  const strands = Array.from({ length: 700 }, () => {
    const s = 0.04 + random() * 0.94;                               // how far up the plume, 0 at its stem
    const spread = Math.sin(Math.PI * s ** 0.8) * 100 * (0.25 + random() * 0.75);
    const [y, side] = [250 - s * 236, random() < 0.5 ? -1 : 1];
    const color = colors[Math.floor(random() * colors.length)];
    return `<path d="M128 ${y.toFixed(1)} q${(side * spread * 0.4).toFixed(1)} ${(-spread * 0.2).toFixed(1)} ${(side * spread).toFixed(1)} ${(-spread * 0.55).toFixed(1)}" stroke="${color}" stroke-width="${(1.6 + random() * 1.6).toFixed(1)}" fill="none" stroke-linecap="round"/>`;
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256">
    <filter id="soft"><feGaussianBlur stdDeviation="0.7"/></filter>
    <g filter="url(#soft)">${strands.join('')}</g><path d="M128 256 L128 14" stroke="${colors[0]}" stroke-width="3"/></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/** The moon's face, round a sphere: pale gray with darker seas and craters, each crater with a light rim. */
async function moonTexture(): Promise<Buffer> {
  const random = seeded(17);
  const seas = Array.from({ length: 7 }, () =>
    `<ellipse cx="${(random() * 512).toFixed(0)}" cy="${(60 + random() * 136).toFixed(0)}" rx="${(30 + random() * 50).toFixed(0)}" ry="${(18 + random() * 30).toFixed(0)}" fill="#a39c8e" opacity="0.55"/>`);
  const craters = Array.from({ length: 60 }, () => {
    const [x, y, r] = [random() * 512, 20 + random() * 216, 2 + random() ** 2 * 16];
    return `<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${r.toFixed(1)}" fill="#b0a99b" stroke="#efe9dc" stroke-width="${(r / 5).toFixed(1)}" opacity="0.7"/>`;
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="256">
    <filter id="dust"><feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves="4" seed="5"/>
      <feColorMatrix type="matrix" values="0 0 0 0 0.4  0 0 0 0 0.38  0 0 0 0 0.34  0 0 0 -0.7 0.45"/></filter>
    <filter id="blur"><feGaussianBlur stdDeviation="10"/></filter>
    <rect width="512" height="256" fill="#ddd7ca"/><g filter="url(#blur)">${seas.join('')}</g>
    <rect width="512" height="256" filter="url(#dust)"/>${craters.join('')}</svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 86 }).toBuffer();
}

/** Each instant photo's card, in px, in the photo atlas: an Instax Mini, 54 × 86 mm, its picture 46 × 62 mm. */
const PHOTO_PX: [width: number, height: number] = [108, 172];
/**
 * Instant photos side by side, each a white card with a picture on it of no one in particular: a sunset over the sea,
 * mountains, a city at night, a beach or a field of flowers.
 */
async function photoAtlas(count: number): Promise<Buffer> {
  const random = seeded(41);
  const [w, h] = PHOTO_PX;
  const pick = <T,>(options: T[]) => options[Math.floor(random() * options.length)];
  const scene = (x: number, y: number, pw: number, ph: number, i: number) => {
    const sky = (top: Hex, bottom: Hex) => `<linearGradient id="s${i}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient><rect x="${x}" y="${y}" width="${pw}" height="${ph}" fill="url(#s${i})"/>`;
    const at = (fx: number, fy: number) => `${(x + fx * pw).toFixed(1)},${(y + fy * ph).toFixed(1)}`;
    switch (i % 5) {
      case 0: return `${sky(pick(['#ff9a62', '#f77f7f', '#ffb36b']), '#ffd89b')}<circle cx="${x + pw * 0.5}" cy="${y + ph * 0.6}" r="${pw * 0.16}" fill="#fff1c9"/>
        <rect x="${x}" y="${y + ph * 0.64}" width="${pw}" height="${ph * 0.36}" fill="#3d5a80"/><rect x="${x + pw * 0.38}" y="${y + ph * 0.68}" width="${pw * 0.24}" height="3" fill="#ffd89b" opacity="0.7"/>`;
      case 1: return `${sky('#8ec9ee', '#e6f4fb')}<polygon points="${at(0, 0.8)} ${at(0.35, 0.3)} ${at(0.7, 0.8)}" fill="#5b7a8c"/><polygon points="${at(0.27, 0.43)} ${at(0.35, 0.3)} ${at(0.43, 0.43)}" fill="#ffffff"/>
        <polygon points="${at(0.4, 0.8)} ${at(0.72, 0.42)} ${at(1, 0.8)}" fill="#46677a"/><rect x="${x}" y="${y + ph * 0.78}" width="${pw}" height="${ph * 0.22}" fill="#6f9a5a"/>`;
      case 2: return `${sky('#1d2340', '#4a4a7a')}${Array.from({ length: 6 }, (_, k) => {
        const [bx, bh] = [x + (k / 6) * pw, ph * (0.3 + random() * 0.4)];
        const lit = Array.from({ length: 5 }, () => `<rect x="${(bx + 3 + random() * (pw / 6 - 8)).toFixed(1)}" y="${(y + ph - bh + 4 + random() * (bh - 10)).toFixed(1)}" width="3" height="4" fill="#ffd36b"/>`).join('');
        return `<rect x="${bx.toFixed(1)}" y="${(y + ph - bh).toFixed(1)}" width="${(pw / 6 - 1).toFixed(1)}" height="${bh.toFixed(1)}" fill="#11142a"/>${lit}`;
      }).join('')}`;
      case 3: return `${sky('#7fcdf0', '#d8f1fb')}<rect x="${x}" y="${y + ph * 0.5}" width="${pw}" height="${ph * 0.2}" fill="#2f9cc4"/>
        <polygon points="${at(0, 0.66)} ${at(1, 0.6)} ${at(1, 1)} ${at(0, 1)}" fill="#f1dcaa"/><circle cx="${x + pw * 0.8}" cy="${y + ph * 0.18}" r="${pw * 0.09}" fill="#fff6c8"/>`;
      default: return `${sky('#bfe3f5', '#f4f9e9')}<rect x="${x}" y="${y + ph * 0.55}" width="${pw}" height="${ph * 0.45}" fill="#7fb069"/>${Array.from({ length: 40 }, () =>
        `<circle cx="${(x + random() * pw).toFixed(1)}" cy="${(y + ph * (0.58 + random() * 0.4)).toFixed(1)}" r="${(1.5 + random() * 2).toFixed(1)}" fill="${pick(['#f7a1c4', '#ffffff', '#ffd166', '#e86a92'])}"/>`).join('')}`;
    }
  };
  const [side, top] = [w * (4 / 54), h * (7 / 86)];
  const cards = Array.from({ length: count }, (_, i) => {
    const x = i * w;
    const [pw, ph] = [w - 2 * side, h * (62 / 86)];
    return `<rect x="${x}" width="${w}" height="${h}" fill="#fbfaf6"/><g>${scene(x + side, top, pw, ph, i)}</g>`;
  });
  return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w * count}" height="${h}">${cards.join('')}</svg>`)).jpeg({ quality: 88 }).toBuffer();
}

/* ───────────── The objects ───────────── */

/** Builds a document from named parts: each part a Mesh and the Material it is drawn in. */
class Model {
  readonly doc = new Document();
  private readonly buffer = this.doc.createBuffer();
  private readonly mesh = this.doc.createMesh('model');
  constructor(name: string) {
    this.doc.createScene(name).addChild(this.doc.createNode(name).setMesh(this.mesh));
  }

  /**
   * A material. `glow` makes it give off light, through its texture when it has one: a number for a lit
   * screen, whose picture glows a little so it reads as on in a dim room, or a color for a lit lampshade.
   * `twoSided` draws a shade's inside too. `alpha` cuts a leaf out of its texture ('MASK'), or lets the wall show
   * through a glow or clear acrylic ('BLEND'), by its texture's alpha and its color's.
   */
  material(name: string, { color = [1, 1, 1, 1], roughness = 0.8, metallic = 0, texture, mime = 'image/jpeg', glow, twoSided = false, alpha }:
    { color?: [number, number, number, number]; roughness?: number; metallic?: number; texture?: Buffer; mime?: string; glow?: number | Vec3; twoSided?: boolean; alpha?: 'MASK' | 'BLEND' } = {}): Material {
    const material = this.doc.createMaterial(name).setBaseColorFactor(color).setRoughnessFactor(roughness).setMetallicFactor(metallic)
      .setDoubleSided(twoSided);
    if (alpha) material.setAlphaMode(alpha);
    if (alpha === 'MASK') material.setAlphaCutoff(0.4);
    const image = texture && this.doc.createTexture(name).setImage(new Uint8Array(texture)).setMimeType(mime);
    if (image) material.setBaseColorTexture(image);
    if (glow) material.setEmissiveFactor(typeof glow === 'number' ? [glow, glow, glow] : glow).setEmissiveTexture(image ?? null);
    return material;
  }

  add(material: Material, build: (mesh: Mesh) => void) {
    const mesh = emptyMesh();
    build(mesh);
    const accessor = (type: 'VEC3' | 'VEC2' | 'SCALAR', array: TypedArray) =>
      this.doc.createAccessor().setType(type).setArray(array).setBuffer(this.buffer);
    this.mesh.addPrimitive(this.doc.createPrimitive()
      .setAttribute('POSITION', accessor('VEC3', new Float32Array(mesh.positions)))
      .setAttribute('NORMAL', accessor('VEC3', new Float32Array(mesh.normals)))
      .setAttribute('TEXCOORD_0', accessor('VEC2', new Float32Array(mesh.uvs)))
      .setIndices(accessor('SCALAR', new Uint32Array(mesh.indices)))
      .setMaterial(material));
  }

  /** Moves the model to stand on its bottom center, for one grown at random, as a vine is. */
  ground(): Document {
    const { min, max } = getBounds(this.doc.getRoot().listScenes()[0]);
    this.doc.getRoot().listNodes()[0].setTranslation([-(min[0] + max[0]) / 2, -min[1], 0]);
    return this.doc;
  }
}

const BLACK_METAL = { color: [0.02, 0.02, 0.02, 1] as [number, number, number, number], roughness: 0.45, metallic: 0.6 };
const STEEL = { color: [0.75, 0.75, 0.76, 1] as [number, number, number, number], roughness: 0.3, metallic: 1 };

/** A record on its platter with a tonearm beside it, on top of a deck at height `top`. */
async function deck(model: Model, top: number, center: Vec3, radius: number, label: Hex, armBase: Vec3) {
  model.add(model.material('platter', BLACK_METAL), (m) => addCylinder(m, [center[0], top, center[2]], radius + 0.004, 0.012));
  model.add(model.material('vinyl', { texture: await vinylTexture(label, '#f5efe1'), roughness: 0.35 }),
    (m) => addCylinder(m, [center[0], top + 0.012, center[2]], radius, 0.002, { segments: 64 }));
  model.add(model.material('steel', STEEL), (m) => {
    addCylinder(m, [center[0], top + 0.014, center[2]], 0.0035, 0.012, { segments: 12 });     // the spindle
    addCylinder(m, armBase, 0.016, 0.03, { segments: 20 });                                    // the tonearm's pivot
    // The arm reaches from its pivot over the record's outer grooves, a little above it.
    const [ax, , az] = armBase;
    const [tx, tz] = [center[0] + radius * 0.72, center[2] + radius * 0.3];
    const length = Math.hypot(tx - ax, tz - az);
    const angle = Math.atan2(-(tz - az), tx - ax);
    addBox(m, [(ax + tx) / 2, armBase[1] + 0.026, (az + tz) / 2], [length, 0.006, 0.006], { turn: angle });
    addBox(m, turnY([tx, armBase[1] + 0.02, tz], 0), [0.02, 0.012, 0.012], { turn: angle });  // the headshell
  });
}

/* ───────────── Books ───────────── */

/** One book: its spine, and its size standing up: thickness, height, and depth from spine to fore-edge. */
interface Book { spine: Spine; size: Vec3 }

/**
 * Adds a book, its spine to +Z, its faces mapped to its column of the spine atlas: the spine on the spine, the covers
 * in the spine's color, and the pages' edges in the pages' column. Standing, `center` is its bottom center; lying, the
 * book lies on its back cover, its spine running along X.
 */
function addBook(mesh: Mesh, column: number, columns: number, center: Vec3, [thickness, height, depth]: Vec3,
  { lying = false, turn = 0, lean = 0 }: { lying?: boolean; turn?: number; lean?: number } = {}) {
  const start = mesh.uvs.length / 2;
  addBox(mesh, center, lying ? [height, thickness, depth] : [thickness, height, depth], { turn, lean });
  const [u0, u1] = [(column + 0.06) / columns, (column + 0.94) / columns];
  const cover: [number, number] = [(column + 0.1) / columns, 0.55];
  const pages: [number, number] = [(columns - 0.5) / columns, 0.5];
  // The box's faces, in addBox's order: front, back, right, left, top, bottom; each from its bottom left counterclockwise.
  const spine = lying ? [[u0, 1], [u0, 0], [u1, 0], [u1, 1]] : [[u0, 1], [u1, 1], [u1, 0], [u0, 0]];
  const faces = lying ? [spine, pages, pages, pages, cover, cover] : [spine, pages, cover, cover, pages, pages];
  faces.forEach((face, f) => {
    for (let k = 0; k < 4; k++) {
      const [u, v] = (Array.isArray(face[0]) ? face[k] : face) as [number, number];
      mesh.uvs[2 * (start + 4 * f + k)] = u;
      mesh.uvs[2 * (start + 4 * f + k) + 1] = v;
    }
  });
}

/** Books for a shelf: `count` standing books of these spines, thicknesses, heights and depths, picked by `random`. */
function shelfBooks(random: () => number, spines: Spine[], count: number, { thickness, height, depth }:
  { thickness: [number, number]; height: [number, number]; depth: [number, number] }): Book[] {
  const between = ([low, high]: [number, number]) => low + (high - low) * random();
  return Array.from({ length: count }, (_, i) => ({
    spine: spines[(i * 7 + Math.floor(random() * 3)) % spines.length],
    size: [between(thickness), between(height), between(depth)],
  }));
}

/**
 * A run of books standing spine out, flush at the front as on a shelf, centered on X: then, after them, a `leaning`
 * book with its top on the run, and `stacked` books lying in a short stack.
 */
async function bookRun(model: Model, standing: Book[], { leaning, stacked = [], roughness = 0.6 }:
  { leaning?: Book; stacked?: Book[]; roughness?: number } = {}) {
  const books = [...standing, ...(leaning ? [leaning] : []), ...stacked];
  const columns = books.length + 1;
  const material = model.material('books', { texture: await spineTexture(books.map(({ spine }) => spine)), roughness });
  const lean = 0.22;
  const leanWidth = leaning ? leaning.size[0] * Math.cos(lean) + leaning.size[1] * Math.sin(lean) : 0;
  const stackWidth = stacked.length ? Math.max(...stacked.map(({ size: [, h] }) => h)) + 0.01 : 0;
  const total = standing.reduce((sum, { size: [t] }) => sum + t, 0) + leanWidth + stackWidth;
  const front = Math.max(...books.map(({ size: [, , d] }) => d)) / 2;
  model.add(material, (m) => {
    let x = -total / 2;
    standing.forEach(({ size }, i) => {
      addBook(m, i, columns, [x + size[0] / 2, 0, front - size[2] / 2], size);
      x += size[0];
    });
    // The leaning book rests its top on the last book standing; its bottom corner stays on the shelf.
    if (leaning) {
      const { size: [t, h, d] } = leaning;
      const center = x + (t / 2) * Math.cos(lean) + h * Math.sin(lean);
      addBook(m, standing.length, columns, [center, (t / 2) * Math.sin(lean), front - d / 2], [t, h, d], { lean });
      x = center + (t / 2) * Math.cos(lean);
    }
    let y = 0;
    stacked.forEach(({ size: [t, h, d] }, i) => {
      addBook(m, books.length - stacked.length + i, columns, [x + 0.005 + stackWidth / 2, y, front - d / 2], [t, h, d], { lying: true, turn: (i % 2 ? 1 : -1) * 0.04 });
      y += t;
    });
  });
}

/** Spines of old leather hardcovers: oxblood, bottle green, navy, tan and black, with gilt. */
const LEATHER: Spine[] = ([['#5a1f24', '#c9a45c'], ['#1f3a2e', '#c9a45c'], ['#1d2b45', '#d4b06a'], ['#7a4a2b', '#e0c27e'],
  ['#2a1d18', '#c9a45c'], ['#6e2a1c', '#d4b06a'], ['#3b4a2a', '#c9a45c'], ['#8c6239', '#2a1d18']] as [Hex, Hex][])
  .map(([color, trim]) => ({ color, trim, style: 'gilt' }));
/** Spines of paperbacks in bright jackets with a publisher's band. */
const PAPERBACKS: Spine[] = ([['#e8583b', '#f6efe0'], ['#f2c14e', '#1e1e1e'], ['#2f6db5', '#f6efe0'], ['#f6efe0', '#e8583b'],
  ['#3f9b6b', '#f6efe0'], ['#e67fa3', '#1e1e1e'], ['#1e1e1e', '#f2c14e'], ['#6bc3d6', '#1e1e1e'], ['#f08a24', '#f6efe0']] as [Hex, Hex][])
  .map(([color, trim]) => ({ color, trim, style: 'band' }));
/** Spines of modern hardcovers in quiet colors: cream, black, sage, clay, stone. */
const MODERN: Spine[] = ([['#efe6d2', '#3a3a3a'], ['#1f1f1f', '#e9e2d0'], ['#9caf88', '#f4efe3'], ['#c46a4a', '#f4efe3'],
  ['#b9b2a5', '#2a2a2a'], ['#e9dcc0', '#9a5b3a'], ['#4c5b54', '#efe6d2']] as [Hex, Hex][])
  .map(([color, trim]) => ({ color, trim, style: 'plain' }));

/* ───────────── Bookcases ───────────── */

/**
 * A bookcase with its back on the wall: two sides, a back, a board at each of `boards` heights (the bottom one on the
 * plinth), and a top, all in `wood`; a crown along the top's front and sides when `crown`. Every board's top is a level
 * that shelf_levels finds, so books and decor can stand on it.
 */
function addBookcase(m: Mesh, [w, h, d]: Vec3, boards: number[], { side = 0.022, board = 0.022, plinth = 0.07, crown = 0 } = {}) {
  const inner = w - 2 * side;
  const tile = 0.9;
  for (const x of [-1, 1]) addBox(m, [x * (w / 2 - side / 2), 0, 0], [side, h - crown, d], { tile, upright: true });
  addBox(m, [0, plinth, -d / 2 + 0.006], [inner, h - crown - plinth - board, 0.012], { tile, upright: true });   // the back
  addBox(m, [0, 0, d / 2 - 0.035], [inner, plinth, 0.02], { tile });                                          // the plinth's front, set back
  for (const y of boards) addBox(m, [0, y, 0.006], [inner, board, d - 0.012], { tile });
  if (crown) {
    addBox(m, [0, h - crown, 0], [w, board, d], { tile });
    addBox(m, [0, h - crown + board, 0.008], [w + 0.03, crown - board, d + 0.016], { tile });                // the crown, over the front and sides
  } else {
    addBox(m, [0, h - board, 0], [w, board, d], { tile });
  }
}

/* ───────────── Lamps ───────────── */

/** The warm light a lit shade gives off. */
const LAMPLIGHT: Vec3 = [1, 0.78, 0.5];
const BRASS = { color: [0.78, 0.6, 0.3, 1] as [number, number, number, number], roughness: 0.35, metallic: 1 };
const BRONZE = { color: [0.3, 0.2, 0.12, 1] as [number, number, number, number], roughness: 0.45, metallic: 0.9 };

/* ───────────── Lights ───────────── */

/** The light a glow gives off, with no color of its own, fading into the wall by its texture's alpha. */
const glowMaterial = async (model: Model, name: string, texture: Promise<Buffer>) =>
  model.material(name, { texture: await texture, mime: 'image/png', color: [0, 0, 0, 1], roughness: 1, glow: 1, alpha: 'BLEND' });

/** A bulb's glass: the color it's lit in, washed toward white, as a lit bulb looks. */
const litGlass = (color: Vec3, white = 0.6): [number, number, number, number] => [...plus(times(color, 1 - white), [white, white, white]), 1];

/**
 * An LED strip `length` long, stuck on the wall along the middle of the model, lit in `color` along it, and the
 * glow it throws on the wall above and below it.
 */
async function ledStrip(model: Model, length: number, color: (u: number) => Vec3) {
  const glow = 0.36;
  model.add(await glowMaterial(model, 'wall-glow', stripGlowTexture(color)), (m) => addScreen(m, [0, 0, 0.001], length, glow));
  model.add(model.material('strip', { color: [0.92, 0.92, 0.9, 1], roughness: 0.5 }), (m) => addBox(m, [0, glow / 2 - 0.006, 0.003], [length, 0.012, 0.006]));
  model.add(model.material('leds', { texture: await pixelTexture([256, 4], (u) => [...color(u), 1]), mime: 'image/png', glow: 1, roughness: 0.3 }),
    (m) => addScreen(m, [0, glow / 2 - 0.004, 0.0062], length, 0.008));
}

/** A bulb of `radius` at each point, lit in `color`, each with the glow it throws on the wall behind it, `glow` m across. */
async function bulbs(model: Model, points: Vec3[], radius: number, color: Vec3, glow = 0.07) {
  model.add(model.material('bulbs', { color: litGlass(color), glow: color, roughness: 0.3 }), (m) => {
    for (const [x, y, z] of points) addLathe(m, [x, y - radius, z], sphere(radius, 4), { segments: 8 });
  });
  model.add(await glowMaterial(model, 'bulb-glow', roundGlowTexture(color)), (m) => {
    for (const [x, y] of points) addScreen(m, [x, y - glow / 2, 0.001], glow, glow);
  });
}

/** Clear adhesive hooks on the wall at each point, for a string of lights or a garland to hang from. */
function hooks(model: Model, points: Vec3[]) {
  model.add(model.material('hooks', { color: [0.95, 0.95, 0.95, 1], roughness: 0.25 }), (m) => {
    for (const [x, y] of points) {
      addBox(m, [x, y - 0.024, 0.0015], [0.014, 0.028, 0.003]);   // the pad
      addBox(m, [x, y - 0.008, 0.006], [0.005, 0.005, 0.01]);     // the hook
    }
  });
}

/** The copper wire fairy lights are strung on. */
const COPPER = { color: [0.72, 0.45, 0.25, 1] as [number, number, number, number], roughness: 0.35, metallic: 1 };

/** One tube of a neon sign: its path across the sign's face, in meters, and the color it's lit in. */
interface NeonTube { path: [x: number, y: number][]; color: Vec3 }

/**
 * A neon sign: each tube along its path on clear acrylic cut to a rectangle round them, held off the wall on four
 * standoffs, with the glow they throw on the wall round it.
 */
async function neonSign(model: Model, tubes: NeonTube[]) {
  const [xs, ys] = [0, 1].map((axis) => tubes.flatMap(({ path }) => path.map((point) => point[axis])));
  const margin = 0.03;
  const [x0, x1, y0, y1] = [Math.min(...xs) - margin, Math.max(...xs) + margin, Math.min(...ys) - margin, Math.max(...ys) + margin];
  const [w, h, cx, glow] = [x1 - x0, y1 - y0, (x0 + x1) / 2, 0.14];
  const frame: [number, number, number, number] = [x0 - glow / 2, y0 - glow / 2, w + glow, h + glow];
  model.add(await glowMaterial(model, 'wall-glow', neonGlowTexture(tubes, frame)), (m) => addScreen(m, [cx, frame[1], 0.001], frame[2], frame[3]));
  model.add(model.material('acrylic', { color: [0.9, 0.95, 1, 0.14], roughness: 0.05, alpha: 'BLEND' }), (m) => addBox(m, [cx, y0, 0.016], [w, h, 0.004]));
  model.add(model.material('standoffs', STEEL), (m) => {
    for (const x of [x0 + 0.014, x1 - 0.014]) for (const y of [y0 + 0.014, y1 - 0.014]) addCylinder(m, [x, y, 0], 0.005, 0.02, { facing: 'z', segments: 12 });
  });
  const radius = 0.0045;
  for (const [i, { path, color }] of tubes.entries()) {
    model.add(model.material(`tube-${i}`, { color: litGlass(color, 0.5), glow: color, roughness: 0.25 }), (m) => {
      addTube(m, path.map(([x, y]) => [x, y, 0.024]), radius);
      for (const [x, y] of [path[0], path.at(-1)!]) addLathe(m, [x, y - radius, 0.024], sphere(radius, 4), { segments: 8 });
    });
  }
}

/** Points along an arc of a circle about (cx, cy), from `from` to `to` degrees counterclockwise from +X. */
const arc = (cx: number, cy: number, r: number, from: number, to: number, steps = 48): [number, number][] =>
  Array.from({ length: steps + 1 }, (_, k) => {
    const angle = ((from + ((to - from) * k) / steps) * Math.PI) / 180;
    return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
  });

/* ───────────── Greenery ───────────── */

/** A vine's or a stem's green-brown. */
const STEM = { color: [0.28, 0.32, 0.15, 1] as [number, number, number, number], roughness: 0.8 };

/** A smooth curve through `points`, `per` points from each to the next (Catmull–Rom): a vine or a cord that bends rather than kinks. */
function smooth(points: Vec3[], per = 6): Vec3[] {
  const at = (i: number) => points[Math.min(Math.max(i, 0), points.length - 1)];
  const curve: Vec3[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    for (let k = 0; k < per; k++) {
      const t = k / per;
      curve.push([0, 1, 2].map((c) => 0.5 * (2 * p1[c] + (p2[c] - p0[c]) * t + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * t ** 2
        + (3 * p1[c] - p0[c] - 3 * p2[c] + p3[c]) * t ** 3)) as Vec3);
    }
  }
  curve.push(points.at(-1)!);
  return curve;
}

/**
 * Leaves along `path`, every `spacing` m from `start`, on alternate sides of it, each `size` m long at random within
 * it, turned out from the vine and facing `facing` where it grows, with a little tilt of its own.
 */
function leavesAlong(m: Mesh, random: () => number, path: Vec3[], { spacing, start = spacing / 2, size: [small, large], facing }:
  { spacing: number; start?: number; size: [number, number]; facing: (at: Vec3) => Vec3 }) {
  for (const [k, { at, along }] of every(path, spacing, start).entries()) {
    const face = unit(plus(facing(at), [random() * 0.7 - 0.35, random() * 0.7 - 0.35, random() * 0.7 - 0.35]));
    const out = unit(plus(times(unit(cross(along, face)), k % 2 ? 1 : -1), times(along, 0.3 + random() * 0.5)));
    const length = small + random() * (large - small);
    addLeaf(m, at, out, face, length, length * 0.9);
  }
}

/** A pot's profile for addLathe: `foot` across at its bottom, widening to its rim, `rim` across at `height`, its inside showing. */
const potProfile = (foot: number, rim: number, height: number, wall = 0.008): [number, number][] =>
  [[0, 0], [foot, 0], [foot, 0], [rim, height], [rim, height], [rim - wall, height], [rim - wall, height], [foot - wall, wall], [0, wall]];

/** Golden pothos leaves: green streaked with yellow, in two patterns so that neighbors differ. */
const pothosLeaves = async (model: Model) => Promise.all([[3, '#3f8a35'], [8, '#4c9a3c']].map(async ([seed, fill], i) =>
  model.material(`leaves-${i}`, { texture: await pothosLeafTexture(fill as Hex, '#e2d878', seed as number), mime: 'image/png', alpha: 'MASK', twoSided: true, roughness: 0.55 })));

/**
 * Pothos vines out over a pot's rim, `rim` m from its middle at height `top`, and down from it, each `reach` m long at
 * random within it: hanging free, or, when `floor` is a height, down the pot's side and out along what it stands on.
 * Returns each vine's path.
 */
function pothosVines(random: () => number, count: number, [cx, top, cz]: Vec3, rim: number, [short, long]: [number, number],
  { floor, around = [0, 360] }: { floor?: number; around?: [number, number] } = {}): Vec3[][] {
  return Array.from({ length: count }, (_, i) => {
    const angle = ((around[0] + ((around[1] - around[0]) * (i + 0.5 + (random() - 0.5) * 0.6)) / count) * Math.PI) / 180;
    const [dx, dz] = [Math.cos(angle), Math.sin(angle)];
    const out = (r: number, y: number, sway = 0): Vec3 => [cx + dx * r - dz * sway, y, cz + dz * r + dx * sway];
    const reach = short + random() * (long - short);
    const points: Vec3[] = [out(rim * 0.4, top - 0.01), out(rim * 1.05, top + 0.02), out(rim + 0.02, top - 0.03)];
    if (floor === undefined) {
      for (let y = top - 0.1; y > top - reach; y -= 0.1) points.push(out(rim + 0.03 + random() * 0.03, y, (random() - 0.5) * 0.05));
    } else {
      points.push(out(rim + 0.015, (top + floor) / 2), out(rim + 0.03, floor + 0.01));
      points.push(out(rim + 0.03 + reach * 0.5, floor + 0.006, (random() - 0.5) * 0.06), out(rim + 0.03 + reach, floor + 0.006, (random() - 0.5) * 0.1));
    }
    return smooth(points);
  });
}

/** Leaves growing up and out of the soil at `soil`, a pot's crown, `count` of them. */
function crown(m: Mesh, random: () => number, [cx, y, cz]: Vec3, count: number, [small, large]: [number, number]) {
  for (let k = 0; k < count; k++) {
    const angle = random() * Math.PI * 2;
    const [dx, dz] = [Math.cos(angle), Math.sin(angle)];
    const lean = 0.4 + random() * 0.8;
    const base: Vec3 = [cx + dx * random() * 0.03, y, cz + dz * random() * 0.03];
    const length = small + random() * (large - small);
    addLeaf(m, plus(base, [dx * 0.02, 0.03 + random() * 0.05, dz * 0.02]), [dx * lean, 1, dz * lean], [dx, 0.5, dz], length, length * 0.9);
  }
}

/** Ivy leaves, dark and variegated. */
const ivyLeaves = async (model: Model) => Promise.all([['#2f5d2a', '#8fb36a'], ['#5f8f3c', '#cfe0a0']].map(async ([fill, vein], i) =>
  model.material(`ivy-${i}`, { texture: await ivyLeafTexture(fill as Hex, vein as Hex), mime: 'image/png', alpha: 'MASK', twoSided: true, roughness: 0.5 })));

/**
 * An ivy garland on the wall: two vines twisted together, swagged between hooks at `hangs`, sagging `sag`, with strands
 * trailing down from it. Returns the swag's path, for lights to be strung along.
 */
async function ivyGarland(model: Model, random: () => number, hangs: Vec3[], sag: number): Promise<Vec3[]> {
  const z = 0.014;
  const swagPath = hangs.slice(1).flatMap((to, i) => swag([hangs[i][0], hangs[i][1] - 0.012, z], [to[0], to[1] - 0.012, z], sag).slice(i ? 1 : 0));
  const twisted = swagPath.map((p, k): Vec3 => plus(p, [0, 0.012 * Math.sin(k * 0.8), 0.004 * Math.cos(k * 0.8)]));
  const trails = Array.from({ length: (hangs.length - 1) * 3 }, (_, i) => {
    const from = swagPath[Math.floor(((i + 0.3 + random() * 0.4) / ((hangs.length - 1) * 3)) * (swagPath.length - 1))];
    const length = 0.18 + random() * 0.32;
    const points: Vec3[] = [from];
    for (let d = 0.08; d < length; d += 0.08) points.push(plus(from, [(random() - 0.5) * 0.05, -d, 0.004]));
    return smooth(points);
  });
  model.add(model.material('vine', STEM), (m) => {
    for (const path of [swagPath, twisted, ...trails]) addTube(m, path, 0.0022, { sides: 6 });
  });
  const [dark, light] = await ivyLeaves(model);
  for (const [material, start] of [[dark, 0], [light, 0.018]] as const) {
    model.add(material, (m) => {
      for (const path of [swagPath, twisted, ...trails]) leavesAlong(m, random, path, { spacing: 0.036, start, size: [0.03, 0.05], facing: () => [0, 0, 1] });
      clearOfWall(m);
    });
  }
  hooks(model, hangs);
  return swagPath;
}


export interface ObjectSpec {
  id: string;
  title: string;
  category: Category;
  mount: CatalogItem['mount'];
  colors: string[];
  materials: string[];
  styleTags: string[];
  price: number;
  build: () => Promise<Document>;
}

export const OBJECTS: ObjectSpec[] = [
  {
    id: 'obj-turntable-walnut',
    title: 'Walnut Turntable Record Player with Vinyl Record',
    category: 'decor',
    mount: 'floor',
    colors: ['Brown', 'Black', 'Orange'],
    materials: ['Wood', 'Metal', 'Vinyl'],
    styleTags: ['Mid-Century Modern', 'Retro', 'Music'],
    price: 180,
    async build() {
      const model = new Model(this.id);
      const [w, h, d] = [0.44, 0.085, 0.35];
      model.add(model.material('walnut', { texture: await woodTexture('#7a4a2b', '#3f2414'), roughness: 0.6 }), (m) => addBox(m, [0, 0.015, 0], [w, h - 0.015, d]));
      model.add(model.material('feet', BLACK_METAL), (m) => {
        for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) addCylinder(m, [x * (w / 2 - 0.04), 0, z * (d / 2 - 0.04)], 0.022, 0.015, { segments: 16 });
      });
      await deck(model, h, [-0.045, 0, 0], 0.152, '#e26a2c', [0.17, h, -0.11]);
      model.add(model.material('knob', STEEL), (m) => addCylinder(m, [0.17, h, 0.13], 0.013, 0.012, { segments: 16 }));
      return model.doc;
    },
  },
  ...([
    ['teal', 'Teal', '#3b8a88', ['Teal', 'Cream']],
    ['cream', 'Cream', '#efe3c8', ['Beige', 'Brown']],
  ] as const).map(([key, name, color, colors]): ObjectSpec => ({
    id: `obj-suitcase-record-player-${key}`,
    title: `Vintage Suitcase Record Player, ${name}`,
    category: 'decor',
    mount: 'floor',
    colors: [...colors],
    materials: ['Leatherette', 'Wood', 'Metal'],
    styleTags: ['Retro', 'Vintage', 'Music'],
    price: 70,
    async build() {
      const model = new Model(this.id);
      const [w, h, d] = [0.36, 0.12, 0.28];
      const leather = model.material('case', { texture: await leatherTexture(color), roughness: 0.75 });
      model.add(leather, (m) => {
        addBox(m, [0, 0, 0], [w, h, d], { tile: 0.12 });
        addBox(m, [0, h - 0.005, -d / 2 + 0.012], [w, d, 0.024], { tile: 0.12 });   // the lid, open and standing at the back
      });
      model.add(model.material('deck', { color: [0.05, 0.05, 0.05, 1], roughness: 0.6 }), (m) => addBox(m, [0, h, 0.012], [w - 0.02, 0.003, d - 0.05]));
      model.add(model.material('brass', { color: [0.78, 0.6, 0.3, 1], roughness: 0.35, metallic: 1 }), (m) => {
        addBox(m, [0, h * 0.42, d / 2 + 0.006], [0.1, 0.018, 0.012]);                // the handle
        for (const x of [-1, 1]) addBox(m, [x * 0.07, h * 0.62, d / 2 + 0.002], [0.016, 0.022, 0.006]);   // its latches
      });
      await deck(model, h + 0.003, [-0.03, 0, 0.02], 0.12, key === 'teal' ? '#f0c74a' : '#c94b3c', [0.13, h + 0.003, -0.07]);
      return model.doc;
    },
  })),
  {
    id: 'obj-vinyl-wall-display',
    title: 'Vinyl Record Wall Display, Set of 3',
    category: 'wall_art',
    mount: 'wall',
    colors: ['Black', 'Orange', 'Blue'],
    materials: ['Vinyl', 'Metal'],
    styleTags: ['Retro', 'Music', 'Eclectic'],
    price: 45,
    async build() {
      const model = new Model(this.id);
      const r = 0.152;
      const labels: Hex[] = ['#e26a2c', '#3d6fb6', '#e9b73a'];
      for (const [i, label] of labels.entries()) {
        model.add(model.material(`vinyl-${i}`, { texture: await vinylTexture(label, '#f5efe1'), roughness: 0.35 }),
          (m) => addCylinder(m, [(i - 1) * (2 * r + 0.06), r, 0.012], r, 0.002, { facing: 'z', segments: 64 }));
      }
      model.add(model.material('brackets', BLACK_METAL), (m) => {
        for (let i = 0; i < 3; i++) addCylinder(m, [(i - 1) * (2 * r + 0.06), r, 0], 0.01, 0.012, { facing: 'z', segments: 12 });
      });
      return model.doc;
    },
  },
  {
    id: 'obj-record-crate',
    title: 'Wooden Record Crate with Vinyl Records',
    category: 'decor',
    mount: 'floor',
    colors: ['Brown', 'Multicolor'],
    materials: ['Wood', 'Cardboard'],
    styleTags: ['Retro', 'Rustic', 'Music'],
    price: 55,
    async build() {
      const model = new Model(this.id);
      const [w, h, d, t] = [0.36, 0.3, 0.36, 0.015];
      model.add(model.material('pine', { texture: await woodTexture('#c99a63', '#8a6136'), roughness: 0.8 }), (m) => {
        addBox(m, [0, 0, 0], [w, t, d]);
        addBox(m, [-w / 2 + t / 2, 0, 0], [t, h, d]);
        addBox(m, [w / 2 - t / 2, 0, 0], [t, h, d]);
        for (const z of [-1, 1]) addBox(m, [0, 0, z * (d / 2 - t / 2)], [w - 2 * t, h * 0.55, t]);
      });
      // Sleeves standing in the crate, spines up, in a run of colors.
      const colors: Hex[] = ['#d9483b', '#f0c74a', '#2f5e8f', '#ece4d2', '#3f7d5a', '#e98a3a', '#7c4f9b', '#1e1e1e', '#e6a6b8', '#5aa3c9', '#b8452f', '#d8cfb8'];
      model.add(model.material('sleeves', { texture: await sleeveTexture(colors), mime: 'image/png', roughness: 0.9 }), (m) => {
        const step = (d - 2 * t - 0.01) / colors.length;
        colors.forEach((_, i) => {
          const z = -d / 2 + t + 0.005 + (i + 0.5) * step;
          const start = m.uvs.length / 2;
          addBox(m, [0, t, z], [w - 2 * t - 0.006, 0.315 - (i % 3) * 0.006, step * 0.8], { tile: 10 });
          // Each sleeve shows one band of the texture.
          for (let k = start; k < m.uvs.length / 2; k++) { m.uvs[2 * k] = (i + 0.5) / colors.length; m.uvs[2 * k + 1] = 0.5; }
        });
      });
      return model.doc;
    },
  },
  ...([
    ['43', 0.952, 0.536, 280, 'feet'],
    ['55', 1.218, 0.685, 450, 'pedestal'],
  ] as const).map(([inches, sw, sh, price, stand]): ObjectSpec => ({
    id: `obj-tv-${inches}`,
    title: `${inches}" 4K Flat-Screen TV on ${stand === 'feet' ? 'Feet' : 'a Pedestal Stand'}, Black`,
    category: 'decor',
    mount: 'floor',
    colors: ['Black'],
    materials: ['Plastic', 'Metal', 'Glass'],
    styleTags: ['Modern', 'Minimalist', 'Electronics', 'Gaming'],
    price,
    async build() {
      const model = new Model(this.id);
      const bezel = 0.008;
      const [w, h, d] = [sw + 2 * bezel, sh + 2 * bezel, 0.028];
      const lift = stand === 'feet' ? 0.075 : 0.09;
      const black = model.material('body', { color: [0.02, 0.02, 0.022, 1], roughness: 0.45 });
      model.add(black, (m) => {
        addBox(m, [0, lift, 0], [w, h, d]);
        addBox(m, [0, lift + h * 0.2, -d / 2 - 0.02], [w * 0.6, h * 0.55, 0.04]);   // the electronics behind the panel
        if (stand === 'feet') {
          for (const side of [-1, 1]) {
            addBox(m, [side * w * 0.4, 0, 0.02], [0.03, lift + 0.05, 0.02], { turn: 0 });
            addBox(m, [side * w * 0.4, 0, 0.02], [0.05, 0.012, 0.22]);
          }
        } else {
          addBox(m, [0, 0, 0], [0.38, 0.012, 0.24]);
          addBox(m, [0, 0.012, -0.03], [0.06, lift + 0.1, 0.03]);
        }
      });
      model.add(model.material('screen', { texture: await wallpaper(['#3a6ff0', '#c04bd8', '#f08a3a'], [1024, 576]), roughness: 0.15, glow: 0.55 }),
        (m) => addScreen(m, [0, lift + bezel, d / 2 + 0.0008], sw, sh));
      return model.doc;
    },
  })),
  {
    id: 'obj-tv-55-wall',
    title: '55" 4K Flat-Screen TV, Wall-Mounted, Black',
    category: 'wall_art',
    mount: 'wall',
    colors: ['Black'],
    materials: ['Plastic', 'Metal', 'Glass'],
    styleTags: ['Modern', 'Minimalist', 'Electronics', 'Gaming'],
    price: 430,
    async build() {
      const model = new Model(this.id);
      const [sw, sh, bezel, d] = [1.218, 0.685, 0.006, 0.03];
      model.add(model.material('body', { color: [0.02, 0.02, 0.022, 1], roughness: 0.45 }), (m) => {
        addBox(m, [0, 0, 0.012 + d / 2], [sw + 2 * bezel, sh + 2 * bezel, d]);
        addBox(m, [0, sh * 0.25, 0.006], [0.4, 0.3, 0.012]);   // the wall bracket
      });
      model.add(model.material('screen', { texture: await wallpaper(['#1fb59a', '#2f5fd0', '#f2c14e'], [1024, 576]), roughness: 0.15, glow: 0.55 }),
        (m) => addScreen(m, [0, bezel, 0.012 + d + 0.0008], sw, sh));
      return model.doc;
    },
  },
  ...([
    ['24', 0.531, 0.299, 150, ['#5b7cf7', '#8f5cf2']],
    ['27', 0.598, 0.336, 230, ['#f2795b', '#f2c14e']],
  ] as const).map(([inches, sw, sh, price, colors]): ObjectSpec => ({
    id: `obj-monitor-${inches}`,
    title: `${inches}" Computer Monitor with Stand, Black`,
    category: 'decor',
    mount: 'floor',
    colors: ['Black'],
    materials: ['Plastic', 'Metal', 'Glass'],
    styleTags: ['Modern', 'Minimalist', 'Electronics', 'Study', 'Gaming'],
    price,
    async build() {
      const model = new Model(this.id);
      const bezel = 0.006;
      const [w, h, d] = [sw + 2 * bezel, sh + 2 * bezel, 0.018];
      const lift = 0.11;
      model.add(model.material('body', { color: [0.03, 0.03, 0.035, 1], roughness: 0.5 }), (m) => {
        addBox(m, [0, lift, 0], [w, h, d]);
        addBox(m, [0, lift + h * 0.15, -d / 2 - 0.015], [w * 0.5, h * 0.55, 0.03]);
        addBox(m, [0, 0.008, -0.06], [0.035, lift + h * 0.4, 0.02]);   // the neck
        addBox(m, [0, 0, -0.04], [0.24, 0.008, 0.18]);                // the base
      });
      model.add(model.material('screen', { texture: await wallpaper([...colors], [1024, 576]), roughness: 0.2, glow: 0.55 }),
        (m) => addScreen(m, [0, lift + bezel, d / 2 + 0.0008], sw, sh));
      return model.doc;
    },
  })),
  {
    id: 'obj-monitor-ultrawide',
    title: '34" Curved Ultrawide Gaming Monitor, Black',
    category: 'decor',
    mount: 'floor',
    colors: ['Black'],
    materials: ['Plastic', 'Metal', 'Glass'],
    styleTags: ['Modern', 'Electronics', 'Gaming', 'Study'],
    price: 400,
    async build() {
      const model = new Model(this.id);
      const [sw, sh, sag, lift] = [0.8, 0.335, 0.07, 0.12];
      model.add(model.material('body', { color: [0.03, 0.03, 0.035, 1], roughness: 0.5 }), (m) => {
        addCurvedPanel(m, [0, lift, 0.01], sw + 0.012, sh + 0.012, 0.02, sag, false);
        addBox(m, [0, lift + sh * 0.1, -0.05], [0.3, sh * 0.6, 0.04]);
        addBox(m, [0, 0.008, -0.08], [0.04, lift + sh * 0.4, 0.025]);
        addBox(m, [0, 0, -0.06], [0.36, 0.008, 0.2]);
      });
      model.add(model.material('screen', { texture: await wallpaper(['#ff4f8b', '#3b4cf5', '#18c3d6'], [1536, 640]), roughness: 0.2, glow: 0.55 }),
        (m) => addCurvedPanel(m, [0, lift + 0.006, 0.012], sw, sh, 0.02, sag, true));
      return model.doc;
    },
  },
  {
    id: 'obj-laptop',
    title: '14" Laptop, Open, Space Gray',
    category: 'decor',
    mount: 'floor',
    colors: ['Gray', 'Black'],
    materials: ['Aluminum', 'Glass'],
    styleTags: ['Modern', 'Minimalist', 'Electronics', 'Study'],
    price: 650,
    async build() {
      const model = new Model(this.id);
      const [w, d, t] = [0.32, 0.22, 0.012];
      const aluminum = model.material('aluminum', { color: [0.42, 0.43, 0.45, 1], roughness: 0.35, metallic: 0.8 });
      model.add(aluminum, (m) => addBox(m, [0, 0, 0], [w, t, d]));
      model.add(model.material('keys', { color: [0.04, 0.04, 0.045, 1], roughness: 0.7 }), (m) => {
        addBox(m, [0, t, -0.02], [w * 0.86, 0.001, d * 0.42]);   // the keyboard
        addBox(m, [0, t, 0.06], [w * 0.36, 0.0008, d * 0.25]);   // the trackpad, dark glass
      });
      // The lid, tilted back about 105° from the base, hinged at the base's back edge.
      const tilt = (15 * Math.PI) / 180;
      const lidH = 0.205;
      const hinge: Vec3 = [0, t, -d / 2];
      const tip = (y: number): Vec3 => [0, hinge[1] + y * Math.cos(tilt), hinge[2] - y * Math.sin(tilt)];
      model.add(aluminum, (m) => {
        const [b0, b1] = [tip(0), tip(lidH)];
        const n: Vec3 = [0, Math.sin(tilt), -Math.cos(tilt)];   // the lid's back faces back and a little up
        quad(m, [[w / 2, b0[1], b0[2] - 0.004], [-w / 2, b0[1], b0[2] - 0.004], [-w / 2, b1[1], b1[2] - 0.004], [w / 2, b1[1], b1[2] - 0.004]], n, () => [0.5, 0.5]);
      });
      model.add(model.material('screen', { texture: await wallpaper(['#4f7cf2', '#7d4ff2', '#ef6aa0'], [1024, 640]), roughness: 0.2, glow: 0.55 }), (m) => {
        const [s0, s1] = [tip(0.012), tip(lidH - 0.008)];
        quad(m, [[-w * 0.46, s0[1], s0[2]], [w * 0.46, s0[1], s0[2]], [w * 0.46, s1[1], s1[2]], [-w * 0.46, s1[1], s1[2]]], [0, Math.sin(tilt), Math.cos(tilt)], ([px, py]) => [(px + w * 0.46) / (w * 0.92), 1 - (py - s0[1]) / (s1[1] - s0[1])]);
      });
      return model.doc;
    },
  },
  {
    id: 'obj-soundbar',
    title: 'TV Soundbar, Black',
    category: 'decor',
    mount: 'floor',
    colors: ['Black'],
    materials: ['Plastic', 'Fabric'],
    styleTags: ['Modern', 'Electronics', 'Music'],
    price: 150,
    async build() {
      const model = new Model(this.id);
      const [w, h, d] = [0.86, 0.065, 0.1];
      model.add(model.material('body', { color: [0.03, 0.03, 0.03, 1], roughness: 0.6 }), (m) => addBox(m, [0, 0, 0], [w, h, d]));
      model.add(model.material('grille', { texture: await grilleTexture(), roughness: 0.9 }), (m) => addBox(m, [0, 0.008, d / 2], [w - 0.02, h - 0.016, 0.003], { tile: 0.05 }));
      return model.doc;
    },
  },
  {
    id: 'obj-speaker',
    title: 'Bookshelf Speaker, Walnut',
    category: 'decor',
    mount: 'floor',
    colors: ['Brown', 'Black'],
    materials: ['Wood', 'Fabric'],
    styleTags: ['Mid-Century Modern', 'Music', 'Electronics'],
    price: 90,
    async build() {
      const model = new Model(this.id);
      const [w, h, d] = [0.16, 0.26, 0.2];
      model.add(model.material('walnut', { texture: await woodTexture('#7a4a2b', '#3f2414'), roughness: 0.6 }), (m) => addBox(m, [0, 0, 0], [w, h, d], { tile: 0.2 }));
      model.add(model.material('cones', { color: [0.03, 0.03, 0.03, 1], roughness: 0.7 }), (m) => {
        addCylinder(m, [0, 0.085, d / 2], 0.055, 0.006, { facing: 'z', segments: 32 });
        addCylinder(m, [0, 0.195, d / 2], 0.022, 0.006, { facing: 'z', segments: 24 });
      });
      return model.doc;
    },
  },
  {
    id: 'obj-game-console',
    title: 'Game Console with Controller, Black',
    category: 'decor',
    mount: 'floor',
    colors: ['Black'],
    materials: ['Plastic'],
    styleTags: ['Modern', 'Electronics', 'Gaming', 'Playful'],
    price: 450,
    async build() {
      const model = new Model(this.id);
      const black = model.material('body', { color: [0.025, 0.025, 0.028, 1], roughness: 0.4 });
      model.add(black, (m) => {
        addBox(m, [-0.095, 0, 0], [0.3, 0.07, 0.25]);
        addBox(m, [0.165, 0, 0.06], [0.15, 0.022, 0.06]);              // the controller's body
        for (const side of [-1, 1]) addBox(m, [0.165 + side * 0.06, 0, 0.085], [0.04, 0.024, 0.05]);   // its grips
      });
      model.add(model.material('light', { color: [0.2, 0.6, 1, 1], roughness: 0.3, glow: 0 }), (m) => addBox(m, [-0.095, 0.03, 0.1251], [0.22, 0.004, 0.001]));
      return model.doc;
    },
  },
  {
    id: 'obj-gaming-pc',
    title: 'Gaming PC Tower with Glass Side Panel',
    category: 'decor',
    mount: 'floor',
    colors: ['Black', 'Purple'],
    materials: ['Metal', 'Glass'],
    styleTags: ['Modern', 'Electronics', 'Gaming'],
    price: 1200,
    async build() {
      const model = new Model(this.id);
      const [w, h, d] = [0.22, 0.47, 0.45];
      model.add(model.material('case', { color: [0.03, 0.03, 0.035, 1], roughness: 0.4, metallic: 0.3 }), (m) => {
        addBox(m, [0, 0.02, 0], [w, h - 0.02, d]);
        for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) addBox(m, [x * (w / 2 - 0.02), 0, z * (d / 2 - 0.03)], [0.03, 0.02, 0.04]);
      });
      // Three lit fans behind the front, and a glowing strip, the "RGB" a gaming PC is known for.
      model.add(model.material('rgb', { texture: await wallpaper(['#a24bff', '#ff4fa3', '#3bd6ff'], [256, 512]), roughness: 0.3, glow: 0.9 }), (m) => {
        addScreen(m, [0, 0.05, d / 2 + 0.0008], w - 0.03, h - 0.09);
      });
      return model.doc;
    },
  },
  {
    id: 'obj-mini-fridge',
    title: 'Compact Mini Fridge, 3.1 cu ft, Black',
    category: 'storage',
    mount: 'floor',
    colors: ['Black'],
    materials: ['Metal'],
    styleTags: ['Modern', 'Dorm', 'Casual'],
    price: 160,
    async build() {
      const model = new Model(this.id);
      const [w, h, d] = [0.48, 0.84, 0.5];
      model.add(model.material('body', { color: [0.04, 0.04, 0.045, 1], roughness: 0.35, metallic: 0.4 }), (m) => {
        addBox(m, [0, 0.02, -0.02], [w, h - 0.02, d - 0.04]);
        addBox(m, [0, 0.025, d / 2 - 0.04], [w - 0.01, h - 0.03, 0.04]);   // the door
        for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) addBox(m, [x * (w / 2 - 0.04), 0, z * (d / 2 - 0.06)], [0.04, 0.02, 0.04]);
      });
      model.add(model.material('handle', { color: [0.7, 0.7, 0.72, 1], roughness: 0.3, metallic: 1 }), (m) => addBox(m, [w / 2 - 0.05, h * 0.45, d / 2], [0.02, 0.3, 0.025]));
      return model.doc;
    },
  },
  ...([
    {
      id: 'obj-books-leather-row',
      title: 'Leather-Bound Hardcover Books with Gilt Spines, Row of 10',
      colors: ['Burgundy', 'Green', 'Brown'],
      materials: ['Leather', 'Paper'],
      styleTags: ['Books', 'Traditional', 'Dark Academia'],
      price: 60,
      books: (random: () => number) => ({
        standing: shelfBooks(random, LEATHER, 10, { thickness: [0.028, 0.045], height: [0.205, 0.245], depth: [0.15, 0.175] }),
        leaning: shelfBooks(random, LEATHER.slice(3), 1, { thickness: [0.035, 0.04], height: [0.22, 0.23], depth: [0.16, 0.17] })[0],
        roughness: 0.5,
      }),
    },
    {
      id: 'obj-books-paperback-row',
      title: 'Paperback Books in Bright Jackets, Row of 11 and a Stack',
      colors: ['Multicolor', 'Orange', 'Yellow'],
      materials: ['Paper'],
      styleTags: ['Books', 'Eclectic', 'Colorful'],
      price: 40,
      books: (random: () => number) => ({
        standing: shelfBooks(random, PAPERBACKS, 11, { thickness: [0.016, 0.03], height: [0.176, 0.198], depth: [0.108, 0.13] }),
        stacked: shelfBooks(random, PAPERBACKS.slice(2), 3, { thickness: [0.018, 0.028], height: [0.178, 0.196], depth: [0.11, 0.128] }),
        roughness: 0.75,
      }),
    },
    {
      id: 'obj-books-modern-row',
      title: 'Modern Hardcover Books in Quiet Colors, Row of 9',
      colors: ['Beige', 'Black', 'Green'],
      materials: ['Paper', 'Linen'],
      styleTags: ['Books', 'Modern', 'Minimalist'],
      price: 55,
      books: (random: () => number) => ({
        standing: shelfBooks(random, MODERN, 9, { thickness: [0.022, 0.04], height: [0.2, 0.24], depth: [0.14, 0.165] }),
        leaning: shelfBooks(random, MODERN, 1, { thickness: [0.028, 0.032], height: [0.215, 0.225], depth: [0.15, 0.155] })[0],
        roughness: 0.7,
      }),
    },
    {
      id: 'obj-books-mixed-row',
      title: 'Mixed Hardcover and Paperback Books, Row of 8 and a Stack',
      colors: ['Multicolor', 'Brown', 'Blue'],
      materials: ['Paper', 'Leather'],
      styleTags: ['Books', 'Eclectic', 'Cozy'],
      price: 50,
      books: (random: () => number) => ({
        standing: shelfBooks(random, [...LEATHER.slice(0, 4), ...PAPERBACKS.slice(0, 4), ...MODERN.slice(0, 3)], 8,
          { thickness: [0.02, 0.042], height: [0.18, 0.24], depth: [0.12, 0.17] }),
        stacked: shelfBooks(random, [...MODERN.slice(2), ...LEATHER.slice(4)], 3, { thickness: [0.022, 0.035], height: [0.2, 0.235], depth: [0.14, 0.165] }),
        roughness: 0.65,
      }),
    },
    {
      id: 'obj-books-coffee-table-stack',
      title: 'Stack of 4 Coffee Table Books',
      colors: ['Beige', 'Black', 'Orange'],
      materials: ['Paper', 'Linen'],
      styleTags: ['Books', 'Modern', 'Coffee Table'],
      price: 75,
      books: (random: () => number) => ({
        standing: [],
        stacked: shelfBooks(random, [MODERN[1], MODERN[3], MODERN[0], MODERN[2]], 4, { thickness: [0.024, 0.04], height: [0.27, 0.32], depth: [0.21, 0.25] })
          .toSorted((a, b) => b.size[1] - a.size[1]),
        roughness: 0.7,
      }),
    },
  ]).map(({ books, ...book }, i): ObjectSpec => ({
    ...book,
    category: 'decor',
    mount: 'floor',
    async build() {
      const model = new Model(this.id);
      const { standing, ...rest } = books(seeded(101 + i));
      await bookRun(model, standing, rest);
      // The modern row stands against a black metal bookend.
      if (this.id === 'obj-books-modern-row') {
        const half = standing.reduce((sum, { size: [t] }) => sum + t, 0) / 2;
        model.add(model.material('bookend', BLACK_METAL), (m) => {
          addBox(m, [-half - 0.002, 0, 0], [0.003, 0.15, 0.12]);
          addBox(m, [-half + 0.05, 0, 0], [0.1, 0.002, 0.12]);
        });
      }
      return model.doc;
    },
  })),
  {
    id: 'obj-bookcase-walnut-library',
    title: 'Walnut Library Bookcase with Crown Molding, 5 Shelves, 79"H',
    category: 'shelf',
    mount: 'floor',
    colors: ['Brown'],
    materials: ['Wood'],
    styleTags: ['Traditional', 'Dark Academia', 'Library'],
    price: 420,
    async build() {
      const model = new Model(this.id);
      model.add(model.material('walnut', { texture: await woodTexture('#6b4226', '#4a2a16'), roughness: 0.55 }),
        (m) => addBookcase(m, [0.92, 2, 0.36], [0.07, 0.45, 0.83, 1.21, 1.59], { side: 0.026, crown: 0.07 }));
      return model.doc;
    },
  },
  {
    id: 'obj-bookcase-sage-cabinet',
    title: 'Painted Bookcase with Cabinet Base, Sage Green, 75"H',
    category: 'shelf',
    mount: 'floor',
    colors: ['Green'],
    materials: ['Wood', 'Brass'],
    styleTags: ['Farmhouse', 'Cottage', 'Traditional'],
    price: 380,
    async build() {
      const model = new Model(this.id);
      const [w, h, d, side, board, base] = [0.82, 1.9, 0.36, 0.024, 0.024, 0.78];
      const inner = w - 2 * side;
      model.add(model.material('paint', { color: [0.47, 0.56, 0.43, 1], roughness: 0.65 }), (m) => {
        for (const x of [-1, 1]) addBox(m, [x * (w / 2 - side / 2), 0, 0], [side, h, d]);
        addBox(m, [0, 0, 0], [inner, base, d]);                                                // the cabinet, its top a shelf
        addBox(m, [0, base, -d / 2 + 0.006], [inner, h - base - board, 0.012]);                 // the back
        for (const y of [1.15, 1.52]) addBox(m, [0, y, 0.006], [inner, board, d - 0.012]);
        addBox(m, [0, h - board, 0], [w + 0.02, board, d + 0.01]);
        // Two doors, each a raised panel in a frame.
        for (const x of [-1, 1]) {
          addBox(m, [x * inner / 4, 0.06, d / 2], [inner / 2 - 0.012, base - 0.1, 0.006]);
          addBox(m, [x * inner / 4, 0.12, d / 2 + 0.006], [inner / 2 - 0.09, base - 0.22, 0.006]);
        }
      });
      model.add(model.material('brass', BRASS), (m) => {
        for (const x of [-1, 1]) addCylinder(m, [x * 0.04, base * 0.55, d / 2 + 0.006], 0.012, 0.02, { facing: 'z', segments: 16 });
      });
      return model.doc;
    },
  },
  {
    id: 'obj-bookcase-oak-low',
    title: 'Low Oak Bookcase, 2 Shelves, 47"W',
    category: 'shelf',
    mount: 'floor',
    colors: ['Natural', 'Brown'],
    materials: ['Wood'],
    styleTags: ['Mid-Century Modern', 'Scandinavian', 'Modern'],
    price: 260,
    async build() {
      const model = new Model(this.id);
      model.add(model.material('oak', { texture: await woodTexture('#d4b083', '#b38a5b'), roughness: 0.6 }),
        (m) => addBookcase(m, [1.2, 0.8, 0.34], [0.06, 0.42], { side: 0.028, board: 0.028, plinth: 0.06 }));
      return model.doc;
    },
  },
  {
    id: 'obj-bookcase-industrial-pipe',
    title: 'Industrial Bookcase, Reclaimed Wood and Black Metal, 5 Shelves',
    category: 'shelf',
    mount: 'floor',
    colors: ['Brown', 'Black'],
    materials: ['Wood', 'Metal'],
    styleTags: ['Industrial', 'Rustic'],
    price: 240,
    async build() {
      const model = new Model(this.id);
      const [w, h, d, post, plank] = [0.9, 1.8, 0.35, 0.025, 0.035];
      const levels = [0.08, 0.44, 0.8, 1.16, 1.52, h - plank];
      model.add(model.material('reclaimed', { texture: await woodTexture('#9a7b5a', '#6e543a'), roughness: 0.85 }), (m) => {
        for (const y of levels) addBox(m, [0, y, 0], [w, plank, d], { tile: 0.9 });
      });
      model.add(model.material('metal', BLACK_METAL), (m) => {
        for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) addBox(m, [x * (w / 2 - post / 2), 0, z * (d / 2 - post / 2)], [post, h, post]);
        // An X of flat bar across the back, and a rail under each plank's front.
        const [span, rise] = [w - 2 * post, h - 0.2];
        for (const sign of [-1, 1]) addBox(m, [0, 0.1 + rise / 2, -d / 2 + 0.004], [Math.hypot(span, rise), 0.02, 0.006], { lean: sign * Math.atan2(rise, span) });
        for (const y of levels) addBox(m, [0, y - 0.02, d / 2 - post / 2], [w - 2 * post, 0.02, post * 0.6]);
      });
      return model.doc;
    },
  },
  {
    id: 'obj-bookcase-black-brass',
    title: 'Black Lacquer Bookcase with Brass Trim, 4 Shelves',
    category: 'shelf',
    mount: 'floor',
    colors: ['Black', 'Gold'],
    materials: ['Wood', 'Brass'],
    styleTags: ['Glam', 'Art Deco', 'Modern'],
    price: 340,
    async build() {
      const model = new Model(this.id);
      const [w, h, d] = [0.8, 1.85, 0.32];
      const boards = [0.05, 0.5, 0.95, 1.4];
      model.add(model.material('lacquer', { color: [0.02, 0.02, 0.022, 1], roughness: 0.55 }),
        (m) => addBookcase(m, [w, h, d], boards, { side: 0.02, board: 0.02, plinth: 0.05 }));
      // A brass edge along each board's front, and brass sabots under the sides.
      model.add(model.material('brass', BRASS), (m) => {
        for (const y of [...boards, h - 0.02]) addBox(m, [0, y, d / 2], [w - 0.04, 0.02, 0.003]);
        for (const x of [-1, 1]) addBox(m, [x * (w / 2 - 0.01), 0, d / 2 - 0.02], [0.022, 0.05, 0.04]);
      });
      return model.doc;
    },
  },
  {
    id: 'obj-lamp-paper-lantern-floor',
    title: 'Paper Lantern Floor Lamp, Rice Paper, 54"H',
    category: 'lamp',
    mount: 'floor',
    colors: ['White', 'Black'],
    materials: ['Paper', 'Metal'],
    styleTags: ['Japandi', 'Minimalist', 'Modern'],
    price: 150,
    async build() {
      const model = new Model(this.id);
      const [bottom, top, radius] = [0.24, 1.37, 0.18];
      const swell = Array.from({ length: 13 }, (_, k) => [radius * (0.9 + 0.1 * Math.sin((k / 12) * Math.PI)), bottom + (k / 12) * (top - bottom)] as [number, number]);
      model.add(model.material('paper', { texture: await paperTexture(16), roughness: 0.9, glow: [0.55, 0.45, 0.32], twoSided: true }),
        (m) => addLathe(m, [0, 0, 0], swell, { segments: 40 }));
      model.add(model.material('stand', BLACK_METAL), (m) => {
        for (let k = 0; k < 3; k++) {
          const t = (k / 3) * Math.PI * 2;
          addCylinder(m, [0.16 * Math.cos(t), 0, -0.16 * Math.sin(t)], 0.006, bottom + 0.02, { segments: 8 });
        }
        addCylinder(m, [0, bottom, 0], radius * 0.9, 0.006, { segments: 40, caps: false });
      });
      return model.doc;
    },
  },
  {
    id: 'obj-lamp-mushroom-amber',
    title: 'Mushroom Table Lamp, Amber Glass, 14"H',
    category: 'lamp',
    mount: 'floor',
    colors: ['Orange', 'Brown'],
    materials: ['Glass'],
    styleTags: ['Retro', 'Mid-Century Modern', '70s'],
    price: 85,
    async build() {
      const model = new Model(this.id);
      const glass = { color: [0.86, 0.42, 0.1, 1] as [number, number, number, number], roughness: 0.12, glow: [0.45, 0.2, 0.04] as Vec3 };
      // A low dome cap over a stem that flares into a round foot: one piece of glass.
      const cap: [number, number][] = [[0.16, 0.25], [0.168, 0.258], ...sphere(0.168, 12).slice(6).map(([r, y]) => [r, 0.258 + (y - 0.168) * 0.7] as [number, number])];
      model.add(model.material('cap', { ...glass, twoSided: true }), (m) => addLathe(m, [0, 0, 0], cap));
      model.add(model.material('stem', glass), (m) => addLathe(m, [0, 0, 0], [[0, 0], [0.1, 0], [0.1, 0.012], [0.1, 0.012], [0.06, 0.03], [0.034, 0.07], [0.03, 0.18], [0.04, 0.255], [0, 0.255]]));
      return model.doc;
    },
  },
  ...([
    ['sage', 'Sage', [0.55, 0.63, 0.5, 1], [0.96, 0.93, 0.86, 1], ['Green', 'Cream']],
    ['rose', 'Rose', [0.78, 0.45, 0.38, 1], [0.92, 0.55, 0.58, 1], ['Pink', 'Orange']],
  ] as const).map(([key, name, glaze, shade, colors]): ObjectSpec => ({
    id: `obj-lamp-pleated-${key}`,
    title: `Pleated Shade Table Lamp with Ginger Jar Base, ${name}, 22"H`,
    category: 'lamp',
    mount: 'floor',
    colors: [...colors],
    materials: ['Ceramic', 'Linen'],
    styleTags: ['Traditional', 'Cottage', 'Eclectic'],
    price: 95,
    async build() {
      const model = new Model(this.id);
      model.add(model.material('glaze', { color: [...glaze], roughness: 0.2 }), (m) => addLathe(m, [0, 0, 0],
        [[0, 0], [0.065, 0], [0.065, 0], [0.09, 0.03], [0.108, 0.09], [0.104, 0.16], [0.075, 0.21], [0.05, 0.228], [0.05, 0.238], [0, 0.238]]));
      model.add(model.material('brass', BRASS), (m) => addCylinder(m, [0, 0.238, 0], 0.012, 0.11, { segments: 16 }));
      model.add(model.material('shade', { color: [...shade], roughness: 0.9, glow: [0.2, 0.15, 0.1], twoSided: true }),
        (m) => addLathe(m, [0, 0, 0], [[0.2, 0.3], [0.125, 0.56]], { pleats: 30, fold: 0.06 }));
      return model.doc;
    },
  })),
  {
    id: 'obj-lamp-stained-glass',
    title: 'Stained Glass Table Lamp, Tiffany Style, Bronze Base, 23"H',
    category: 'lamp',
    mount: 'floor',
    colors: ['Orange', 'Green', 'Brown'],
    materials: ['Glass', 'Metal'],
    styleTags: ['Traditional', 'Victorian', 'Dark Academia'],
    price: 160,
    async build() {
      const model = new Model(this.id);
      model.add(model.material('bronze', BRONZE), (m) => {
        addLathe(m, [0, 0, 0], [[0, 0], [0.11, 0], [0.11, 0], [0.11, 0.014], [0.11, 0.014], [0.06, 0.03], [0.03, 0.07], [0.02, 0.1], [0.018, 0.4], [0, 0.4]]);
        addLathe(m, [0, 0.575, 0], sphere(0.014, 8));                                         // the finial
      });
      const glass = await stainedGlassTexture(['#c98a35', '#dba650', '#a8642a', '#d9b26a', '#6f8040', '#55682f', '#8c3a26'], '#3f5e2a');
      model.add(model.material('glass', { texture: glass, roughness: 0.25, glow: [0.4, 0.34, 0.25], twoSided: true }), (m) => addLathe(m, [0, 0, 0],
        [[0.21, 0.37], [0.205, 0.4], [0.18, 0.47], [0.13, 0.53], [0.07, 0.565], [0.02, 0.578]], { segments: 48 }));
      return model.doc;
    },
  },
  {
    id: 'obj-lamp-opal-globes-floor',
    title: 'Opal Globe Floor Lamp, Three Lights, Brass, 62"H',
    category: 'lamp',
    mount: 'floor',
    colors: ['Gold', 'White'],
    materials: ['Brass', 'Glass', 'Marble'],
    styleTags: ['Mid-Century Modern', 'Glam', 'Modern'],
    price: 190,
    async build() {
      const model = new Model(this.id);
      const globe = 0.09;
      const lights: [x: number, y: number][] = [[0.17, 0.98], [-0.17, 1.24], [0, 1.4]];
      model.add(model.material('marble', { color: [0.12, 0.12, 0.13, 1], roughness: 0.2 }), (m) => addCylinder(m, [0, 0, 0], 0.15, 0.03, { segments: 40 }));
      model.add(model.material('brass', BRASS), (m) => {
        addCylinder(m, [0, 0.03, 0], 0.011, 1.38, { segments: 16 });
        for (const [x, y] of lights.slice(0, 2)) addBox(m, [x / 2, y - 0.012, 0], [Math.abs(x), 0.012, 0.012]);
        for (const [x, y] of lights) addCylinder(m, [x, y - 0.012, 0], 0.02, 0.03, { segments: 16 });
      });
      model.add(model.material('opal', { color: [0.97, 0.95, 0.9, 1], roughness: 0.35, glow: [0.6, 0.52, 0.4] }), (m) => {
        for (const [x, y] of lights) addLathe(m, [x, y + 0.012, 0], sphere(globe, 14), { segments: 32 });
      });
      return model.doc;
    },
  },
  ...([
    ['warm', 'Warm White', () => [1, 0.8, 0.55], ['White', 'Orange'], ['Cozy', 'Modern', 'Dorm']],
    ['purple', 'Purple', () => [0.62, 0.25, 1], ['Purple'], ['Modern', 'Gaming', 'Dorm']],
    ['blue', 'Ice Blue', () => [0.25, 0.55, 1], ['Blue'], ['Modern', 'Gaming', 'Dorm']],
    ['pink', 'Pink', () => [1, 0.3, 0.65], ['Pink'], ['Modern', 'Y2K', 'Dorm']],
    ['rgb', 'RGB Color Changing', rainbow, ['Multicolor'], ['Gaming', 'Modern', 'Dorm']],
  ] as const).map(([key, name, color, colors, styleTags]): ObjectSpec => ({
    id: `obj-led-strip-${key}`,
    title: `${name} LED Strip Lights, 6.6 ft`,
    category: 'wall_art',
    mount: 'wall',
    colors: [...colors],
    materials: ['LED', 'Silicone'],
    styleTags: [...styleTags],
    price: key === 'rgb' ? 20 : 15,
    async build() {
      const model = new Model(this.id);
      await ledStrip(model, 2, color as (u: number) => Vec3);
      return model.doc;
    },
  })),
  {
    id: 'obj-fairy-lights-warm',
    title: 'Fairy String Lights on Copper Wire, Warm White, Draped in Swags',
    category: 'wall_art',
    mount: 'wall',
    colors: ['White', 'Copper'],
    materials: ['LED', 'Copper wire'],
    styleTags: ['Cozy', 'Bohemian', 'Dorm'],
    price: 12,
    async build() {
      const model = new Model(this.id);
      const hangs: Vec3[] = [-0.75, -0.25, 0.25, 0.75].map((x) => [x, 0.34, 0]);
      const wire = hangs.slice(1).flatMap((to, i) => swag([hangs[i][0], 0.33, 0.008], [to[0], 0.33, 0.008], 0.2).slice(i ? 1 : 0));
      model.add(model.material('wire', COPPER), (m) => addTube(m, wire, 0.0012, { sides: 5 }));
      await bulbs(model, every(wire, 0.07).map(({ at }) => at), 0.004, LAMPLIGHT);
      hooks(model, hangs);
      return model.ground();
    },
  },
  {
    id: 'obj-curtain-lights-warm',
    title: 'LED Curtain String Lights, Warm White, 4 x 4.6 ft',
    category: 'wall_art',
    mount: 'wall',
    colors: ['White'],
    materials: ['LED', 'Wire'],
    styleTags: ['Cozy', 'Romantic', 'Dorm'],
    price: 22,
    async build() {
      const model = new Model(this.id);
      const random = seeded(5);
      const [w, top] = [1.2, 1.4];
      const strands = Array.from({ length: 12 }, (_, i) => -w / 2 + (w * (i + 0.5)) / 12);
      model.add(model.material('wire', { color: [0.9, 0.9, 0.88, 1], roughness: 0.5 }), (m) => {
        addTube(m, [[-w / 2, top, 0.008], [w / 2, top, 0.008]], 0.0015, { sides: 5 });
        for (const [i, x] of strands.entries()) addTube(m, [[x, top, 0.008], [x, top - (i % 2 ? 1.2 : 1.32), 0.008]], 0.001, { sides: 4 });
      });
      const points = strands.flatMap((x, i) => Array.from({ length: i % 2 ? 12 : 13 }, (_, k): Vec3 => [x + (random() - 0.5) * 0.004, top - 0.06 - k * 0.1, 0.009]));
      await bulbs(model, points, 0.004, LAMPLIGHT, 0.06);
      hooks(model, [[-w / 2, top + 0.01, 0], [0, top + 0.01, 0], [w / 2, top + 0.01, 0]]);
      return model.ground();
    },
  },
  {
    id: 'obj-photo-string-lights',
    title: 'Photo Clip String Lights with 8 Instant Photos, Warm White',
    category: 'wall_art',
    mount: 'wall',
    colors: ['White', 'Multicolor'],
    materials: ['LED', 'Wood', 'Paper'],
    styleTags: ['Cozy', 'Dorm', 'Eclectic'],
    price: 16,
    async build() {
      const model = new Model(this.id);
      const random = seeded(9);
      const hangs: Vec3[] = [-0.6, 0, 0.6].map((x) => [x, 0.4, 0]);
      const wire = hangs.slice(1).flatMap((to, i) => swag([hangs[i][0], 0.39, 0.008], [to[0], 0.39, 0.008], 0.12).slice(i ? 1 : 0));
      model.add(model.material('wire', COPPER), (m) => addTube(m, wire, 0.0012, { sides: 5 }));
      await bulbs(model, every(wire, 0.1, 0.05).map(({ at }) => at), 0.007, LAMPLIGHT, 0.09);
      // A photo between each two bulbs, clipped to the wire at its top middle, hanging a little crooked.
      const clips = every(wire, 0.15, 0.1).slice(0, 8);
      const [cw, ch] = [0.054, 0.086];
      model.add(model.material('photos', { texture: await photoAtlas(clips.length), roughness: 0.4 }), (m) => {
        for (const [i, { at: [x, y] }] of clips.entries()) {
          const tilt = (random() - 0.5) * 0.2;
          const corner = (dx: number, dy: number): Vec3 => [x + dx * Math.cos(tilt) - dy * Math.sin(tilt), y - 0.008 + dx * Math.sin(tilt) + dy * Math.cos(tilt), 0.006];
          const [u0, u1] = [i / clips.length, (i + 1) / clips.length];
          const start = m.positions.length / 3;
          [[corner(-cw / 2, -ch), u0, 1], [corner(cw / 2, -ch), u1, 1], [corner(cw / 2, 0), u1, 0], [corner(-cw / 2, 0), u0, 0]].forEach(([p, u, v]) => {
            m.positions.push(...(p as Vec3));
            m.normals.push(0, 0, 1);
            m.uvs.push(u as number, v as number);
          });
          m.indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
        }
      });
      model.add(model.material('clips', { texture: await woodTexture('#d8b483', '#a57a4a'), roughness: 0.7 }), (m) => {
        for (const { at: [x, y] } of clips) addBox(m, [x, y - 0.018, 0.009], [0.008, 0.026, 0.006]);
      });
      hooks(model, hangs);
      return model.ground();
    },
  },
  {
    id: 'obj-neon-heart-pink',
    title: 'Pink Heart Neon Sign, LED, 14 x 13 in',
    category: 'wall_art',
    mount: 'wall',
    colors: ['Pink'],
    materials: ['LED neon', 'Acrylic'],
    styleTags: ['Y2K', 'Romantic', 'Dorm'],
    price: 35,
    async build() {
      const model = new Model(this.id);
      const heart = Array.from({ length: 97 }, (_, k): [number, number] => {
        const t = (k / 96) * Math.PI * 2;
        return [0.0105 * 16 * Math.sin(t) ** 3, 0.0105 * (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t))];
      });
      await neonSign(model, [{ path: heart, color: [1, 0.25, 0.6] }]);
      return model.ground();
    },
  },
  {
    id: 'obj-neon-moon-star',
    title: 'Crescent Moon and Star Neon Sign, Warm Yellow, LED, 15 in',
    category: 'wall_art',
    mount: 'wall',
    colors: ['Yellow'],
    materials: ['LED neon', 'Acrylic'],
    styleTags: ['Cozy', 'Celestial', 'Dorm'],
    price: 38,
    async build() {
      const model = new Model(this.id);
      // The moon's outer edge, then its inner edge back: a circle through both horns, its center further right.
      const moon = [...arc(0, 0, 0.17, 60, 300), ...arc(0.06, 0, 0.149, 279.7, 80.3, 40).slice(1)];
      const star = Array.from({ length: 11 }, (_, k): [number, number] => {
        const [angle, r] = [Math.PI / 2 + (k * Math.PI) / 5, k % 2 ? 0.016 : 0.04];
        return [0.1 + r * Math.cos(angle), 0.01 + r * Math.sin(angle)];
      });
      await neonSign(model, [{ path: moon, color: [1, 0.8, 0.35] }, { path: star, color: [1, 0.8, 0.35] }]);
      return model.ground();
    },
  },
  {
    id: 'obj-neon-rainbow',
    title: 'Rainbow Neon Sign, Pastel, LED, 15 x 8 in',
    category: 'wall_art',
    mount: 'wall',
    colors: ['Multicolor', 'Pink', 'Yellow', 'Blue'],
    materials: ['LED neon', 'Acrylic'],
    styleTags: ['Playful', 'Kids', 'Dorm'],
    price: 35,
    async build() {
      const model = new Model(this.id);
      const colors: Vec3[] = [[1, 0.35, 0.6], [1, 0.82, 0.3], [0.3, 0.65, 1]];
      await neonSign(model, [0.17, 0.135, 0.1].map((r, i) => ({ path: arc(0, 0, r, 0, 180, 40), color: colors[i] })));
      return model.ground();
    },
  },
  {
    id: 'obj-moon-lamp',
    title: '3D Moon Lamp on Wooden Stand, 6"',
    category: 'lamp',
    mount: 'floor',
    colors: ['White', 'Brown'],
    materials: ['PLA', 'Wood'],
    styleTags: ['Cozy', 'Celestial', 'Dorm'],
    price: 20,
    async build() {
      const model = new Model(this.id);
      model.add(model.material('stand', { texture: await woodTexture('#b88a5a', '#7a5532'), roughness: 0.6 }), (m) => {
        addLathe(m, [0, 0, 0], [[0, 0], [0.05, 0], [0.05, 0], [0.05, 0.016], [0.05, 0.016], [0.046, 0.02], [0, 0.02]]);
        addCylinder(m, [0, 0.02, 0], 0.032, 0.012, { segments: 32, caps: false });
      });
      model.add(model.material('moon', { texture: await moonTexture(), glow: [0.62, 0.58, 0.5], roughness: 0.8 }),
        (m) => addLathe(m, [0, 0.022, 0], sphere(0.075, 24), { segments: 48 }));
      return model.doc;
    },
  },
  ...([
    ['purple', 'Purple Liquid with Pink Wax', [0.45, 0.2, 0.75], [1, 0.35, 0.65], ['Purple', 'Pink']],
    ['orange', 'Yellow Liquid with Orange Wax', [1, 0.75, 0.2], [1, 0.38, 0.1], ['Yellow', 'Orange']],
  ] as const).map(([key, name, liquid, wax, colors]): ObjectSpec => ({
    id: `obj-lava-lamp-${key}`,
    title: `Lava Lamp, 14.5", ${name}`,
    category: 'lamp',
    mount: 'floor',
    colors: [...colors, 'Silver'],
    materials: ['Glass', 'Metal'],
    styleTags: ['Retro', '70s', 'Playful'],
    price: 30,
    async build() {
      const model = new Model(this.id);
      const metal = { color: [0.7, 0.7, 0.72, 1] as [number, number, number, number], roughness: 0.25, metallic: 1 };
      model.add(model.material('base', metal), (m) => {
        addLathe(m, [0, 0, 0], [[0, 0], [0.064, 0], [0.064, 0], [0.064, 0.008], [0.064, 0.008], [0.041, 0.125], [0, 0.125]]);
        addLathe(m, [0, 0, 0], [[0.024, 0.333], [0.026, 0.333], [0.026, 0.333], [0.017, 0.37], [0.017, 0.37], [0, 0.37]]);
      });
      model.add(model.material('wax', { color: [...wax, 1], glow: times([...wax], 0.8), roughness: 0.3 }), (m) => {
        const blob = (y: number, r: number, stretch = 1.3) => addLathe(m, [0, y, 0], sphere(r, 10).map(([a, b]) => [a, b * stretch] as [number, number]), { segments: 24 });
        blob(0.125, 0.036, 0.5);
        for (const [x, y, r] of [[0.006, 0.17, 0.02], [-0.008, 0.225, 0.015], [0.004, 0.275, 0.011], [-0.002, 0.305, 0.007]]) {
          addLathe(m, [x, y, 0], sphere(r, 10).map(([a, b]) => [a, b * 1.35] as [number, number]), { segments: 24 });
        }
      });
      model.add(model.material('liquid', { color: [...liquid, 0.5], glow: times([...liquid], 0.45), roughness: 0.05, alpha: 'BLEND', twoSided: true }),
        (m) => addLathe(m, [0, 0, 0], smooth([[0.041, 0.125, 0], [0.05, 0.19, 0], [0.045, 0.26, 0], [0.024, 0.333, 0]], 6).map(([r, y]) => [r, y] as [number, number]), { segments: 40 }));
      return model.doc;
    },
  })),
  {
    id: 'obj-ivy-garland',
    title: 'Artificial Ivy Vine Garland, Hanging, 5 ft',
    category: 'wall_art',
    mount: 'wall',
    colors: ['Green'],
    materials: ['Faux greenery', 'Wire'],
    styleTags: ['Cottagecore', 'Bohemian', 'Dorm'],
    price: 14,
    async build() {
      const model = new Model(this.id);
      await ivyGarland(model, seeded(13), [-0.75, 0, 0.75].map((x): Vec3 => [x, 0.7, 0]), 0.16);
      return model.ground();
    },
  },
  {
    id: 'obj-ivy-garland-lights',
    title: 'Artificial Ivy Garland with Fairy Lights, Warm White, 5 ft',
    category: 'wall_art',
    mount: 'wall',
    colors: ['Green', 'White'],
    materials: ['Faux greenery', 'LED', 'Wire'],
    styleTags: ['Cottagecore', 'Cozy', 'Dorm'],
    price: 20,
    async build() {
      const model = new Model(this.id);
      const swagPath = await ivyGarland(model, seeded(21), [-0.75, 0, 0.75].map((x): Vec3 => [x, 0.7, 0]), 0.16);
      await bulbs(model, every(swagPath, 0.09).map(({ at }) => plus(at, [0, 0, 0.012])), 0.004, LAMPLIGHT);
      return model.ground();
    },
  },
  {
    id: 'obj-pothos-trailing',
    title: 'Golden Pothos in White Ceramic Pot, Trailing',
    category: 'plant',
    mount: 'floor',
    colors: ['Green', 'White'],
    materials: ['Ceramic'],
    styleTags: ['Bohemian', 'Modern', 'Cozy'],
    price: 28,
    async build() {
      const model = new Model(this.id);
      const random = seeded(7);
      const [rim, height] = [0.08, 0.14];
      model.add(model.material('pot', { color: [0.94, 0.93, 0.9, 1], roughness: 0.3 }), (m) => addLathe(m, [0, 0, 0], potProfile(0.062, rim, height)));
      model.add(model.material('soil', { color: [0.2, 0.14, 0.09, 1], roughness: 1 }), (m) => addCylinder(m, [0, height - 0.02, 0], rim - 0.01, 0.004, { segments: 32 }));
      const vines = pothosVines(random, 8, [0, height, 0], rim, [0.03, 0.14], { floor: 0 });
      model.add(model.material('vines', STEM), (m) => { for (const vine of vines) addTube(m, vine, 0.002, { sides: 5 }); });
      const leaves = await pothosLeaves(model);
      for (const [i, material] of leaves.entries()) {
        model.add(material, (m) => {
          for (const vine of vines) leavesAlong(m, random, vine, { spacing: 0.09, start: 0.03 + i * 0.045, size: [0.05, 0.075], facing: ([x, y, z]) => [x, y > 0.02 ? 0.4 : 3, z] });
          crown(m, random, [0, height - 0.02, 0], 9, [0.06, 0.09]);
        });
      }
      return model.ground();
    },
  },
  {
    id: 'obj-pothos-macrame',
    title: 'Pothos in Macramé Plant Hanger, Wall Hook',
    category: 'plant',
    mount: 'wall',
    colors: ['Green', 'Cream', 'Terracotta'],
    materials: ['Cotton rope', 'Terracotta'],
    styleTags: ['Bohemian', 'Cottagecore', 'Dorm'],
    price: 32,
    async build() {
      const model = new Model(this.id);
      const random = seeded(11);
      const [rim, height, hook, zc] = [0.075, 0.13, 1.1, 0.13];
      const top = 0.62;                                          // the pot's rim
      model.add(model.material('pot', { color: [0.72, 0.4, 0.26, 1], roughness: 0.85 }), (m) => addLathe(m, [0, top - height, zc], potProfile(0.058, rim, height)));
      model.add(model.material('soil', { color: [0.2, 0.14, 0.09, 1], roughness: 1 }), (m) => addCylinder(m, [0, top - 0.02, zc], rim - 0.01, 0.004, { segments: 32 }));
      model.add(model.material('hook', BRASS), (m) => {
        addBox(m, [0, hook - 0.02, 0.002], [0.03, 0.03, 0.004]);
        addCylinder(m, [0, hook - 0.005, 0], 0.003, 0.03, { facing: 'z', segments: 8 });
      });
      const knot: Vec3 = [0, top - height - 0.05, zc];
      model.add(model.material('cord', { color: [0.93, 0.88, 0.78, 1], roughness: 0.95 }), (m) => {
        const ring: Vec3 = [0, hook - 0.03, 0.03];
        for (let k = 0; k < 4; k++) {
          const angle = Math.PI / 4 + (k * Math.PI) / 2;
          const at = (r: number, y: number): Vec3 => [r * Math.cos(angle), y, zc + r * Math.sin(angle)];
          // Each cord: from the ring down to a knot above the pot, round the pot's belly, and in under it to the gathering knot.
          const above = plus(ring, times(minus(at(rim + 0.004, top), ring), 0.6));
          addTube(m, smooth([ring, above, at(rim + 0.004, top), at(rim - 0.005, top - height * 0.6), at(0.03, top - height - 0.02), knot], 5), 0.0035, { sides: 6 });
          addLathe(m, [above[0], above[1] - 0.008, above[2]], sphere(0.008, 6), { segments: 10 });
        }
        addLathe(m, [knot[0], knot[1] - 0.012, knot[2]], sphere(0.013, 6), { segments: 12 });
        for (let k = 0; k < 10; k++) {
          const angle = (k / 10) * Math.PI * 2;
          addTube(m, [knot, plus(knot, [0.012 * Math.cos(angle), -0.16 - random() * 0.03, 0.012 * Math.sin(angle)])], 0.002, { sides: 4 });
        }
      });
      // The vines fall over the front and sides of the pot, not behind it against the wall.
      const vines = pothosVines(random, 7, [0, top, zc], rim, [0.3, 0.6], { around: [-20, 200] });
      model.add(model.material('vines', STEM), (m) => {
        for (const vine of vines) addTube(m, vine, 0.002, { sides: 5 });
        clearOfWall(m, 0.01);
      });
      const leaves = await pothosLeaves(model);
      for (const [i, material] of leaves.entries()) {
        model.add(material, (m) => {
          for (const vine of vines) leavesAlong(m, random, vine, { spacing: 0.09, start: 0.03 + i * 0.045, size: [0.05, 0.075], facing: ([x, , z]) => [x, 0.3, z - zc] });
          crown(m, random, [0, top - 0.02, zc], 8, [0.06, 0.085]);
          clearOfWall(m);
        });
      }
      return model.ground();
    },
  },
  {
    id: 'obj-pampas-vase',
    title: 'Dried Pampas Grass in White Ceramic Vase, 3 ft',
    category: 'decor',
    mount: 'floor',
    colors: ['Beige', 'White'],
    materials: ['Dried grass', 'Ceramic'],
    styleTags: ['Bohemian', 'Japandi', 'Minimalist'],
    price: 35,
    async build() {
      const model = new Model(this.id);
      const random = seeded(19);
      model.add(model.material('vase', { color: [0.95, 0.94, 0.9, 1], roughness: 0.6 }), (m) => addLathe(m, [0, 0, 0],
        [[0, 0], [0.065, 0], [0.065, 0], [0.09, 0.08], [0.088, 0.17], [0.055, 0.25], [0.045, 0.29], [0.05, 0.3], [0.05, 0.3], [0.042, 0.3], [0.042, 0.3], [0.035, 0.26], [0, 0.26]]));
      const stems = Array.from({ length: 8 }, (_, i) => {
        const angle = (i / 8) * Math.PI * 2 + random() * 0.5;
        const splay = 0.08 + random() * 0.22;
        const length = 0.55 + random() * 0.25;
        const direction = unit([splay * Math.cos(angle), 1, splay * Math.sin(angle)]);
        const base: Vec3 = [0.012 * Math.cos(angle), 0.26, 0.012 * Math.sin(angle)];
        return { base, direction, length, angle };
      });
      model.add(model.material('stems', { color: [0.78, 0.68, 0.5, 1], roughness: 0.8 }), (m) => {
        for (const { base, direction, length } of stems) addTube(m, [base, plus(base, times(direction, length))], 0.0025, { sides: 5 });
      });
      model.add(model.material('plumes', { texture: await plumeTexture(['#efe4cf', '#e2d2b3', '#d6c29c', '#f6efe2']), mime: 'image/png', alpha: 'MASK', twoSided: true, roughness: 0.9 }), (m) => {
        for (const { base, direction, length, angle } of stems) {
          const from = plus(base, times(direction, length * 0.62));
          // Four cards crossed about the stem, so the plume is full from every side.
          for (let k = 0; k < 4; k++) {
            const turn = angle + (k * Math.PI) / 4;
            addLeaf(m, from, direction, unit(cross(direction, [Math.cos(turn), 0, Math.sin(turn)])), length * 0.45, 0.12, 0);
          }
        }
      });
      return model.doc;
    },
  },
];

/* ───────────── Files ───────────── */

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CACHE = join(ROOT, 'scripts/.cache/objects');
const OUT = join(ROOT, 'data/catalog/objects');
const CATALOG = join(ROOT, 'data/catalog/objects.json');

/** The Catalog entry for an object of this size. */
export function toCatalogItem(spec: ObjectSpec, size: Vec3): CatalogItem {
  return {
    id: spec.id,
    source: 'generated',
    title: spec.title,
    category: spec.category,
    mount: spec.mount,
    size,
    model: `/data/catalog/objects/${spec.id}.glb`,
    thumbnail: `/data/catalog/objects/${spec.id}.jpg`,
    colors: spec.colors,
    materials: spec.materials,
    styleTags: spec.styleTags,
    priceEstimateUsd: spec.price,
    url: '',
    attribution: 'Modeled for Mise',
  };
}

async function build(only?: string[]) {
  const previous: Catalog = existsSync(CATALOG) ? JSON.parse(await readFile(CATALOG, 'utf8')) : { version: 1, items: [] };
  await mkdir(OUT, { recursive: true });
  await mkdir(CACHE, { recursive: true });
  const items: CatalogItem[] = [];
  for (const spec of OBJECTS) {
    const kept = previous.items.find((item) => item.id === spec.id);
    if (only && !only.includes(spec.id)) {
      if (kept) items.push(kept);
      continue;
    }
    try {
      const raw = join(CACHE, `${spec.id}.raw.glb`);
      await writeGlb(await spec.build(), raw);
      const glb = join(OUT, `${spec.id}.glb`);
      const { size, bytes, triangles } = await optimizeModel(raw, glb).finally(() => rm(raw));
      await renderThumbnails([{ glb, out: join(OUT, `${spec.id}.jpg`) }]);
      items.push(toCatalogItem(spec, size));
      console.log(`✓ ${spec.id.padEnd(36)} ${size.join(' × ')} m  ${(bytes / 1e6).toFixed(2)} MB  ${triangles} △`);
    } catch (error) {
      if (kept) items.push(kept);
      console.error(`✗ ${spec.id} skipped: ${error instanceof Error ? error.message : error}${kept ? '; kept its previous build' : ''}`);
    }
  }
  await writeFile(CATALOG, `${JSON.stringify({ version: 1, items } satisfies Catalog, null, 2)}\n`);
  const used = new Set(items.flatMap((item) => [item.model, item.thumbnail]));
  for (const name of await readdir(OUT)) {
    if (/^obj-.*\.(glb|jpg)$/.test(name) && !used.has(`/data/catalog/objects/${name}`)) await rm(join(OUT, name));
  }
  console.log(`Wrote ${items.length} of ${OBJECTS.length} objects to data/catalog/objects.json.`);
}

async function main() {
  const { values } = parseArgs({ options: { only: { type: 'string' } } });
  await build(values.only?.split(',').map((id) => id.trim()));
}

// Run only as a script, not when the tests import this file.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
