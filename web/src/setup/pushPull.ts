// Image helpers for Patch v2 (spec §11.2): push-pull diffusion fills the pixels no Capture saw.

export interface RgbaImage { width: number; height: number; data: Uint8ClampedArray }

/** One level of the pyramid: per pixel, the sum of the known colors below it, how many were known, and how many pixels it covers. */
interface Level { width: number; height: number; sum: Float32Array; known: Float32Array; area: Float32Array }

/** The next level up, one pixel for each 2×2 block (an odd edge pixel keeps its own block). */
function pull({ width, height, sum, known, area }: Level): Level {
  const [w, h] = [Math.ceil(width / 2), Math.ceil(height / 2)];
  const next: Level = { width: w, height: h, sum: new Float32Array(w * h * 3), known: new Float32Array(w * h), area: new Float32Array(w * h) };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [from, to] = [y * width + x, (y >> 1) * w + (x >> 1)];
      for (let c = 0; c < 3; c++) next.sum[to * 3 + c] += sum[from * 3 + c];
      next.known[to] += known[from];
      next.area[to] += area[from];
    }
  }
  return next;
}

/** The color of a level's pixel `i`, or null when it holds no known pixel. */
function averageAt({ sum, known }: Level, i: number, c: number) {
  return known[i] > 0 ? sum[i * 3 + c] / known[i] : null;
}

/** Bilinear sample of a finished level at a pixel of the level below it, clamped to the edges. */
function sampleUp(level: { width: number; height: number; color: Float32Array }, x: number, y: number, c: number) {
  const [fx, fy] = [Math.max(0, (x + 0.5) / 2 - 0.5), Math.max(0, (y + 0.5) / 2 - 0.5)];
  const [x0, y0] = [Math.min(Math.floor(fx), level.width - 1), Math.min(Math.floor(fy), level.height - 1)];
  const [x1, y1] = [Math.min(x0 + 1, level.width - 1), Math.min(y0 + 1, level.height - 1)];
  const [tx, ty] = [fx - x0, fy - y0];
  const at = (px: number, py: number) => level.color[(py * level.width + px) * 3 + c];
  return (at(x0, y0) * (1 - tx) + at(x1, y0) * tx) * (1 - ty) + (at(x0, y1) * (1 - tx) + at(x1, y1) * tx) * ty;
}

/**
 * Push-pull diffusion (spec §11.2 step 3): the colors of the pixels where `known[i]` is 0, filled from
 * the ones where it is 1.
 *
 * Pull averages the known pixels into ever coarser levels, down to one color. Push then walks back
 * down: a pixel keeps what it knows of itself, and takes the rest from the coarser level, so the fill
 * runs smoothly inward from the boundary and settles on the average where nothing is near. That suits
 * the plain floors and walls it is for (carpet, vinyl, wood, paint). Pixels that are known come back
 * untouched, as does alpha. When no pixel is known there is nothing to spread, and the image is returned as it is.
 */
export function pushPull({ width, height, data }: RgbaImage, known: Uint8Array): Uint8ClampedArray {
  const out = new Uint8ClampedArray(data);
  const base: Level = { width, height, sum: new Float32Array(width * height * 3), known: new Float32Array(width * height), area: new Float32Array(width * height).fill(1) };
  for (let i = 0; i < width * height; i++) {
    if (!known[i]) continue;
    base.known[i] = 1;
    for (let c = 0; c < 3; c++) base.sum[i * 3 + c] = data[i * 4 + c];
  }

  const levels = [base];
  while (levels[levels.length - 1].width > 1 || levels[levels.length - 1].height > 1) levels.push(pull(levels[levels.length - 1]));
  const top = levels[levels.length - 1];
  if (top.known[0] === 0) return out;

  // Finished colors, coarsest first.
  let coarser = { width: 1, height: 1, color: Float32Array.from([0, 1, 2].map((c) => averageAt(top, 0, c)!)) };
  for (let k = levels.length - 2; k >= 0; k--) {
    const level = levels[k];
    const color = new Float32Array(level.width * level.height * 3);
    for (let y = 0; y < level.height; y++) {
      for (let x = 0; x < level.width; x++) {
        const i = y * level.width + x;
        const own = level.known[i] / level.area[i];
        for (let c = 0; c < 3; c++) {
          color[i * 3 + c] = own >= 1 ? averageAt(level, i, c)! : (own > 0 ? averageAt(level, i, c)! * own : 0) + sampleUp(coarser, x, y, c) * (1 - own);
        }
      }
    }
    coarser = { width: level.width, height: level.height, color };
  }
  for (let i = 0; i < width * height; i++) {
    if (known[i]) continue;
    for (let c = 0; c < 3; c++) out[i * 4 + c] = Math.round(coarser.color[i * 3 + c]);
  }
  return out;
}

/** How far, in pixels, each pixel is from the nearest one where `mask` is 1 (0 on it): a two-pass chamfer. */
export function distanceTo(mask: Uint8Array, width: number, height: number): Float32Array {
  const near = Math.SQRT2;
  const distance = new Float32Array(width * height);
  for (let i = 0; i < distance.length; i++) distance[i] = mask[i] ? 0 : Infinity;
  const relax = (x: number, y: number, dx: number, dy: number, step: number, i: number) => {
    const [nx, ny] = [x + dx, y + dy];
    if (nx >= 0 && nx < width && ny >= 0 && ny < height) distance[i] = Math.min(distance[i], distance[ny * width + nx] + step);
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      relax(x, y, -1, 0, 1, i); relax(x, y, 0, -1, 1, i); relax(x, y, -1, -1, near, i); relax(x, y, 1, -1, near, i);
    }
  }
  for (let y = height - 1; y >= 0; y--) {
    for (let x = width - 1; x >= 0; x--) {
      const i = y * width + x;
      relax(x, y, 1, 0, 1, i); relax(x, y, 0, 1, 1, i); relax(x, y, 1, 1, near, i); relax(x, y, -1, 1, near, i);
    }
  }
  return distance;
}
