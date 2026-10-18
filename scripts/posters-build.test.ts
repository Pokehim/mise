import { readFileSync } from 'node:fs';
import { getBounds } from '@gltf-transform/functions';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  COLLECTIONS, colorName, credits, pixelText, posterColors, posterDocument, posterSize, type PosterSpec, printPixels,
  textSvg, toCatalogItem, withoutColor,
} from './posters-build';

const GREAT_WAVE: PosterSpec = {
  id: 'poster-great-wave',
  title: 'The Great Wave',
  collection: 'museum',
  size: '18x24',
  frame: 'black',
  source: {
    kind: 'publicdomain',
    image: 'https://example.org/wave.jpg',
    page: 'https://www.metmuseum.org/art/collection/search/45434',
    institution: 'The Metropolitan Museum of Art',
    work: 'Katsushika Hokusai, Under the Wave off Kanagawa, ca. 1830–32',
    why: 'Made before 1929; The Met designates it Open Access (CC0).',
  },
  text: { kind: 'museum', artist: 'Hokusai', work: 'Under the Wave off Kanagawa', date: 'c. 1831', paper: '#f4efe6', ink: '#1d2433' },
};

const MOTH: PosterSpec = {
  id: 'poster-moth-and-kettle',
  title: 'Moth & Kettle, Live',
  collection: 'gig posters',
  size: '11x17',
  landscape: true,
  frame: 'none',
  source: { kind: 'generated', prompt: 'A moth around a lamp, screen print.' },
  text: { kind: 'gig', band: 'Moth & Kettle', venue: 'The <Copper> Hall', date: 'Sat Nov 5', ink: '#1d1a17', shadow: '#e0702b', at: 'bottom' },
};

describe('sizes', () => {
  it('makes an unframed print a 3 mm slab at its real size, and turns it for a landscape', () => {
    expect(posterSize({ size: '18x24', frame: 'none' })).toEqual([0.457, 0.61, 0.003]);
    expect(posterSize({ size: '24x36', landscape: true, frame: 'none' })).toEqual([0.914, 0.61, 0.003]);
  });

  it('adds a 2 cm moulding around a framed print', () => {
    expect(posterSize({ size: '11x17', frame: 'oak' })).toEqual([0.319, 0.472, 0.025]);
  });

  it('makes every poster image 2048 px on its long side, at its aspect ratio', () => {
    expect(printPixels({ size: '18x24' })).toEqual([1534, 2048]);
    expect(printPixels({ size: '24x36', landscape: true })).toEqual([2048, 1367]);
  });
});

describe('toCatalogItem', () => {
  it('makes a public-domain poster wall art that links to its source', () => {
    expect(toCatalogItem(GREAT_WAVE, { colors: ['Beige', 'Blue'], colorHex: '#e9e1d0' })).toEqual({
      id: 'poster-great-wave',
      source: 'publicdomain',
      title: 'The Great Wave',
      category: 'wall_art',
      mount: 'wall',
      size: [0.497, 0.65, 0.025],
      model: '/data/catalog/posters/poster-great-wave.glb',
      thumbnail: '/data/catalog/posters/poster-great-wave.jpg',
      colors: ['Beige', 'Blue'],
      colorHex: '#e9e1d0',
      materials: ['Paper', 'Metal'],
      styleTags: ['poster', 'museum', 'beige', 'blue'],
      priceEstimateUsd: 35,
      url: 'https://www.metmuseum.org/art/collection/search/45434',
      attribution: 'The Metropolitan Museum of Art. Public domain',
    });
  });

  it('credits FLUX for an original, which has no source page', () => {
    expect(toCatalogItem(MOTH, { colors: ['Beige'], colorHex: '#efe6d2' })).toMatchObject({
      source: 'generated', url: '', attribution: 'Generated with FLUX on fal', priceEstimateUsd: 15, materials: ['Paper'],
    });
  });
});

