// scripts/posters-build.ts — the pre-loaded posters (#85): scripts/posters.json → data/catalog/posters/.
//
//   npx tsx --env-file=.env scripts/posters-build.ts [--only <id,id…>]
//
// For each poster: gets its art (a public-domain image, downloaded once, or an original generated with FLUX on fal,
// paid for once), crops it to the print's aspect ratio, sets its text with SVG, and writes
// data/catalog/posters/<id>.glb (a paper slab or a framed print, at its real size) and <id>.jpg (its thumbnail). Then
// writes data/catalog/posters.json (a Catalog), CREDITS.md, and contact-sheet.jpg.
//
// Art is kept in scripts/.cache/posters/, so a rebuild (to change a layout or a frame) neither downloads nor pays again.
// A poster whose art isn't there and can't be got keeps its last build. The type is set in macOS system fonts.

import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { fal } from '@fal-ai/client';
import { Document, NodeIO, type TypedArray } from '@gltf-transform/core';
import { EXTTextureWebP } from '@gltf-transform/extensions';
import sharp, { type OverlayOptions, type Sharp } from 'sharp';
import type { Catalog, CatalogItem, Hex, Vec3 } from '../shared/types';

/* ───────────── posters.json ───────────── */

/** A poster collection: a styleTag, and a filter chip in the Catalog panel. */
export const COLLECTIONS = [
  'museum', 'japanese prints', 'art nouveau', 'nature & science', 'space', 'y2k', 'retro gaming', 'anime sunsets', 'gig posters', 'parks & travel',
] as const;
export type Collection = (typeof COLLECTIONS)[number];

/** A standard print size in inches, portrait. */
export type PrintSize = '11x17' | '18x24' | '24x36';
export type Frame = 'none' | 'black' | 'white' | 'oak';

export interface PublicDomainSource {
  kind: 'publicdomain';
  image: string;                     // the full-size image to download
  page: string;                      // the institution's page for the work: the item's `url`
  institution: string;               // "The Art Institute of Chicago"
  work: string;                      // "Vincent van Gogh, The Bedroom, 1889": how CREDITS.md names it
  why: string;                       // why it is public domain (or free to use), for CREDITS.md
  /** The credit line, where the source asks for its own: "Courtesy NASA/JPL-Caltech". */
  attribution?: string;
  /** The part of the image to keep, as fractions of it, such as a margin with a logo cut off. */
  crop?: { left: number; top: number; width: number; height: number };
}

/** An original from FLUX 3, which takes no seed: its art is kept once paid for (see `art`). */
export interface GeneratedSource {
  kind: 'generated';
  prompt: string;
}

/** The text a poster's art gets, set with SVG. Sizes are cap heights in cm on the print, so they read from across a room. */
export type PosterText =
  | { kind: 'museum'; artist: string; work: string; date: string; paper: Hex; ink: Hex }
  | { kind: 'chrome'; title: string; subtitle?: string; at: 'top' | 'bottom' }
  | { kind: 'pixel'; title: string; subtitle?: string; color: Hex; at: 'top' | 'bottom' }
  | { kind: 'gig'; band: string; support?: string; venue: string; date: string; ink: Hex; shadow: Hex; at: 'top' | 'bottom' }
  | { kind: 'travel'; title: string; subtitle: string; ink: Hex; band: Hex; at: 'top' | 'bottom' }
  | { kind: 'caption'; text: string; ink: Hex; at: 'top' | 'bottom' }
  /** A travel poster: the art cropped into a bordered panel, a small kicker line and a big title above, a caption below. */
  | { kind: 'panel'; kicker?: string; title: string; caption: [string] | [string, string]; paper: Hex; ink: Hex };

/** One entry of scripts/posters.json. */
export interface PosterSpec {
  id: string;                        // "poster-great-wave"
  title: string;
  collection: Collection;
  size: PrintSize;
  landscape?: boolean;
  frame: Frame;
  /**
   * 'cover' (the default) crops the art to the print's aspect ratio. 'contain' keeps all of it, on a cream margin: for a
   * poster with its own lettering near its edges.
   */
  fit?: 'cover' | 'contain';
  source: PublicDomainSource | GeneratedSource;
  text?: PosterText;
}

/* ───────────── Sizes, prices, Catalog items ───────────── */

const INCH = 0.0254;
const PAPER_DEPTH = 0.003;           // a print on heavy paper
const FRAME_WIDTH = 0.02;            // the moulding's face
const FRAME_DEPTH = 0.025;
const LONG_SIDE_PX = 2048;

/** The print's [width, height] in meters, to the millimeter. */
export function printMeters({ size, landscape }: Pick<PosterSpec, 'size' | 'landscape'>): [number, number] {
  const [short, long] = size.split('x').map((inches) => Math.round(Number(inches) * INCH * 1000) / 1000);
  return landscape ? [long, short] : [short, long];
}

/** The poster image's [width, height] in pixels: 2048 on the long side, at the print's aspect ratio. */
export function printPixels(spec: Pick<PosterSpec, 'size' | 'landscape'>): [number, number] {
  const [w, h] = printMeters(spec);
  const scale = LONG_SIDE_PX / Math.max(w, h);
  return [Math.round(w * scale), Math.round(h * scale)];
}

/** [W, H, D] in meters of the whole Piece: the print, or the print in its frame. */
export function posterSize(spec: Pick<PosterSpec, 'size' | 'landscape' | 'frame'>): Vec3 {
  const [w, h] = printMeters(spec);
  if (spec.frame === 'none') return [w, h, PAPER_DEPTH];
  const mm = (meters: number) => Math.round(meters * 1000) / 1000;
  return [mm(w + 2 * FRAME_WIDTH), mm(h + 2 * FRAME_WIDTH), FRAME_DEPTH];
}

/** A typical price for a print of this size, framed or not: $15–40. */
export function posterPrice({ size, frame }: Pick<PosterSpec, 'size' | 'frame'>): number {
  const print = { '11x17': 15, '18x24': 25, '24x36': 30 }[size];
  return frame === 'none' ? print : print + 10;
}

/** Names of colors: the share of a poster's pixels each covers decides its color tags. */
const COLOR_NAMES = ['Red', 'Orange', 'Yellow', 'Green', 'Teal', 'Blue', 'Purple', 'Pink', 'Brown', 'Black', 'White', 'Gray', 'Beige'] as const;

