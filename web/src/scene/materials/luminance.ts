// The average luminance of textured triangles (spec §9.4), which recolor divides by (spec §10.6):
// for each Scan node in splitScan, and for each Part in applyParts.
import { type BufferAttribute, type InterleavedBufferAttribute, type Material, type MeshStandardMaterial, type Texture, Vector2 } from 'three';
import { type Pixels, luminance, luminanceAt } from '../../setup/geometry/color';

/** Spec §9.4: sample the texture at the UV centroids of up to this many random triangles. */
const LUMINANCE_SAMPLES = 2000;
/** Spec §16 risk 4: the luminance to use when a texture can't be read back. */
const FALLBACK_LUMINANCE = 0.5;

/** Triangles drawn with one material: three vertex indices per triangle. */
export interface LuminanceSlice {
  material: Material;
  uv?: BufferAttribute | InterleavedBufferAttribute;
  index: ArrayLike<number>;
}

/**
 * The mean luminance at the UV centroids of the slices' triangles, each times its material color's
 * luminance, which multiplies the texture: every triangle when there are at most LUMINANCE_SAMPLES,
 * or else that many random ones.
 */
export function averageLuminance(slices: LuminanceSlice[], random = mulberry32(1)): number {
  // Each slice's texture pixels, and the luminance of its material's color.
  const sources = slices.map(({ material }) => {
    const { map, color } = material as Partial<MeshStandardMaterial>;
    map?.updateMatrix();
    return { map, colorLuminance: color ? luminance(color.r, color.g, color.b) : 1, pixels: map ? texturePixels(map) : null };
  });
  if (sources.some((source) => source.map && !source.pixels)) return FALLBACK_LUMINANCE;
  const counts = slices.map((slice) => slice.index.length / 3);
  const total = counts.reduce((a, b) => a + b, 0);
  const sampleAll = total <= LUMINANCE_SAMPLES;
  let sum = 0;
  let samples = 0;
  const uv = new Vector2();
  for (let k = 0; k < Math.min(LUMINANCE_SAMPLES, total); k++) {
    let t = sampleAll ? k : Math.floor(random() * total);
    let p = 0;
    while (t >= counts[p]) t -= counts[p++];
    const { map, colorLuminance, pixels } = sources[p];
    const { uv: uvs, index } = slices[p];
    let sample = colorLuminance;
    if (map && pixels && uvs) {
      const [a, b, c] = [index[3 * t], index[3 * t + 1], index[3 * t + 2]];
      uv.set((uvs.getX(a) + uvs.getX(b) + uvs.getX(c)) / 3, (uvs.getY(a) + uvs.getY(b) + uvs.getY(c)) / 3);
      map.transformUv(uv);   // texture transform, wrapping, and flipY → image space, row 0 at the top
      sample *= luminanceAt(pixels, uv.x, uv.y);
    }
    sum += sample;
    samples++;
  }
  return samples > 0 ? sum / samples : FALLBACK_LUMINANCE;
}

const pixelCache = new WeakMap<Texture, Pixels | null>();

/**
 * A texture's RGBA pixels, read once per texture: drawn into an OffscreenCanvas of at most 512 px
 * (the average barely changes, and a 2K readback would cost more than the split) and read with
 * getImageData. A DataTexture's own data is used as it is. Null when it can't be read, such as a
 * compressed texture.
 */
function texturePixels(texture: Texture): Pixels | null {
  if (pixelCache.has(texture)) return pixelCache.get(texture)!;
  let pixels: Pixels | null = null;
  const image = texture.image as { width: number; height: number; data?: ArrayLike<number> } | undefined;
  try {
    if (image?.data && image.data.length === image.width * image.height * 4) {
      pixels = { width: image.width, height: image.height, data: image.data };
    } else if (image && image.width > 0 && typeof OffscreenCanvas !== 'undefined') {
      const scale = Math.min(1, 512 / Math.max(image.width, image.height));
      const width = Math.max(1, Math.round(image.width * scale));
      const height = Math.max(1, Math.round(image.height * scale));
      const context = new OffscreenCanvas(width, height).getContext('2d', { willReadFrequently: true })!;
      context.drawImage(image as CanvasImageSource, 0, 0, width, height);
      pixels = context.getImageData(0, 0, width, height);
    }
  } catch (error) {
    console.warn('Could not read a texture for avgLuminance', error);
  }
  pixelCache.set(texture, pixels);
  return pixels;
}

/** A small seeded random generator, so each load samples the same triangles. */
export function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
