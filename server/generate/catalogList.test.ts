import { describe, expect, it } from 'vitest';
import { item } from '../../shared/test-room';
import type { Catalog, CatalogItem } from '../../shared/types';
import catalogJson from '../../data/catalog/catalog.json';
import postersJson from '../../data/catalog/posters.json';
import { catalogList, SHORTLIST } from './catalogList';

const rug = (id: string, color: string, price: number) => item(id, 'rug', `${color} Rug`, [1.5, 0.01, 2], { colors: [color], priceEstimateUsd: price });
/** The lines of a section of the shortlist: its heading is the section's name, then a note in brackets or a colon. */
const lines = (text: string, category: string) => {
  const section = text.split('\n\n').find((part) => part.startsWith(`${category}:`) || part.startsWith(`${category} (`)) ?? '';
  return section.split('\n').slice(1);
};

describe('catalogList', () => {
  it('lists each decorating category on its own lines: id, title, size, color and estimated price', () => {
    const catalog: Catalog = { version: 1, items: [rug('rug-navy', 'Navy', 80)] };

    expect(lines(catalogList(catalog), 'rug')).toEqual(['- rug-navy | Navy Rug | 1.5×0.01×2 m | Navy | $80']);
  });

  it('shows at most so many of a category, spread over its colors and cheapest first within each', () => {
    const rugs = ['Navy', 'Beige', 'Navy', 'Gray', 'Beige', 'Navy', 'Gray', 'Navy', 'Green', 'Beige', 'Navy', 'Gray', 'Rust', 'Navy', 'Beige', 'Gray', 'Navy', 'Beige', 'Navy', 'Gray']
      .map((color, i) => rug(`rug-${i}`, color, 50 + i * 10));
    const listed = lines(catalogList({ version: 1, items: rugs }), 'rug');

    expect(listed).toHaveLength(SHORTLIST.rug!);
    // Every color is there before any color shows up a third time.
    const colors = listed.map((line) => line.split(' | ')[3]);
    expect(new Set(colors)).toEqual(new Set(['Navy', 'Beige', 'Gray', 'Green', 'Rust']));
    expect(listed[0]).toContain('rug-0 ');
  });

  it("says whether a lamp stands on the floor or on a table, lists desk chairs apart, and leaves out big tables", () => {
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
    expect(lines(text, 'chair')).toEqual([expect.stringContaining('chair-accent')]);
    expect(lines(text, 'desk_chair')).toEqual([expect.stringContaining('chair-office')]);
    expect(text).not.toContain('table-dining');
    expect(text).toContain('table-side');
  });

  it('lists a few of each kind of furniture, to furnish an empty room with in one reply', () => {
    const furniture: Catalog = {
      version: 1,
      items: [
        item('bed-twin', 'bed', 'Twin XL Platform Bed', [0.99, 0.4, 2.03]),
        item('desk-oak', 'desk', 'Oak Writing Desk', [1.07, 0.76, 0.6]),
        item('dresser-oak', 'dresser', 'Oak Dresser', [0.8, 0.8, 0.45]),
        item('wardrobe-white', 'wardrobe', 'White Wardrobe', [1, 1.8, 0.58]),
        item('bookcase-tall', 'shelf', 'Tall Bookcase', [0.66, 1.89, 0.38]),
        item('sofa-gray', 'sofa', 'Gray Loveseat', [1.4, 0.85, 0.85]),
      ],
    };
    const text = catalogList(furniture);

    for (const [category, id] of [['bed', 'bed-twin'], ['desk', 'desk-oak'], ['dresser', 'dresser-oak'], ['wardrobe', 'wardrobe-white'], ['shelf', 'bookcase-tall'], ['sofa', 'sofa-gray']]) {
      expect(lines(text, category)).toEqual([expect.stringContaining(id)]);
    }
  });

  it('lists posters by collection, saying what each holds, and clocks and boards apart, as not art', () => {
    const poster = (id: string, title: string, collection: string) =>
      item(id, 'wall_art', title, [0.46, 0.61, 0.003], { mount: 'wall', styleTags: ['poster', collection], priceEstimateUsd: 25 });
    const catalog: Catalog = {
      version: 1,
      items: [
        poster('poster-great-wave', 'The Great Wave', 'museum'),
        poster('poster-red-fuji', 'Red Fuji', 'parks & travel'),
        poster('poster-visit-mars', 'Visit Historic Mars', 'space'),
        item('art-mountain', 'wall_art', 'Abstract Mountain Landscape Wall Art on Canvas', [1.22, 0.91, 0.04], { mount: 'wall' }),
        item('clock-wall', 'wall_art', 'Round Vintage Decorative Wall Clock', [0.6, 0.6, 0.03], { mount: 'wall' }),
      ],
    };
    const text = catalogList(catalog);
    const heading = (start: string) => text.split('\n\n').find((part) => part.startsWith(start))?.split('\n')[0];

    expect(heading('wall_art, museum')).toMatch(/^wall_art, museum \(famous paintings and Japanese woodblock prints.*\):$/);
    expect(lines(text, 'wall_art, museum')).toEqual([expect.stringContaining('poster-great-wave | The Great Wave')]);
    expect(lines(text, 'wall_art, parks & travel')).toEqual([expect.stringContaining('poster-red-fuji')]);
    expect(lines(text, 'wall_art, space')).toEqual([expect.stringContaining('poster-visit-mars')]);
    expect(lines(text, 'wall_art')).toEqual([expect.stringContaining('art-mountain')]);
    expect(heading('not_art')).toMatch(/never in a gallery/);
    expect(lines(text, 'not_art')).toEqual([expect.stringContaining('clock-wall')]);
  });

  it("never lists the Catalog's placeholder boxes", () => {
    const placeholder = item('placeholder-rug', 'rug', 'Placeholder Rug', [1.5, 0.01, 2]);

    expect(catalogList({ version: 1, items: [placeholder, rug('rug-navy', 'Navy', 80)] })).not.toContain('placeholder-rug');
  });

  it('shortens long titles at a word', () => {
    const long = item('decor-long', 'decor', 'Rivet Modern Geometric Pattern Decorative Stoneware Vase, Large Centerpiece, 12.25"H, White', [0.17, 0.33, 0.17]);

    expect(lines(catalogList({ version: 1, items: [long] }), 'decor')[0]).toContain('| Rivet Modern Geometric Pattern Decorative… |');
  });

  it('keeps the whole Catalog, posters too, to a few thousand tokens, however large it grows', () => {
    const catalog: Catalog = { version: 1, items: [...(catalogJson as Catalog).items, ...(postersJson as Catalog).items] };
    const doubled: CatalogItem[] = [...catalog.items, ...catalog.items.map((each) => ({ ...each, id: `${each.id}-2` }))];

    expect(catalogList(catalog).length).toBeLessThan(18000);
    expect(catalogList({ version: 1, items: doubled }).length).toBeLessThan(18000);
  });
});
