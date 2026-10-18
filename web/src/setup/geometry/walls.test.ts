import { describe, expect, it } from 'vitest';
import type { Opening, Original, RoomSetup, Vec2 } from '@shared/types';
import { isNewCorner, wallsFromPolygon, withPolygon } from './walls';

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

// The room from the bug report: 4 × 3 m with its north-west corner at the origin, clicked clockwise.
const room: Vec2[] = [[0, 0], [4, 0], [4, 3], [0, 3]];

function roomSetup(openings: Opening[], originals: Original[] = []): RoomSetup {
  const empty: RoomSetup = { version: 1, scanId: 'test', ceilingHeight: 2.5, floor: { polygon: [] }, walls: [], openings: [], originals: [] };
  return { ...withPolygon(empty, room), openings, originals };
}

/** Undo corner, then click another 4th corner, which turns wl_3 into a 3.35 m diagonal. */
const moveLastCorner = (setup: RoomSetup) => {
  const undone = withPolygon(setup, setup.floor.polygon.slice(0, -1));
  return withPolygon(undone, [...undone.floor.polygon, [1, 1.5]]);
};

describe('withPolygon', () => {
  it("drops an Opening whose wall's edge changed, and keeps one on an unchanged wall", () => {
    const northWindow: Opening = { id: 'op_1', kind: 'window', wallId: 'wl_1', offset: 1, width: 1.2, bottom: 0.9, height: 1.2 };
    const door: Opening = { id: 'op_2', kind: 'door', wallId: 'wl_3', offset: 3, width: 0.9, bottom: 0, height: 2.1, swing: 'in-left' };
    const moved = moveLastCorner(roomSetup([northWindow, door]));
    expect(moved.walls[2]).toMatchObject({ id: 'wl_3', start: [4, 3], end: [1, 1.5] });
    expect(moved.openings).toEqual([northWindow]);
  });

  it('drops patch.walls images of a wall whose edge changed', () => {
    const sofa: Original = {
      id: 'og_sofa', label: 'Sofa', category: 'sofa', kept: false, floorColor: '#808080',
      box: { position: [2, 0, 0.5], size: [2, 0.8, 0.9], rotationY: 0 },
      patch: { floor: 'patches/og_sofa.floor.png', walls: { wl_1: 'patches/og_sofa.wl_1.png', wl_3: 'patches/og_sofa.wl_3.png' } },
    };
    const [moved] = moveLastCorner(roomSetup([], [sofa])).originals;
    expect(moved.patch).toEqual({ floor: 'patches/og_sofa.floor.png', walls: { wl_1: 'patches/og_sofa.wl_1.png' } });
  });
});

describe('isNewCorner', () => {
  it('is false for the last corner and the first corner, and true for any other point', () => {
    expect(isNewCorner(room, [0, 3])).toBe(false);
    expect(isNewCorner(room, [0, 0])).toBe(false);
    expect(isNewCorner(room, [4, 0])).toBe(true);
    expect(isNewCorner(room, [1, 1.5])).toBe(true);
    expect(isNewCorner(room, [0, 2.999])).toBe(true);
    expect(isNewCorner([], [0, 0])).toBe(true);
  });
});
