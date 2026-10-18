import { describe, expect, it } from 'vitest';
import { distanceTo, pushPull, type RgbaImage } from './pushPull';

type Rgb = [number, number, number];

/** An image and its known mask: `color(x, y)` for the known pixels, and where `hole(x, y)` is true, none. */
function image(width: number, height: number, color: (x: number, y: number) => Rgb, hole: (x: number, y: number) => boolean) {
  const data = new Uint8ClampedArray(width * height * 4);
  const known = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (hole(x, y)) continue;
      known[i] = 1;
      data.set([...color(x, y), 255], i * 4);
    }
  }
  return { image: { width, height, data } satisfies RgbaImage, known };
}

const rgbAt = ({ width, data }: RgbaImage, x: number, y: number) => [...data.subarray((y * width + x) * 4, (y * width + x) * 4 + 3)];

describe('pushPull', () => {
  it('fills a hole in a plain floor with that floor’s color', () => {
    const { image: img, known } = image(16, 16, () => [180, 140, 100], (x, y) => x >= 5 && x < 11 && y >= 5 && y < 11);

    const out = pushPull(img, known);

    for (const [x, y] of [[5, 5], [8, 8], [10, 10], [5, 10]]) expect(rgbAt({ ...img, data: out }, x, y)).toEqual([180, 140, 100]);
  });

  it('spreads a gradient across the hole, in order and between the two sides', () => {
    // Dark on the left, light on the right, and nothing known in the four columns between them.
    const { image: img, known } = image(12, 4, (x) => (x < 6 ? [40, 40, 40] : [200, 200, 200]), (x) => x >= 4 && x < 8);

    const out = pushPull(img, known);

    const row = [4, 5, 6, 7].map((x) => rgbAt({ ...img, data: out }, x, 1)[0]);
    expect(row).toEqual(row.toSorted((a, b) => a - b));
    expect(row[0]).toBeGreaterThanOrEqual(40);
    expect(row[3]).toBeLessThanOrEqual(200);
    expect(row[0]).toBeLessThan(row[3]);
  });

  it('keeps every known pixel and every alpha as they were', () => {
    const { image: img, known } = image(9, 9, (x, y) => [x * 20, y * 20, 7], (x, y) => x === 4 && y === 4);
    img.data[(4 * 9 + 4) * 4 + 3] = 77;

    const out = pushPull(img, known);

    for (let i = 0; i < 81; i++) {
      if (!known[i]) continue;
      expect([...out.subarray(i * 4, i * 4 + 4)]).toEqual([...img.data.subarray(i * 4, i * 4 + 4)]);
    }
    expect(out[(4 * 9 + 4) * 4 + 3]).toBe(77);
  });

  it('fills right up to the border, and on sizes that are not powers of two', () => {
    const { image: img, known } = image(7, 5, () => [10, 200, 30], (x, y) => x === 0 || y === 4 || (x === 6 && y === 0));

    const out = pushPull(img, known);

    for (let y = 0; y < 5; y++) for (let x = 0; x < 7; x++) expect(rgbAt({ ...img, data: out }, x, y)).toEqual([10, 200, 30]);
  });

  it('fills a one-pixel-wide image', () => {
    const { image: img, known } = image(1, 6, () => [50, 60, 70], (_, y) => y >= 3);

    expect(rgbAt({ ...img, data: pushPull(img, known) }, 0, 5)).toEqual([50, 60, 70]);
  });

  it('takes more from the near side than the far one', () => {
    // A red column far left and a blue one far right, with a hole all between: left pixels lean red.
    const { image: img, known } = image(32, 2, (x) => (x === 0 ? [255, 0, 0] : [0, 0, 255]), (x) => x > 0 && x < 31);

    const out = { ...img, data: pushPull(img, known) };

    expect(rgbAt(out, 2, 0)[0]).toBeGreaterThan(rgbAt(out, 29, 0)[0]);
    expect(rgbAt(out, 2, 0)[2]).toBeLessThan(rgbAt(out, 29, 0)[2]);
  });

  it('returns the image as it is when no pixel is known', () => {
    const { image: img, known } = image(4, 4, () => [1, 2, 3], () => true);

    expect([...pushPull(img, known)]).toEqual([...img.data]);
  });

  it('does not change the image it is given', () => {
    const { image: img, known } = image(8, 8, () => [9, 9, 9], (x) => x > 3);
    const before = [...img.data];

    pushPull(img, known);

    expect([...img.data]).toEqual(before);
  });
});

describe('distanceTo', () => {
  const mask = (width: number, height: number, set: [number, number][]) => {
    const out = new Uint8Array(width * height);
    for (const [x, y] of set) out[y * width + x] = 1;
    return out;
  };

  it('counts pixels in a straight line, and about √2 on a diagonal', () => {
    const d = distanceTo(mask(9, 9, [[4, 4]]), 9, 9);

    expect(d[4 * 9 + 4]).toBe(0);
    expect(d[4 * 9 + 7]).toBeCloseTo(3);
    expect(d[1 * 9 + 4]).toBeCloseTo(3);
    expect(d[5 * 9 + 5]).toBeCloseTo(Math.SQRT2);
  });

  it('measures from the nearest of several', () => {
    const d = distanceTo(mask(10, 1, [[0, 0], [9, 0]]), 10, 1);

    expect([...d]).toEqual([0, 1, 2, 3, 4, 4, 3, 2, 1, 0]);
  });

  it('is infinite when nothing is set', () => {
    expect(distanceTo(new Uint8Array(6), 3, 2).every((v) => v === Infinity)).toBe(true);
  });
});