/** The name of an sRGB color (0–255 channels). */
export function colorName(r: number, g: number, b: number): (typeof COLOR_NAMES)[number] {
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  const l = (max + min) / 2;
  const s = max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1));
  const hue = max === min ? 0 : (() => {
    const [rr, gg, bb] = [r, g, b].map((c) => c / 255);
    const d = max - min;
    const h = max === rr ? ((gg - bb) / d) % 6 : max === gg ? (bb - rr) / d + 2 : (rr - gg) / d + 4;
    return (h * 60 + 360) % 360;
  })();
  if (l < 0.13) return 'Black';
  if (l > 0.94) return 'White';      // HSL saturation runs high this near white
  if (s < 0.1 || (s < 0.25 && l < 0.22)) return l > 0.85 ? 'White' : 'Gray';
  if (l > 0.82 && s < 0.6 && hue >= 20 && hue < 70) return 'Beige';
  if (hue < 15 || hue >= 345) return l > 0.7 ? 'Pink' : 'Red';
  if (hue < 45) return l < 0.42 ? 'Brown' : 'Orange';
  if (hue < 68) return l < 0.35 ? 'Brown' : 'Yellow';
  if (hue < 165) return 'Green';
  if (hue < 195) return 'Teal';
  if (hue < 255) return 'Blue';
  if (hue < 290) return 'Purple';
  return 'Pink';
}

/**
 * The colors that cover at least 12% of an image's RGB pixels, the most first (at most 3), and the average of the
 * first one's pixels.
 */
export function posterColors(rgb: Uint8Array): { colors: string[]; colorHex: Hex } {
  const counts = new Map<string, { n: number; sum: [number, number, number] }>();
  for (let i = 0; i + 2 < rgb.length; i += 3) {
    const name = colorName(rgb[i], rgb[i + 1], rgb[i + 2]);
    const entry = counts.get(name) ?? { n: 0, sum: [0, 0, 0] };
    entry.n++;
    for (let c = 0; c < 3; c++) entry.sum[c] += rgb[i + c];
    counts.set(name, entry);
  }
  const total = rgb.length / 3;
  const ranked = [...counts].sort(([, a], [, b]) => b.n - a.n);
  const colors = ranked.filter(([, { n }], i) => i === 0 || n / total >= 0.12).slice(0, 3).map(([name]) => name);
  const { n, sum } = ranked[0][1];
  const colorHex = `#${sum.map((channel) => Math.round(channel / n).toString(16).padStart(2, '0')).join('')}` as Hex;
  return { colors, colorHex };
}

/** The RGB pixels not within a few steps of `hex`, such as a museum poster's art without its paper. */
export function withoutColor(rgb: Uint8Array, hex: Hex): Uint8Array {
  const color = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const kept: number[] = [];
  for (let i = 0; i + 2 < rgb.length; i += 3) {
    if (Math.max(...color.map((channel, c) => Math.abs(rgb[i + c] - channel))) > 10) kept.push(rgb[i], rgb[i + 1], rgb[i + 2]);
  }
  return new Uint8Array(kept);
}

/** The Catalog entry for a poster whose image has these colors. */
export function toCatalogItem(spec: PosterSpec, { colors, colorHex }: { colors: string[]; colorHex: Hex }): CatalogItem {
  const { source } = spec;
  return {
    id: spec.id,
    source: source.kind,
    title: spec.title,
    category: 'wall_art',
    mount: 'wall',
    size: posterSize(spec),
    model: `/data/catalog/posters/${spec.id}.glb`,
    thumbnail: `/data/catalog/posters/${spec.id}.jpg`,
    colors,
    colorHex,
    materials: spec.frame === 'none' ? ['Paper'] : ['Paper', spec.frame === 'oak' ? 'Wood' : 'Metal'],
    styleTags: ['poster', spec.collection, ...colors.map((color) => color.toLowerCase())],
    priceEstimateUsd: posterPrice(spec),
    url: source.kind === 'publicdomain' ? source.page : '',
    attribution: source.kind === 'generated' ? 'Generated with FLUX on fal' : source.attribution ?? `${source.institution}. Public domain`,
  };
}

/* ───────────── Text ───────────── */

const escapeXml = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);

interface Type { family: string; weight?: number | string; style?: 'italic'; spacing?: number }   // spacing: em

const textAttributes = ({ family, weight = 400, style, spacing = 0 }: Type, fontSize: number) =>
  `font-family="${escapeXml(family)}" font-size="${fontSize.toFixed(1)}" font-weight="${weight}"` +
  `${style ? ` font-style="${style}"` : ''}${spacing ? ` letter-spacing="${(spacing * fontSize).toFixed(1)}"` : ''}`;

/** How wide a line of text renders, in pixels, measured by rendering it. */
async function measure(text: string, type: Type, fontSize: number): Promise<number> {
  const width = Math.ceil(fontSize * (text.length + 2) * 1.4);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${Math.ceil(fontSize * 2)}">` +
    `<text x="${fontSize / 2}" y="${fontSize * 1.4}" ${textAttributes(type, fontSize)}>${escapeXml(text)}</text></svg>`;
  const { info } = await sharp(Buffer.from(svg)).trim().toBuffer({ resolveWithObject: true });
  return info.width;
}

/** The font size, at most `fontSize`, at which a line fits in `maxWidth` pixels. */
async function fit(text: string, type: Type, fontSize: number, maxWidth: number): Promise<number> {
  const width = await measure(text, type, fontSize);
  return width <= maxWidth ? fontSize : (fontSize * maxWidth) / width;
}

