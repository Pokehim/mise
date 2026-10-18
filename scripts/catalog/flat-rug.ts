// scripts/catalog/flat-rug.ts — a rug from an ABO listing with no 3D model: a 1 cm slab at the listing's size, with
// its photo, taken straight down at the whole rug, on top.

import { Document, type TypedArray } from '@gltf-transform/core';
import sharp from 'sharp';
import type { Vec2 } from '../../shared/types';

/** The rug's thickness, and how far in from its edge the bevel that softens its rim reaches. */
const THICKNESS = 0.01;
const BEVEL = 0.008;
/** The longest side of the texture: "2K", before catalog-build's optimize brings it to the Catalog's 1K. */
const TEXTURE_SIDE = 2048;

/** A pixel darker than this counts as rug: the backdrop is white, and a cream rug is only a little darker. */
const BACKDROP = 245;
/** A row or column is rug when at least this share of its pixels is. A dimension line or its label fills far less. */
const FILLED = 0.5;
/** How far the rug in a photo may be from the listing's proportions: any further, and the photo isn't straight down. */
export const ASPECT_TOLERANCE = 0.08;

export interface Crop { left: number; top: number; width: number; height: number }

/**
 * The rug's box in a product photo on a white backdrop, found as the longest runs of rows and of columns that are
 * mostly rug: the thin dimension lines and labels some listings draw beside the rug are left out.
 */
export function rugBounds(gray: Uint8Array, width: number, height: number): Crop {
  const longestRun = (filled: boolean[]) => {
    let best = { start: 0, length: 0 };
    let start = -1;
    filled.forEach((on, i) => {
      if (on && start < 0) start = i;
      if (on && i - start + 1 > best.length) best = { start, length: i - start + 1 };
      if (!on) start = -1;
    });
    return best;
  };
  const dark = (x: number, y: number) => gray[y * width + x] < BACKDROP;
  const count = (length: number, at: (i: number) => boolean) => {
    let n = 0;
    for (let i = 0; i < length; i++) if (at(i)) n++;
    return n;
  };
  // Every column of the rug is dark for about the rug's height, and a vertical dimension line beside it too, but a
  // white gap parts the two: the longest run is the rug's. Then its rows are those dark for most of its width.
  const columns = Array.from({ length: width }, (_, x) => count(height, (y) => dark(x, y)));
  const columnRun = longestRun(columns.map((n) => n >= FILLED * Math.max(...columns)));
  const rows = Array.from({ length: height }, (_, y) => count(width, (x) => dark(x, y)));
  const rowRun = longestRun(rows.map((n) => n >= FILLED * columnRun.length));
  if (columnRun.length === 0 || rowRun.length === 0) throw new Error('found no rug on a white backdrop in the photo');
  return { left: columnRun.start, top: rowRun.start, width: columnRun.length, height: rowRun.length };
}

/** The rug's photo, cropped to the rug and turned so its long side runs the way the rug's long side does. */
export async function rugTexture(photo: string, [width, depth]: Vec2): Promise<{ jpeg: Buffer; aspect: number }> {
  const { data, info } = await sharp(photo).grayscale().raw().toBuffer({ resolveWithObject: true });
  const crop = rugBounds(new Uint8Array(data), info.width, info.height);
  const turned = (crop.width > crop.height) !== (width > depth);
  // Two pipelines: in one, sharp would extract after rotating.
  const rug = await sharp(photo).extract(crop).toBuffer();
  const image = sharp(rug).rotate(turned ? 90 : 0).resize(TEXTURE_SIDE, TEXTURE_SIDE, { fit: 'inside', withoutEnlargement: true });
  const aspect = turned ? crop.height / crop.width : crop.width / crop.height;
  return { jpeg: await image.jpeg({ quality: 90 }).toBuffer(), aspect };
}

/**
 * The slab: a top face carrying the whole photo, a narrow bevel down to the floor all around, and no bottom, which the
 * floor hides. Its pivot is the bottom center and its top faces +Y; the photo's top edge is at the back (−Z).
 */
export function rugDocument(texture: Buffer, [width, depth]: Vec2, name: string): Document {
  const [x0, x1, z0, z1] = [-width / 2, width / 2, -depth / 2, depth / 2];
  const inset = BEVEL;
  // The rings of four corners: the top face, inset by the bevel, then the floor edge. Each corner's uv is its spot in
  // the photo, so the bevel shows the photo's edge stretched down.
  const top = [[x0 + inset, z0 + inset], [x1 - inset, z0 + inset], [x1 - inset, z1 - inset], [x0 + inset, z1 - inset]];
  const floor = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
  const uv = ([x, z]: number[]) => [(x - x0) / width, (z - z0) / depth];
  const positions: number[] = [];
  const uvs: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const quad = (corners: number[][], heights: number[], normal: number[]) => {
    const first = positions.length / 3;
    corners.forEach((corner, i) => {
      positions.push(corner[0], heights[i], corner[1]);
      uvs.push(...uv(corner));
      normals.push(...normal);
    });
    indices.push(first, first + 2, first + 1, first, first + 3, first + 2);
  };
  // Seen from above with +Z toward the viewer, these corners run clockwise, so (0, 2, 1) is counterclockwise: up.
  quad(top, [THICKNESS, THICKNESS, THICKNESS, THICKNESS], [0, 1, 0]);
  const slope = Math.hypot(THICKNESS, inset);
  const sides: [number, number, number[]][] = [
    [0, 1, [0, inset / slope, -THICKNESS / slope]],   // back (−Z)
    [1, 2, [THICKNESS / slope, inset / slope, 0]],    // right (+X)
    [2, 3, [0, inset / slope, THICKNESS / slope]],    // front (+Z)
    [3, 0, [-THICKNESS / slope, inset / slope, 0]],   // left (−X)
  ];
  // Seen from outside, top[b] → top[a] → floor[a] → floor[b] runs clockwise too, so these face out.
  for (const [a, b, normal] of sides) {
    quad([top[b], top[a], floor[a], floor[b]], [THICKNESS, THICKNESS, 0, 0], normal);
  }

  const doc = new Document();
  const buffer = doc.createBuffer();
  const accessor = (array: TypedArray, type: 'VEC2' | 'VEC3' | 'SCALAR') =>
    doc.createAccessor().setArray(array).setType(type).setBuffer(buffer);
  const material = doc.createMaterial(name).setRoughnessFactor(0.95).setMetallicFactor(0)
    .setBaseColorTexture(doc.createTexture(name).setImage(new Uint8Array(texture)).setMimeType('image/jpeg'));
  const primitive = doc.createPrimitive()
    .setAttribute('POSITION', accessor(new Float32Array(positions), 'VEC3'))
    .setAttribute('NORMAL', accessor(new Float32Array(normals), 'VEC3'))
    .setAttribute('TEXCOORD_0', accessor(new Float32Array(uvs), 'VEC2'))
    .setIndices(accessor(new Uint16Array(indices), 'SCALAR'))
    .setMaterial(material);
  doc.createScene(name).addChild(doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(primitive)));
  return doc;
}
