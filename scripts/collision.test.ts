import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Catalog, CollisionBox, RoomSetup, Vec3 } from '../shared/types';
import { boundsOf, decide, type Fit, fitModel, fitParts, furniture, type Part, placeInSize, toJson, withCollision } from './collision';

/** A closed box's 12 triangles, as a Part. */
function cuboid(node: string, [x0, y0, z0]: Vec3, [x1, y1, z1]: Vec3): Part {
  const v = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
  const faces = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [3, 7, 6], [3, 6, 2], [0, 4, 7], [0, 7, 3], [1, 2, 6], [1, 6, 5]];
  return { node, triangles: new Float64Array(faces.flat().flatMap((i) => v[i])) };
}

/** A flat rectangle at height y: two triangles, zero thickness. */
const plane = (node: string, [x0, z0]: [number, number], [x1, z1]: [number, number], y: number): Part =>
  ({ node, triangles: new Float64Array([x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z0, x1, y, z1, x0, y, z1]) });

/** A 1.2 × 0.6 m table: a 4 cm top on four 5 cm legs, 75 cm tall, 60 triangles. */
const TABLE = [
  cuboid('top', [-0.6, 0.71, -0.3], [0.6, 0.75, 0.3]),
  ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz], i) =>
    cuboid(`leg${i}`, [sx * 0.55 - 0.025, 0, sz * 0.25 - 0.025], [sx * 0.55 + 0.025, 0.71, sz * 0.25 + 0.025])),
];

const overlaps = (a: CollisionBox, b: CollisionBox) => [0, 1, 2].every((i) => a.min[i] < b.max[i] && b.min[i] < a.max[i]);
/** Whether a box is inside the size box of an item, to within 1 mm. */
const inside = ({ min, max }: CollisionBox, [w, h, d]: Vec3) =>
  [-w / 2, 0, -d / 2].every((v, a) => min[a] >= v - 0.001) && [w / 2, h, d / 2].every((v, a) => max[a] <= v + 0.001);
const extent = ({ min, max }: { min: Vec3; max: Vec3 }) => [0, 1, 2].map((a) => max[a] - min[a]);

describe('fitParts', () => {
  it('fits a table, a top on four legs, to 5 boxes with the space under its top empty, low-poly as it is', () => {
    const fit = fitParts(TABLE);
    expect(fit.fallback).toBeUndefined();
    expect(fit.boxes).toHaveLength(5);
    expect(fit.coverage).toBe(1);
    // The knee space: under the top, between the legs.
    expect(fit.boxes.some((box) => overlaps(box, { min: [-0.5, 0.02, -0.2], max: [0.5, 0.69, 0.2] }))).toBe(false);
    // Tight to the geometry: the top's box is the top, reaching at most 1 cm down the legs, and each leg's box its leg.
    const [top] = placeInSize(fit.boxes.filter(({ min }) => min[1] > 0.6), [1.2, 0.75, 0.6]);
    expect(top.max).toEqual([0.6, 0.75, 0.3]);
    expect(top.min[1]).toBeGreaterThanOrEqual(0.7);
    for (const leg of TABLE.slice(1)) {
      const { min, max } = boundsOf([leg]);
      // Up to where the top's box starts.
      expect(fit.boxes.some((box) => box.min.every((v, a) => Math.abs(v - min[a]) < 0.001)
        && Math.abs(box.max[0] - max[0]) < 0.001 && box.max[1] >= top.min[1])).toBe(true);
    }
  });

  it('fills a hollow pedestal solid', () => {
    // A drawer pedestal's shell: six faces, nothing inside.
    const fit = fitParts([cuboid('pedestal', [-0.2, 0, -0.25], [0.2, 0.7, 0.25])]);
    expect(fit.fallback).toBeUndefined();
    expect(fit.boxes).toHaveLength(1);
    expect(fit.fill).toBeCloseTo(1, 3);
  });

  it('keeps a desk with a solid pedestal and a modesty panel out of the knee space', () => {
    const fit = fitParts([
      cuboid('top', [-0.6, 0.72, -0.3], [0.6, 0.75, 0.3]),
      cuboid('pedestal', [0.2, 0, -0.3], [0.6, 0.72, 0.3]),
      cuboid('side', [-0.6, 0, -0.3], [-0.58, 0.72, 0.3]),
      cuboid('modesty', [-0.58, 0.3, -0.3], [0.2, 0.72, -0.28]),
    ]);
    expect(fit.fallback).toBeUndefined();
    expect(fit.coverage).toBeGreaterThan(0.99);
    expect(fit.boxes.some((box) => overlaps(box, { min: [-0.55, 0.02, -0.25], max: [0.17, 0.69, 0.3] }))).toBe(false);
  });

  it('is deterministic', () => {
    expect(fitParts(TABLE)).toEqual(fitParts(TABLE));
  });
});

