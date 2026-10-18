// Room Setup step 7 (spec §11.2): Patch v2, the generated fill for the spots no Capture saw. For each
// non-Kept Original it draws the Floor, and each Wall close behind it, top-down or head-on, cuts out
// the Patch region, puts the Original's captured Patch (ADR-0007) on top, and fills what is still
// empty by push-pull diffusion. Each image is saved as patches/<id>.floor.png or patches/<id>.<wallId>.png.
import { type Object3D, OrthographicCamera, Scene, type WebGLRenderer, WebGLRenderTarget } from 'three';
import { pointInPolygon, wallPoint } from '@shared/geometry';
import type { Original, RoomSetup, ScanManifest, Wall } from '@shared/types';
import { savePatchImage } from '../api';
import {
  FEATHER, type FloorFrame, IMAGE_SIZE, inRegion, type WallFrame, floorFrame, wallFrame,
} from '../scene/patchFrames';
import { disposeSplit, splitScan } from '../scene/splitScan';
import { distanceTo, pushPull, type RgbaImage } from './pushPull';

/** A pixel counts as seen when its alpha is at least this. */
const SEEN = 128;
/** Around an Opening, this much of the Wall stays clear too, so the frame isn't painted over. */
const OPENING_OUTSET = 0.02;

const smoothstep = (t: number) => t * t * (3 - 2 * t);

export interface PatchImageInput {
  width: number;
  height: number;
  /** The Floor or Wall node alone, as RGBA with alpha 0 where nothing was seen. */
  base: Uint8ClampedArray;
  /** The Original's captured Patch alone, in the same view; absent when no Fill Capture saw the spot. */
  captured?: Uint8ClampedArray;
  /** Whether pixel (column, row) lies in the Patch region, the box grown by 10 cm. */
  inRegion(column: number, row: number): boolean;
  /** Pixels that must stay clear: outside the room, or in an Opening. */
  keepClear?(column: number, row: number): boolean;
  /** How many pixels the edge of the fill fades over. */
  featherPx: number;
  /** The color to fill with when not one pixel was seen. */
  fallback?: [number, number, number];
}

/**
 * One Patch image from a view of the node (§11.2 steps 1 to 3). The region is cut out of the node,
 * and the captured Patch shows through in its place. What is still empty inside the region is
 * unseen: the pixels no Capture saw. Push-pull fills them from everything that was seen, and the
 * fill fades out over `featherPx` past its edge. The seen pixels keep their own colors, so the image
 * matches what it lies on, and the fill needs no seam where a captured Patch sits over it.
 *
 * Returns null when nothing in the region is unseen, as the captured Patch covers all of it, or when
 * nothing at all was seen to fill from.
 */
export function buildPatchImage(input: PatchImageInput): { image: RgbaImage; unseen: number } | null {
  const { width, height, base, captured, featherPx, fallback } = input;
  const rgba = new Uint8ClampedArray(width * height * 4);
  const [known, unseen, clear] = [0, 1, 2].map(() => new Uint8Array(width * height));
  let unseenCount = 0;
  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      const i = row * width + column;
      if (input.keepClear?.(column, row)) {
        clear[i] = 1;
        continue;
      }
      const region = input.inRegion(column, row);
      const source = region ? captured : base;
      if (source && source[i * 4 + 3] >= SEEN) {
        known[i] = 1;
        rgba.set(source.subarray(i * 4, i * 4 + 3), i * 4);
      } else if (region) {
        unseen[i] = 1;
        unseenCount++;
      }
    }
  }
  if (!unseenCount) return null;

  let data: Uint8ClampedArray;
  if (known.includes(1)) {
    data = pushPull({ width, height, data: rgba }, known);
  } else if (fallback) {
    data = rgba;
    for (let i = 0; i < width * height; i++) data.set(fallback, i * 4);
  } else {
    return null;
  }

  const distance = distanceTo(unseen, width, height);
  for (let i = 0; i < width * height; i++) {
    const fade = distance[i] >= featherPx ? 0 : smoothstep(1 - distance[i] / featherPx);
    data[i * 4 + 3] = clear[i] ? 0 : Math.round(255 * fade);
  }
  return { image: { width, height, data }, unseen: unseenCount };
}

