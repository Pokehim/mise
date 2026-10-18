import { describe, expect, it } from 'vitest';
import { buildPatchImage, type PatchImageInput } from './bakePatches';

const SIZE = 32;
const [FLOOR, SHADOW, COPY] = [[150, 110, 70], [60, 40, 20], [240, 10, 10]] as const;

/** RGBA of SIZE × SIZE where `paint(x, y)` gives the color, or null for nothing seen. */
function view(paint: (x: number, y: number) => readonly number[] | null) {
  const data = new Uint8ClampedArray(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const color = paint(x, y);
      if (color) data.set([...color, 255], (y * SIZE + x) * 4);
    }
  }
  return data;
}

/** The region is the square 12 ≤ x, y < 20 (the Original’s box grown by 10 cm). */
const inSquare = (x: number, y: number) => x >= 12 && x < 20 && y >= 12 && y < 20;
const input = (over: Partial<PatchImageInput>): PatchImageInput => ({
  width: SIZE, height: SIZE, base: view(() => FLOOR), inRegion: inSquare, featherPx: 4, ...over,
});
const pixel = (data: Uint8ClampedArray, x: number, y: number) => [...data.subarray((y * SIZE + x) * 4, (y * SIZE + x) * 4 + 4)];

describe('buildPatchImage', () => {
  it('with no Fill Capture, covers the whole region, and drops the contact shadow with it', () => {
    // The floor is plain, except for a dark ring of contact shadow just inside the region’s edge.
    const base = view((x, y) => (inSquare(x, y) ? (x < 14 ? SHADOW : null) : FLOOR));

    const built = buildPatchImage(input({ base }))!;

    expect(built.unseen).toBe(8 * 8);
    expect(pixel(built.image.data, 12, 15)).toEqual([...FLOOR, 255]);   // where the shadow was
    expect(pixel(built.image.data, 16, 16)).toEqual([...FLOOR, 255]);   // where nothing was seen
  });

  it('leaves what the Fill Capture saw to it, and fills only the rest', () => {
    // The captured Patch holds the left half of the region.
    const captured = view((x, y) => (inSquare(x, y) && x < 16 ? COPY : null));

    const built = buildPatchImage(input({ captured }))!;

    expect(built.unseen).toBe(4 * 8);
    expect(pixel(built.image.data, 13, 15).slice(0, 3)).toEqual([...COPY]);   // captured: its own color, so no seam under the Patch
    expect(pixel(built.image.data, 13, 15)[3]).toBeLessThan(255);
    expect(pixel(built.image.data, 18, 15)[3]).toBe(255);                     // unseen: solid
    // The fill takes both the captured Patch’s red and the floor outside, not the shadow it replaced.
    const [r, g] = pixel(built.image.data, 18, 15);
    expect(r).toBeGreaterThan(FLOOR[0]);
    expect(g).toBeLessThan(255);
  });

  it('is null when the Fill Capture covered the whole region', () => {
    const captured = view((x, y) => (inSquare(x, y) ? COPY : null));

    expect(buildPatchImage(input({ captured }))).toBeNull();
  });

  it('fades the fill out past the region, over featherPx, and not at all beyond that', () => {
    const built = buildPatchImage(input({}))!;

    expect(pixel(built.image.data, 12, 15)[3]).toBe(255);                       // in the region
    expect(pixel(built.image.data, 11, 15)[3]).toBeGreaterThan(0);              // 1 px out
    expect(pixel(built.image.data, 11, 15)[3]).toBeLessThan(255);
    expect(pixel(built.image.data, 12 - 4, 15)[3]).toBe(0);                     // featherPx out
    expect(pixel(built.image.data, 2, 2)[3]).toBe(0);
  });

  it('never covers pixels it is told to keep clear, such as an Opening, and never fills from them', () => {
    // A blue "window" sits in the region’s left edge, and is cut out of the base too.
    const window = (x: number, y: number) => x >= 10 && x < 16 && y >= 12 && y < 20;
    const base = view((x, y) => (inSquare(x, y) ? null : window(x, y) ? [0, 0, 255] : FLOOR));

    const built = buildPatchImage(input({ base, keepClear: window }))!;

    expect(pixel(built.image.data, 11, 15)[3]).toBe(0);
    expect(pixel(built.image.data, 14, 15)[3]).toBe(0);
    expect(built.unseen).toBe(8 * 8 - 4 * 8);
    // The blue never spreads into the fill.
    const [r, , b] = pixel(built.image.data, 18, 15);
    expect(b).toBeLessThan(r);
  });

  it('fills with the fallback color when not a pixel was seen, and is null without one', () => {
    const nothing = view(() => null);

    const built = buildPatchImage(input({ base: nothing, fallback: [10, 20, 30] }))!;

    expect(pixel(built.image.data, 16, 16)).toEqual([10, 20, 30, 255]);
    expect(buildPatchImage(input({ base: nothing }))).toBeNull();
  });
});
