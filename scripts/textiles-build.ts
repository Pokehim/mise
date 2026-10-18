// scripts/textiles-build.ts — rugs and wall tapestries: scripts/textiles.json → data/catalog/textiles/.
//
//   npx tsx scripts/textiles-build.ts [--only <id,id…>]
//
// Each textile's face is a real rug or textile that is free to use (a museum's public-domain image, downloaded once
// into scripts/.cache/textiles/) or a pattern drawn here in SVG (checks, waves, daisies: shapes, no one's artwork).
// A rug becomes a 1 cm slab with the face on top (scripts/catalog/flat-rug.ts), a tapestry a 4 mm hanging on a wooden
// rod. Writes data/catalog/textiles/<id>.glb and <id>.jpg (its thumbnail), data/catalog/textiles.json (a Catalog),
// CREDITS.md, and contact-sheet.jpg. A textile whose image can't be got keeps its last build.

import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { Document, type TypedArray } from '@gltf-transform/core';
import sharp, { type OverlayOptions } from 'sharp';
import { ShapeUtils, Vector2 } from 'three';
import type { Catalog, CatalogItem, Hex, Vec2, Vec3 } from '../shared/types';
import { optimizeModel } from './catalog-build';
import { rugDocument } from './catalog/flat-rug';
import { renderThumbnails } from './catalog/thumbnail';
import { writeGlb } from './catalog/gso';
import { addBox, posterColors } from './posters-build';

/* ───────────── textiles.json ───────────── */

/** A real rug or textile from a museum's open-access collection. `crop` is fractions of the image, to trim its backdrop. */
export interface MuseumSource {
  kind: 'publicdomain';
  image: string;
  page: string;
  institution: string;
  work: string;               // what the museum calls it: maker or culture, title, date
  why: string;                // why it is free to use
  crop?: { left: number; top: number; width: number; height: number };
  /** Quarter turns clockwise, so the image's long side runs the way the textile's does. */
  turn?: 1 | 2 | 3;
}

export const PATTERNS = ['checker', 'waves', 'daisies', 'arches', 'blobs', 'stripes', 'solid', 'motif'] as const;
export type Pattern = (typeof PATTERNS)[number];

/**
 * A rug's outline, seen from above: a rectangle, or a shaped rug like the custom-tufted ones (a daisy, a cloud, a
 * mushroom). Each fills the rug's width × length.
 */
export const SHAPES = ['rect', 'round', 'wavy', 'cloud', 'daisy', 'sheepskin', 'heart', 'mushroom'] as const;
export type Shape = (typeof SHAPES)[number];

/**
 * A pattern drawn here. `colors` are its field first, then its motifs; `count` is how many cells, bands or motifs across.
 * 'solid' is the field alone; 'motif' draws the rug's shape as a picture: a daisy's petals and heart, a mushroom's cap,
 * spots and stem.
 */
export interface PatternSource { kind: 'pattern'; pattern: Pattern; colors: Hex[]; count?: number; seed?: number }

/** One entry of scripts/textiles.json. A rug's size is width × length, a tapestry's width × height, in cm. */
export interface TextileSpec {
  id: string;
  title: string;
  use: 'rug' | 'tapestry';
  size: Vec2;
  /** A rug's outline, 'rect' by default. */
  shape?: Shape;
  /** A shag rug is 3.5 cm of fluffy pile; a flat one is 1 cm of tufted or woven wool. */
  pile?: 'flat' | 'shag';
  styleTags: string[];
  price: number;
  source: MuseumSource | PatternSource;
}

const RUG_THICKNESS = 0.01;              // scripts/catalog/flat-rug.ts's slab
const SHAG_THICKNESS = 0.035;
const CLOTH = 0.004;                     // a tapestry's thickness
const ROD = 0.018;                       // its rod's square section, and how far past the cloth each end reaches
const ROD_OVERHANG = 0.04;
const LONG_SIDE_PX = 2048;

/** The textile's size in meters, [W, H, D]: a rug lies flat, a tapestry hangs from its rod. */
export function textileSize({ use, pile, size: [width, length] }: Pick<TextileSpec, 'use' | 'size' | 'pile'>): Vec3 {
  const w = width / 100;
  const l = length / 100;
  return use === 'rug' ? [w, pile === 'shag' ? SHAG_THICKNESS : RUG_THICKNESS, l] : [w + 2 * ROD_OVERHANG, l + ROD, ROD];
}

/** Points around a closed curve r(θ) about the origin, y up. */
const polar = (r: (theta: number) => number, n = 160): [number, number][] =>
  Array.from({ length: n }, (_, i) => {
    const theta = (i / n) * Math.PI * 2;
    return [r(theta) * Math.cos(theta), r(theta) * Math.sin(theta)];
  });

