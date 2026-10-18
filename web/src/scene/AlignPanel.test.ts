import { describe, expect, it } from 'vitest';
import { Object3D, Vector3 } from 'three';
import type { Vec3 } from '@shared/types';
import { applySplatTransform, fitPointPairs, type SplatTransform } from './AlignPanel';

// Four floor-level corners of a 4 × 3 m room, plus a point up a wall, in a splat's own frame.
const splat: Vec3[] = [[0, 0, 0], [4, 0, 0], [4, 0, 3], [0, 0, 3], [2, 1.2, 0]];
const known: SplatTransform = { position: [1.5, -0.2, -2], rotationY: 0.7, scale: 1.08 };

describe('fitPointPairs', () => {
  it('recovers the yaw, scale and translation that made the room points', () => {
    const room = splat.map((p) => applySplatTransform(known, p));
    const { transform, rms } = fitPointPairs(splat, room);

    expect(transform.rotationY).toBeCloseTo(known.rotationY);
    expect(transform.scale).toBeCloseTo(known.scale);
    transform.position.forEach((v, i) => expect(v).toBeCloseTo(known.position[i]));
    expect(rms).toBeCloseTo(0);
  });

  it('works from 3 floor corners, with a turn past 180°', () => {
    const turned: SplatTransform = { position: [-3, 0, 5], rotationY: -2.5, scale: 0.92 };
    const corners = splat.slice(0, 3);
    const { transform } = fitPointPairs(corners, corners.map((p) => applySplatTransform(turned, p)));

    expect(transform.rotationY).toBeCloseTo(turned.rotationY);
    expect(transform.scale).toBeCloseTo(turned.scale);
  });

  it('averages out click error, and reports it', () => {
    const jitter: Vec3[] = [[0.02, 0, -0.01], [-0.01, 0.01, 0.02], [0.01, -0.02, 0], [-0.02, 0, -0.01], [0, 0.01, 0.01]];
    const room = splat.map((p, i) => applySplatTransform(known, p).map((v, k) => v + jitter[i][k]) as Vec3);
    const { transform, rms } = fitPointPairs(splat, room);

    expect(Math.abs(transform.rotationY - known.rotationY)).toBeLessThan(0.01);
    expect(Math.abs(transform.scale - known.scale)).toBeLessThan(0.01);
    expect(rms).toBeGreaterThan(0.005);
    expect(rms).toBeLessThan(0.03);
  });

  it('matches how an Object3D places the SplatMesh', () => {
    const object = new Object3D();
    object.position.set(...known.position);
    object.rotation.y = known.rotationY;
    object.scale.setScalar(known.scale);
    object.updateMatrixWorld();

    const [x, y, z] = applySplatTransform(known, [1, 2, 3]);
    const expected = new Vector3(1, 2, 3).applyMatrix4(object.matrixWorld);
    expect(x).toBeCloseTo(expected.x);
    expect(y).toBeCloseTo(expected.y);
    expect(z).toBeCloseTo(expected.z);
  });

  it('refuses mismatched, too few, or coincident points', () => {
    expect(() => fitPointPairs(splat, splat.slice(1))).toThrow();
    expect(() => fitPointPairs([[0, 0, 0]], [[1, 0, 1]])).toThrow();
    expect(() => fitPointPairs([[1, 0, 1], [1, 0, 1]], [[0, 0, 0], [1, 0, 0]])).toThrow();
  });
});
