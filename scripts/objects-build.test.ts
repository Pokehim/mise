import { getBounds } from '@gltf-transform/functions';
import { describe, expect, it } from 'vitest';
import { OBJECTS, toCatalogItem } from './objects-build';

describe('OBJECTS', () => {
  it('names each object once', () => {
    expect(new Set(OBJECTS.map(({ id }) => id)).size).toBe(OBJECTS.length);
    for (const { id } of OBJECTS) expect(id).toMatch(/^obj-[a-z0-9-]+$/);
  });

  it('builds each one standing on its bottom center at a real size, a wall piece with its back on the wall', async () => {
    for (const spec of OBJECTS) {
      const { min, max } = getBounds((await spec.build()).getRoot().listScenes()[0]);
      const size = max.map((side, i) => side - min[i]);
      if (spec.mount === 'wall') expect(min[2]).toBeCloseTo(0, 2);
      expect(min[1]).toBeCloseTo(0, 2);
      expect(Math.abs(min[0] + max[0])).toBeLessThan(0.02);
      expect(Math.max(...size)).toBeLessThan(1.5);   // a 55" TV is 1.23 m wide
      expect(Math.min(...size)).toBeGreaterThan(0.005);
    }
  });

  it('files each one where Designs look for it', () => {
    const item = toCatalogItem(OBJECTS[0], [0.44, 0.12, 0.35]);
    expect(item).toMatchObject({ source: 'generated', model: '/data/catalog/objects/obj-turntable-walnut.glb', category: 'decor' });
  });
});
