// scripts/catalog/models.ts — glTF Document edits for the Catalog's items: keeping one variant of a Poly Haven asset,
// turning a scan to face +Z, setting a plant in a pot, and making up an ABO bed frame. catalog-build centers and
// optimizes the result.

import { type Document, NodeIO, type TypedArray, type vec3 } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { getBounds, mergeDocuments, prune, unpartition } from '@gltf-transform/functions';

export const io = () => new NodeIO().registerExtensions(ALL_EXTENSIONS);

const sceneOf = (doc: Document) => {
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
  if (!scene) throw new Error('the glTF has no scene');
  return scene;
};

export const boundsOf = (doc: Document) => getBounds(sceneOf(doc));

/**
 * Keeps only the scene's top-level nodes with these names, such as one plant of the several that a Poly Haven botany
 * asset lays out side by side. Throws on a name the scene doesn't have, so a renamed asset can't slip through empty.
 */
export async function keepNodes(doc: Document, names: string[]) {
  const scene = sceneOf(doc);
  const children = scene.listChildren();
  const missing = names.filter((name) => !children.some((node) => node.getName() === name));
  if (missing.length > 0) {
    throw new Error(`no node ${missing.join(', ')}; the scene has ${children.map((node) => node.getName()).join(', ')}`);
  }
  for (const node of children) if (!names.includes(node.getName())) node.dispose();
  await doc.transform(prune());
}

/**
 * Makes Poly Haven's glass clear. Its glass is BLEND, but colored by the body's JPEG texture, which has no alpha, so it
 * draws opaque and hides what is behind it: a clock's dial, a frame's picture. Returns the document.
 */
export function clearGlass(doc: Document) {
  for (const material of doc.getRoot().listMaterials()) {
    if (material.getAlphaMode() !== 'BLEND' || !/glass/i.test(material.getName())) continue;
    material.setBaseColorTexture(null).setMetallicRoughnessTexture(null)
      .setBaseColorFactor([1, 1, 1, 0.12]).setMetallicFactor(0).setRoughnessFactor(0.05);
  }
  return doc;
}

/** Moves the scene's top-level nodes under one new node with this translation, rotation and scale. */
function wrap(doc: Document, name: string, transform: { translation?: vec3; rotation?: [number, number, number, number]; scale?: number }) {
  const scene = sceneOf(doc);
  const group = doc.createNode(name);
  if (transform.translation) group.setTranslation(transform.translation);
  if (transform.rotation) group.setRotation(transform.rotation);
  if (transform.scale) group.setScale([transform.scale, transform.scale, transform.scale]);
  for (const node of scene.listChildren()) {
    scene.removeChild(node);
    group.addChild(node);
  }
  scene.addChild(group);
  return group;
}

/** Turns the model about +Y by whole degrees, counterclockwise seen from above, as a pick turns a scan to face +Z. */
export function turn(doc: Document, degrees: number) {
  const half = (degrees * Math.PI) / 360;
  wrap(doc, 'turn', { rotation: [0, Math.sin(half), 0, Math.cos(half)] });
}

/** Turns the model about +X by whole degrees, as a pick stands up a model its author laid on its back (+Z up). */
export function tilt(doc: Document, degrees: number) {
  const half = (degrees * Math.PI) / 360;
  wrap(doc, 'tilt', { rotation: [Math.sin(half), 0, 0, Math.cos(half)] });
}

/** Scales the model evenly to a real size: its height, or its longest side, in meters. */
export function scaleTo(doc: Document, { height, longest }: { height?: number; longest?: number }) {
  const { min, max } = boundsOf(doc);
  const size = [0, 1, 2].map((axis) => max[axis] - min[axis]);
  const scale = height ? height / size[1] : longest ? longest / Math.max(...size) : 1;
  if (!Number.isFinite(scale) || scale <= 0) throw new Error('the model has no size to scale');
  wrap(doc, 'scale', { scale });
}

/** How far below a pot's rim its soil lies. */
const SOIL_DEPTH = 0.03;

/**
 * The pot with the plant standing in it: the plant's lowest point on the soil, a little below the rim, and centered on
 * the pot. The soil is a flat brown disc over most of the pot's mouth, enough to hide the empty pot under the leaves.
 */
export async function potted(pot: Document, plant: Document): Promise<Document> {
  const potBox = boundsOf(pot);
  const plantBox = boundsOf(plant);
  const center = (box: typeof potBox, axis: number) => (box.min[axis] + box.max[axis]) / 2;
  const soil = potBox.max[1] - SOIL_DEPTH;
  wrap(plant, 'plant', {
    translation: [center(potBox, 0) - center(plantBox, 0), soil - plantBox.min[1], center(potBox, 2) - center(plantBox, 2)],
  });
  const radius = 0.46 * Math.min(potBox.max[0] - potBox.min[0], potBox.max[2] - potBox.min[2]);
  sceneOf(pot).addChild(soilDisc(pot, radius, [center(potBox, 0), soil, center(potBox, 2)]));

  // Merging adds the plant's scene beside the pot's: move its nodes into the pot's, then drop it.
  mergeDocuments(pot, plant);
  const [potScene, ...others] = pot.getRoot().listScenes();
  for (const scene of others) {
    for (const node of scene.listChildren()) potScene.addChild(node);
    scene.dispose();
  }
  await pot.transform(unpartition(), prune());
  return pot;
}

