// Colors read from images: a texture's luminance (for avgLuminance, spec §9.4) and the floor's
// color around an Original (floorColor, Room Setup step 6).
import type { Box, Hex, Vec2 } from '@shared/types';

/** RGBA pixels, 4 bytes each, row by row from the top. */
export interface Pixels { width: number; height: number; data: ArrayLike<number> }

/** A top-down image of the floor. */
export interface FloorImage extends Pixels {
  /** The floor point (x, z) at the center of a pixel. */
  pointAt(column: number, row: number): Vec2;
}

/**
 * The luminance of an sRGB texture at a glTF UV ((0, 0) is the top-left; UVs repeat), in linear
 * light: the same value three.js's `luminance()` gives for the texel once it is decoded.
 */
export function luminanceAt(image: Pixels, u: number, v: number): number {
  const column = Math.min(image.width - 1, Math.floor(fraction(u) * image.width));
  const row = Math.min(image.height - 1, Math.floor(fraction(v) * image.height));
  const i = (row * image.width + column) * 4;
  return 0.2126 * SRGB_TO_LINEAR[image.data[i]] + 0.7152 * SRGB_TO_LINEAR[image.data[i + 1]] + 0.0722 * SRGB_TO_LINEAR[image.data[i + 2]];
}

/**
 * The average color of the floor within `ring` meters around a box's footprint, as sRGB hex, or
 * null when none of it was seen. The image holds linear light, as read back from a render target;
 * pixels with alpha 0 are where the scan has no floor.
 */
export function ringColor(image: FloorImage, box: Box, ring = 0.15): Hex | null {
  const [px, , pz] = box.position;
  const halfW = box.size[0] / 2;
  const halfD = box.size[2] / 2;
  const c = Math.cos(box.rotationY);
  const s = Math.sin(box.rotationY);
  const sum = [0, 0, 0];
  let count = 0;
  for (let row = 0; row < image.height; row++) {
    for (let column = 0; column < image.width; column++) {
      const i = (row * image.width + column) * 4;
      if (image.data[i + 3] === 0) continue;
      const [x, z] = image.pointAt(column, row);
      // Into the box's frame: rotate by −rotationY.
      const lx = c * (x - px) - s * (z - pz);
      const lz = s * (x - px) + c * (z - pz);
      const dx = Math.max(Math.abs(lx) - halfW, 0);
      const dz = Math.max(Math.abs(lz) - halfD, 0);
      const outside = Math.hypot(dx, dz);
      if (outside === 0 || outside > ring) continue;
      for (let k = 0; k < 3; k++) sum[k] += image.data[i + k] / 255;
      count++;
    }
  }
  if (count === 0) return null;
  return `#${sum.map((v) => Math.round(linearToSrgb(v / count) * 255).toString(16).padStart(2, '0')).join('')}`;
}

const fraction = (v: number) => v - Math.floor(v);

const srgbToLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const linearToSrgb = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
const SRGB_TO_LINEAR = Float32Array.from({ length: 256 }, (_, i) => srgbToLinear(i / 255));