/** The shape's outline in its own units, y up (the rug's back): `outline` stretches it to the rug's size. */
function shapePoints(shape: Exclude<Shape, 'rect'>): [number, number][] {
  const bump = (theta: number, at: number, width: number) => Math.exp(-((Math.atan2(Math.sin(theta - at), Math.cos(theta - at)) / width) ** 2));
  switch (shape) {
    case 'round': return polar(() => 1);
    case 'wavy': return polar((t) => 1 + 0.035 * Math.sin(16 * t));
    case 'cloud': return polar((t) => 0.84 + 0.16 * Math.abs(Math.sin(3 * t)) ** 0.5);
    case 'daisy': return polar((t) => 0.58 + 0.42 * Math.abs(Math.cos(4 * t)) ** 0.7);
    case 'sheepskin': return polar((t) => 1 + 0.06 * Math.sin(3 * t + 0.4) + 0.04 * Math.sin(7 * t)
      + 0.2 * [0.25, 0.75, 1.25, 1.75].reduce((sum, at) => sum + bump(t, at * Math.PI, 0.13), 0));
    case 'heart': return Array.from({ length: 160 }, (_, i) => (i / 160) * Math.PI * 2)
      // Near its notch (t = 0) the curve runs back on itself in a sliver of no width: keep only the notch's own point.
      .filter((t) => t === 0 || Math.abs(Math.sin(t)) > 0.28 || Math.cos(t) < 0)
      .map((t) => [16 * Math.sin(t) ** 3, 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)]);
    case 'mushroom': {
      // A domed cap over a stem with a rounded foot, counterclockwise from the stem's foot.
      const stem = 0.34;
      const foot = Array.from({ length: 13 }, (_, i) => {
        const t = Math.PI + (i / 12) * Math.PI;
        return [stem * Math.cos(t), 0.12 + 0.12 * Math.sin(t)] as [number, number];
      });
      const cap = Array.from({ length: 49 }, (_, i) => {
        const t = (i / 48) * Math.PI;
        return [Math.cos(t), 0.62 + 0.7 * Math.sin(t)] as [number, number];
      });
      return [...foot, [stem, 0.58], [0.95, 0.56], ...cap, [-0.95, 0.56], [-stem, 0.58]];
    }
  }
}

/** The rug's outline in meters, (x, z) with +z toward the rug's front, centered, spanning exactly its width × length. */
export function outline({ shape = 'rect', size: [width, length], pile }: Pick<TextileSpec, 'shape' | 'size' | 'pile'>): [number, number][] {
  const [w, l] = [width / 100, length / 100];
  if (shape === 'rect' && pile !== 'shag') return [[-w / 2, -l / 2], [w / 2, -l / 2], [w / 2, l / 2], [-w / 2, l / 2]];
  // A shag rug's edge is fuzzy: its points move in or out by up to 6 mm, and a rectangle gets a point every 2 cm.
  const fuzz = pile === 'shag' ? 0.006 : 0;
  const rand = random(width * 7 + length);
  const jitter = (points: [number, number][]) => points.map(([x, z]): [number, number] => {
    const r = Math.hypot(x / w, z / l) || 1;
    const d = (rand() - 0.5) * 2 * fuzz;
    return [x + (x / w / r) * d, z + (z / l / r) * d];
  });
  if (shape === 'rect') {
    const edge = (n: number, at: (t: number) => [number, number]) => Array.from({ length: n }, (_, i) => at(i / n));
    const [nw, nl] = [Math.ceil(w / 0.02), Math.ceil(l / 0.02)];
    return jitter([
      ...edge(nw, (t) => [-w / 2 + t * w, -l / 2]), ...edge(nl, (t) => [w / 2, -l / 2 + t * l]),
      ...edge(nw, (t) => [w / 2 - t * w, l / 2]), ...edge(nl, (t) => [-w / 2, l / 2 - t * l]),
    ]);
  }
  const points = shapePoints(shape);
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  return jitter(points.map(([x, y]) => [((x - x0) / (x1 - x0) - 0.5) * w, (0.5 - (y - y0) / (y1 - y0)) * l]));
}

/** The face's pixel size: LONG_SIDE_PX on its long side, the textile's proportions. */
export function facePixels({ size: [width, length] }: Pick<TextileSpec, 'size'>): Vec2 {
  const scale = LONG_SIDE_PX / Math.max(width, length);
  return [Math.round(width * scale), Math.round(length * scale)];
}

/** The Catalog entry for a textile whose face has these colors. */
export function toCatalogItem(spec: TextileSpec, { colors, colorHex }: { colors: string[]; colorHex: Hex }): CatalogItem {
  const { source } = spec;
  return {
    id: spec.id,
    source: source.kind === 'pattern' ? 'generated' : 'publicdomain',
    title: spec.title,
    category: spec.use === 'rug' ? 'rug' : 'wall_art',
    mount: spec.use === 'rug' ? 'floor' : 'wall',
    size: textileSize(spec),
    model: `/data/catalog/textiles/${spec.id}.glb`,
    thumbnail: `/data/catalog/textiles/${spec.id}.jpg`,
    colors,
    colorHex,
    materials: spec.use === 'rug' ? [spec.pile === 'shag' ? 'Faux fur' : 'Wool'] : ['Cotton', 'Wood'],
    styleTags: [...spec.styleTags, ...(spec.use === 'tapestry' ? ['tapestry'] : [])],
    priceEstimateUsd: spec.price,
    url: source.kind === 'publicdomain' ? source.page : '',
    attribution: source.kind === 'publicdomain' ? `${source.institution}. Public domain` : 'Pattern drawn for Mise',
  };
}

/* ───────────── Patterns ───────────── */

/** A seeded pseudo-random number generator (mulberry32), so a pattern draws the same each build. */
export function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const f = (n: number) => n.toFixed(1);

/** A smooth closed path through the points (Catmull-Rom as cubic Béziers). */
function closedCurve(points: [number, number][]): string {
  const n = points.length;
  const at = (i: number) => points[(i + n) % n];
  const parts = [`M${f(at(0)[0])},${f(at(0)[1])}`];
  for (let i = 0; i < n; i++) {
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    parts.push(`C${f(c1[0])},${f(c1[1])} ${f(c2[0])},${f(c2[1])} ${f(p2[0])},${f(p2[1])}`);
  }
  return `${parts.join(' ')}Z`;
}