// A 5 × 7 pixel font for the retro gaming posters, drawn square by square so it stays crisp.
const PIXEL_GLYPHS: Record<string, string> = {
  A: '.###.|#...#|#...#|#####|#...#|#...#|#...#', B: '####.|#...#|#...#|####.|#...#|#...#|####.',
  C: '.###.|#...#|#....|#....|#....|#...#|.###.', D: '####.|#...#|#...#|#...#|#...#|#...#|####.',
  E: '#####|#....|#....|####.|#....|#....|#####', F: '#####|#....|#....|####.|#....|#....|#....',
  G: '.###.|#...#|#....|#.###|#...#|#...#|.####', H: '#...#|#...#|#...#|#####|#...#|#...#|#...#',
  I: '.###.|..#..|..#..|..#..|..#..|..#..|.###.', J: '..###|...#.|...#.|...#.|...#.|#..#.|.##..',
  K: '#...#|#..#.|#.#..|##...|#.#..|#..#.|#...#', L: '#....|#....|#....|#....|#....|#....|#####',
  M: '#...#|##.##|#.#.#|#.#.#|#...#|#...#|#...#', N: '#...#|#...#|##..#|#.#.#|#..##|#...#|#...#',
  O: '.###.|#...#|#...#|#...#|#...#|#...#|.###.', P: '####.|#...#|#...#|####.|#....|#....|#....',
  Q: '.###.|#...#|#...#|#...#|#.#.#|#..#.|.##.#', R: '####.|#...#|#...#|####.|#.#..|#..#.|#...#',
  S: '.####|#....|#....|.###.|....#|....#|####.', T: '#####|..#..|..#..|..#..|..#..|..#..|..#..',
  U: '#...#|#...#|#...#|#...#|#...#|#...#|.###.', V: '#...#|#...#|#...#|#...#|#...#|.#.#.|..#..',
  W: '#...#|#...#|#...#|#.#.#|#.#.#|#.#.#|.#.#.', X: '#...#|#...#|.#.#.|..#..|.#.#.|#...#|#...#',
  Y: '#...#|#...#|.#.#.|..#..|..#..|..#..|..#..', Z: '#####|....#|...#.|..#..|.#...|#....|#####',
  0: '.###.|#...#|#..##|#.#.#|##..#|#...#|.###.', 1: '..#..|.##..|..#..|..#..|..#..|..#..|.###.',
  2: '.###.|#...#|....#|...#.|..#..|.#...|#####', 3: '#####|...#.|..#..|...#.|....#|#...#|.###.',
  4: '...#.|..##.|.#.#.|#..#.|#####|...#.|...#.', 5: '#####|#....|####.|....#|....#|#...#|.###.',
  6: '..##.|.#...|#....|####.|#...#|#...#|.###.', 7: '#####|....#|...#.|..#..|.#...|.#...|.#...',
  8: '.###.|#...#|#...#|.###.|#...#|#...#|.###.', 9: '.###.|#...#|#...#|.####|....#|...#.|.##..',
  '-': '.....|.....|.....|.###.|.....|.....|.....', '.': '.....|.....|.....|.....|.....|.....|..#..',
  '!': '..#..|..#..|..#..|..#..|..#..|.....|..#..', ':': '.....|..#..|.....|.....|.....|..#..|.....',
  '&': '.##..|#..#.|#.#..|.#...|#.#.#|#..#.|.##.#', "'": '..#..|..#..|.....|.....|.....|.....|.....',
  '/': '....#|....#|...#.|..#..|.#...|#....|#....', '+': '.....|..#..|..#..|#####|..#..|..#..|.....',
  '?': '.###.|#...#|....#|...#.|..#..|.....|..#..', ' ': '.....|.....|.....|.....|.....|.....|.....',
};

/** A line of pixel text as SVG squares `cell` px wide, its top-left at (x, y), and its width. */
export function pixelText(text: string, x: number, y: number, cell: number, fill: string): { svg: string; width: number } {
  const squares: string[] = [];
  [...text.toUpperCase()].forEach((char, i) => {
    const glyph = PIXEL_GLYPHS[char];
    if (!glyph) throw new Error(`The pixel font has no "${char}"`);
    glyph.split('|').forEach((row, j) => [...row].forEach((on, k) => {
      if (on === '#') squares.push(`<rect x="${x + (i * 6 + k) * cell}" y="${y + j * cell}" width="${cell}" height="${cell}"/>`);
    }));
  });
  return { svg: `<g fill="${fill}">${squares.join('')}</g>`, width: (text.length * 6 - 1) * cell };
}

/** A box `height` px tall shaded from transparent to `color`, to set light text over the end of the art. */
const scrim = (id: string, y: number, height: number, w: number, at: 'top' | 'bottom', color = '#000', opacity = 0.55) =>
  `<defs><linearGradient id="${id}" x1="0" y1="${at === 'top' ? 1 : 0}" x2="0" y2="${at === 'top' ? 0 : 1}">` +
  `<stop offset="0" stop-color="${color}" stop-opacity="0"/><stop offset="1" stop-color="${color}" stop-opacity="${opacity}"/>` +
  `</linearGradient></defs><rect x="0" y="${y}" width="${w}" height="${height}" fill="url(#${id})"/>`;

/**
 * The SVG of a poster's text, `w` × `h` px, to lay over its art. `cm` is how many pixels a centimeter of the print is.
 * Cap heights are about 0.7 of a font size, so a 1.6 cm font size reads from 2 m away, and titles are far larger.
 */
