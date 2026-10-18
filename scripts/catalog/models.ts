// scripts/catalog/models.ts — glTF Document edits for the Catalog's non-ABO items: keeping one variant of a Poly Haven
// asset, turning a scan to face +Z, and setting a plant in a pot. catalog-build centers and optimizes the result.

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

/** Moves the scene's top-level nodes under one new node with this translation, rotation and scale. */
function wrap(doc: Document, name: string, transform: { translation?: vec3; rotation?: [number, number, number, number] }) {
  const scene = sceneOf(doc);
  const group = doc.createNode(name);
  if (transform.translation) group.setTranslation(transform.translation);
  if (transform.rotation) group.setRotation(transform.rotation);
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