describe('furniture', () => {
  const chair = [cuboid('seat', [-0.25, 0.4, -0.25], [0.25, 0.45, 0.25]), cuboid('legs', [-0.25, 0, -0.25], [-0.2, 0.4, -0.2])];

  it('drops a Master Copy\'s shadow node', () => {
    const { kept, dropped } = furniture([...chair, plane('shadow', [-0.5, -0.5], [0.5, 0.5], 0.002)]);
    expect(kept).toEqual(chair);
    expect(dropped).toEqual(['shadow']);
  });

  it('drops a zero-thickness plane at floor level that is bigger than the rest, whatever its name', () => {
    const { kept, dropped } = furniture([...chair, plane('ground', [-0.5, -0.5], [0.5, 0.5], 0)]);
    expect(kept).toEqual(chair);
    expect(dropped).toEqual(['ground']);
  });

  it('keeps a plane that is the whole model, a plane above the floor, and one smaller than the rest', () => {
    const rug = [plane('rug', [-1, -1.5], [1, 1.5], 0)];
    expect(furniture(rug).kept).toEqual(rug);
    const canvas = [...chair, plane('Plane.003', [-0.5, -0.5], [0.5, 0.5], 0.3)];
    expect(furniture(canvas).kept).toEqual(canvas);
    const mat = [...chair, plane('Plane.004', [-0.2, -0.2], [0.2, 0.2], 0)];
    expect(furniture(mat).kept).toEqual(mat);
  });

  it('keeps a part however few triangles it has', () => {
    const throwBlanket = { node: 'throw', triangles: new Float64Array([-0.3, 0.45, 0, 0.3, 0.45, 0, 0, 0.5, 0.2]) };
    expect(furniture([...chair, throwBlanket]).kept).toContain(throwBlanket);
  });
});

/** The test cases of #129: models that look as if they had stray geometry. */
describe('the test cases', () => {
  const catalog: Catalog = JSON.parse(readFileSync('data/catalog/catalog.json', 'utf8'));
  const sizeOf = (id: string) => catalog.items.find((item) => item.id === id)!.size;
  const near = (fit: Fit, size: Vec3) => extent(fit.bounds).every((e, a) => Math.abs(e - size[a]) <= 0.02);

  for (const scan of ['lounge', 'fixture-models']) {
    const setup: RoomSetup = JSON.parse(readFileSync(`data/scans/${scan}/setup.json`, 'utf8'));
    for (const model of ['models/chair.glb', 'models/table.glb']) {
      it(`drops the shadow plane of ${scan}'s ${model}, so its boxes are inside the Original's box.size`, async () => {
        const fit = await fitModel(`data/scans/${scan}/${model}`);
        expect(fit.dropped).toEqual(['shadow']);
        const original = setup.originals.find((o) => o.model === model)!;
        const { collision } = decide(original.id, fit, original.box.size, undefined, true);
        expect(collision?.length).toBeGreaterThan(0);
        for (const box of collision!) expect(inside(box, original.box.size)).toBe(true);
        // Without the shadow, the model is about the Original's size, not the shadow's 1 m or 2 m.
        expect(extent(fit.bounds)[0]).toBeLessThan(original.box.size[0] + 0.02);
      });
    }
  }

  const keep: [string, string][] = [
    ['ph-gilt-landscape', 'nodes named Plane.0xx: a canvas'],
    ['ph-anthurium', 'nodes named Plane.0xx: leaves'],
    ['ph-chesterfield', 'nodes named Plane.0xx: cushions'],
    ['B073WQ8JLT', 'a made-up bed whose mattress, duvet and throw are under 1 % of its triangles'],
    ['B07SQWPC7Z', 'a loft bed\'s splayed legs at floor level'],
    ['B0742D9X4R', 'a tripod lamp\'s splayed legs'],
    ['B07L6LL293', 'a saddle stool\'s splayed legs'],
    ['ph-fern-red', 'a potted plant\'s leaf tips'],
    ['ph-money-tree-tall', 'a potted plant\'s leaf tips'],
  ];
  for (const [id, what] of keep) {
    it(`keeps every part of ${id}: ${what}`, async () => {
      const fit = await fitModel(`data/catalog/models/${id}.glb`);
      expect(fit.dropped).toEqual([]);
      expect(near(fit, sizeOf(id))).toBe(true);
    });
  }
});