export async function textSvg(text: PosterText, w: number, h: number): Promise<string> {
  const cm = h / heightCm(w, h);
  const margin = Math.round(Math.min(w, h) * 0.07);
  const inner = w - 2 * margin;
  const body: string[] = [];
  switch (text.kind) {
    case 'museum': {
      // The art sits above on the paper; the type goes in the band below it (see museumLayout).
      const artist: Type = { family: 'Futura', weight: 500, spacing: 0.22 };
      const work: Type = { family: 'Didot', style: 'italic' };
      const artistSize = await fit(text.artist.toUpperCase(), artist, 3.2 * cm, inner);
      const workSize = await fit(`${text.work}, ${text.date}`, work, 2.2 * cm, inner);
      const base = h - margin;
      body.push(`<text x="${w / 2}" y="${base - workSize * 1.5}" text-anchor="middle" fill="${text.ink}" ${textAttributes(artist, artistSize)}>${escapeXml(text.artist.toUpperCase())}</text>`);
      body.push(`<text x="${w / 2}" y="${base}" text-anchor="middle" fill="${text.ink}" ${textAttributes(work, workSize)}>${escapeXml(`${text.work}, ${text.date}`)}</text>`);
      break;
    }
    case 'chrome': {
      const title: Type = { family: 'Arial Rounded MT Bold', spacing: 0.02 };
      const size = await fit(text.title, title, 7.5 * cm, inner);
      const stroke = size * 0.07;
      const sub: Type = { family: 'Arial Rounded MT Bold', spacing: 0.06 };
      const subSize = text.subtitle ? await fit(text.subtitle, sub, 2 * cm, inner) : 0;
      const block = size * 0.75 + (text.subtitle ? subSize * 1.7 : 0);
      const top = text.at === 'top' ? margin : h - margin - block;
      const baseline = top + size * 0.75;
      body.push(`<defs>
        <linearGradient id="chrome" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#ffffff"/><stop offset="0.38" stop-color="#d9e2ee"/><stop offset="0.5" stop-color="#5f6a80"/>
          <stop offset="0.56" stop-color="#2e3446"/><stop offset="0.7" stop-color="#cfd9e6"/><stop offset="1" stop-color="#ffffff"/>
        </linearGradient>
        <filter id="glow" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="${(size * 0.08).toFixed(1)}"/></filter>
      </defs>`);
      const attrs = `x="${w / 2}" y="${baseline}" text-anchor="middle" ${textAttributes(title, size)}`;
      // A pink glow, then a thick ink outline, so the chrome reads on pale art too, then the chrome.
      body.push(`<text ${attrs} fill="#ff7fd1" stroke="#ff7fd1" stroke-width="${stroke * 4}" stroke-linejoin="round" filter="url(#glow)" opacity="0.9">${escapeXml(text.title)}</text>`);
      body.push(`<text ${attrs} fill="#20243a" stroke="#20243a" stroke-width="${stroke * 2.4}" stroke-linejoin="round">${escapeXml(text.title)}</text>`);
      body.push(`<text ${attrs} fill="url(#chrome)" stroke="#ffffff" stroke-width="${stroke * 0.35}" stroke-linejoin="round" paint-order="stroke">${escapeXml(text.title)}</text>`);
      if (text.subtitle) {
        body.push(`<text x="${w / 2}" y="${baseline + subSize * 1.7}" text-anchor="middle" fill="#ffffff" stroke="#20243a" stroke-width="${subSize * 0.22}" stroke-linejoin="round" paint-order="stroke" ${textAttributes(sub, subSize)}>${escapeXml(text.subtitle)}</text>`);
      }
      break;
    }
    case 'pixel': {
      const cell = Math.floor(Math.min((6.5 * cm) / 7, inner / (text.title.length * 6 - 1)));
      const subCell = text.subtitle ? Math.floor(Math.min((1.8 * cm) / 7, inner / (text.subtitle.length * 6 - 1))) : 0;
      const block = 7 * cell + (text.subtitle ? 7 * subCell + 3 * cell : 0);
      const top = text.at === 'top' ? margin : h - margin - block;
      const shadow = Math.max(2, Math.round(cell * 0.5));
      const title = (dx: number, fill: string) => pixelText(text.title, 0, 0, cell, fill).svg.replace('<g ', `<g transform="translate(${(w - (text.title.length * 6 - 1) * cell) / 2 + dx} ${top + dx})" `);
      body.push(scrim('pixel-scrim', text.at === 'top' ? 0 : h - block - 2 * margin, block + 2 * margin, w, text.at, '#000', 0.6));
      body.push(title(shadow, '#1a0f2e'), title(0, text.color));
      if (text.subtitle) {
        const sub = pixelText(text.subtitle, 0, 0, subCell, '#ffffff');
        body.push(sub.svg.replace('<g ', `<g transform="translate(${(w - sub.width) / 2} ${top + 7 * cell + 3 * cell})" `));
      }
      break;
    }
    case 'gig': {
      const band: Type = { family: 'Phosphate', spacing: 0.01 };
      const small: Type = { family: 'Futura', weight: 700, spacing: 0.12 };
      const bandSize = await fit(text.band.toUpperCase(), band, 7.5 * cm, inner);
      const supportSize = text.support ? await fit(`WITH ${text.support.toUpperCase()}`, small, 1.9 * cm, inner) : 0;
      const infoSize = await fit(`${text.venue} · ${text.date}`.toUpperCase(), small, 1.9 * cm, inner);
      const block = bandSize * 0.8 + supportSize * 1.7 + infoSize * 1.7;
      const top = text.at === 'top' ? margin : h - margin - block;
      const offset = bandSize * 0.04;   // the misregistered second color of a riso print
      const line = (y: number, words: string, type: Type, size: number, fill: string) =>
        `<text x="${w / 2}" y="${y}" text-anchor="middle" fill="${fill}" ${textAttributes(type, size)}>${escapeXml(words)}</text>`;
      const bandY = top + bandSize * 0.8;
      body.push(line(bandY + offset, text.band.toUpperCase(), band, bandSize, text.shadow));
      body.push(line(bandY, text.band.toUpperCase(), band, bandSize, text.ink));
      let y = bandY;
      if (text.support) body.push(line((y += supportSize * 1.7), `WITH ${text.support.toUpperCase()}`, small, supportSize, text.ink));
      body.push(line((y += infoSize * 1.7), `${text.venue} · ${text.date}`.toUpperCase(), small, infoSize, text.ink));
      break;
    }
    case 'travel': {
      const title: Type = { family: 'Futura', weight: 800, spacing: 0.04 };
      const sub: Type = { family: 'Futura', weight: 500, spacing: 0.16 };
      const titleSize = await fit(text.title.toUpperCase(), title, 6 * cm, inner);
      const subSize = await fit(text.subtitle.toUpperCase(), sub, 1.9 * cm, inner);
      const pad = titleSize * 0.35;
      const bandHeight = titleSize * 0.72 + subSize * 1.8 + 2 * pad;
      const bandTop = text.at === 'top' ? 0 : h - bandHeight;
      body.push(`<rect x="0" y="${bandTop}" width="${w}" height="${bandHeight}" fill="${text.band}"/>`);
      body.push(`<text x="${w / 2}" y="${bandTop + pad + titleSize * 0.72}" text-anchor="middle" fill="${text.ink}" ${textAttributes(title, titleSize)}>${escapeXml(text.title.toUpperCase())}</text>`);
      body.push(`<text x="${w / 2}" y="${bandTop + pad + titleSize * 0.72 + subSize * 1.8}" text-anchor="middle" fill="${text.ink}" ${textAttributes(sub, subSize)}>${escapeXml(text.subtitle.toUpperCase())}</text>`);
      break;
    }
    case 'panel': {
      const layout = panelLayout(text, w, h);
      const kicker: Type = { family: 'Hiragino Sans', weight: 700, spacing: 0.08 };
      const title: Type = { family: 'Futura', weight: 800, spacing: 0.01 };
      const caption: Type = { family: 'Futura', weight: 700, spacing: 0.04 };
      const line = (y: number, words: string, type: Type, size: number) =>
        `<text x="${w / 2}" y="${y}" text-anchor="middle" fill="${text.ink}" ${textAttributes(type, size)}>${escapeXml(words)}</text>`;
      if (text.kicker) body.push(line(layout.kickerBase, text.kicker, kicker, await fit(text.kicker, kicker, layout.kickerSize, inner)));
      body.push(line(layout.titleBase, text.title.toUpperCase(), title, await fit(text.title.toUpperCase(), title, layout.titleSize, inner)));
      for (const [i, words] of text.caption.entries()) {
        body.push(line(layout.captionBase + i * layout.captionSize * 1.3, words.toUpperCase(), caption, await fit(words.toUpperCase(), caption, layout.captionSize, inner)));
      }
      const { left, top, width, height } = layout.panel;
      const border = 0.3 * cm;
      body.push(`<rect x="${left + border / 2}" y="${top + border / 2}" width="${width - border}" height="${height - border}" fill="none" stroke="${text.ink}" stroke-width="${border}"/>`);
      break;
    }
    case 'caption': {
      const type: Type = { family: 'Avenir Next', weight: 600, spacing: 0.3 };
      const size = await fit(text.text.toUpperCase(), type, 2.2 * cm, inner);
      const y = text.at === 'top' ? margin + size * 0.72 : h - margin;
      body.push(`<text x="${w / 2}" y="${y}" text-anchor="middle" fill="${text.ink}" ${textAttributes(type, size)}>${escapeXml(text.text.toUpperCase())}</text>`);
      break;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body.join('')}</svg>`;
}

/** The print's height in cm, from its pixel size: every print is 2048 px on its long side. */
function heightCm(w: number, h: number): number {
  for (const size of ['11x17', '18x24', '24x36'] as const) {
    for (const landscape of [false, true]) {
      const [pw, ph] = printPixels({ size, landscape });
      if (pw === w && ph === h) return printMeters({ size, landscape })[1] * 100;
    }
  }
  throw new Error(`${w} × ${h} px is not a print size`);
}

/* ───────────── The poster image ───────────── */

/** Where a museum poster's art goes on its paper: inside the margins, above the band for the type. */
function museumLayout(w: number, h: number) {
  const margin = Math.round(Math.min(w, h) * 0.07);
  const typeBand = Math.round(h * 0.17);
  return { left: margin, top: margin, width: w - 2 * margin, height: h - 2 * margin - typeBand };
}

/**
 * Where a panel poster's type and art go: the kicker and title above the panel, the caption below. The type sizes are
 * cap heights in cm, as in textSvg; a line too wide for the margins only gets smaller, so the layout stays put.
 */
function panelLayout(text: Extract<PosterText, { kind: 'panel' }>, w: number, h: number) {
  const cm = h / heightCm(w, h);
  const margin = Math.round(Math.min(w, h) * 0.07);
  const [kickerSize, titleSize, captionSize] = [2.4 * cm, 7 * cm, 1.9 * cm];
  const kickerBase = margin + kickerSize * 0.85;
  const titleBase = (text.kicker ? kickerBase + kickerSize * 0.45 : margin) + titleSize * 0.74;
  const panelTop = Math.round(titleBase + titleSize * 0.2);
  const captionBase = h - margin - (text.caption.length - 1) * captionSize * 1.3;
  const panelBottom = Math.round(captionBase - captionSize * 1.2);
  return {
    kickerSize, titleSize, captionSize, kickerBase, titleBase, captionBase,
    panel: { left: margin, top: panelTop, width: w - 2 * margin, height: panelBottom - panelTop },
  };
}

/** The margin around art that is fitted whole ('contain'). */
const MAT = '#f1ebde';

/** A raster copy of art that comes as SVG, 2800 px on its long side; other art as it is. */
async function rasterized(art: Buffer): Promise<Buffer> {
  const { format, width = 0, height = 0 } = await sharp(art).metadata();
  if (format !== 'svg') return art;
  return sharp(art, { density: (72 * 2800) / Math.max(width, height) }).flatten({ background: '#ffffff' }).png().toBuffer();
}

/** The poster at its print's pixel size, as sRGB PNG: its art cropped to fit, and its text set over it. */
export async function composePoster(original: Buffer, spec: PosterSpec): Promise<Buffer> {
  const [w, h] = printPixels(spec);
  const art = await rasterized(original);
  let image = sharp(art).rotate().toColourspace('srgb');
  const { crop } = spec.source as PublicDomainSource;
  if (crop) {
    const { width = 0, height = 0 } = await sharp(art).metadata();
    image = image.extract({
      left: Math.round(crop.left * width), top: Math.round(crop.top * height),
      width: Math.round(crop.width * width), height: Math.round(crop.height * height),
    });
  }
  const text = spec.text;
  let canvas: Sharp;
  if (text?.kind === 'museum') {
    // The whole work, never cropped, centered in its area of the paper.
    const area = museumLayout(w, h);
    const fitted = await sharp(await image.png().toBuffer())
      .resize(area.width, area.height, { fit: 'inside', kernel: 'lanczos3' }).png().toBuffer({ resolveWithObject: true });
    canvas = sharp({ create: { width: w, height: h, channels: 3, background: text.paper } }).composite([{
      input: fitted.data,
      left: area.left + Math.round((area.width - fitted.info.width) / 2),
      top: area.top + Math.round((area.height - fitted.info.height) / 2),
    }]);
  } else if (text?.kind === 'panel') {
    // The art fills its panel, cropped to the panel's shape.
    const { panel } = panelLayout(text, w, h);
    const fitted = await image.resize(panel.width, panel.height, { fit: 'cover', kernel: 'lanczos3' }).png().toBuffer();
    canvas = sharp({ create: { width: w, height: h, channels: 3, background: text.paper } })
      .composite([{ input: fitted, left: panel.left, top: panel.top }]);
  } else if (spec.fit === 'contain') {
    canvas = sharp(await image.resize(w, h, { fit: 'contain', background: MAT, kernel: 'lanczos3' }).png().toBuffer());
  } else {
    canvas = sharp(await image.resize(w, h, { fit: 'cover', kernel: 'lanczos3' }).png().toBuffer());
  }
  const base = await canvas.png().toBuffer();
  if (!text) return base;
  return sharp(base).composite([{ input: Buffer.from(await textSvg(text, w, h)) }]).removeAlpha().png().toBuffer();
}

/* ───────────── The model ───────────── */

/** Triangles for one glTF primitive. */
interface Mesh { positions: number[]; normals: number[]; uvs: number[]; indices: number[] }

const emptyMesh = (): Mesh => ({ positions: [], normals: [], uvs: [], indices: [] });

/**
 * Adds a box from `min` to `max` to `mesh`: all six faces, or only `faces` (by outward normal, such as '+z'). Its UVs
 * run along `grain` (0 = x, 1 = y), `tile` m per repeat, so a wood texture follows the moulding.
 */
export function addBox(mesh: Mesh, min: Vec3, max: Vec3, { grain = 0, tile = 0.5, faces }: { grain?: 0 | 1; tile?: number; faces?: string[] } = {}) {
  const corners = (axis: number, sign: 1 | -1): Vec3[] => {
    const [u, v] = [0, 1, 2].filter((a) => a !== axis);
    const at = sign > 0 ? max[axis] : min[axis];
    const quad: [number, number][] = [[min[u], min[v]], [max[u], min[v]], [max[u], max[v]], [min[u], max[v]]];
    return quad.map(([a, b]) => {
      const p: Vec3 = [0, 0, 0];
      p[axis] = at; p[u] = a; p[v] = b;
      return p;
    });
  };
  for (const axis of [0, 1, 2]) {
    for (const sign of [1, -1] as const) {
      if (faces && !faces.includes(`${sign > 0 ? '+' : '-'}${'xyz'[axis]}`)) continue;
      const quad = corners(axis, sign);
      const start = mesh.positions.length / 3;
      const normal: Vec3 = [0, 0, 0];
      normal[axis] = sign;
      for (const p of quad) {
        mesh.positions.push(...p);
        mesh.normals.push(...normal);
        const along = grain === 0 ? (axis === 0 ? p[2] : p[0]) : (axis === 1 ? p[2] : p[1]);
        const across = grain === 0 ? (axis === 1 ? p[2] : p[1]) : (axis === 0 ? p[2] : p[0]);
        mesh.uvs.push(along / tile, across / tile);
      }
      // Counter-clockwise seen from outside: the quad's winding flips with the face's side and axis.
      const ccw = (sign > 0) !== (axis === 1);
      mesh.indices.push(...(ccw ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2]).map((i) => start + i));
    }
  }
}

/** The print's face: a quad at depth z, `w` × `h` with its bottom at y0, the image upright on it. */
function printFace(w: number, h: number, y0: number, z: number): Mesh {
  const [x0, x1, y1] = [-w / 2, w / 2, y0 + h];
  return {
    positions: [x0, y0, z, x1, y0, z, x1, y1, z, x0, y1, z],
    normals: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
    uvs: [0, 1, 1, 1, 1, 0, 0, 0],   // glTF UVs start at the image's top-left
    indices: [0, 1, 2, 0, 2, 3],
  };
}

const FRAME_COLORS: Record<Exclude<Frame, 'none'>, [number, number, number, number]> = {
  black: [0.018, 0.018, 0.018, 1],   // linear RGB
  white: [0.86, 0.84, 0.8, 1],
  oak: [1, 1, 1, 1],                 // its wood texture
};

/** An oak grain texture, from SVG noise stretched along u. */
async function oakTexture(): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">
    <filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="0.0025 0.09" numOctaves="4" seed="7"/>
      <feColorMatrix type="matrix" values="0 0 0 0.55 0.45  0 0 0 0.45 0.31  0 0 0 0.3 0.17  0 0 0 0 1"/></filter>
    <rect width="512" height="512" filter="url(#grain)"/></svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 85 }).toBuffer();
}

/**
 * The poster as a glTF document: its bottom-center at the origin and its print facing +Z, matte. Unframed, a 3 mm
 * paper slab; framed, the print set 6 mm back in a 2 cm moulding with a backing board.
 */
export async function posterDocument(spec: PosterSpec, image: Buffer): Promise<Document> {
  const document = new Document();
  document.createExtension(EXTTextureWebP).setRequired(true);
  const buffer = document.createBuffer();
  const scene = document.createScene(spec.id);
  const root = document.createNode(spec.id);
  scene.addChild(root);
  const mesh = document.createMesh(spec.id);
  root.setMesh(mesh);
  const accessor = (type: 'VEC3' | 'VEC2' | 'SCALAR', array: TypedArray) =>
    document.createAccessor().setType(type).setArray(array).setBuffer(buffer);
  const add = (name: string, { positions, normals, uvs, indices }: Mesh, material: ReturnType<Document['createMaterial']>) =>
    mesh.addPrimitive(document.createPrimitive()
      .setName(name)
      .setAttribute('POSITION', accessor('VEC3', new Float32Array(positions)))
      .setAttribute('NORMAL', accessor('VEC3', new Float32Array(normals)))
      .setAttribute('TEXCOORD_0', accessor('VEC2', new Float32Array(uvs)))
      .setIndices(accessor('SCALAR', new Uint16Array(indices)))
      .setMaterial(material));
  const matte = (name: string) => document.createMaterial(name).setMetallicFactor(0).setRoughnessFactor(1);

  const [w, h] = printMeters(spec);
  const [W, H, D] = posterSize(spec);
  const print = document.createTexture('print').setImage(image).setMimeType('image/webp');
  const printMaterial = matte('print').setBaseColorTexture(print);
  if (spec.frame === 'none') {
    add('print', printFace(w, h, 0, D / 2), printMaterial);
    const paper = emptyMesh();
    addBox(paper, [-w / 2, 0, -D / 2], [w / 2, h, D / 2], { faces: ['+x', '-x', '+y', '-y', '-z'] });
    add('paper', paper, matte('paper').setBaseColorFactor([0.9, 0.89, 0.86, 1]));
  } else {
    const f = FRAME_WIDTH;
    const moulding = emptyMesh();
    addBox(moulding, [-W / 2, 0, -D / 2], [-w / 2, H, D / 2], { grain: 1 });
    addBox(moulding, [w / 2, 0, -D / 2], [W / 2, H, D / 2], { grain: 1 });
    addBox(moulding, [-w / 2, 0, -D / 2], [w / 2, f, D / 2]);
    addBox(moulding, [-w / 2, H - f, -D / 2], [w / 2, H, D / 2]);
    const frame = document.createMaterial(`frame-${spec.frame}`)
      .setBaseColorFactor(FRAME_COLORS[spec.frame]).setMetallicFactor(0).setRoughnessFactor(spec.frame === 'oak' ? 0.85 : 0.7);
    if (spec.frame === 'oak') frame.setBaseColorTexture(document.createTexture('oak').setImage(await oakTexture()).setMimeType('image/jpeg'));
    add('frame', moulding, frame);
    add('print', printFace(w, h, f, D / 2 - 0.006), printMaterial);
    const backing = emptyMesh();
    addBox(backing, [-w / 2, f, -D / 2], [w / 2, H - f, -D / 2 + 0.004], { faces: ['-z', '+z'] });
    add('backing', backing, matte('backing').setBaseColorFactor([0.35, 0.27, 0.19, 1]));
  }
  return document;
}

/* ───────────── Files ───────────── */

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SPECS = join(ROOT, 'scripts/posters.json');
const CACHE = join(ROOT, 'scripts/.cache/posters');
const OUT = join(ROOT, 'data/catalog/posters');
const CATALOG = join(ROOT, 'data/catalog/posters.json');
const MAX_GLB_BYTES = 2_000_000;     // §2.3: each Piece ≤ 2 MB

// FLUX 3 Image, fal's newest FLUX (docs/research/poster-sources.md §5): https://fal.ai/models/blackforestlabs/flux-3/text-to-image
const FLUX = 'blackforestlabs/flux-3/text-to-image';
const NO_TEXT = 'No text, no letters, no words, no numbers, no logos, no signatures, no watermark, no people, no characters.';

/** A file's bytes. The Library of Congress sometimes ends a JPEG early with a 200, so a cut-off JPEG is tried again. */
async function download(url: string): Promise<Buffer> {
  for (let attempt = 1; ; attempt++) {
    // The Art Institute of Chicago turns away Node's default User-Agent, and one with an address in it.
    const res = await fetch(url, { headers: { 'User-Agent': 'mise-posters-build/1.0' } });
    if (!res.ok) throw new Error(`GET ${url}: ${res.status} ${res.statusText}`);
    const data = Buffer.from(await res.arrayBuffer());
    const isJpeg = data[0] === 0xff && data[1] === 0xd8;
    if (!isJpeg || (data.at(-2) === 0xff && data.at(-1) === 0xd9)) return data;
    if (attempt === 3) throw new Error(`GET ${url}: the JPEG was cut off three times`);
  }
}

/** The aspect ratio to ask FLUX 3 for. It has no 11:17, so those come at 2:3 and lose 3% of their width to the crop. */
function aspectRatio({ size, landscape }: PosterSpec): string {
  const ratio = size === '18x24' ? '3:4' : '2:3';
  return landscape ? ratio.split(':').reverse().join(':') : ratio;
}

/** A poster's art: from the cache, or downloaded or generated into it. */
async function art(spec: PosterSpec): Promise<Buffer> {
  const file = join(CACHE, `${spec.id}.${spec.source.kind === 'generated' ? 'png' : 'img'}`);
  if (existsSync(file)) return readFile(file);
  let data: Buffer;
  if (spec.source.kind === 'publicdomain') {
    data = await download(spec.source.image);
  } else {
    if (!process.env.FAL_KEY) throw new Error('generating its art needs FAL_KEY in .env');
    // The client's endpoint types predate FLUX 3, so its output is typed here.
    const { data: output } = await fal.subscribe<string>(FLUX, {
      input: { prompt: `${spec.source.prompt} ${NO_TEXT}`, resolution: '2k', aspect_ratio: aspectRatio(spec), output_format: 'png' },
    });
    data = await download((output as { images: { url: string }[] }).images[0].url);
  }
  await mkdir(CACHE, { recursive: true });
  await writeFile(`${file}.part`, data);
  await rename(`${file}.part`, file);
  return data;
}

/** A 256 px thumbnail: the poster, framed when it is, on the Catalog's light card. */
async function thumbnail(spec: PosterSpec, poster: Buffer): Promise<Buffer> {
  const [W, H] = posterSize(spec);
  const scale = 224 / Math.max(W, H);
  const [outerW, outerH] = [Math.round(W * scale), Math.round(H * scale)];
  const border = spec.frame === 'none' ? 0 : Math.max(3, Math.round(FRAME_WIDTH * scale));
  const print = await sharp(poster).resize(outerW - 2 * border, outerH - 2 * border).png().toBuffer();
  const frameColor = { none: '#ffffff', black: '#1c1c1c', white: '#f1eee8', oak: '#b88a57' }[spec.frame];
  const framed = await sharp({ create: { width: outerW, height: outerH, channels: 3, background: frameColor } })
    .composite([{ input: print, left: border, top: border }]).png().toBuffer();
  return sharp({ create: { width: 256, height: 256, channels: 3, background: '#f4f1ea' } })
    .composite([{ input: framed, left: Math.round((256 - outerW) / 2), top: Math.round((256 - outerH) / 2) }])
    .jpeg({ quality: 86 }).toBuffer();
}

/** Builds one poster's GLB and thumbnail and returns its Catalog entry. */
async function buildPoster(spec: PosterSpec, io: NodeIO): Promise<{ item: CatalogItem; bytes: number; poster: Buffer }> {
  const poster = await composePoster(await art(spec), spec);
  const { data: rgb } = await sharp(poster).resize(96, 96, { fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const paper = spec.text && 'paper' in spec.text ? spec.text.paper : undefined;   // museum and panel posters
  const item = toCatalogItem(spec, posterColors(paper ? withoutColor(rgb, paper) : rgb));
  const webp = await sharp(poster).webp({ quality: 84 }).toBuffer();
  const glb = await io.writeBinary(await posterDocument(spec, webp));
  if (glb.byteLength > MAX_GLB_BYTES) throw new Error(`${(glb.byteLength / 1e6).toFixed(2)} MB is over the 2 MB budget`);
  await writeFile(join(OUT, `${spec.id}.glb`), glb);
  await writeFile(join(OUT, `${spec.id}.jpg`), await thumbnail(spec, poster));
  return { item, bytes: glb.byteLength, poster };
}

/**
 * CREDITS.md: where each real poster comes from and why it may be used (public domain, CC0, or the NASA/JPL posters'
 * image use policy), and which are generated.
 */
export function credits(specs: PosterSpec[]): string {
  const sourced = specs.filter((spec) => spec.source.kind === 'publicdomain');
  const generated = specs.filter((spec) => spec.source.kind === 'generated');
  const lines = [
    '# Poster credits',
    '',
    'Written by `scripts/posters-build.ts` from `scripts/posters.json`. Every poster is a real work that is free to use',
    '(public domain, a US government work, CC0, or a NASA/JPL poster under JPL\'s Image Use Policy), or an original',
    'generated for Mise where no free real poster exists. Type that the build adds was set by the script, not an image model.',
    '',
    '## Real posters',
    '',
    ...sourced.flatMap((spec) => {
      const source = spec.source as PublicDomainSource;
      return [
        `### ${spec.title} (\`${spec.id}\`)`,
        '',
        `- **Work:** ${source.work}`,
        `- **Source:** ${source.institution}, ${source.page}`,
        `- **Image:** ${source.image}`,
        `- **Why we may use it:** ${source.why}`,
        ...(source.attribution ? [`- **Credit:** ${source.attribution}`] : []),
        '',
      ];
    }),
    '## Generated',
    '',
    'Generated with FLUX 3 Image on fal from the prompts in `scripts/posters.json`. They show no real characters, logos,',
    'brands, bands, movies, or people; their band, venue, game, and place names are made up.',
    '',
    ...generated.map((spec) => `- ${spec.title} (\`${spec.id}\`)`),
    '',
  ];
  return lines.join('\n');
}

