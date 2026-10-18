// The surface detail of a room with no Capture (ADR-0010): painted drywall, painted cinderblock and
// acoustic ceiling tile, made in code so they tile seamlessly and need no files. Each is nearly
// white: the wall's paint color tints it, and its light comes from the room's light map, so it
// carries only the small light and shade of the surface itself, as if lit from above.
import { DataTexture, LinearMipmapLinearFilter, RepeatWrapping, SRGBColorSpace, type Texture } from 'three';
import type { RoomSurfaces } from '@shared/types';
import { mulberry32 } from '../materials/luminance';

/** A floor that is part of the building rather than a Material Library material: vinyl composition tile. */
export const BUILT_FLOORS = ['vct'] as const;
export type SurfaceKind = RoomSurfaces['walls'] | RoomSurfaces['ceiling'] | (typeof BUILT_FLOORS)[number];

export interface SurfaceTexture {
  texture: Texture;
  /** The meters one repeat of the texture covers, across and up. */
  meters: number;
  /** The texture's average luminance, in linear light, for recolor's relLum. */
  mean: number;
}

/** Value noise in 0–1 that tiles: `cells` lattice cells across a square of `size` pixels. */
function tileNoise(size: number, cells: number, seed: number): Float32Array {
  const random = mulberry32(seed);
  const lattice = Float32Array.from({ length: cells * cells }, () => random());
  const out = new Float32Array(size * size);
  const smooth = (t: number) => t * t * (3 - 2 * t);
  for (let y = 0; y < size; y++) {
    const gy = (y / size) * cells;
    const y0 = Math.floor(gy);
    const fy = smooth(gy - y0);
    for (let x = 0; x < size; x++) {
      const gx = (x / size) * cells;
      const x0 = Math.floor(gx);
      const fx = smooth(gx - x0);
      const [x1, y1] = [(x0 + 1) % cells, (y0 + 1) % cells];
      const top = lattice[y0 * cells + x0] * (1 - fx) + lattice[y0 * cells + x1] * fx;
      const bottom = lattice[y1 * cells + x0] * (1 - fx) + lattice[y1 * cells + x1] * fx;
      out[y * size + x] = top * (1 - fy) + bottom * fy;
    }
  }
  return out;
}

/** Several octaves of tileNoise, weighted, summed. */
function fractal(size: number, octaves: [cells: number, weight: number][], seed: number) {
  const out = new Float32Array(size * size);
  octaves.forEach(([cells, weight], i) => {
    const layer = tileNoise(size, cells, seed + i * 7919);
    for (let p = 0; p < out.length; p++) out[p] += layer[p] * weight;
  });
  return out;
}

/** Light from above on a height field: brighter where it faces up, darker where it faces down. */
function relief(height: Float32Array, size: number, strength: number) {
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    // The texture isn't flipped, so row 0 lands at the bottom (v = 0) and each next row is higher up.
    const below = ((y - 1 + size) % size) * size, above = ((y + 1) % size) * size;
    for (let x = 0; x < size; x++) {
      const left = (x - 1 + size) % size, right = (x + 1) % size;
      // A surface faces up where it drops away going up the wall.
      const facingUp = height[below + x] - height[above + x];
      const facingSide = height[y * size + right] - height[y * size + left];
      out[y * size + x] = strength * (facingUp * 0.8 + facingSide * 0.25);
    }
  }
  return out;
}

const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/** A gray texture from luminance values (linear light), with mipmaps, repeating. */
function grayTexture(values: Float32Array, size: number): { texture: DataTexture; mean: number } {
  const data = new Uint8Array(size * size * 4);
  let sum = 0;
  for (let p = 0; p < values.length; p++) {
    const linear = Math.min(1, Math.max(0, values[p]));
    // Store sRGB, as a color map is.
    const srgb = linear <= 0.0031308 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - 0.055;
    const byte = Math.round(srgb * 255);
    data.set([byte, byte, byte, 255], p * 4);
    sum += srgbToLinear(byte / 255);
  }
  const texture = new DataTexture(data, size, size);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.generateMipmaps = true;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return { texture, mean: sum / values.length };
}

