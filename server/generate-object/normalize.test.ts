import { describe, expect, it } from 'vitest';
import { item } from '../../shared/test-room';
import type { Catalog } from '../../shared/types';
import { fitScale, targetBox } from './normalize';

describe('targetBox', () => {
  const catalog: Catalog = {
    version: 1,
    items: [
      item('a', 'chair', 'A', [0.5, 0.8, 0.7]), item('b', 'chair', 'B', [0.7, 1.0, 0.5]), item('c', 'chair', 'C', [0.6, 0.9, 0.6]),
      item('d', 'rug', 'D', [2, 0.01, 1.4]),
    ],
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
    expect(fitScale([2, 1, 1], [1, 1, 1], 'table')).toBe(0.5);
  });

  it('ignores the height of a rug, so a thick generated rug still gets the full footprint', () => {
    expect(fitScale([2, 0.05, 1.5], [1.6, 0.02, 1.2], 'rug')).toBeCloseTo(0.8);
  });

  it('ignores the depth of wall art, so a thick generated frame still gets the full face', () => {
    expect(fitScale([1, 0.8, 0.1], [0.5, 0.4, 0.02], 'wall_art')).toBeCloseTo(0.5);
  });

  it('fits a small item by every axis, however small', () => {
    expect(fitScale([0.1, 0.3, 0.1], [0.08, 0.08, 0.08], 'decor')).toBeCloseTo(0.8 / 3);
  });
});