/** A contact sheet of every poster, by collection, for the PR. */
async function contactSheet(specs: PosterSpec[], posters: Map<string, Buffer>): Promise<Buffer> {
  const cell = 300;
  const gap = 28;
  const label = 64;
  const rows = COLLECTIONS.map((collection) => specs.filter((spec) => spec.collection === collection && posters.has(spec.id)));
  const columns = Math.max(...rows.map((row) => row.length));
  const head = 56;
  const width = gap + columns * (cell + gap) + 220;
  const height = rows.length * (cell + label + head);
  const layers: OverlayOptions[] = [];
  const svg: string[] = [];
  for (const [r, row] of rows.entries()) {
    const top = r * (cell + label + head);
    svg.push(`<text x="${gap}" y="${top + 40}" font-family="Futura" font-weight="700" font-size="28" fill="#27231f">${escapeXml(COLLECTIONS[r].toUpperCase())}</text>`);
    for (const [c, spec] of row.entries()) {
      const [W, H] = posterSize(spec);
      const scale = cell / Math.max(W, H);
      const [ow, oh] = [Math.round(W * scale), Math.round(H * scale)];
      const border = spec.frame === 'none' ? 0 : Math.max(4, Math.round(FRAME_WIDTH * scale));
      const frameColor = { none: '#ffffff', black: '#1c1c1c', white: '#e9e5dc', oak: '#b88a57' }[spec.frame];
      const print = await sharp(posters.get(spec.id)!).resize(ow - 2 * border, oh - 2 * border).png().toBuffer();
      const tile = await sharp({ create: { width: ow, height: oh, channels: 3, background: frameColor } })
        .composite([{ input: print, left: border, top: border }]).png().toBuffer();
      const left = gap + c * (cell + gap);
      layers.push({ input: tile, left: left + Math.round((cell - ow) / 2), top: top + head + (cell - oh) });
      const caption = `${spec.size.replace('x', '×')}${spec.landscape ? ' L' : ''}${spec.frame === 'none' ? '' : ` · ${spec.frame} frame`}`;
      svg.push(`<text x="${left + cell / 2}" y="${top + head + cell + 22}" text-anchor="middle" font-family="Avenir Next" font-weight="600" font-size="15" fill="#27231f">${escapeXml(spec.title)}</text>`);
      svg.push(`<text x="${left + cell / 2}" y="${top + head + cell + 42}" text-anchor="middle" font-family="Avenir Next" font-size="13" fill="#5b5349">${escapeXml(caption)}</text>`);
    }
  }
  layers.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${svg.join('')}</svg>`), left: 0, top: 0 });
  return sharp({ create: { width, height, channels: 3, background: '#f4f1ea' } }).composite(layers).jpeg({ quality: 82 }).toBuffer();
}

/** An error's message or, for fal's errors, which can have an empty one, their status and body. */
function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const { status, body } = error as Error & { status?: number; body?: unknown };
  return [error.message, status && `fal ${status}`, body !== undefined && JSON.stringify(body)].filter(Boolean).join(' ');
}

/** Builds every poster (or only some), skipping and logging the ones that fail, then writes posters.json and the rest. */
async function build(only?: string[]) {
  const specs: PosterSpec[] = JSON.parse(await readFile(SPECS, 'utf8'));
  const previous: Catalog = existsSync(CATALOG) ? JSON.parse(await readFile(CATALOG, 'utf8')) : { version: 1, items: [] };
  await mkdir(OUT, { recursive: true });
  const io = new NodeIO().registerExtensions([EXTTextureWebP]);

  // Four at a time: fal generates in parallel, and sharp keeps a core busy per poster. Items keep posters.json's order.
  const built: (CatalogItem | undefined)[] = [];
  const posters = new Map<string, Buffer>();
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
        const { item, bytes, poster } = await buildPoster(spec, io);
        built[i] = item;
        posters.set(spec.id, poster);
        console.log(`✓ ${spec.id.padEnd(30)} ${item.size.join(' × ')} m  ${(bytes / 1e6).toFixed(2)} MB  ${item.colors.join(', ')}`);
      } catch (error) {
        built[i] = kept;
        console.error(`✗ ${spec.id} skipped: ${describeError(error)}${kept ? '; kept its previous build' : ''}`);
      }
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  const items = built.filter((item) => item !== undefined);
  await writeFile(CATALOG, `${JSON.stringify({ version: 1, items } satisfies Catalog, null, 2)}\n`);
  await writeFile(join(OUT, 'CREDITS.md'), credits(specs.filter((spec) => items.some((item) => item.id === spec.id))));

  // The contact sheet shows every poster, so it needs the ones this run didn't build too: compose them from their art.
  for (const spec of specs) {
    if (!posters.has(spec.id) && items.some((item) => item.id === spec.id)) {
      posters.set(spec.id, await composePoster(await art(spec), spec).catch(() => Buffer.alloc(0)));
    }
  }
  for (const [id, poster] of posters) if (poster.length === 0) posters.delete(id);
  await writeFile(join(OUT, 'contact-sheet.jpg'), await contactSheet(specs, posters));

  // Remove the files of posters that left the list. The rest of the folder, such as the PR's screenshots, stays.
  const used = new Set(items.flatMap((item) => [item.model, item.thumbnail]));
  for (const name of await readdir(OUT)) {
    if (/^poster-.*\.(glb|jpg)$/.test(name) && !used.has(`/data/catalog/posters/${name}`)) await rm(join(OUT, name));
  }
  console.log(`Wrote ${items.length} of ${specs.length} posters to data/catalog/posters.json.`);
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
