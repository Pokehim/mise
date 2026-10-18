import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { collisionBoxes, sizeBox } from './collision';
import type { Catalog, CollisionBox, RoomSetup, Vec3 } from './types';

/** Whether a box is inside the size box of an item, to within 1 mm, and not inside out. */
const inside = ({ min, max }: CollisionBox, size: Vec3) => {
  const outer = sizeBox(size);
  return [0, 1, 2].every((a) => min[a] >= outer.min[a] - 0.001 && max[a] <= outer.max[a] + 0.001 && min[a] < max[a]);
};
const toMillimeter = (v: number) => Math.abs(v * 1000 - Math.round(v * 1000)) < 1e-6;

describe('collisionBoxes', () => {
  it('is one solid box of the item\'s size when it has no collision boxes', () => {
    expect(collisionBoxes({ size: [1.2, 0.75, 0.6] })).toEqual([{ min: [-0.6, 0, -0.3], max: [0.6, 0.75, 0.3] }]);
    expect(collisionBoxes({ size: [1.2, 0.75, 0.6], collision: [] })).toEqual([sizeBox([1.2, 0.75, 0.6])]);
  });

  it('is an Original\'s box.size when it has none', () => {
    expect(collisionBoxes({ box: { position: [3, 0, 1], size: [0.5, 0.9, 0.5], rotationY: 1 } }))
      .toEqual([{ min: [-0.25, 0, -0.25], max: [0.25, 0.9, 0.25] }]);
  });

  it('is the item\'s own boxes when it has them', () => {
    const collision: CollisionBox[] = [{ min: [-0.6, 0.71, -0.3], max: [0.6, 0.75, 0.3] }];
    expect(collisionBoxes({ size: [1.2, 0.75, 0.6], collision })).toBe(collision);
  });
});

describe('every collision box', () => {
  const catalog: Catalog = JSON.parse(readFileSync('data/catalog/catalog.json', 'utf8'));

  it('of the Catalog is inside its item\'s size, at most 12 to an item, to the millimeter', () => {
    const outside = catalog.items.flatMap((item) => (item.collision ?? [])
      .filter((box) => !inside(box, item.size) || ![...box.min, ...box.max].every(toMillimeter))
      .map((box) => `${item.id} ${JSON.stringify(box)}`));
    expect(outside).toEqual([]);
    expect(catalog.items.filter((item) => (item.collision?.length ?? 0) > 12).map(({ id }) => id)).toEqual([]);
  });

  it('of the Catalog leaves at most 5 % of the items one solid box', () => {
    expect(catalog.items.filter((item) => !item.collision).length).toBeLessThanOrEqual(catalog.items.length * 0.05);
  });

  for (const scan of ['lounge', 'fixture-models']) {
    it(`of ${scan}'s Master Copy Originals is inside its box.size`, () => {
      const setup: RoomSetup = JSON.parse(readFileSync(`data/scans/${scan}/setup.json`, 'utf8'));
      const withModel = setup.originals.filter((original) => original.model);
      expect(withModel.length).toBeGreaterThan(0);
      for (const original of withModel) {
        expect(original.collision?.length, original.id).toBeGreaterThan(0);
        for (const box of original.collision!) expect(inside(box, original.box.size), `${original.id} ${JSON.stringify(box)}`).toBe(true);
      }
    });
  }
});
