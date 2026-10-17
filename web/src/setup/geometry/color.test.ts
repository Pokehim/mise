import { describe, expect, it } from 'vitest';
import type { Box, Vec2 } from '@shared/types';
import { type FloorImage, luminanceAt, ringColor } from './color';

/** A width × height RGBA image whose pixels come from `color(column, row)`. */
function image(width: number, height: number, color: (column: number, row: number) => number[]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) data.set(color(column, row), (row * width + column) * 4);
  }
  return { width, height, data };
}

describe('luminanceAt', () => {
  it('gives the linear-light luminance of the texel, as three.js computes it after decoding sRGB', () => {
    const texels = [[255, 255, 255, 255], [0, 0, 0, 255], [128, 128, 128, 255], [0, 255, 0, 255]];
    const strip = image(4, 1, (column) => texels[column]);
    expect(luminanceAt(strip, 0.1, 0.5)).toBeCloseTo(1);
    expect(luminanceAt(strip, 0.3, 0.5)).toBeCloseTo(0);
    expect(luminanceAt(strip, 0.6, 0.5)).toBeCloseTo(0.2159, 4);
    expect(luminanceAt(strip, 0.9, 0.5)).toBeCloseTo(0.7152, 4);
  });

  it('reads glTF UVs: (0, 0) is the top-left texel, and UVs outside 0–1 repeat', () => {
    const quarters = image(2, 2, (column, row) => (column === 0 && row === 0 ? [255, 255, 255, 255] : [0, 0, 0, 255]));
    expect(luminanceAt(quarters, 0.25, 0.25)).toBeCloseTo(1);
    expect(luminanceAt(quarters, 0.25, 0.75)).toBeCloseTo(0);
    expect(luminanceAt(quarters, 1.25, -0.75)).toBeCloseTo(1);
  });
});

describe('ringColor', () => {
  // A 2 × 2 m top-down image of the floor around the origin, 1 cm per pixel, North (−Z) at row 0.
  const pointAt = (column: number, row: number): Vec2 => [-1 + (column + 0.5) / 100, -1 + (row + 0.5) / 100];
  const RED = [255, 0, 0, 255];
  const GREEN = [0, 255, 0, 255];
  const BLUE = [0, 0, 255, 255];
  const floor = (color: (x: number, z: number) => number[]): FloorImage =>
    ({ ...image(200, 200, (column, row) => color(...pointAt(column, row))), pointAt });
  const nightstand: Box = { position: [0, 0, 0], size: [0.5, 0.6, 0.4], rotationY: 0 };

  it('averages the floor in a 15 cm ring around the footprint', () => {
    const inRing = (x: number, z: number) => Math.abs(x) <= 0.4 && Math.abs(z) <= 0.35;
    const underIt = (x: number, z: number) => Math.abs(x) < 0.25 && Math.abs(z) < 0.2;
    const colored = floor((x, z) => (underIt(x, z) ? BLUE : inRing(x, z) ? RED : GREEN));
    expect(ringColor(colored, nightstand)).toBe('#ff0000');
  });

  it("follows the box's rotation", () => {
    const turned: Box = { ...nightstand, rotationY: Math.PI / 2 };   // 0.4 m along X, 0.5 m along Z
    const colored = floor((x, z) => (Math.abs(x) <= 0.35 && Math.abs(z) <= 0.4 ? RED : GREEN));
    expect(ringColor(colored, turned)).toBe('#ff0000');
  });

  it('skips pixels with no floor, and reads linear-light pixels (as a render target holds them) into sRGB hex', () => {
    const halfSeen = floor((x) => (x < 0 ? [128, 128, 128, 255] : [0, 0, 0, 0]));
    expect(ringColor(halfSeen, nightstand)).toBe('#bcbcbc');
  });

  it('is null when no floor was seen around the footprint', () => {
    expect(ringColor(floor(() => [0, 0, 0, 0]), nightstand)).toBeNull();
  });
});