/** A color texture from RGB values (linear light), with mipmaps, repeating. */
function colorTexture(rgb: Float32Array, size: number): { texture: DataTexture; mean: number } {
  const data = new Uint8Array(size * size * 4);
  let sum = 0;
  for (let p = 0; p < size * size; p++) {
    const bytes = [0, 1, 2].map((c) => {
      const linear = Math.min(1, Math.max(0, rgb[p * 3 + c]));
      return Math.round((linear <= 0.0031308 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - 0.055) * 255);
    });
    data.set([...bytes, 255], p * 4);
    const [r, g, b] = bytes.map((byte) => srgbToLinear(byte / 255));
    sum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  const texture = new DataTexture(data, size, size);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.generateMipmaps = true;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return { texture, mean: sum / (size * size) };
}

/**
 * Vinyl composition tile, the floor of many dorms: 12 × 12 in tiles laid in two tones of beige,
 * checkerboard, each with the chips of color pressed into it and a faint wax sheen, and fine dark
 * seams. Two tiles across: 0.6096 m square.
 */
function vct(): SurfaceTexture {
  const size = 512;
  const tile = size / 2;
  const chips = fractal(size, [[160, 0.6], [320, 0.4]], 131);
  const flecks = fractal(size, [[256, 1]], 137);
  const wax = fractal(size, [[6, 0.6], [14, 0.4]], 139);
  const tones = [[0.42, 0.38, 0.31], [0.36, 0.33, 0.27]];
  const rgb = new Float32Array(size * size * 3);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const p = y * size + x;
      const [tx, ty] = [Math.floor(x / tile), Math.floor(y / tile)];
      const seam = Math.min(x % tile, tile - (x % tile), y % tile, tile - (y % tile)) < 1;
      const base = tones[(tx + ty) % 2];
      const chip = (chips[p] - 0.5) * 0.12;
      const fleck = flecks[p] > 0.8 ? -0.1 : flecks[p] < 0.12 ? 0.08 : 0;
      const shade = 1 + chip + fleck + (wax[p] - 0.5) * 0.06;
      const color = seam ? [0.12, 0.11, 0.1] : base.map((c) => c * shade);
      rgb.set(color, p * 3);
    }
  }
  return { ...colorTexture(rgb, size), meters: 0.6096 };
}

/** Paint on drywall: a fine orange peel, a few millimeters across. 0.6 m square. */
function drywall(): SurfaceTexture {
  const size = 512;
  const peel = fractal(size, [[256, 0.5], [128, 0.35], [64, 0.15]], 11);
  const shade = relief(peel, size, 0.16);
  const values = new Float32Array(size * size);
  for (let p = 0; p < values.length; p++) values[p] = 0.88 + shade[p] + (peel[p] - 0.5) * 0.02;
  return { ...grayTexture(values, size), meters: 0.6 };
}

/**
 * Painted cinderblock: 16 × 8 in blocks (0.406 × 0.203 m with their joints) in running bond, with
 * concave mortar joints and the pitted face of the block under its paint. Two blocks across, four
 * courses up: 0.8128 m square.
 */