describe('colors', () => {
  it('names colors the way a shopper would', () => {
    expect([
      colorName(20, 40, 160), colorName(248, 248, 246), colorName(10, 10, 12), colorName(120, 70, 30),
      colorName(230, 120, 30), colorName(250, 160, 200), colorName(128, 128, 128),
    ]).toEqual(['Blue', 'White', 'Black', 'Brown', 'Orange', 'Pink', 'Gray']);
  });

  it("leaves a museum poster's paper out of its colors", () => {
    const pixels = new Uint8Array([244, 239, 230, 20, 40, 160, 246, 240, 229]);
    expect([...withoutColor(pixels, '#f4efe6')]).toEqual([20, 40, 160]);
  });

  it('keeps the colors that cover at least 12% of the image, the most first', () => {
    const pixels = [...Array(70).fill([20, 40, 160]), ...Array(25).fill([230, 120, 30]), ...Array(5).fill([10, 10, 10])];
    expect(posterColors(new Uint8Array(pixels.flat()))).toEqual({ colors: ['Blue', 'Orange'], colorHex: '#1428a0' });
  });
});

describe('text', () => {
  it('draws pixel text square by square, 6 cells a character', () => {
    const { svg, width } = pixelText('I', 0, 0, 10, '#fff');
    expect(width).toBe(50);
    expect(svg.match(/<rect /g)).toHaveLength(11);
    expect(() => pixelText('~', 0, 0, 10, '#fff')).toThrow('no "~"');
  });

  it('escapes names, so a "&" or "<" renders instead of breaking the SVG', async () => {
    const svg = await textSvg(MOTH.text!, ...printPixels(MOTH));
    expect(svg).toContain('MOTH &amp; KETTLE');
    expect(svg).toContain('THE &lt;COPPER&gt; HALL');
    await expect(sharp(Buffer.from(svg)).png().toBuffer()).resolves.toBeInstanceOf(Buffer);
  });
});

describe('posterDocument', () => {
  const image = () => sharp({ create: { width: 8, height: 8, channels: 3, background: '#888' } }).webp().toBuffer();

  it.each([['unframed', MOTH], ['framed', GREAT_WAVE]])('builds a(n) %s poster at its size, bottom-center, facing +Z', async (_, spec) => {
    const document = await posterDocument(spec, await image());
    const { min, max } = getBounds(document.getRoot().listScenes()[0]);
    const [w, h, d] = posterSize(spec);
    [[-w / 2, 0, -d / 2], [w / 2, h, d / 2]].forEach((expected, i) =>
      expected.forEach((value, axis) => expect([min, max][i][axis]).toBeCloseTo(value, 5)));
    const print = document.getRoot().listMaterials().find((material) => material.getName() === 'print')!;
    expect(print.getRoughnessFactor()).toBe(1);   // matte
    expect(print.getMetallicFactor()).toBe(0);
  });
});

describe('scripts/posters.json', () => {
  const specs: PosterSpec[] = JSON.parse(readFileSync(new URL('./posters.json', import.meta.url), 'utf8'));

  it('has about 40 posters, about 6 in each collection, each id once', () => {
    expect(specs.length).toBeGreaterThanOrEqual(38);
    expect(new Set(specs.map((spec) => spec.id)).size).toBe(specs.length);
    for (const collection of COLLECTIONS) expect(specs.filter((spec) => spec.collection === collection).length).toBeGreaterThanOrEqual(5);
  });

  it('frames about a third of them', () => {
    const framed = specs.filter((spec) => spec.frame !== 'none').length / specs.length;
    expect(framed).toBeGreaterThan(0.25);
    expect(framed).toBeLessThan(0.42);
  });

  it('gives every public-domain poster a source page and a reason, and lists each in CREDITS.md', () => {
    const md = credits(specs);
    for (const spec of specs.filter((s) => s.source.kind === 'publicdomain')) {
      const source = spec.source as Extract<PosterSpec['source'], { kind: 'publicdomain' }>;
      expect(source.page).toMatch(/^https:\/\//);
      expect(source.why.length).toBeGreaterThan(20);
      expect(md).toContain(source.page);
    }
  });

  it('only uses characters the pixel font has', () => {
    for (const { text } of specs) {
      if (text?.kind !== 'pixel') continue;
      expect(() => pixelText(`${text.title}${text.subtitle ?? ''}`, 0, 0, 1, '#fff')).not.toThrow();
    }
  });
});
