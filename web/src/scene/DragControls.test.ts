import { describe, expect, it } from 'vitest';
import { MathUtils, Ray, Vector3 } from 'three';
import { setup } from '@shared/test-room';
import type { Placement, Vec3 } from '@shared/types';
import { wallDrag } from './DragControls';

/** A whiteboard 3.5 m wide: it fits on the 4 m North and South walls, not the 3 m East and West ones. */
const BOARD = { category: 'decor' as const, size: [3.5, 1.2, 0.05] as Vec3, mount: 'wall' as const };
/** A poster small enough for any wall. */
const POSTER = { category: 'decor' as const, size: [0.6, 0.9, 0.02] as Vec3, mount: 'wall' as const };

/** Hung on the North wall (z = −1.5), centered at x, with its bottom at y, facing south. */
const onNorthWall = (x: number, y: number, depth: number): Placement =>
  ({ position: [x, y, -1.5 + depth / 2], rotationY: 0, mount: 'wall', wallId: 'wl_north' });

/** The pointer's ray from an eye through a point in the room. */
const through = (eye: Vec3, [x, y, z]: Vec3) => {
  const origin = new Vector3(...eye);
  return new Ray(origin, new Vector3(x, y, z).sub(origin).normalize());
};

/** Where a placement stands, to the millimeter, and on which wall. */
const rounded = (placement: Placement) => ({
  at: placement.position.map((n) => Math.round(n * 1000) / 1000 + 0),
  wallId: placement.wallId,
});

/** Standing in the south of the room, eyes at 1.5 m, facing the North wall. */
const EYE: Vec3 = [0, 1.5, 1.2];

describe('wallDrag', () => {
  it('keeps the grabbed point under the pointer, rather than centering the item on it', () => {
    // The board's center is at x 0, y 1.6; it is grabbed near its east end, 30 cm above the center.
    const move = wallDrag(through(EYE, [1.2, 1.9, -1.5]), onNorthWall(0, 1, 0.05), BOARD, setup);
    // The pointer moves 10 cm east and 10 cm up: the board moves just as far.
    expect(rounded(move(through(EYE, [1.3, 2.0, -1.5])))).toEqual({ at: [0.1, 1.1, -1.475], wallId: 'wl_north' });
  });

  it('moves a small item onto another wall when the pointer is clearly over it', () => {
    const move = wallDrag(through(EYE, [0, 1.5, -1.5]), onNorthWall(0, 1.05, 0.02), POSTER, setup);
    // Over the East wall (x = 2), 1 m in from its north end: the poster is hung there, facing west.
    expect(rounded(move(through(EYE, [2, 1.5, -0.5])))).toEqual({ at: [1.99, 1.05, -0.5], wallId: 'wl_east' });
  });

  it('keeps a small item on its own wall while the pointer is only just past the corner', () => {
    const move = wallDrag(through(EYE, [1.5, 1.5, -1.5]), onNorthWall(1.5, 1.05, 0.02), POSTER, setup);
    // Over the East wall, 5 cm from the corner.
    expect(move(through(EYE, [2, 1.5, -1.45])).wallId).toBe('wl_north');
  });

  it('keeps an item on its own wall when the pointer crosses a wall shorter than it', () => {
    const move = wallDrag(through(EYE, [0, 1.6, -1.5]), onNorthWall(0, 1, 0.05), BOARD, setup);
    // Over the 3 m East wall, which the 3.5 m board doesn't fit: it stays on the North wall, as far
    // east as it goes there, whole on that wall.
    const { at: [x, , z], wallId } = rounded(move(through(EYE, [2, 1.6, -0.5])));
    expect({ x, z, wallId }).toEqual({ x: 0.25, z: -1.475, wallId: 'wl_north' });
  });

  it('slides an item along its wall to the point nearest the pointer while the pointer is over the floor', () => {
    const move = wallDrag(through(EYE, [0, 1.6, -1.5]), onNorthWall(0, 1, 0.05), BOARD, setup);
    // Over the floor at x −0.1, where the ray would meet the North wall's plane under the floor at x −0.45.
    expect(rounded(move(through(EYE, [-0.1, 0, 0.6])))).toEqual({ at: [-0.1, 0, -1.475], wallId: 'wl_north' });
  });

  describe('where the view grazes the wall', () => {
    /** A poster centered at x 0.5 on the North wall, grabbed at its center from an eye `off` meters from the wall at its west end, and dragged by the pointer turning `degrees` toward the room. */
    const grazing = (off: number, degrees: number) => {
      const grab = through([-1.9, 1.5, -1.5 + off], [0.5, 1.5, -1.5]);
      const move = wallDrag(grab, onNorthWall(0.5, 1.05, 0.02), POSTER, setup);
      const ray = new Ray(grab.origin, grab.direction.clone().applyAxisAngle(new Vector3(0, 1, 0), MathUtils.degToRad(-degrees)));
      return move(ray).position[0] - 0.5;
    };

    it('holds the item still when the ray barely meets the wall', () => {
      // At 1°, a 0.2° turn of the pointer, a few pixels, would take the ray's hit 48 cm east.
      expect(grazing(0.05, 0.2)).toBe(0);
    });

    it('moves the item no more than a few times as far as the pointer does', () => {
      // At 10°, a 1° turn would take the ray's hit 28 cm east. Square on, at 2.4 m, it moves a point 4 cm.
      const moved = grazing(0.42, 1);
      expect(moved).toBeGreaterThan(0.04);
      expect(moved).toBeLessThan(0.15);
    });
  });
});
