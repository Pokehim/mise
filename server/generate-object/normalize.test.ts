import { describe, expect, it } from 'vitest';
import type { Catalog, CatalogItem, Category, Vec3 } from '../../shared/types';
import { fitScale, targetBox } from './normalize';

const item = (category: Category, size: Vec3) => ({ category, size }) as CatalogItem;

describe('targetBox', () => {
  const catalog: Catalog = {
    version: 1,
    items: [item('chair', [0.5, 0.8, 0.7]), item('chair', [0.7, 1.0, 0.5]), item('chair', [0.6, 0.9, 0.6]), item('rug', [2, 0.01, 1.4])],
  };

  it("is the category's typical size: the median of its Catalog items on each axis", () => {
    expect(targetBox(catalog, 'chair')).toEqual([0.6, 0.9, 0.6]);
  });

  it('is a 50 cm cube for a category the Catalog has no items in', () => {
    expect(targetBox(catalog, 'wardrobe')).toEqual([0.5, 0.5, 0.5]);
  });
});

describe('fitScale', () => {
  it('shrinks a model to fit inside the box, by its tightest axis', () => {
    expect(fitScale([2, 1, 1], [1, 1, 1])).toBe(0.5);
  });

  it('ignores the thin axis of a rug, so a thick generated rug still gets the full footprint', () => {
    expect(fitScale([2, 0.05, 1.5], [1.6, 0.02, 1.2])).toBeCloseTo(0.8);
  });
});