/** A shape's outline as an SVG path over a w × h px face, grown a little about its center so its color reaches the rug's edge. */
function outlinePath(shape: Exclude<Shape, 'rect'>, w: number, h: number, keep: (y: number) => boolean = () => true): string {
  const points = shapePoints(shape);
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const grow = 1.04;
  return `${points.filter(([, y]) => keep(y)).map(([x, y], i) => {
    const [u, v] = [(x - x0) / (x1 - x0) - 0.5, 0.5 - (y - y0) / (y1 - y0)];
    return `${i ? 'L' : 'M'}${f((0.5 + u * grow) * w)},${f((0.5 + v * grow) * h)}`;
  }).join('')}Z`;
}

/** A shaped rug's own picture: a daisy's petals and heart, a mushroom's spotted cap on its stem, or the shape in one color. */
function motifShapes(shape: Exclude<Shape, 'rect'>, colors: Hex[], w: number, h: number): string {
  const [first, second = first, third = second] = colors;
  if (shape === 'daisy') {
    const veins = Array.from({ length: 8 }, (_, k) => {
      const t = ((k + 0.5) / 8) * Math.PI * 2;
      return `<line x1="${f(w / 2)}" y1="${f(h / 2)}" x2="${f(w / 2 + Math.cos(t) * w * 0.4)}" y2="${f(h / 2 + Math.sin(t) * h * 0.4)}"/>`;
    });
    return `<path d="${outlinePath(shape, w, h)}" fill="${first}"/>`
      + `<g stroke="${third}" stroke-width="${f(w * 0.012)}" stroke-linecap="round">${veins.join('')}</g>`
      + `<circle cx="${f(w / 2)}" cy="${f(h / 2)}" r="${f(Math.min(w, h) * 0.2)}" fill="${second}"/>`;
  }
  if (shape === 'mushroom') {
    // The cap is the outline above the stem's top (y 0.56 in shapePoints' units, of 0 to 1.32).
    const spots = [[0.3, 0.2, 0.07], [0.55, 0.12, 0.055], [0.72, 0.27, 0.065], [0.45, 0.32, 0.05], [0.16, 0.36, 0.045], [0.86, 0.4, 0.04]];
    return `<path d="${outlinePath(shape, w, h)}" fill="${third}"/>`
      + `<path d="${outlinePath(shape, w, h, (y) => y >= 0.555)}" fill="${first}"/>`
      + spots.map(([x, y, r]) => `<circle cx="${f(x * w)}" cy="${f(y * h)}" r="${f(r * w)}" fill="${second}"/>`).join('');
  }
  return `<path d="${outlinePath(shape, w, h)}" fill="${first}"/>`;
}

/** The pattern's shapes, w × h px, without the tufting the face adds over them. */
export function patternShapes({ pattern, colors, count, seed = 1 }: PatternSource, w: number, h: number, shape: Shape = 'rect'): string {
  const [field, ...motifs] = colors;
  const rand = random(seed);
  const shapes = [`<rect width="${w}" height="${h}" fill="${field}"/>`];
  if (pattern === 'solid') {
    // The field alone.
  } else if (pattern === 'motif') {
    if (shape === 'rect') throw new Error("a 'motif' pattern draws the rug's shape: give the rug a shape");
    shapes.push(motifShapes(shape, motifs.length ? motifs : [field], w, h));
  } else if (pattern === 'checker') {
    const cell = w / (count ?? 6);
    for (let y = 0; y * cell < h; y++) {
      for (let x = 0; x * cell < w; x++) {
        if ((x + y) % 2) shapes.push(`<rect x="${f(x * cell)}" y="${f(y * cell)}" width="${f(cell)}" height="${f(cell)}" fill="${motifs[0]}"/>`);
      }
    }
  } else if (pattern === 'waves' || pattern === 'stripes') {
    // Bands across the textile's length, wavy or straight, each a motif color in turn.
    const bands = count ?? 9;
    const band = h / bands;
    const amplitude = pattern === 'waves' ? band * 0.42 : 0;
    const wave = (i: number) => Array.from({ length: 41 }, (_, k) => {
      const x = (k / 40) * w;
      return [x, i * band + amplitude * Math.sin((x / w) * Math.PI * 2 * 1.5 + i * 0.6)] as [number, number];
    });
    for (let i = 0; i < bands; i++) {
      const top = wave(i).map(([x, y]) => [x, i === 0 ? -amplitude - 2 : y] as [number, number]);
      const bottom = wave(i + 1).map(([x, y]) => [x, i === bands - 1 ? h + amplitude + 2 : y] as [number, number]).reverse();
      const d = [...top, ...bottom].map(([x, y], k) => `${k ? 'L' : 'M'}${f(x)},${f(y)}`).join('');
      shapes.push(`<path d="${d}Z" fill="${[field, ...motifs][i % colors.length]}"/>`);
    }
  } else if (pattern === 'daisies') {
    // Daisies on a jittered grid: petals in the first motif color, a center in the second.
    const across = count ?? 5;
    const step = w / across;
    for (let y = step / 2; y < h + step / 2; y += step * 0.87) {
      for (let x = (Math.round(y / step) % 2) * step / 2; x < w + step / 2; x += step) {
        const cx = x + (rand() - 0.5) * step * 0.35;
        const cy = y + (rand() - 0.5) * step * 0.35;
        const r = step * (0.26 + rand() * 0.12);
        const spin = rand() * 45;
        const petals = Array.from({ length: 8 }, (_, k) =>
          `<ellipse cx="${f(cx)}" cy="${f(cy - r * 0.55)}" rx="${f(r * 0.24)}" ry="${f(r * 0.5)}" transform="rotate(${f(spin + k * 45)} ${f(cx)} ${f(cy)})"/>`);
        shapes.push(`<g fill="${motifs[0]}">${petals.join('')}</g><circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r * 0.28)}" fill="${motifs[1]}"/>`);
      }
    }
  } else if (pattern === 'arches') {
    // Rows of rainbow arches, each ring a motif color, outermost first.
    const across = count ?? 4;
    const cell = w / across;
    const rings = motifs.length;
    for (let row = 0; row * cell * 0.62 < h + cell; row++) {
      for (let col = 0; col < across + 1; col++) {
        const cx = col * cell + (row % 2 ? cell / 2 : 0);
        const base = (row + 1) * cell * 0.62;
        for (let k = 0; k < rings; k++) {
          const r = (cell * 0.46 * (rings - k)) / rings;
          shapes.push(`<path d="M${f(cx - r)},${f(base)} A${f(r)},${f(r)} 0 0 1 ${f(cx + r)},${f(base)}Z" fill="${motifs[k]}"/>`);
        }
      }
    }
  } else {
    // Blobs: soft cut-out shapes, one jittered about each cell of a grid, so they spread over the whole textile.
    const across = count ?? 3;
    const cell = w / across;
    const down = Math.round(h / cell);
    for (let i = 0; i < across * down; i++) {
      const cx = ((i % across) + 0.2 + rand() * 0.6) * cell;
      const cy = (Math.floor(i / across) + 0.2 + rand() * 0.6) * (h / down);
      const r = cell * (0.22 + rand() * 0.14);
      const points = Array.from({ length: 7 }, (_, k) => {
        const angle = (k / 7) * Math.PI * 2;
        const radius = r * (0.65 + rand() * 0.55);
        return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)] as [number, number];
      });
      shapes.push(`<path d="${closedCurve(points)}" fill="${motifs[i % motifs.length]}"/>`);
    }
  }
  return shapes.join('');
}

