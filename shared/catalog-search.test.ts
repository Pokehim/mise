import { describe, expect, it } from 'vitest';
import { search, type SearchQuery } from './catalog-search';
import { catalog } from './test-room';
import type { Vec3 } from './types';

// The test Catalog, [w, h, d] in meters: chair-ergo [0.6, 0.95, 0.6], desk-walnut [0.76, 0.75, 0.5],
// rug-gray [1.52, 0.01, 2.13], lamp-brass [0.2, 0.45, 0.2].
const ids = (query: SearchQuery) => search(catalog, query).map((result) => result.item.id);

describe('search', () => {
  it('filters by category', () => {
    expect(ids({ category: 'desk' })).toEqual(['desk-walnut']);
    expect(ids({ category: 'sofa' })).toEqual([]);
  });

  it('matches text in the title or the style, ignoring case, word by word', () => {
    expect(ids({ text: 'WALNUT' })).toEqual(['desk-walnut']);
    expect(ids({ text: 'mid-century' })).toEqual(['desk-walnut']);
    expect(ids({ text: 'modern' })).toEqual(['chair-ergo', 'desk-walnut']);
    expect(ids({ text: 'brass lamp' })).toEqual(['lamp-brass']);
    expect(ids({ text: 'modern lamp' })).toEqual([]);
  });

  it('matches a color by name, word for word, or by its hex code, ignoring case', () => {
    expect(ids({ color: 'black' })).toEqual(['chair-ergo']);
    expect(ids({ color: 'Gray' })).toEqual(['rug-gray']);
    expect(ids({ color: 'light gray' })).toEqual(['rug-gray']);
    expect(ids({ color: 'ray' })).toEqual([]);
    expect(ids({ color: '#5C4033' })).toEqual(['desk-walnut']);
  });

  it('keeps items no wider and no deeper than maxSize; height does not count', () => {
    expect(ids({ maxSize: [1, 0.1, 1] })).toEqual(['chair-ergo', 'desk-walnut', 'lamp-brass']);
    expect(ids({ maxSize: [0.76, 2, 0.5] })).toEqual(['desk-walnut', 'lamp-brass']);
  });

  describe('size closeness, for Swap and Resize', () => {
    // score = max(|w−W|/W, |d−D|/D): the larger relative miss in width or depth.
    it('ranks the items closest first, labeling those within 15% "fits" and the rest "closest"', () => {
      const results = search(catalog, { targetSize: [0.7, 0.9, 0.55] });

      expect(results.map(({ item, label }) => [item.id, label])).toEqual([
        ['desk-walnut', 'fits'], ['chair-ergo', 'fits'], ['lamp-brass', 'closest'], ['rug-gray', 'closest'],
      ]);
      expect(results[0].score).toBeCloseTo(0.0909); // depth: |0.5 − 0.55| / 0.55
      expect(results[1].score).toBeCloseTo(0.1429); // width: |0.6 − 0.7| / 0.7
      expect(search(catalog, { targetSize: [0.65, 0.9, 0.55], limit: 2 }).map(({ item, label }) => [item.id, label]))
        .toEqual([['chair-ergo', 'fits'], ['desk-walnut', 'closest']]); // the desk is 17% too wide
    });

    // Resize shows up to 3 candidates (§10.5): 3 that fit or, failing that, the 3 closest.
    it('gives Resize the 3 closest items, labeled "closest", when none fits', () => {
      const results = search(catalog, { targetSize: [0.5, 0.5, 0.35], limit: 3 });

      expect(results.map(({ item, label }) => [item.id, label])).toEqual([
        ['desk-walnut', 'closest'], // 0.52
        ['lamp-brass', 'closest'], // 0.6
        ['chair-ergo', 'closest'], // 0.71; the rug, at 5.1, is the 4th
      ]);
      expect(results.map((result) => result.score)).toEqual([expect.closeTo(0.52), expect.closeTo(0.6), expect.closeTo(0.714, 3)]);
    });

    it('gives Swap every item of the category, closest first', () => {
      const chairs = [0.5, 0.9, 0.62, 0.2].map((width, i) => ({ ...catalog.items[0], id: `chair-${i}`, size: [width, 0.9, 0.6] as Vec3 }));

      expect(search({ ...catalog, items: chairs }, { category: 'chair', targetSize: [0.6, 0.9, 0.6] }).map(({ item }) => item.id))
        .toEqual(['chair-2', 'chair-0', 'chair-1', 'chair-3']);
    });

    it('counts the height too when lockHeight is on', () => {
      const lowChair: SearchQuery = { category: 'chair', targetSize: [0.6, 0.6, 0.6] };

      expect(search(catalog, lowChair)).toMatchObject([{ score: 0, label: 'fits' }]);
      expect(search(catalog, { ...lowChair, lockHeight: true })).toMatchObject([{ score: expect.closeTo(0.583), label: 'closest' }]);
    });

    it('returns nothing for a category without items, so the panel shows its empty state', () => {
      expect(search(catalog, { category: 'sofa', targetSize: [2, 0.8, 0.9] })).toEqual([]);
    });
  });

  it('returns at most `limit` results, 12 by default', () => {
    const chairs = { ...catalog, items: Array.from({ length: 15 }, (_, i) => ({ ...catalog.items[0], id: `chair-${i}` })) };

    expect(search(chairs, {})).toHaveLength(12);
    expect(ids({ limit: 2 })).toEqual(['chair-ergo', 'desk-walnut']);
    expect(ids({ targetSize: [0.5, 0.5, 0.35], limit: 2 })).toEqual(['desk-walnut', 'lamp-brass']);
  });
});
