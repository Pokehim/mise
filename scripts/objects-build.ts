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
   * `twoSided` draws a shade's inside too.
   */
  material(name: string, { color = [1, 1, 1, 1], roughness = 0.8, metallic = 0, texture, mime = 'image/jpeg', glow, twoSided = false }:
    { color?: [number, number, number, number]; roughness?: number; metallic?: number; texture?: Buffer; mime?: string; glow?: number | Vec3; twoSided?: boolean } = {}): Material {
    const material = this.doc.createMaterial(name).setBaseColorFactor(color).setRoughnessFactor(roughness).setMetallicFactor(metallic)
      .setDoubleSided(twoSided);
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
