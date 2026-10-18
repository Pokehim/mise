import { describe, expect, it } from 'vitest';
import { footprint, rectInPolygon } from '@shared/geometry';
import { onFloor, setup } from '@shared/test-room';
import type { Placement, Vec3, Wall } from '@shared/types';
import { keepInRoom, snapToWalls } from './placement';

/** A desk 1.07 m wide and 0.60 m deep: half its width is 0.535, half its depth 0.3. */
const DESK: Vec3 = [1.07, 0.76, 0.6];
/** The test room's walls: x −2 to 2, z −1.5 to 1.5. */
const { walls } = setup;

/** Where a placement stands and which way it faces, to the millimeter, so it compares exactly. */
const rounded = (placement: Placement | null) => placement && {
  at: [placement.position[0], placement.position[2]].map((n) => Math.round(n * 1000) / 1000 + 0),
  facing: Math.round(placement.rotationY * 1000) / 1000 + 0,
};

describe('snapToWalls', () => {
  describe('the back', () => {
    it('snaps flush against a wall it is within 15 cm of', () => {
      // Facing south, its back 12 cm off the North wall at z = −1.5.
      expect(rounded(snapToWalls(onFloor(0, -1.08), DESK, walls))).toEqual({ at: [0, -1.2], facing: 0 });
    });

    it('turns the item to face straight into the room when it was a little off', () => {
      expect(rounded(snapToWalls(onFloor(0, -1.1, 0.15), DESK, walls))).toEqual({ at: [0, -1.2], facing: 0 });
    });

    it('lets go past 15 cm, or when the item is turned more than 20° from the wall', () => {
      expect(snapToWalls(onFloor(0, -1.0), DESK, walls)).toBeNull();
      expect(snapToWalls(onFloor(0, -1.1, 0.4), DESK, walls)).toBeNull();
    });
  });

  describe('a side', () => {
    it('snaps flush against a wall it is within 15 cm of, still facing along the wall', () => {
      // Facing south, its right side (+x) 10 cm off the East wall at x = 2.
      expect(rounded(snapToWalls(onFloor(1.365, 0), DESK, walls))).toEqual({ at: [1.465, 0], facing: 0 });
      // Facing north, its left side is the one by the East wall.
      expect(rounded(snapToWalls(onFloor(1.365, 0, Math.PI), DESK, walls))).toEqual({ at: [1.465, 0], facing: 3.142 });
    });

    it('squares the side up to the wall when the item was a little off', () => {
      expect(rounded(snapToWalls(onFloor(1.35, 0, -0.1), DESK, walls))).toEqual({ at: [1.465, 0], facing: 0 });
    });
  });

  describe('a corner', () => {
    it('snaps an item near two walls that meet into their corner: back against one, side against the other', () => {
      // Its back 10 cm off the North wall, its right side 8 cm off the East wall.
      expect(rounded(snapToWalls(onFloor(1.385, -1.1, 0.1), DESK, walls))).toEqual({ at: [1.465, -1.2], facing: 0 });
    });

    it('snaps into the corner when it is the side that is nearer', () => {
      // Its back 12 cm off the North wall, its left side 2 cm off the West wall.
      expect(rounded(snapToWalls(onFloor(-1.445, -1.08), DESK, walls))).toEqual({ at: [-1.465, -1.2], facing: 0 });
    });
  });

  describe('in an L-shaped room', () => {
    // x 0–4 along the north, z 0–4 along the west, with the inner corner at [2, 2].
    const lWalls: Wall[] = [
      { id: 'wl_n', name: 'North wall', start: [0, 0], end: [4, 0], normal: [0, 1], height: 2.6 },
      { id: 'wl_e', name: 'East wall', start: [4, 0], end: [4, 2], normal: [-1, 0], height: 2.6 },
      { id: 'wl_s', name: 'South wall', start: [4, 2], end: [2, 2], normal: [0, -1], height: 2.6 },
      { id: 'wl_e2', name: 'East wall 2', start: [2, 2], end: [2, 4], normal: [-1, 0], height: 2.6 },
      { id: 'wl_s2', name: 'South wall 2', start: [2, 4], end: [0, 4], normal: [0, -1], height: 2.6 },
      { id: 'wl_w', name: 'West wall', start: [0, 4], end: [0, 0], normal: [1, 0], height: 2.6 },
    ];

    it('snaps into the corner where the end of the north arm meets the inner wall', () => {
      // Facing north (−z), back to the South wall at z = 2, its left side by the East wall at x = 4.
      expect(rounded(snapToWalls(onFloor(3.4, 1.62, Math.PI), DESK, lWalls))).toEqual({ at: [3.465, 1.7], facing: 3.142 });
    });

    it('snaps a side to the inner wall of the west arm, and lets the inner corner be', () => {
      // Facing south, its right side 10 cm off East wall 2 at x = 2, its back 0.6 m below the North wall.
      expect(rounded(snapToWalls(onFloor(1.365, 3), DESK, lWalls))).toEqual({ at: [1.465, 3], facing: 0 });
    });

    it('doesn’t snap to a wall’s line where the wall isn’t', () => {
      // In the west arm, 10 cm from where the South wall’s line would be, at z = 2, but at x < 2.
      expect(snapToWalls(onFloor(1, 1.6, Math.PI), DESK, lWalls)).toBeNull();
    });
  });
});

describe('keepInRoom', () => {
  it('stops an item pushed through a wall flush against it, and snaps it there', () => {
    // Dragged 0.4 m past the East wall, facing south: it stops with its right side on the wall.
    expect(rounded(keepInRoom(onFloor(2.4, 0.2), DESK, setup))).toEqual({ at: [1.465, 0.2], facing: 0 });
  });

  it('drops an item pushed past two walls into their corner', () => {
    expect(rounded(keepInRoom(onFloor(2.5, -1.9, 0.1), DESK, setup))).toEqual({ at: [1.465, -1.2], facing: 0 });
  });

  it('without snapping, still keeps the item inside, without turning it', () => {
    const free = keepInRoom(onFloor(2.4, 0.2, 0.1), DESK, setup, { snap: false })!;

    expect(free.rotationY).toBe(0.1);
    expect(free.position[0]).toBeLessThan(1.465);
    expect(rectInPolygon(footprint(free, DESK), setup.floor.polygon)).toBe(true);
    // 10 cm off the North wall, a free item stays 10 cm off it.
    expect(rounded(keepInRoom(onFloor(0, -1.1), DESK, setup, { snap: false }))).toEqual({ at: [0, -1.1], facing: 0 });
  });

  it('is null for an item too big for the room', () => {
    expect(keepInRoom(onFloor(0, 0), [4.5, 0.5, 1], setup)).toBeNull();
  });
});
