import { getBounds } from '@gltf-transform/functions';
import { describe, expect, it } from 'vitest';
import { rugBounds, rugDocument } from './flat-rug';

/** A white photo with a gray rug at the box, and black dimension lines beside it, as many ABO rug photos have. */
function photo(width: number, height: number, rug: { left: number; top: number; width: number; height: number }) {
  const gray = new Uint8Array(width * height).fill(255);
  for (let y = rug.top; y < rug.top + rug.height; y++) gray.fill(180, y * width + rug.left, y * width + rug.left + rug.width);
  // A vertical dimension line, as long as the rug, 10 px to its left; a horizontal one 10 px below it.
  for (let y = rug.top; y < rug.top + rug.height; y++) gray[y * width + rug.left - 10] = 0;
  gray.fill(0, (rug.top + rug.height + 10) * width + rug.left, (rug.top + rug.height + 10) * width + rug.left + rug.width);
  return gray;
}

describe('rugBounds', () => {
  it('finds the rug in a photo on a white backdrop, leaving out the dimension lines beside it', () => {
    const rug = { left: 30, top: 20, width: 60, height: 120 };
    expect(rugBounds(photo(120, 170, rug), 120, 170)).toEqual(rug);
  });

  it('fails on a photo with nothing but backdrop', () => {
    expect(() => rugBounds(new Uint8Array(100).fill(255), 10, 10)).toThrow(/no rug/);
  });
});

describe('rugDocument', () => {
  const doc = rugDocument(Buffer.from([]), [1.219, 1.829], 'B075LFMQM6');
  const primitive = doc.getRoot().listMeshes()[0].listPrimitives()[0];

  it('is a 1 cm slab at the listed size, its pivot at the bottom center', () => {
    const { min, max } = getBounds(doc.getRoot().listScenes()[0]);
    expect(min.map((v) => +v.toFixed(4))).toEqual([-0.6095, 0, -0.9145]);
    expect(max.map((v) => +v.toFixed(4))).toEqual([0.6095, 0.01, 0.9145]);
  });

  it('winds every face toward its normal, so the top faces up and the bevel faces out', () => {
    const position = primitive.getAttribute('POSITION')!;
    const normal = primitive.getAttribute('NORMAL')!;
    const indices = primitive.getIndices()!.getArray()!;
    const at = (i: number) => position.getElement(i, [0, 0, 0]);
    for (let t = 0; t < indices.length; t += 3) {
      const [a, b, c] = [at(indices[t]), at(indices[t + 1]), at(indices[t + 2])];
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const face = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const n = normal.getElement(indices[t], [0, 0, 0]);
      expect(face[0] * n[0] + face[1] * n[1] + face[2] * n[2]).toBeGreaterThan(0);
    }
  });

  it('maps the whole photo onto the top, its top edge at the back', () => {
    const position = primitive.getAttribute('POSITION')!;
    const uv = primitive.getAttribute('TEXCOORD_0')!;
    const corners = Array.from({ length: 4 }, (_, i) => ({ p: position.getElement(i, [0, 0, 0]), uv: uv.getElement(i, [0, 0]) }));
    const backLeft = corners.find(({ p }) => p[0] < 0 && p[2] < 0)!;
    const frontRight = corners.find(({ p }) => p[0] > 0 && p[2] > 0)!;
    expect(backLeft.uv[0]).toBeLessThan(0.01);
    expect(backLeft.uv[1]).toBeLessThan(0.01);
    expect(frontRight.uv[0]).toBeGreaterThan(0.99);
    expect(frontRight.uv[1]).toBeGreaterThan(0.99);
  });
});
