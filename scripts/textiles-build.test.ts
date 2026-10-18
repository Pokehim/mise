import { readFileSync } from 'node:fs';
import { getBounds } from '@gltf-transform/functions';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  credits, facePixels, outline, PATTERNS, type PatternSource, patternFace, patternShapes, random, SHAPES, shapedRugDocument, tapestryDocument,
  textileSize, type TextileSpec, toCatalogItem,
} from './textiles-build';

const CHECKER: TextileSpec = {
  id: 'rug-checker-test',
  title: 'Checkered Rug, Sage and Cream',
  use: 'rug',
  size: [150, 210],
  styleTags: ['Modern'],
  price: 120,
  source: { kind: 'pattern', pattern: 'checker', colors: ['#efe6d2', '#a3b48a'], count: 6 },
};
const TAPESTRY: TextileSpec = {
  id: 'tapestry-test',
  title: 'Test Tapestry',
  use: 'tapestry',
  size: [100, 140],
  styleTags: ['Japanese'],
  price: 60,
  source: {
    kind: 'publicdomain', image: 'https://example.org/a.jpg', page: 'https://example.org/a', institution: 'A Museum',
    work: 'A textile, 1900', why: 'Made in 1900 and released by the museum as CC0.',
  },
};

describe('textileSize', () => {
  it('lays a rug flat, 1 cm thick, its length running front to back', () => {
    expect(textileSize(CHECKER)).toEqual([1.5, 0.01, 2.1]);
  });

  it('hangs a tapestry from a rod that is a little wider than the cloth', () => {
    const [w, h, d] = textileSize(TAPESTRY);
    expect(w).toBeCloseTo(1.08);
    expect(h).toBeCloseTo(1.418);
    expect(d).toBeCloseTo(0.018);
  });
});

describe('facePixels', () => {
  it('draws the face 2048 px on its long side, at the textile\'s proportions', () => {
    expect(facePixels(CHECKER)).toEqual([1463, 2048]);
  });
});

describe('toCatalogItem', () => {
  it('files a rug under rug on the floor, and a tapestry under wall_art on the wall', () => {
    const rug = toCatalogItem(CHECKER, { colors: ['Green', 'Beige'], colorHex: '#a3b48a' });
    expect(rug).toMatchObject({ category: 'rug', mount: 'floor', source: 'generated', model: '/data/catalog/textiles/rug-checker-test.glb' });
    const tapestry = toCatalogItem(TAPESTRY, { colors: ['Blue'], colorHex: '#223366' });
    expect(tapestry).toMatchObject({ category: 'wall_art', mount: 'wall', source: 'publicdomain', url: 'https://example.org/a' });
    expect(tapestry.styleTags).toContain('tapestry');
  });
});

describe('patterns', () => {
  it('draws the same shapes from the same seed', () => {
    expect(random(4)()).toBe(random(4)());
    const daisies: PatternSource = { kind: 'pattern', pattern: 'daisies', colors: ['#fff', '#000', '#f00'], seed: 7 };
    expect(patternShapes(daisies, 300, 400)).toBe(patternShapes(daisies, 300, 400));
  });

  it('renders every pattern as an image of the face\'s size', async () => {
    for (const pattern of PATTERNS) {
      const face = await patternFace({ kind: 'pattern', pattern, colors: ['#f4eee4', '#c25f37', '#7c8656', '#f1cc6e'] }, [120, 180], { shape: 'daisy' });
      expect(await sharp(face).metadata()).toMatchObject({ width: 120, height: 180 });
    }
  });
});

/** Whether (x, z) is inside the polygon (even-odd). */
function inside(polygon: [number, number][], x: number, z: number): boolean {
  let result = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, zi] = polygon[i];
    const [xj, zj] = polygon[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) result = !result;
  }
  return result;
}

