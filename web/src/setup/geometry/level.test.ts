import { Object3D, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { Vec3, YawTransform } from '@shared/types';
import { mergeMeshes } from './mesh';
import { detectCeilingHeight, detectFloorHeight, detectYaw, levelTransform } from './level';
import { box, degrees, horizontal, rotateY } from './testShapes';

// A 4 × 3 m room whose floor is at y = 0.8 in the capture's frame, as Polycam might export it.
const room = box([3, 0.8, 1], [7, 3.3, 4], true);

describe('detectFloorHeight', () => {
  it('finds the floor below a desk top', () => {
    const deskTop = horizontal([3.2, 1.2], [4.2, 1.8], 1.56);
    expect(detectFloorHeight(mergeMeshes([room, deskTop]))).toBeCloseTo(0.8, 2);
  });

  it('ignores a small patch of noise below the floor', () => {
    const noise = horizontal([5, 2], [5.1, 2.1], 0.5);
    expect(detectFloorHeight(mergeMeshes([room, noise]))).toBeCloseTo(0.8, 2);
  });

  it('is null for a mesh with nothing facing up', () => {
    expect(detectFloorHeight(horizontal([0, 0], [1, 1], 0, true))).toBeNull();
  });
});

describe('detectCeilingHeight', () => {
  it('finds the ceiling above the underside of a shelf', () => {
    const shelfUnderside = horizontal([3.2, 1.2], [4.2, 1.5], 2.1, true);
    expect(detectCeilingHeight(mergeMeshes([room, shelfUnderside]))).toBeCloseTo(3.3, 2);
  });
});

describe('detectYaw', () => {
  it('gives the rotation that lines the walls up with the X and Z axes', () => {
    // The capture's walls face 20° off the axes; rotating by −20° lines them up again.
    expect(detectYaw(rotateY(room, degrees(20)))).toBeCloseTo(degrees(-20), 3);
  });

  it('takes the smallest such rotation, since walls repeat every 90°', () => {
    expect(detectYaw(rotateY(room, degrees(70)))).toBeCloseTo(degrees(20), 3);
  });

  it('finds walls that are just off the axes on either side of 0°', () => {
    expect(detectYaw(rotateY(room, degrees(0.3)))).toBeCloseTo(degrees(-0.3), 3);
    expect(detectYaw(rotateY(room, degrees(-0.3)))).toBeCloseTo(degrees(0.3), 3);
  });

  it('follows the wall with the most area over a smaller one at another angle', () => {
    const angledCabinet = rotateY(box([0, 0, 0], [0.4, 0.5, 0.4]), degrees(30));
    expect(detectYaw(mergeMeshes([room, angledCabinet]))).toBeCloseTo(0, 3);
  });
});

/** A point moved by a meshTransform the way three.js moves an Object3D with that position and rotation. */
function applyTransform({ position, rotationY }: YawTransform, point: Vec3) {
  const object = new Object3D();
  object.position.set(...position);
  object.rotation.y = rotationY;
  object.updateMatrix();
  return new Vector3(...point).applyMatrix4(object.matrix).toArray().map((v) => Number(v.toFixed(6)) + 0);
}

describe('levelTransform', () => {
  it('lines the walls up with the axes, puts the floor at y = 0 and centers it on the origin', () => {
    const captured = rotateY(room, degrees(20));
    const transform = levelTransform(captured, 0.8, degrees(-20));
    const floorCorners = ([[3, 1], [7, 1], [7, 4], [3, 4]] as const).map(([x, z]) => {
      const [cx, , cz] = rotateY({ positions: new Float32Array([x, 0.8, z]), index: new Uint32Array() }, degrees(20)).positions;
      return applyTransform(transform, [cx, 0.8, cz]);
    });
    expect(floorCorners).toEqual([[-2, 0, -1.5], [2, 0, -1.5], [2, 0, 1.5], [-2, 0, 1.5]]);
  });
});
