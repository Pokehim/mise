import { Document } from '@gltf-transform/core';
import { getBounds } from '@gltf-transform/functions';
import { describe, expect, it } from 'vitest';
import { boundsOf, clearGlass, keepNodes, madeUp, potted, turn } from './models';

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

describe('clearGlass', () => {
  it("makes BLEND glass clear, as Poly Haven's takes the body's opaque texture, and leaves other materials alone", () => {
    const doc = new Document();
    const texture = doc.createTexture('alarm_clock_01_diff');
    const glass = doc.createMaterial('alarm_clock_01_Glass').setAlphaMode('BLEND').setBaseColorTexture(texture);
    const body = doc.createMaterial('alarm_clock_01').setBaseColorTexture(texture);
    const leaves = doc.createMaterial('leaves_glassy').setAlphaMode('MASK').setBaseColorTexture(texture);
    clearGlass(doc);
    expect([glass.getBaseColorTexture(), glass.getAlpha(), glass.getMetallicFactor()]).toEqual([null, 0.12, 0]);
    expect([body.getBaseColorTexture(), leaves.getBaseColorTexture()]).toEqual([texture, texture]);
  });
});

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

describe('madeUp', () => {
  it('makes a bed frame up: a mattress of the listed size on top, centered, with a duvet, a throw and a pillow at its head', () => {
    // A 14" twin XL frame, 1.09 × 2.07 m, its top 0.356 m up; a 39 × 80 × 10 in mattress.
    const frame = boxes(['frame', [-0.545, 0, -1.035], [0.545, 0.356, 1.035]]);
    const doc = madeUp(frame, { mattress: [39, 80, 10] });
    const bounds = (name: string) => {
      const { min, max } = getBounds(doc.getRoot().listNodes().find((n) => n.getName() === name)!);
      return [rounded(min), rounded(max)];
    };

    // 0.991 × 2.032 × 0.254 m on the frame's top, centered on it.
    expect(bounds('mattress')).toEqual([[-0.495, 0.356, -1.016], [0.495, 0.61, 1.016]]);
    // The duvet over its foot two thirds, a little wider; the pillow at its head (−Z), on top.
    const [[, , duvetHead], [, duvetTop]] = bounds('duvet');
    expect(duvetHead).toBeCloseTo(-1.016 + 2.032 * 0.3, 2);
    expect(duvetTop).toBeCloseTo(0.66, 2);
    const [[, pillowBottom, pillowHead], [, pillowTop]] = bounds('pillow');
    expect([pillowBottom, pillowHead, pillowTop]).toEqual([0.61, -0.936, 0.74]);
    expect(bounds('throw')[1][1]).toBeCloseTo(0.69, 2);
  });
});