/** Linear light, as a render target holds it, to the 8-bit sRGB a PNG holds. */
const TO_SRGB = Uint8ClampedArray.from({ length: 256 }, (_, i) => {
  const v = i / 255;
  return Math.round((v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055) * 255);
});

/**
 * Draws the nodes alone through `camera` as IMAGE_SIZE² RGBA in sRGB, top row first, with alpha 0
 * wherever nothing was drawn. A hidden node (a Patch, until its Original is lifted) is shown for the draw.
 */
function renderRgba(renderer: WebGLRenderer, nodes: Object3D[], camera: OrthographicCamera, mirror = false): Uint8ClampedArray {
  const scene = new Scene();
  const hidden = nodes.filter((node) => !node.visible);
  hidden.forEach((node) => { node.visible = true; });
  scene.add(...nodes);
  const target = new WebGLRenderTarget(IMAGE_SIZE, IMAGE_SIZE);
  const raw = new Uint8Array(IMAGE_SIZE * IMAGE_SIZE * 4);
  const saved = { target: renderer.getRenderTarget(), clipping: renderer.clippingPlanes, alpha: renderer.getClearAlpha() };
  try {
    renderer.clippingPlanes = [];
    renderer.setClearAlpha(0);
    renderer.setRenderTarget(target);
    renderer.clear();
    renderer.render(scene, camera);
    renderer.readRenderTargetPixels(target, 0, 0, IMAGE_SIZE, IMAGE_SIZE, raw);
  } finally {
    renderer.setRenderTarget(saved.target);
    renderer.clippingPlanes = saved.clipping;
    renderer.setClearAlpha(saved.alpha);
    target.dispose();
    scene.remove(...nodes);
    hidden.forEach((node) => { node.visible = false; });
  }

  // WebGL reads the bottom row first.
  const out = new Uint8ClampedArray(raw.length);
  for (let row = 0; row < IMAGE_SIZE; row++) {
    for (let column = 0; column < IMAGE_SIZE; column++) {
      const from = ((IMAGE_SIZE - 1 - row) * IMAGE_SIZE + column) * 4;
      const to = (row * IMAGE_SIZE + (mirror ? IMAGE_SIZE - 1 - column : column)) * 4;
      for (let c = 0; c < 3; c++) out[to + c] = TO_SRGB[raw[from + c]];
      out[to + 3] = raw[from + 3];
    }
  }
  return out;
}

/** Top-down with North up, so the image's right is +X and its top row the smallest z. */
function floorCamera({ center: [x, z], side }: FloorFrame) {
  const camera = new OrthographicCamera(-side / 2, side / 2, side / 2, -side / 2, 0.1, 100);
  camera.up.set(0, 0, -1);
  camera.position.set(x, 50, z);
  camera.lookAt(x, 0, z);
  camera.updateMatrixWorld();
  return camera;
}

/**
 * From 1 m inside the room, facing the Wall. Looking at the Wall, the camera's right is (nz, −nx),
 * which is the Wall's direction (start → end) or its opposite; `mirror` says which, so that the image
 * always runs along the Wall from its start.
 */
function wallCamera(wall: Wall, { along: [a0, a1], up: [y0, y1] }: WallFrame) {
  const y = (y0 + y1) / 2;
  const [from, to] = [wallPoint(wall, (a0 + a1) / 2, 1), wallPoint(wall, (a0 + a1) / 2, 0)];
  const camera = new OrthographicCamera(-(a1 - a0) / 2, (a1 - a0) / 2, (y1 - y0) / 2, -(y1 - y0) / 2, 0.1, 10);
  camera.position.set(from[0], y, from[1]);
  camera.lookAt(to[0], y, to[1]);
  camera.updateMatrixWorld();
  const [nx, nz] = wall.normal;
  const [dx, dz] = [wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]];
  return { camera, mirror: nz * dx - nx * dz < 0 };
}

const hexToRgb = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];

async function toPng({ width, height, data }: RgbaImage): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(data), width, height), 0, 0);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the Patch image'))), 'image/png');
  });
}

