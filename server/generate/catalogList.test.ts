import { describe, expect, it } from 'vitest';
import { item } from '../../shared/test-room';
import type { Catalog, CatalogItem } from '../../shared/types';
import catalogJson from '../../data/catalog/catalog.json';
import { catalogList, SHORTLIST } from './catalogList';

const rug = (id: string, color: string, price: number) => item(id, 'rug', `${color} Rug`, [1.5, 0.01, 2], { colors: [color], priceEstimateUsd: price });
const lines = (text: string, category: string) => {
  const section = text.split('\n\n').find((part) => part.startsWith(`${category}:`)) ?? '';
  return section.split('\n').slice(1);
};

describe('catalogList', () => {
  it('lists each decorating category on its own lines: id, title, size, color and estimated price', () => {
    const catalog: Catalog = { version: 1, items: [rug('rug-navy', 'Navy', 80)] };

    expect(lines(catalogList(catalog), 'rug')).toEqual(['- rug-navy | Navy Rug | 1.5×0.01×2 m | Navy | $80']);
  });

  it('shows at most so many of a category, spread over its colors and cheapest first within each', () => {
    const rugs = ['Navy', 'Beige', 'Navy', 'Gray', 'Beige', 'Navy', 'Gray', 'Navy', 'Green', 'Beige', 'Navy', 'Gray', 'Rust']
      .map((color, i) => rug(`rug-${i}`, color, 50 + i * 10));
    const listed = lines(catalogList({ version: 1, items: rugs }), 'rug');

    expect(listed).toHaveLength(SHORTLIST.rug!);
    // Every color is there before any color shows up a third time.
    const colors = listed.map((line) => line.split(' | ')[3]);
    expect(new Set(colors)).toEqual(new Set(['Navy', 'Beige', 'Gray', 'Green', 'Rust']));
    expect(listed[0]).toContain('rug-0 ');
  });

  it("says whether a lamp stands on the floor or on a table, and leaves out desk chairs and big tables", () => {
    const catalog: Catalog = {
      version: 1,
      items: [
        item('lamp-floor', 'lamp', 'Arc Floor Lamp', [0.4, 1.6, 0.4]),
        item('lamp-table', 'lamp', 'Ceramic Table Lamp', [0.3, 0.5, 0.3]),
        item('chair-office', 'chair', 'Ergonomic Office Desk Chair', [0.6, 1, 0.6]),
        item('chair-accent', 'chair', 'Velvet Accent Chair', [0.7, 0.8, 0.7]),
        item('table-dining', 'table', 'Oak Dining Table', [1.8, 0.75, 0.9]),
        item('table-side', 'table', 'Round Side Table', [0.45, 0.55, 0.45]),
      ],
    };
    const text = catalogList(catalog);

    expect(lines(text, 'lamp')).toEqual([
      expect.stringContaining('lamp-floor | Arc Floor Lamp (floor lamp)'), expect.stringContaining('lamp-table | Ceramic Table Lamp (table lamp)'),
    ]);
    expect(text).not.toContain('chair-office');
    expect(text).toContain('chair-accent');
    expect(text).not.toContain('table-dining');
    expect(text).toContain('table-side');
  });

  it('shortens long titles at a word', () => {
    const long = item('decor-long', 'decor', 'Rivet Modern Geometric Pattern Decorative Stoneware Vase, Large Centerpiece, 12.25"H, White', [0.17, 0.33, 0.17]);

    expect(lines(catalogList({ version: 1, items: [long] }), 'decor')[0]).toContain('| Rivet Modern Geometric Pattern Decorative… |');
  });

  it('keeps the whole Catalog to a few thousand characters, however large it grows', () => {
    const catalog = catalogJson as Catalog;
    const doubled: CatalogItem[] = [...catalog.items, ...catalog.items.map((each) => ({ ...each, id: `${each.id}-2` }))];

    expect(catalogList(catalog).length).toBeLessThan(9000);
    expect(catalogList({ version: 1, items: doubled }).length).toBeLessThan(9000);
  });
});