function cinderblock(): SurfaceTexture {
  const size = 1024;
  const [blockW, course] = [size / 2, size / 4];
  const joint = 6;   // half of the 3/8 in joint, in pixels
  const pits = fractal(size, [[260, 0.6], [110, 0.4]], 41);
  const grain = fractal(size, [[64, 0.5], [16, 0.5]], 53);
  const tone = mulberry32(67);
  const tones = Float32Array.from({ length: 2 * 4 }, () => (tone() - 0.5) * 0.04);
  const height = new Float32Array(size * size);
  const ao = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    const row = Math.floor(y / course);
    const shift = row % 2 ? blockW / 2 : 0;
    const dy = Math.min(y % course, course - (y % course));
    for (let x = 0; x < size; x++) {
      const xs = (x + shift) % size;
      const dx = Math.min(xs % blockW, blockW - (xs % blockW));
      const d = Math.min(dx, dy);
      // The block's face, its rounded arris, then the tooled joint curving back into the wall.
      const edge = Math.min(1, Math.max(0, (d - joint) / 5));
      const inJoint = d < joint ? Math.sqrt(1 - (d / joint) ** 2) : 0;
      const block = Math.floor(xs / blockW) + 2 * (row % 4);
      const p = y * size + x;
      height[p] = 0.6 + 0.4 * edge - 0.25 * inJoint;
      // Paint pools in the pits, and the joints sit back in shade.
      const pit = pits[p] < 0.3 ? (0.3 - pits[p]) * 0.5 : 0;
      ao[p] = 1 + tones[block % tones.length] - pit - (1 - edge) * 0.1 - inJoint * 0.06 + (grain[p] - 0.5) * 0.05;
    }
  }
  const shade = relief(height, size, 0.9);
  const values = new Float32Array(size * size);
  for (let p = 0; p < values.length; p++) values[p] = 0.84 * ao[p] + shade[p];
  return { ...grayTexture(values, size), meters: 0.8128 };
}

/** Acoustic ceiling tile: 2 × 2 ft tiles with fissures and pinholes, in a white T-bar grid. 0.6096 m square. */
function acousticTile(): SurfaceTexture {
  const size = 512;
  const bar = 10;   // half the T-bar's width, in pixels
  const fissures = fractal(size, [[24, 0.6], [56, 0.4]], 71);
  const speck = fractal(size, [[200, 1]], 83);
  const values = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.min(x, size - x, y, size - y);
      const p = y * size + x;
      if (d < bar) {
        values[p] = 0.92;
      } else if (d < bar + 3) {
        values[p] = 0.62;   // the shadow line where the tile meets the grid
      } else {
        const crack = Math.abs(fissures[p] - 0.5) < 0.012 ? 0.2 : 0;
        const hole = speck[p] < 0.22 ? 0.18 : 0;
        values[p] = 0.84 - crack - hole + (speck[p] - 0.5) * 0.04;
      }
    }
  }
  return { ...grayTexture(values, size), meters: 0.6096 };
}

const made = new Map<SurfaceKind, SurfaceTexture>();

/** The detail texture of a kind of wall or ceiling, made once and shared. */
export function surfaceTexture(kind: SurfaceKind): SurfaceTexture {
  let texture = made.get(kind);
  if (!texture) {
    texture = kind === 'cinderblock' ? cinderblock() : kind === 'acoustic-tile' ? acousticTile() : kind === 'vct' ? vct() : drywall();
    made.set(kind, texture);
  }
  return texture;
}

/* ───────────── The view out of a window ───────────── */

let view: Texture | undefined;

/** Where the horizon is in windowViewTexture, 0–1 up it: eye level. */
export const VIEW_HORIZON = 0.5;

/**
 * What a window looks out on, from a few floors up: an overcast sky with soft clouds, a brick campus
 * building and a line of trees, and a lawn with a path below. Slightly blurred, as if out of focus
 * from inside. Its horizon (eye level) is at VIEW_HORIZON.
 */