export interface PatchBake {
  /** By Original id: its images, or undefined when nothing needed filling (a Kept Original, or one a Fill Capture covered). */
  patches: Record<string, Original['patch']>;
  /** How many PNGs were saved. */
  images: number;
}

/**
 * Bakes Patch v2 for every non-Kept Original and saves the PNGs. `gltfScene` must be the Scan's
 * `room.glb` as merged from its Fill Captures, so that it holds the captured Patches. The caller puts
 * `patches` into the Originals.
 */
export async function bakePatches(
  renderer: WebGLRenderer, gltfScene: Object3D, setup: RoomSetup, manifest: ScanManifest,
  save: (name: string, png: Blob) => Promise<string> = (name, png) => savePatchImage(manifest.id, name, png),
): Promise<PatchBake> {
  const split = splitScan(gltfScene, setup, manifest);
  const result: PatchBake = { patches: {}, images: 0 };
  try {
    for (const original of setup.originals) {
      if (original.kept) continue;
      const { box } = original;
      const captured = split.patches[original.id];
      const patch: NonNullable<Original['patch']> = {};

      const floor = floorFrame(box);
      if (floor) {
        const [x0, z0] = [floor.center[0] - floor.side / 2, floor.center[1] - floor.side / 2];
        const pixel = floor.side / IMAGE_SIZE;
        const camera = floorCamera(floor);
        const point = (column: number, row: number): [number, number] => [x0 + (column + 0.5) * pixel, z0 + (row + 0.5) * pixel];
        const built = buildPatchImage({
          width: IMAGE_SIZE,
          height: IMAGE_SIZE,
          base: renderRgba(renderer, [split.floor], camera),
          captured: captured && renderRgba(renderer, [captured], camera),
          inRegion: (column, row) => { const [x, z] = point(column, row); return inRegion(box, [x, box.position[1], z]); },
          keepClear: (column, row) => !pointInPolygon(point(column, row), setup.floor.polygon),
          featherPx: FEATHER / pixel,
          fallback: hexToRgb(original.floorColor),
        });
        if (built) {
          patch.floor = await save(`${original.id}.floor.png`, await toPng(built.image));
          result.images++;
        }
      }

      for (const wall of setup.walls) {
        const frame = wallFrame(box, wall);
        if (!frame) continue;
        const [along0, up1] = [frame.along[0], frame.up[1]];
        const [pixelAlong, pixelUp] = [(frame.along[1] - frame.along[0]) / IMAGE_SIZE, (frame.up[1] - frame.up[0]) / IMAGE_SIZE];
        const { camera, mirror } = wallCamera(wall, frame);
        const alongAt = (column: number) => along0 + (column + 0.5) * pixelAlong;
        const heightAt = (row: number) => up1 - (row + 0.5) * pixelUp;
        const openings = setup.openings.filter((opening) => opening.wallId === wall.id);
        const built = buildPatchImage({
          width: IMAGE_SIZE,
          height: IMAGE_SIZE,
          base: renderRgba(renderer, [split.walls[wall.id]], camera, mirror),
          captured: captured && renderRgba(renderer, [captured], camera, mirror),
          inRegion: (column, row) => {
            const [x, z] = wallPoint(wall, alongAt(column), 0);
            return inRegion(box, [x, heightAt(row), z]);
          },
          // An Opening is the room's, not the Original's: the fill never covers a window or a door.
          keepClear: (column, row) => openings.some(({ offset, width, bottom, height }) =>
            alongAt(column) >= offset - OPENING_OUTSET && alongAt(column) <= offset + width + OPENING_OUTSET
            && heightAt(row) >= bottom - OPENING_OUTSET && heightAt(row) <= bottom + height + OPENING_OUTSET),
          featherPx: FEATHER / Math.max(pixelAlong, pixelUp),
        });
        if (built) {
          (patch.walls ??= {})[wall.id] = await save(`${original.id}.${wall.id}.png`, await toPng(built.image));
          result.images++;
        }
      }
      if (patch.floor || patch.walls) result.patches[original.id] = patch;
    }
  } finally {
    disposeSplit(split);
  }
  return result;
}
