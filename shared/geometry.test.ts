import { describe, expect, it } from 'vitest';
import { distanceToWall, footprint, type OrientedRect, pointInPolygon, rectCorners, rectsOverlap, wallPoint } from './geometry';
import { setup } from './test-room';
import type { Vec2, Wall } from './types';

/** A rectangle on the floor: center [x, z], size [width, depth], yaw in radians. */
const rect = (x: number, z: number, width: number, depth: number, rotationY = 0): OrientedRect =>
  ({ center: [x, z], size: [width, depth], rotationY });

/** Corners rounded to the millimeter and sorted by x, then z, so they compare exactly. */
const rounded = (corners: number[][]) => corners
  .map((corner) => corner.map((v) => Math.round(v * 1000) / 1000 + 0))
  .sort(([ax, az], [bx, bz]) => ax - bx || az - bz);

describe('footprint', () => {
  it('is the floor rectangle of a box: its x and z, its width and depth, and its yaw', () => {
    expect(footprint({ position: [1.7, 0.4, -0.6], rotationY: 0.3 }, [1.07, 0.76, 0.6]))
      .toEqual({ center: [1.7, -0.6], size: [1.07, 0.6], rotationY: 0.3 });
  });

  it('turns with the box: a desk at rotationY −π/2 faces −x, so its width runs along z', () => {
    const desk = footprint({ position: [1.7, 0, -0.6], rotationY: -Math.PI / 2 }, [1.07, 0.76, 0.6]);

    expect(rounded(rectCorners(desk))).toEqual([[1.4, -1.135], [1.4, -0.065], [2, -1.135], [2, -0.065]]);
  });
});

describe('rectsOverlap', () => {
  it('tells overlapping rectangles from separate ones', () => {
    expect(rectsOverlap(rect(0, 0, 2, 1), rect(1.5, 0.5, 2, 1))).toBe(true);
    expect(rectsOverlap(rect(0, 0, 2, 1), rect(2.5, 0, 2, 1))).toBe(false);
    expect(rectsOverlap(rect(0, 0, 2, 1), rect(0, 1.5, 2, 1))).toBe(false);
  });

  it('follows each rectangle’s rotation, not just its bounding box', () => {
    const square = rect(0, 0, 2, 2); // x and z −1 to 1
    // A 1 × 1 square turned 45°: a diamond whose points reach 0.71 from its center.
    expect(rectsOverlap(square, rect(1.6, 1.6, 1, 1, Math.PI / 4))).toBe(false); // its bounding box overlaps the corner
    expect(rectsOverlap(square, rect(1.3, 1.3, 1, 1, Math.PI / 4))).toBe(true);
    expect(rectsOverlap(rect(1.5, 0, 4, 0.2, Math.PI / 2), rect(1.5, 1.5, 1, 1))).toBe(true); // a plank turned to run along z
  });

  it('lets rectangles touch, or overlap by no more than the tolerance', () => {
    expect(rectsOverlap(rect(0, 0, 2, 1), rect(2, 0, 2, 1))).toBe(false); // touching
    expect(rectsOverlap(rect(0, 0, 2, 1), rect(1.995, 0, 2, 1))).toBe(true); // 0.5 cm in
    expect(rectsOverlap(rect(0, 0, 2, 1), rect(1.995, 0, 2, 1), 0.01)).toBe(false);
    expect(rectsOverlap(rect(0, 0, 2, 1), rect(1.98, 0, 2, 1), 0.01)).toBe(true); // 2 cm in
  });
});

describe('pointInPolygon', () => {
  it('tells points inside a room from points outside it', () => {
    const room: Vec2[] = [[-2, -1.5], [2, -1.5], [2, 1.5], [-2, 1.5]];

    expect(pointInPolygon([0, 0], room)).toBe(true);
    expect(pointInPolygon([1.99, -1.49], room)).toBe(true);
    expect(pointInPolygon([2.01, 0], room)).toBe(false);
    expect(pointInPolygon([0, -1.6], room)).toBe(false);
  });

  it('follows a room that is not convex: the notch of an L', () => {
    // A 4 × 4 room missing its north-east 2 × 2 quarter.
    const lShaped: Vec2[] = [[0, 0], [2, 0], [2, 2], [4, 2], [4, 4], [0, 4]];

    expect(pointInPolygon([1, 1], lShaped)).toBe(true);
    expect(pointInPolygon([3, 3], lShaped)).toBe(true);
    expect(pointInPolygon([3, 1], lShaped)).toBe(false);
  });
});

const [north, , south] = setup.walls; // North runs x −2 → 2 at z = −1.5; South runs x 2 → −2 at z = 1.5
const slanted: Wall = { id: 'wl_x', name: 'Slanted wall', start: [0, 0], end: [3, 4], normal: [-0.8, 0.6], height: 2.6 };

describe('wallPoint', () => {
  it('finds the point a distance along a wall from its start, and out into the room', () => {
    expect(wallPoint(north, 1, 0)).toEqual([-1, -1.5]);
    expect(wallPoint(north, 1, 0.4)).toEqual([-1, -1.1]);
    expect(wallPoint(south, 0.3, 0.6)).toEqual([1.7, 0.9]);
    expect(wallPoint(slanted, 5, 1).map((v) => Math.round(v * 1000) / 1000)).toEqual([2.2, 4.6]);
  });
});

describe('distanceToWall', () => {
  it("measures from a wall's plane, positive inside the room and negative behind the wall", () => {
    expect(distanceToWall([0, 0], north)).toBeCloseTo(1.5);
    expect(distanceToWall([-1.9, -1.4], north)).toBeCloseTo(0.1);
    expect(distanceToWall([0, -1.6], north)).toBeCloseTo(-0.1);
    expect(distanceToWall([0, 1], slanted)).toBeCloseTo(0.6);
    expect(distanceToWall([30, 40], slanted)).toBeCloseTo(0); // the plane goes on past the wall's ends
  });
});