export function windowViewTexture(): Texture {
  if (view) return view;
  const [width, height] = [1024, 512];
  // Fractal noise, read between its pixels, so an edge drawn from it is smooth however far it's magnified.
  const noise = (octaves: [number, number][], seed: number) => {
    const field = fractal(512, octaves, seed);
    return (u: number, v: number) => {
      const [x, y] = [u * 512, Math.min(511, Math.max(0, v * 512))];
      const [x0, y0] = [Math.floor(x), Math.floor(y)];
      const [fx, fy] = [x - x0, y - y0];
      const at = (i: number, j: number) => field[Math.min(511, j) * 512 + (((i % 512) + 512) % 512)];
      return (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy;
    };
  };
  const clouds = noise([[5, 0.5], [11, 0.3], [23, 0.2]], 97);
  const canopy = noise([[24, 0.55], [60, 0.3], [140, 0.15]], 101);
  const leaves = noise([[180, 0.5], [90, 0.3], [40, 0.2]], 103);
  const grass = noise([[220, 0.6], [60, 0.4]], 107);
  const rgb = new Float32Array(width * height * 3);
  const mix = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i] - v) * t);
  for (let y = 0; y < height; y++) {
    const v = y / height;   // 0 at the bottom: the ground
    for (let x = 0; x < width; x++) {
      const u = x / width;
      let color: number[];
      // The tree line: its base just under eye level, its tops wandering above it.
      const treeBase = VIEW_HORIZON - 0.07;
      const treeTop = VIEW_HORIZON - 0.01 + canopy(u, 0.3) * 0.08;
      // A three-story brick building across the lawn, about 14 m wide (the view is 150 m × 75 m).
      const inBuilding = u > 0.43 && u < 0.52 && v > treeBase && v < VIEW_HORIZON + 0.07;
      if (inBuilding && v > treeTop - 0.03) {
        // Brick, with a window every 1.8 m and a floor every 3.5 m, and a pale cornice.
        const [wx, wy] = [((u - 0.43) * 83) % 1, ((v - treeBase) * 21) % 1];
        const pane = wx > 0.3 && wx < 0.7 && wy > 0.3 && wy < 0.75;
        color = v > VIEW_HORIZON + 0.06 ? [0.72, 0.7, 0.66] : pane ? [0.1, 0.13, 0.17] : [0.34, 0.14, 0.08];
      } else if (v < treeTop && v > treeBase) {
        const depth = (treeTop - v) / (treeTop - treeBase);
        color = mix([0.16, 0.25, 0.08], [0.04, 0.08, 0.03], Math.min(1, depth * 0.9 + (0.5 - leaves(u, v)) * 0.7));
      } else if (v <= treeBase) {
        // The lawn, with a path across it.
        const path = Math.abs(v - 0.3 - (u - 0.5) * 0.12) < 0.006 + (0.43 - v) * 0.04;
        color = path ? [0.45, 0.43, 0.4] : mix([0.09, 0.16, 0.04], [0.18, 0.27, 0.08], grass(u, v));
      } else {
        const t = Math.min(1, (v - VIEW_HORIZON) / 0.5);
        const sky = mix([0.78, 0.84, 0.9], [0.4, 0.56, 0.84], t);
        const cloud = Math.max(0, clouds(u, v) - 0.48) * 2.4;
        color = mix(sky, [0.97, 0.97, 0.98], Math.min(1, cloud));
      }
      rgb.set(color, (y * width + x) * 3);
    }
  }
  // Out of focus: a small box blur.
  const blurred = new Float32Array(rgb.length);
  const radius = 2;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sum = [0, 0, 0];
      let count = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const [sx, sy] = [(x + dx + width) % width, Math.min(height - 1, Math.max(0, y + dy))];
          for (let c = 0; c < 3; c++) sum[c] += rgb[(sy * width + sx) * 3 + c];
          count++;
        }
      }
      for (let c = 0; c < 3; c++) blurred[(y * width + x) * 3 + c] = sum[c] / count;
    }
  }
  const data = new Uint8Array(width * height * 4);
  for (let p = 0; p < width * height; p++) {
    for (let c = 0; c < 3; c++) {
      const linear = Math.min(1, blurred[p * 3 + c]);
      data[p * 4 + c] = Math.round((linear <= 0.0031308 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - 0.055) * 255);
    }
    data[p * 4 + 3] = 255;
  }
  const texture = new DataTexture(data, width, height);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.generateMipmaps = true;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.needsUpdate = true;
  view = texture;
  return texture;
}
