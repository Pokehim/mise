import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import type { LibraryMaterial } from '../shared/types';
import { MAX_TEXTURE_BYTES, MAX_TEXTURE_SIDE, PICKS, toLibraryMaterial } from './materials-build';

const DIR = fileURLToPath(new URL('../data/materials', import.meta.url));
const KINDS: LibraryMaterial['kind'][] = ['wood', 'stone', 'fabric', 'metal', 'carpet', 'wallpaper', 'tile'];
const library: LibraryMaterial[] = JSON.parse(readFileSync(join(DIR, 'materials.json'), 'utf8'));

describe('the picks', () => {
  it("are the issue's materials: four woods, marble, concrete, three fabrics, brushed metal, 3 carpets, 3 wallpapers, 2 tiles", () => {
    expect(PICKS.map(({ id }) => id).slice(0, 10)).toEqual(
      ['oak', 'walnut', 'maple', 'cherry', 'marble', 'concrete', 'linen', 'velvet', 'leather', 'brushed-metal']);
    const count = (kind: string) => PICKS.filter((pick) => pick.kind === kind).length;
    expect([count('carpet'), count('wallpaper'), count('tile')]).toEqual([3, 3, 2]);
  });

  it('are each pinned to a different asset, with a kind of the contract and a size', () => {
    expect(new Set(PICKS.map(({ id }) => id)).size).toBe(PICKS.length);
    expect(new Set(PICKS.map(({ site, asset }) => `${site}/${asset}`)).size).toBe(PICKS.length);
    for (const { kind, tileSize } of PICKS) {
      expect(KINDS).toContain(kind);
      expect(tileSize).toBeGreaterThan(0);
    }
  });
});

describe('toLibraryMaterial', () => {
  it('maps a pick to a LibraryMaterial whose source says where it is from and that it is CC0', () => {
    expect(toLibraryMaterial(PICKS[0])).toEqual({
      id: 'oak', name: 'Oak', kind: 'wood', maps: { color: '/data/materials/oak.jpg' }, tileSize: 1.83,
      source: 'Poly Haven oak_veneer_01 (CC0)',
    });
    expect(toLibraryMaterial(PICKS.find(({ id }) => id === 'carpet-grey')!).source).toBe('ambientCG Carpet001 (CC0)');
  });
});

describe('data/materials/materials.json', () => {
  it('is what the build writes for the picks', () => {
    expect(library).toEqual(PICKS.map(toLibraryMaterial));
  });

  it('has a CC0 source, a size and a color map for every material', () => {
    for (const material of library) {
      expect(material.source).toMatch(/^(Poly Haven|ambientCG) \S+ \(CC0\)$/);
      expect(material.tileSize).toBeGreaterThan(0);
      expect(material.maps.color).toBe(`/data/materials/${material.id}.jpg`);
    }
  });

  it('keeps every texture a small 1K JPEG, with a thumbnail, so the set is small enough to commit', async () => {
    let total = 0;
    for (const { id } of library) {
      const file = join(DIR, `${id}.jpg`);
      const { size } = statSync(file);
      total += size;
      expect(size, id).toBeLessThanOrEqual(MAX_TEXTURE_BYTES);
      const { format, width, height } = await sharp(file).metadata();
      expect(format, id).toBe('jpeg');
      expect(Math.max(width!, height!), id).toBeLessThanOrEqual(MAX_TEXTURE_SIDE);
      expect(statSync(join(DIR, 'thumbs', `${id}.jpg`)).size, id).toBeLessThan(20_000);
    }
    expect(total).toBeLessThan(15_000_000);
  });
});
