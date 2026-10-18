// Room Setup step 7 (spec §9.3): each Original's floorColor, from a top-down render of the Floor.
import { type Object3D, OrthographicCamera, Scene, type WebGLRenderer, WebGLRenderTarget } from 'three';
import type { Hex, RoomSetup, ScanManifest } from '@shared/types';
import { disposeSplit, splitScan } from '../scene/splitScan';
import { type FloorImage, ringColor } from './geometry/color';
import { polygonBounds } from './geometry/walls';

/** 1 cm per pixel, up to 2048 pixels a side. */
const PIXEL = 0.01;
const MAX_PIXELS = 2048;
const MARGIN = 0.3;

/**
 * The floor color in a 15 cm ring around each Original's footprint: the Floor node alone (so with
 * the Originals hidden) is rendered top-down, orthographically, and the ring's pixels are averaged.
 * An Original with no floor seen around it is left out.
 */
export function bakeFloorColors(
  renderer: WebGLRenderer, gltfScene: Object3D, setup: RoomSetup, manifest: ScanManifest,
): Record<string, Hex> {
  const split = splitScan(gltfScene, setup, manifest);
  const bounds = polygonBounds(setup.floor.polygon);
  const [minX, maxX, minZ, maxZ] = [bounds.minX - MARGIN, bounds.maxX + MARGIN, bounds.minZ - MARGIN, bounds.maxZ + MARGIN];
  const pixel = Math.max(PIXEL, (maxX - minX) / MAX_PIXELS, (maxZ - minZ) / MAX_PIXELS);
  const width = Math.ceil((maxX - minX) / pixel);
  const height = Math.ceil((maxZ - minZ) / pixel);

  // Looking down with North (−Z) up: screen right is +X, and the image's bottom row is the largest z.
  const camera = new OrthographicCamera(-(width * pixel) / 2, (width * pixel) / 2, (height * pixel) / 2, -(height * pixel) / 2, 0.1, 100);
  const center = [minX + (width * pixel) / 2, minZ + (height * pixel) / 2] as const;
  camera.up.set(0, 0, -1);
  camera.position.set(center[0], 50, center[1]);
  camera.lookAt(center[0], 0, center[1]);
  camera.updateMatrixWorld();

  const scene = new Scene();
  scene.add(split.floor);
  const target = new WebGLRenderTarget(width, height);
  const data = new Uint8Array(width * height * 4);
  const saved = { target: renderer.getRenderTarget(), clipping: renderer.clippingPlanes, alpha: renderer.getClearAlpha() };
  try {
    renderer.clippingPlanes = [];
    renderer.setClearAlpha(0);
    renderer.setRenderTarget(target);
    renderer.clear();
    renderer.render(scene, camera);
    renderer.readRenderTargetPixels(target, 0, 0, width, height, data);
  } finally {
    renderer.setRenderTarget(saved.target);
    renderer.clippingPlanes = saved.clipping;
    renderer.setClearAlpha(saved.alpha);
    target.dispose();
    disposeSplit(split);
  }

  const top = minZ + height * pixel;
  const image: FloorImage = {
    width, height, data,
    pointAt: (column, row) => [minX + (column + 0.5) * pixel, top - (row + 0.5) * pixel],
  };
  const colors: Record<string, Hex> = {};
  for (const original of setup.originals) {
    const color = ringColor(image, original.box);
    if (color) colors[original.id] = color;
  }
  return colors;
}
