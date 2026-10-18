import { Document } from '@gltf-transform/core';
import { getBounds } from '@gltf-transform/functions';
import { describe, expect, it } from 'vitest';
import { boundsOf, keepNodes, potted, turn } from './models';

/** A Document of axis-aligned boxes, each a top-level node named for it: [name, min, max]. */
function boxes(...specs: [string, [number, number, number], [number, number, number]][]) {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene();
  for (const [name, min, max] of specs) {
    const corners: number[] = [];
    for (const x of [min[0], max[0]]) for (const y of [min[1], max[1]]) for (const z of [min[2], max[2]]) corners.push(x, y, z);
    const position = doc.createAccessor().setType('VEC3').setArray(new Float32Array(corners)).setBuffer(buffer);
    const indices = doc.createAccessor().setType('SCALAR').setArray(new Uint16Array([0, 1, 2, 4, 5, 6])).setBuffer(buffer);
    const mesh = doc.createMesh(name).addPrimitive(doc.createPrimitive().setAttribute('POSITION', position).setIndices(indices));
    scene.addChild(doc.createNode(name).setMesh(mesh));
  }
  return doc;
}

const rounded = (values: ArrayLike<number>) => Array.from(values, (v) => Math.round(v * 1000) / 1000);

describe('keepNodes', () => {
  it('keeps one of the variants a Poly Haven botany asset lays side by side', async () => {
    const doc = boxes(['plant_a', [-1.2, 0, -0.2], [-0.8, 0.5, 0.2]], ['plant_b', [-0.2, 0, -0.2], [0.2, 0.4, 0.2]]);
    await keepNodes(doc, ['plant_b']);
    expect(doc.getRoot().listScenes()[0].listChildren().map((node) => node.getName())).toEqual(['plant_b']);
    expect(doc.getRoot().listMeshes()).toHaveLength(1);
  });

  it('throws on a name the asset lacks, listing the names it has', async () => {
    await expect(keepNodes(boxes(['plant_a', [0, 0, 0], [1, 1, 1]]), ['plant_z'])).rejects.toThrow(/plant_z.*plant_a/);
  });
});

describe('turn', () => {
  it('turns the model about +Y, counterclockwise seen from above', () => {
    const doc = boxes(['frame', [0, 0, -0.1], [0.02, 0.25, 0.1]]);   // facing +X
    turn(doc, 90);
    const { min, max } = boundsOf(doc);
    expect(rounded(min)).toEqual([-0.1, 0, -0.02]);
    expect(rounded(max)).toEqual([0.1, 0.25, 0]);
  });
});

describe('potted', () => {
  it('stands the plant on soil just below the rim, centered on the pot', async () => {
    const pot = boxes(['pot', [-0.13, 0, -0.13], [0.13, 0.22, 0.13]]);
    const plant = boxes(['plant', [0.9, -0.01, 0.4], [1.5, 0.45, 0.9]]);   // where Poly Haven lays it out
    const doc = await potted(pot, plant);
    expect(doc.getRoot().listScenes()).toHaveLength(1);
    const node = doc.getRoot().listNodes().find((n) => n.getName() === 'plant')!;
    const { min, max } = getBounds(node);
    expect(rounded(min)).toEqual([-0.3, 0.19, -0.25]);
    expect(rounded(max)).toEqual([0.3, 0.65, 0.25]);
    const soil = doc.getRoot().listNodes().find((n) => n.getName() === 'soil')!;
    expect(rounded(soil.getTranslation())).toEqual([0, 0.19, 0]);
  });
});