describe('shaped rugs', () => {
  const shaped = (shape: TextileSpec['shape'], pile?: TextileSpec['pile']): TextileSpec =>
    ({ ...CHECKER, id: `rug-${shape}`, size: [120, 90], shape, pile, source: { kind: 'pattern', pattern: 'solid', colors: ['#f0a6bb'] } });

  it('fills the rug\'s width × length with every outline', () => {
    for (const shape of SHAPES) {
      const points = outline(shaped(shape));
      const xs = points.map(([x]) => x);
      const zs = points.map(([, z]) => z);
      expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(1.2);
      expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(0.9);
    }
  });

  it('gives a shag rug a fuzzy edge, a few mm in or out', () => {
    const smooth = outline(shaped('round'));
    const fuzzy = outline(shaped('round', 'shag'));
    expect(fuzzy).not.toEqual(smooth);
    expect(Math.max(...fuzzy.map(([x]) => Math.abs(x)))).toBeLessThan(0.62);
  });

  it('builds a top that faces up and a rim that faces out, standing on the floor at its size', async () => {
    const face = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#f0a6bb' } }).jpeg().toBuffer();
    for (const shape of ['heart', 'mushroom', 'daisy'] as const) {
      const spec = shaped(shape, 'shag');
      const doc = shapedRugDocument(spec, face);
      const { min, max } = getBounds(doc.getRoot().listScenes()[0]);
      expect(min[1]).toBeCloseTo(0);
      expect(max[1]).toBeCloseTo(textileSize(spec)[1]);
      const primitive = doc.getRoot().listMeshes()[0].listPrimitives()[0];
      const position = primitive.getAttribute('POSITION')!;
      const normal = primitive.getAttribute('NORMAL')!;
      const indices = primitive.getIndices()!.getArray()!;
      for (let k = 0; k < indices.length; k += 3) {
        const [a, b, c] = [0, 1, 2].map((i) => position.getElement(indices[k + i], []));
        const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        const cross = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
        const n = normal.getElement(indices[k], []);
        expect(cross[0] * n[0] + cross[1] * n[1] + cross[2] * n[2]).toBeGreaterThanOrEqual(0);
        // A rim normal points out: a short step along it from the middle of the rim's floor edge leaves the outline.
        const onFloor = [a, b, c].filter((p) => Math.abs(p[1]) < 1e-6);
        if (n[1] < 0.99 && onFloor.length === 2) {
          const [mx, mz] = [0, 2].map((i) => onFloor.reduce((sum, p) => sum + p[i], 0) / onFloor.length + n[i] * 0.003);
          expect(inside(outline(spec), mx, mz)).toBe(false);
        }
      }
    }
  });
});

describe('tapestryDocument', () => {
  it('stands on its bottom-center, its face toward +Z, its size what the Catalog says', async () => {
    const face = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#335' } }).jpeg().toBuffer();
    const { min, max } = getBounds(tapestryDocument(TAPESTRY, face).getRoot().listScenes()[0]);
    const [w, h, d] = textileSize(TAPESTRY);
    expect(min[1]).toBeCloseTo(0);
    expect(max[0] - min[0]).toBeCloseTo(w);
    expect(max[1] - min[1]).toBeCloseTo(h);
    expect(max[2] - min[2]).toBeCloseTo(d);
    expect(min[0] + max[0]).toBeCloseTo(0);
  });
});

describe('scripts/textiles.json', () => {
  const specs: TextileSpec[] = JSON.parse(readFileSync(new URL('./textiles.json', import.meta.url), 'utf8'));

  it('names each textile once, by what it is', () => {
    expect(new Set(specs.map((spec) => spec.id)).size).toBe(specs.length);
    for (const spec of specs) expect(spec.id.startsWith(`${spec.use}-`)).toBe(true);
  });

  it('gives each a real size: rugs up to 3 m, tapestries up to 2 m', () => {
    for (const { use, size } of specs) {
      expect(Math.min(...size)).toBeGreaterThanOrEqual(40);
      expect(Math.max(...size)).toBeLessThanOrEqual(use === 'rug' ? 300 : 200);
    }
  });

  it('gives every museum textile a source page and a reason, and lists each in CREDITS.md', () => {
    const md = credits(specs);
    for (const spec of specs) {
      if (spec.source.kind !== 'publicdomain') continue;
      expect(spec.source.page).toMatch(/^https:\/\//);
      expect(spec.source.why.length).toBeGreaterThan(20);
      expect(md).toContain(spec.source.page);
    }
  });
});
