import { describe, expect, it } from 'vitest';
import type { Vec2 } from '@shared/types';
import { wallsFromPolygon } from './walls';

// The fixture room (data/scans/fixture): 4 × 3 m, centered on the origin, clicked clockwise from
// the north-west corner as seen from above with North (−Z) at the top.
const rectangle: Vec2[] = [[-2, -1.5], [2, -1.5], [2, 1.5], [-2, 1.5]];

describe('wallsFromPolygon', () => {
  it('makes one Wall per edge, named by the side of the room it is on', () => {
    expect(wallsFromPolygon(rectangle, 2.6)).toEqual([
      { id: 'wl_1', name: 'North wall', start: [-2, -1.5], end: [2, -1.5], normal: [0, 1], height: 2.6 },
      { id: 'wl_2', name: 'East wall', start: [2, -1.5], end: [2, 1.5], normal: [-1, 0], height: 2.6 },
      { id: 'wl_3', name: 'South wall', start: [2, 1.5], end: [-2, 1.5], normal: [0, -1], height: 2.6 },
      { id: 'wl_4', name: 'West wall', start: [-2, 1.5], end: [-2, -1.5], normal: [1, 0], height: 2.6 },
    ]);
  });

  it('points every normal into the room when the corners are clicked counter-clockwise', () => {
    const walls = wallsFromPolygon([...rectangle].reverse(), 2.6);
    expect(walls.map((w) => [w.name, w.normal])).toEqual([
      ['South wall', [0, -1]],
      ['East wall', [-1, 0]],
      ['North wall', [0, 1]],
      ['West wall', [1, 0]],
    ]);
  });

  it('points the normals of a U-shaped room into the room, and numbers repeated names', () => {
    // A 6 × 6 m square with a 2 × 4 m notch cut into its north side. The notch's side walls face
    // away from the room's centroid, so "toward the centroid" would point them out of the room.
    const uShape: Vec2[] = [[0, 0], [2, 0], [2, 4], [4, 4], [4, 0], [6, 0], [6, 6], [0, 6]];
    expect(wallsFromPolygon(uShape, 2.5).map((w) => [w.name, w.normal])).toEqual([
      ['North wall', [0, 1]],
      ['East wall', [-1, 0]],
      ['North wall 2', [0, 1]],
      ['West wall', [1, 0]],
      ['North wall 3', [0, 1]],
      ['East wall 2', [-1, 0]],
      ['South wall', [0, -1]],
      ['West wall 2', [1, 0]],
    ]);
  });

  it('names a diagonal wall by the closest of eight directions', () => {
    // A triangle whose long edge cuts off the north-east corner.
    const walls = wallsFromPolygon([[0, 0], [3, 3], [0, 3]], 2.5);
    expect(walls[0].name).toBe('Northeast wall');
    expect(walls[0].normal[0]).toBeCloseTo(-Math.SQRT1_2);
    expect(walls[0].normal[1]).toBeCloseTo(Math.SQRT1_2);
  });
});