/** A flat, upward-facing disc of dark potting soil. */
function soilDisc(doc: Document, radius: number, [x, y, z]: vec3) {
  const segments = 32;
  const positions = [0, 0, 0];
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * 2 * Math.PI;
    positions.push(radius * Math.cos(angle), 0, radius * Math.sin(angle));
  }
  const indices: number[] = [];
  // Counterclockwise seen from above (+Y), so the face points up.
  for (let i = 1; i <= segments; i++) indices.push(0, (i % segments) + 1, i);
  const normals = positions.map((_, i) => (i % 3 === 1 ? 1 : 0));
  const buffer = doc.getRoot().listBuffers()[0] ?? doc.createBuffer();
  const accessor = (array: TypedArray, type: 'VEC3' | 'SCALAR') =>
    doc.createAccessor().setArray(array).setType(type).setBuffer(buffer);
  const material = doc.createMaterial('soil').setBaseColorFactor([0.13, 0.09, 0.06, 1]).setRoughnessFactor(1).setMetallicFactor(0);
  const primitive = doc.createPrimitive()
    .setAttribute('POSITION', accessor(new Float32Array(positions), 'VEC3'))
    .setAttribute('NORMAL', accessor(new Float32Array(normals), 'VEC3'))
    .setIndices(accessor(new Uint16Array(indices), 'SCALAR'))
    .setMaterial(material);
  return doc.createNode('soil').setTranslation([x, y, z]).setMesh(doc.createMesh('soil').addPrimitive(primitive));
}

/** A mattress made up with bedding, in inches as a listing gives it: width × length × height. */
export interface MadeUp { mattress: [width: number, length: number, height: number] }

/**
 * The bed frame made up: a mattress of the listed size on top of it, centered, with a duvet over its foot two thirds,
 * a throw folded across its foot, and a pillow at its head. The frame's front is +Z, so its head is at −Z.
 */
export function madeUp(frame: Document, { mattress: [widthIn, lengthIn, heightIn] }: MadeUp): Document {
  const inch = 0.0254;
  const [width, length, height] = [widthIn * inch, lengthIn * inch, heightIn * inch];
  const { min, max } = boundsOf(frame);
  const [cx, cz] = [(min[0] + max[0]) / 2, (min[2] + max[2]) / 2];
  const [head, foot] = [cz - length / 2, cz + length / 2];
  const top = max[1] + height;
  const scene = sceneOf(frame);
  scene.addChild(box(frame, 'mattress', [cx - width / 2, max[1], head], [cx + width / 2, top, foot], [0.92, 0.91, 0.88]));
  scene.addChild(box(frame, 'duvet', [cx - width / 2 - 0.04, top - 0.1, head + length * 0.3], [cx + width / 2 + 0.04, top + 0.05, foot + 0.04], [0.8, 0.72, 0.6]));
  scene.addChild(box(frame, 'throw', [cx - width / 2 - 0.05, top + 0.05, foot - 0.45], [cx + width / 2 + 0.05, top + 0.08, foot - 0.1], [0.62, 0.36, 0.22]));
  scene.addChild(box(frame, 'pillow', [cx - width / 2 + 0.12, top, head + 0.08], [cx + width / 2 - 0.12, top + 0.13, head + 0.5], [0.96, 0.94, 0.9]));
  return frame;
}

/** A soft, matte box from `min` to `max`, its faces pointing out. */
function box(doc: Document, name: string, [x0, y0, z0]: vec3, [x1, y1, z1]: vec3, [r, g, b]: [number, number, number]) {
  // Each face: its normal, then its 4 corners counterclockwise seen from outside.
  const faces: [vec3, vec3[]][] = [
    [[0, 1, 0], [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]]],
    [[0, -1, 0], [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]]],
    [[0, 0, 1], [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]],
    [[0, 0, -1], [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]]],
    [[1, 0, 0], [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]]],
    [[-1, 0, 0], [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]]],
  ];
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  faces.forEach(([normal, corners], face) => {
    for (const corner of corners) { positions.push(...corner); normals.push(...normal); }
    const at = face * 4;
    indices.push(at, at + 1, at + 2, at, at + 2, at + 3);
  });
  const buffer = doc.getRoot().listBuffers()[0] ?? doc.createBuffer();
  const accessor = (array: TypedArray, type: 'VEC3' | 'SCALAR') =>
    doc.createAccessor().setArray(array).setType(type).setBuffer(buffer);
  const material = doc.createMaterial(name).setBaseColorFactor([r, g, b, 1]).setRoughnessFactor(0.95).setMetallicFactor(0);
  const primitive = doc.createPrimitive()
    .setAttribute('POSITION', accessor(new Float32Array(positions), 'VEC3'))
    .setAttribute('NORMAL', accessor(new Float32Array(normals), 'VEC3'))
    .setIndices(accessor(new Uint16Array(indices), 'SCALAR'))
    .setMaterial(material);
  return doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(primitive));
}