describe('decide', () => {
  const fit = fitParts(TABLE);
  const size: Vec3 = [1.2, 0.75, 0.6];

  it('never changes size on its own', () => {
    expect(decide('desk', fit, size).size).toBe(size);
    expect(decide('desk', fitParts([cuboid('x', [-0.6, 0, -0.3], [0.6, 0.75, 0.33])]), size).size).toBe(size);
  });

  it('flags cleaned bounds over 2 cm off size, and boxes that fill under 30 % of it', () => {
    expect(decide('desk', fit, [1.25, 0.75, 0.6]).flags[0]).toMatch(/^bounds/);
    expect(decide('desk', fit, size).flags).toEqual(['boxes fill 8% of size']);
  });

  it('lets an override beat the fitter: boxes, "solid", or a corrected size', () => {
    const boxes: CollisionBox[] = [{ min: [-0.6, 0, -0.3], max: [0.6, 0.75, 0.3] }];
    expect(decide('desk', fit, size, boxes)).toMatchObject({ collision: boxes, result: 'override' });
    expect(decide('desk', fit, size, 'solid')).toMatchObject({ result: 'override' });
    expect(decide('desk', fit, size, 'solid').collision).toBeUndefined();
    expect(decide('desk', fit, size, { size: [1.2, 0.74, 0.6] })).toMatchObject({ size: [1.2, 0.74, 0.6], result: 'fitted' });
  });

  it('is one solid box when the fitter falls back', () => {
    const fallback = { ...fit, boxes: [], fallback: '12 boxes cover only 80%' };
    expect(decide('plant', fallback, size).result).toBe('solid fallback');
    expect(decide('plant', fallback, size).collision).toBeUndefined();
  });

  it('scales a Master Copy\'s boxes to its Original\'s box.size, and keeps every box inside it', () => {
    const { collision } = decide('og_table', fit, [1.32, 0.75, 0.6], undefined, true);
    expect(Math.max(...collision!.map(({ max }) => max[0]))).toBe(0.66);
  });
});

describe('placeInSize', () => {
  it('rounds to the millimeter and clamps into the size box', () => {
    expect(placeInSize([{ min: [-0.70004, -0.001, -0.3], max: [0.12345, 0.8, 0.3] }], [1.2, 0.75, 0.6]))
      .toEqual([{ min: [-0.6, 0, -0.3], max: [0.123, 0.75, 0.3] }]);
  });
});

describe('the JSON', () => {
  it('puts collision after the field given, one box per line', () => {
    const plain: { id: string; size: Vec3; collision?: CollisionBox[]; model: string } = { id: 'x', size: [1, 1, 1], model: 'm' };
    const item = withCollision(plain, [{ min: [0, 0, 0], max: [1, 1, 1] }], 'size');
    expect(Object.keys(item)).toEqual(['id', 'size', 'collision', 'model']);
    expect(toJson({ collision: item.collision })).toBe('{\n  "collision": [\n    { "min": [0, 0, 0], "max": [1, 1, 1] }\n  ]\n}\n');
    expect(Object.keys(withCollision(item, undefined, 'size'))).toEqual(['id', 'size', 'model']);
  });
});
