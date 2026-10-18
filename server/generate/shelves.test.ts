import { describe, expect, it } from 'vitest';
import type { Catalog } from '../../shared/types';
import catalogJson from '../../data/catalog/catalog.json';
import { shelfLevels } from './shelves';

const catalog = catalogJson as Catalog;
const only = (id: string): Catalog => ({ ...catalog, items: catalog.items.filter((item) => item.id === id) });

describe('shelfLevels', () => {
  it("finds a Catalog shelf's levels in its model: the upward faces that cover most of it, bottom to top", async () => {
    // Furniture 247's 4-cube unit, 0.79 m tall: a bottom board, a middle one and the top.
    const levels = await shelfLevels(only('B0754KHKCX'), './data');

    expect(levels.B0754KHKCX.map(({ height }) => height)).toEqual([expect.closeTo(0.04, 1), expect.closeTo(0.4, 1), expect.closeTo(0.79, 1)]);
    // The room above each level runs up to the underside of the board over it; the top has the whole room.
    const [bottom, middle, top] = levels.B0754KHKCX;
    expect(bottom.clearance).toBeGreaterThan(0.3);
    expect(bottom.clearance).toBeLessThan(0.36);
    expect(middle.clearance).toBeGreaterThan(0.3);
    expect(top.clearance).toBe(Infinity);
    expect(middle.size[0]).toBeGreaterThan(0.6);
  });

  it('reads only shelves, and skips a model it cannot read', async () => {
    const missing: Catalog = { version: 1, items: [{ ...catalog.items.find(({ category }) => category === 'shelf')!, id: 'shelf-gone', model: '/data/catalog/models/gone.glb' }] };

    expect(Object.keys(await shelfLevels(only('B07QGFS4JC'), './data'))).toEqual([]);
    expect(await shelfLevels(missing, './data')).toEqual({});
  });
});