/**
 * A drawn pattern as a hand-tufted face: its edges wobble a little, and a fine wool grain lies over it. librsvg draws
 * the filters, as it does the posters' oak.
 */
export async function patternFace(source: PatternSource, [w, h]: Vec2, { shape = 'rect', pile = 'flat', size }: Partial<Pick<TextileSpec, 'shape' | 'pile' | 'size'>> = {}): Promise<Buffer> {
  const wobble = Math.max(w, h) / 160;
  if (pile === 'shag') {
    // Shag: soft clumps of pile about 4 cm across, light and dark, with curled strands over them. cm is pixels per cm.
    const cm = Math.max(w, h) / Math.max(...(size ?? [Math.max(w, h) / 10, 0]));
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
      <filter id="shag" x="0" y="0" width="1" height="1">
        <feTurbulence type="fractalNoise" baseFrequency="${(1 / (4 * cm)).toFixed(4)}" numOctaves="3" seed="${source.seed ?? 1}" result="clumps"/>
        <feColorMatrix in="clumps" type="matrix" values="0.7 0 0 0 0.6  0.7 0 0 0 0.6  0.7 0 0 0 0.6  0 0 0 0 1" result="clumpShade"/>
        <feTurbulence type="turbulence" baseFrequency="${(1 / (0.25 * cm)).toFixed(4)} ${(1 / (1.8 * cm)).toFixed(4)}" numOctaves="2" seed="${(source.seed ?? 1) + 1}" result="streaks"/>
        <feDisplacementMap in="streaks" in2="clumps" scale="${f(1.5 * cm)}" xChannelSelector="R" yChannelSelector="G" result="curls"/>
        <feColorMatrix in="curls" type="matrix" values="-0.5 0 0 0 1.05  -0.5 0 0 0 1.05  -0.5 0 0 0 1.05  0 0 0 0 1" result="strandShade"/>
        <feDisplacementMap in="SourceGraphic" in2="clumps" scale="${f(0.8 * cm)}" xChannelSelector="R" yChannelSelector="G" result="fur"/>
        <feBlend in="clumpShade" in2="fur" mode="multiply" result="clumped"/>
        <feBlend in="strandShade" in2="clumped" mode="multiply"/>
      </filter>
      <g filter="url(#shag)">${patternShapes(source, w, h, shape)}</g>
    </svg>`;
    return sharp(Buffer.from(svg)).removeAlpha().jpeg({ quality: 90 }).toBuffer();
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <filter id="tuft" x="0" y="0" width="1" height="1">
      <feTurbulence type="fractalNoise" baseFrequency="0.012" numOctaves="2" seed="${source.seed ?? 1}" result="warp"/>
      <feDisplacementMap in="SourceGraphic" in2="warp" scale="${f(wobble)}" xChannelSelector="R" yChannelSelector="G"/>
    </filter>
    <filter id="wool" x="0" y="0" width="1" height="1">
      <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="3"/>
      <feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0.5 0.5 0 0 -0.42"/>
    </filter>
    <g filter="url(#tuft)">${patternShapes(source, w, h, shape)}</g>
    <rect width="${w}" height="${h}" filter="url(#wool)"/>
  </svg>`;
  return sharp(Buffer.from(svg)).removeAlpha().jpeg({ quality: 90 }).toBuffer();
}

/* ───────────── The model ───────────── */

/**
 * A normal map of shag pile, from the same kind of noise that shades the face: each pixel's normal is the slope of
 * the noise there. Without it a shag rug's top lights as flat as a print.
 */
export async function pileNormals(spec: Pick<TextileSpec, 'size'>, seed = 1): Promise<Buffer> {
  const [w, h] = facePixels(spec);
  const scale = 1024 / Math.max(w, h);
  const cm = 1024 / Math.max(...spec.size);   // normal-map pixels per cm
  const [nw, nh] = [Math.round(w * scale), Math.round(h * scale)];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${nw}" height="${nh}"><filter id="n" x="0" y="0" width="1" height="1">
    <feTurbulence type="fractalNoise" baseFrequency="${(1 / (4 * cm)).toFixed(4)}" numOctaves="3" seed="${seed}"/></filter>
    <rect width="${nw}" height="${nh}" filter="url(#n)"/></svg>`;
  const { data } = await sharp(Buffer.from(svg)).removeAlpha().greyscale().raw().toBuffer({ resolveWithObject: true });
  const height = (x: number, y: number) => data[Math.min(nh - 1, Math.max(0, y)) * nw + Math.min(nw - 1, Math.max(0, x))] / 255;
  const out = Buffer.alloc(nw * nh * 3);
  const strength = 5;
  for (let y = 0; y < nh; y++) {
    for (let x = 0; x < nw; x++) {
      const dx = (height(x + 1, y) - height(x - 1, y)) * strength;
      const dy = (height(x, y + 1) - height(x, y - 1)) * strength;
      const length = Math.hypot(dx, dy, 1);
      // Tangent space: +x along u, +y along -v (glTF's v runs down the image), z out of the surface.
      out.set([(-dx / length) * 127.5 + 127.5, (dy / length) * 127.5 + 127.5, (1 / length) * 127.5 + 127.5].map(Math.round), (y * nw + x) * 3);
    }
  }
  return sharp(out, { raw: { width: nw, height: nh, channels: 3 } }).png().toBuffer();
}

/**
 * A shaped or shag rug as a glTF document: its outline's top face carrying the face image, a sloped rim down to the
 * floor, no bottom. Its pivot is the bottom center and its top faces +Y; the image's top edge is at the back (−Z), as
 * flat-rug.ts lays its rugs.
 */
export function shapedRugDocument(spec: TextileSpec, face: Buffer, normals?: Buffer): Document {
  const [w, thickness, l] = textileSize(spec);
  const floor = outline(spec);
  // Counterclockwise seen from above (+Y): with x right and z toward the viewer, that is clockwise in the x–z plane's
  // own axes, so its shoelace sum comes out negative, and an edge (ex, ez)'s outward normal is (−ez, ex).
  const area = floor.reduce((sum, [x, z], i) => { const [nx, nz] = floor[(i + 1) % floor.length]; return sum + x * nz - nx * z; }, 0);
  if (area > 0) floor.reverse();
  // The top ring sits inside the floor ring by the bevel, each point moved along the inward normal of its two edges.
  const bevel = Math.min(spec.pile === 'shag' ? 0.018 : 0.006, Math.min(w, l) / 20);
  const n = floor.length;
  const top = floor.map(([x, z], i) => {
    const [px, pz] = floor[(i - 1 + n) % n];
    const [qx, qz] = floor[(i + 1) % n];
    const inward = (ax: number, az: number, bx: number, bz: number) => { const len = Math.hypot(bx - ax, bz - az) || 1; return [(bz - az) / len, -(bx - ax) / len]; };
    const [ax, az] = inward(px, pz, x, z);
    const [bx, bz] = inward(x, z, qx, qz);
    const len = Math.hypot(ax + bx, az + bz) || 1;
    return [x + ((ax + bx) / len) * bevel, z + ((az + bz) / len) * bevel] as [number, number];
  });
  const uv = ([x, z]: [number, number]) => [x / w + 0.5, z / l + 0.5];
  const positions: number[] = [];
  const normalsOut: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  // The top: triangulated inside the outline, each triangle wound to face up.
  top.forEach((point) => { positions.push(point[0], thickness, point[1]); normalsOut.push(0, 1, 0); uvs.push(...uv(point)); });
  for (const [a, b, c] of ShapeUtils.triangulateShape(top.map(([x, z]) => new Vector2(x, z)), [])) {
    const [ax, az] = top[a];
    const cross = (top[b][0] - ax) * (top[c][1] - az) - (top[b][1] - az) * (top[c][0] - ax);
    indices.push(...(cross < 0 ? [a, b, c] : [a, c, b]));
  }
  // The rim: a quad from each top edge down to its floor edge, facing out.
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const [ex, ez] = [floor[j][0] - floor[i][0], floor[j][1] - floor[i][1]];
    const len = Math.hypot(ex, ez) || 1;
    const [ox, oz] = [-ez / len, ex / len];
    const slope = Math.hypot(thickness, bevel);
    const normal = [ox * (thickness / slope), bevel / slope, oz * (thickness / slope)];
    const first = positions.length / 3;
    for (const [point, y] of [[top[i], thickness], [top[j], thickness], [floor[j], 0], [floor[i], 0]] as const) {
      positions.push(point[0], y, point[1]);
      normalsOut.push(...normal);
      uvs.push(...uv(point));
    }
    indices.push(first, first + 2, first + 1, first, first + 3, first + 2);
  }
  // Wind each rim quad to face out, whichever way the ring runs.
  for (let k = indices.length - n * 6; k < indices.length; k += 3) {
    const [a, b, c] = [indices[k], indices[k + 1], indices[k + 2]].map((i) => positions.slice(i * 3, i * 3 + 3));
    const cross = [
      (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]),
      (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]),
      (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]),
    ];
    const ni = indices[k] * 3;
    if (cross[0] * normalsOut[ni] + cross[1] * normalsOut[ni + 1] + cross[2] * normalsOut[ni + 2] < 0) {
      [indices[k + 1], indices[k + 2]] = [indices[k + 2], indices[k + 1]];
    }
  }

  const doc = new Document();
  const buffer = doc.createBuffer();
  const accessor = (array: TypedArray, type: 'VEC2' | 'VEC3' | 'SCALAR') => doc.createAccessor().setArray(array).setType(type).setBuffer(buffer);
  const material = doc.createMaterial(spec.id).setRoughnessFactor(1).setMetallicFactor(0)
    .setBaseColorTexture(doc.createTexture('face').setImage(new Uint8Array(face)).setMimeType('image/jpeg'));
  if (normals) material.setNormalTexture(doc.createTexture('pile').setImage(new Uint8Array(normals)).setMimeType('image/png'));
  const primitive = doc.createPrimitive()
    .setAttribute('POSITION', accessor(new Float32Array(positions), 'VEC3'))
    .setAttribute('NORMAL', accessor(new Float32Array(normalsOut), 'VEC3'))
    .setAttribute('TEXCOORD_0', accessor(new Float32Array(uvs), 'VEC2'))
    .setIndices(accessor(new Uint16Array(indices), 'SCALAR'))
    .setMaterial(material);
  doc.createScene(spec.id).addChild(doc.createNode(spec.id).setMesh(doc.createMesh(spec.id).addPrimitive(primitive)));
  return doc;
}

/**
 * A tapestry as a glTF document: the cloth hanging from a wooden rod at its top, its bottom-center at the origin and
 * its face toward +Z. The rod's back touches the wall; the cloth hangs just in front of the wall, under the rod.
 */
export function tapestryDocument(spec: TextileSpec, face: Buffer): Document {
  const [W, H, D] = textileSize(spec);
  const [w, h] = [spec.size[0] / 100, spec.size[1] / 100];
  const document = new Document();
  const buffer = document.createBuffer();
  const mesh = document.createMesh(spec.id);
  document.createScene(spec.id).addChild(document.createNode(spec.id).setMesh(mesh));
  const accessor = (type: 'VEC3' | 'VEC2' | 'SCALAR', array: TypedArray) =>
    document.createAccessor().setType(type).setArray(array).setBuffer(buffer);
  type Mesh = { positions: number[]; normals: number[]; uvs: number[]; indices: number[] };
  const add = ({ positions, normals, uvs, indices }: Mesh, material: ReturnType<Document['createMaterial']>) =>
    mesh.addPrimitive(document.createPrimitive()
      .setAttribute('POSITION', accessor('VEC3', new Float32Array(positions)))
      .setAttribute('NORMAL', accessor('VEC3', new Float32Array(normals)))
      .setAttribute('TEXCOORD_0', accessor('VEC2', new Float32Array(uvs)))
      .setIndices(accessor('SCALAR', new Uint16Array(indices)))
      .setMaterial(material));
  const matte = (name: string) => document.createMaterial(name).setMetallicFactor(0).setRoughnessFactor(1);

  // The cloth: its face carries the image, upright (glTF UVs start at the image's top-left), the rest is its edge.
  const z = D / 2;
  add({
    positions: [-w / 2, 0, z, w / 2, 0, z, w / 2, h, z, -w / 2, h, z],
    normals: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
    uvs: [0, 1, 1, 1, 1, 0, 0, 0],
    indices: [0, 1, 2, 0, 2, 3],
  }, matte('face').setBaseColorTexture(document.createTexture('face').setImage(new Uint8Array(face)).setMimeType('image/jpeg')));
  const edge: Mesh = { positions: [], normals: [], uvs: [], indices: [] };
  addBox(edge, [-w / 2, 0, z - CLOTH], [w / 2, h, z], { faces: ['+x', '-x', '-y', '-z'] });
  add(edge, matte('cloth').setBaseColorFactor([0.62, 0.58, 0.52, 1]));
  const rod: Mesh = { positions: [], normals: [], uvs: [], indices: [] };
  addBox(rod, [-W / 2, h, 0 - D / 2], [W / 2, H, D / 2]);
  add(rod, document.createMaterial('rod').setBaseColorFactor([0.42, 0.26, 0.13, 1]).setMetallicFactor(0).setRoughnessFactor(0.8));
  return document;
}

/* ───────────── Files ───────────── */

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SPECS = join(ROOT, 'scripts/textiles.json');
const CACHE = join(ROOT, 'scripts/.cache/textiles');
const OUT = join(ROOT, 'data/catalog/textiles');
const CATALOG = join(ROOT, 'data/catalog/textiles.json');

/** A file's bytes, as posters-build gets them: some museums turn away Node's default User-Agent. */
async function download(url: string): Promise<Buffer> {
  const res = await fetch(url, { headers: { 'User-Agent': 'mise-textiles-build/1.0' } });
  if (!res.ok) throw new Error(`GET ${url}: ${res.status} ${res.statusText}`);
  return Buffer.from(await res.arrayBuffer());
}

/** A museum textile's image: from the cache, or downloaded into it. */
async function original(source: MuseumSource, id: string): Promise<Buffer> {
  const file = join(CACHE, `${id}.img`);
  if (existsSync(file)) return readFile(file);
  const data = await download(source.image);
  await mkdir(CACHE, { recursive: true });
  await writeFile(`${file}.part`, data);
  await rename(`${file}.part`, file);
  return data;
}

/** The textile's face at its proportions: the museum image cropped and turned, or the pattern drawn. */
export async function face(spec: TextileSpec): Promise<Buffer> {
  const [w, h] = facePixels(spec);
  const { source } = spec;
  if (source.kind === 'pattern') return patternFace(source, [w, h], spec);
  let image = sharp(await original(source, spec.id)).rotate();   // EXIF orientation first
  const { width = 0, height = 0 } = await image.metadata();
  if (source.crop) {
    const { left, top, width: cw, height: ch } = source.crop;
    image = sharp(await image.extract({
      left: Math.round(left * width), top: Math.round(top * height), width: Math.floor(cw * width), height: Math.floor(ch * height),
    }).toBuffer());
  }
  // Turned so the photo's long side runs the way the textile's does, unless the spec says how to turn it.
  const cropped = await image.metadata();
  const sideways = ((cropped.width ?? 0) > (cropped.height ?? 0)) !== (w > h);
  const turn = source.turn ?? (sideways ? 1 : 0);
  if (turn) image = sharp(await image.rotate(turn * 90).toBuffer());
  // The photo's proportions and the record's size differ by a few percent at most (see textiles.json): fill stretches.
  return image.resize(w, h, { fit: 'fill' }).removeAlpha().jpeg({ quality: 90 }).toBuffer();
}

/** A 256 px thumbnail on the Catalog's light card: a rug seen from above, a tapestry on its rod. */
async function thumbnail(spec: TextileSpec, image: Buffer): Promise<Buffer> {
  const [w, h] = spec.size;
  const rod = spec.use === 'tapestry' ? 8 : 0;
  const scale = (224 - rod) / Math.max(w, h);
  const [tw, th] = [Math.round(w * scale), Math.round(h * scale)];
  const layers: OverlayOptions[] = [{ input: await sharp(image).resize(tw, th, { fit: 'fill' }).toBuffer(), left: Math.round((256 - tw) / 2), top: Math.round((256 - th + rod) / 2) }];
  if (rod) {
    const rw = tw + 16;
    layers.push({ input: await sharp({ create: { width: rw, height: rod, channels: 3, background: '#6b4321' } }).png().toBuffer(), left: Math.round((256 - rw) / 2), top: Math.round((256 - th - rod) / 2) });
  }
  return sharp({ create: { width: 256, height: 256, channels: 3, background: '#f4f1ea' } }).composite(layers).jpeg({ quality: 86 }).toBuffer();
}

/** Builds one textile's GLB and thumbnail and returns its Catalog entry. */
async function buildTextile(spec: TextileSpec): Promise<{ item: CatalogItem; bytes: number; image: Buffer }> {
  const image = await face(spec);
  // A pattern's colors are measured before its wool grain, which would darken a cream field into "Orange".
  const flat = spec.source.kind === 'pattern'
    ? Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="${Math.round((200 * spec.size[1]) / spec.size[0])}">${patternShapes(spec.source, 200, Math.round((200 * spec.size[1]) / spec.size[0]), spec.shape)}</svg>`)
    : image;
  const { data: rgb } = await sharp(flat).resize(96, 96, { fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const item = toCatalogItem(spec, posterColors(rgb));
  const shaped = spec.use === 'rug' && ((spec.shape ?? 'rect') !== 'rect' || spec.pile === 'shag');
  const normals = spec.pile === 'shag' ? await pileNormals(spec, spec.source.kind === 'pattern' ? spec.source.seed : 1) : undefined;
  const doc = spec.use === 'tapestry' ? tapestryDocument(spec, image)
    : shaped ? shapedRugDocument(spec, image, normals)
    : rugDocument(image, [spec.size[0] / 100, spec.size[1] / 100], spec.id);
  await mkdir(join(CACHE, 'build'), { recursive: true });
  const raw = join(CACHE, 'build', `${spec.id}.raw.glb`);
  await writeGlb(doc, raw);
  // catalog-build's optimize: WebP textures at 1K, checked against the 2 MB budget and the glTF validator.
  const { bytes } = await optimizeModel(raw, join(OUT, `${spec.id}.glb`)).finally(() => rm(raw));
  // A shaped or shag rug's thumbnail is rendered from its GLB, so it shows the rug's outline and pile, not its square face.
  if (shaped) await renderThumbnails([{ glb: join(OUT, `${spec.id}.glb`), out: join(OUT, `${spec.id}.jpg`) }]);
  else await writeFile(join(OUT, `${spec.id}.jpg`), await thumbnail(spec, image));
  return { item, bytes, image };
}

/** CREDITS.md: where each real textile comes from and why it may be used, and which are drawn patterns. */
export function credits(specs: TextileSpec[]): string {
  const museum = specs.filter((spec) => spec.source.kind === 'publicdomain');
  const drawn = specs.filter((spec) => spec.source.kind === 'pattern');
  return [
    '# Rug and tapestry credits',
    '',
    'Written by `scripts/textiles-build.ts` from `scripts/textiles.json`. Each textile is a real rug or textile in the',
    'public domain, from a museum\'s open-access collection, or a simple pattern (checks, waves, daisies) drawn by the script.',
    '',
    '## Real rugs and textiles',
    '',
    ...museum.flatMap((spec) => {
      const source = spec.source as MuseumSource;
      return [
        `### ${spec.title} (\`${spec.id}\`)`,
        '',
        `- **Work:** ${source.work}`,
        `- **Source:** ${source.institution}, ${source.page}`,
        `- **Image:** ${source.image}`,
        `- **Why we may use it:** ${source.why}`,
        '',
      ];
    }),
    '## Drawn patterns',
    '',
    ...drawn.map((spec) => `- ${spec.title} (\`${spec.id}\`): ${(spec.source as PatternSource).pattern}`),
    '',
  ].join('\n');
}

/** A contact sheet of every textile, rugs then tapestries, for the PR. */
async function contactSheet(specs: TextileSpec[], images: Map<string, Buffer>): Promise<Buffer> {
  const cell = 260;
  const gap = 24;
  const label = 46;
  const columns = 6;
  const shown = specs.filter((spec) => images.has(spec.id));
  const rows = Math.ceil(shown.length / columns);
  const [width, height] = [gap + columns * (cell + gap), gap + rows * (cell + label + gap)];
  const layers: OverlayOptions[] = [];
  const svg: string[] = [];
  for (const [i, spec] of shown.entries()) {
    const [left, top] = [gap + (i % columns) * (cell + gap), gap + Math.floor(i / columns) * (cell + label + gap)];
    const rendered = join(OUT, `${spec.id}.jpg`);
    const shaped = spec.use === 'rug' && ((spec.shape ?? 'rect') !== 'rect' || spec.pile === 'shag');
    const tile = await sharp(shaped && existsSync(rendered) ? await readFile(rendered) : await thumbnail(spec, images.get(spec.id)!)).resize(cell, cell).toBuffer();
    layers.push({ input: tile, left, top });
    const name = spec.title.length > 34 ? `${spec.title.slice(0, 33)}…` : spec.title;
    svg.push(`<text x="${left + cell / 2}" y="${top + cell + 20}" text-anchor="middle" font-family="Avenir Next" font-weight="600" font-size="14" fill="#27231f">${name.replace(/&/g, '&amp;')}</text>`);
    svg.push(`<text x="${left + cell / 2}" y="${top + cell + 38}" text-anchor="middle" font-family="Avenir Next" font-size="12" fill="#5b5349">${spec.use} · ${spec.size.join(' × ')} cm</text>`);
  }
  layers.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${svg.join('')}</svg>`), left: 0, top: 0 });
  return sharp({ create: { width, height, channels: 3, background: '#ffffff' } }).composite(layers).jpeg({ quality: 82 }).toBuffer();
}

/** Builds every textile (or only some), skipping and logging the ones that fail, then writes textiles.json and the rest. */
async function build(only?: string[]) {
  const specs: TextileSpec[] = JSON.parse(await readFile(SPECS, 'utf8'));
  const previous: Catalog = existsSync(CATALOG) ? JSON.parse(await readFile(CATALOG, 'utf8')) : { version: 1, items: [] };
  await mkdir(OUT, { recursive: true });

  // Four at a time, since each gltf-transform run keeps about one core busy. Items keep textiles.json's order.
  const built: (CatalogItem | undefined)[] = [];
  const images = new Map<string, Buffer>();
  let next = 0;
  const worker = async () => {
    for (let i = next++; i < specs.length; i = next++) {
      const spec = specs[i];
      const kept = previous.items.find((item) => item.id === spec.id);
      if (only && !only.includes(spec.id)) {
        built[i] = kept;
        continue;
      }
      try {
        const { item, bytes, image } = await buildTextile(spec);
        built[i] = item;
        images.set(spec.id, image);
        console.log(`✓ ${spec.id.padEnd(28)} ${item.size.map((side) => side.toFixed(2)).join(' × ')} m  ${(bytes / 1e6).toFixed(2)} MB  ${item.colors.join(', ')}`);
      } catch (error) {
        built[i] = kept;
        console.error(`✗ ${spec.id} skipped: ${error instanceof Error ? error.message : error}${kept ? '; kept its previous build' : ''}`);
      }
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  const items = built.filter((item) => item !== undefined);
  await writeFile(CATALOG, `${JSON.stringify({ version: 1, items } satisfies Catalog, null, 2)}\n`);
  const listed = specs.filter((spec) => items.some((item) => item.id === spec.id));
  await writeFile(join(OUT, 'CREDITS.md'), credits(listed));
  for (const spec of listed) if (!images.has(spec.id)) images.set(spec.id, await face(spec).catch(() => Buffer.alloc(0)));
  for (const [id, image] of images) if (image.length === 0) images.delete(id);
  await writeFile(join(OUT, 'contact-sheet.jpg'), await contactSheet(listed, images));

  // Remove the files of textiles that left the list.
  const used = new Set(items.flatMap((item) => [item.model, item.thumbnail]));
  for (const name of await readdir(OUT)) {
    if (/^(rug|tapestry)-.*\.(glb|jpg)$/.test(name) && !used.has(`/data/catalog/textiles/${name}`)) await rm(join(OUT, name));
  }
  console.log(`Wrote ${items.length} of ${specs.length} textiles to data/catalog/textiles.json.`);
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
