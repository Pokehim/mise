import { describe, expect, it } from 'vitest';
import type { RoomSetup, Vec3 } from '@shared/types';
import { triangleClassifier } from './classify';

// The fixture room (4 × 3 m, ceiling 2.6 m), plus a wardrobe that reaches the ceiling.
const setup: RoomSetup = {
  version: 1,
  scanId: 'test',
  ceilingHeight: 2.6,
  floor: { polygon: [[-2, -1.5], [2, -1.5], [2, 1.5], [-2, 1.5]] },
  walls: [
    { id: 'wl_1', name: 'North wall', start: [-2, -1.5], end: [2, -1.5], normal: [0, 1], height: 2.6 },
    { id: 'wl_2', name: 'East wall', start: [2, -1.5], end: [2, 1.5], normal: [-1, 0], height: 2.6 },
    { id: 'wl_3', name: 'South wall', start: [2, 1.5], end: [-2, 1.5], normal: [0, -1], height: 2.6 },
    { id: 'wl_4', name: 'West wall', start: [-2, 1.5], end: [-2, -1.5], normal: [1, 0], height: 2.6 },
  ],
  openings: [
    { id: 'op_1', kind: 'door', wallId: 'wl_3', offset: 0.3, width: 0.9, bottom: 0, height: 2.03, swing: 'in-right' },
    { id: 'op_2', kind: 'window', wallId: 'wl_1', offset: 1.4, width: 1.2, bottom: 0.9, height: 1.2 },
  ],
  originals: [
    // Against the West wall: x from −2 to −1.01, z from −1.5 to 0.53.
    { id: 'og_bed', label: 'Bed', category: 'bed', kept: true, floorColor: '#a89f91',
      box: { position: [-1.505, 0, -0.485], size: [0.99, 0.6, 2.03], rotationY: 0 } },
    // Against the East wall, facing West: x from 1.4 to 2, z from −1.135 to −0.065.
    { id: 'og_desk', label: 'Desk', category: 'desk', kept: false, floorColor: '#a89f91',
      box: { position: [1.7, 0, -0.6], size: [1.07, 0.76, 0.6], rotationY: -Math.PI / 2 } },
    { id: 'og_wardrobe', label: 'Wardrobe', category: 'wardrobe', kept: true, floorColor: '#a89f91',
      box: { position: [-0.8, 0, 1.2], size: [1, 2.6, 0.6], rotationY: Math.PI } },
  ],
};

const { groups, classify } = triangleClassifier(setup);
const UP: Vec3 = [0, 1, 0];

/** The group a triangle with this centroid and normal goes to. */
const groupOf = ([cx, cy, cz]: Vec3, [nx, ny, nz]: Vec3) => groups[classify({ cx, cy, cz, nx, ny, nz, area: 0.0001 })];

const original = (id: string) => ({ kind: 'original', id });
const wall = (id: string) => ({ kind: 'wall', id });

describe('triangleClassifier, rule 1: Originals', () => {
  it("sends a triangle inside an Original's box to that Original", () => {
    expect(groupOf([-1.5, 0.6, -0.5], UP)).toEqual(original('og_bed'));
  });

  it('grows each box by 2 cm', () => {
    expect(groupOf([-0.995, 0.3, -0.5], [1, 0, 0])).toEqual(original('og_bed'));
    expect(groupOf([-0.98, 0.3, -0.5], [1, 0, 0])).toEqual({ kind: 'shell' });
  });

  it("turns each box by its rotationY", () => {
    expect(groupOf([1.5, 0.5, -1], [0, 0, -1])).toEqual(original('og_desk'));
    expect(groupOf([1.25, 0.5, -0.6], [-1, 0, 0])).toEqual({ kind: 'shell' });
  });

  it('leaves the floor under an Original to the Floor', () => {
    expect(groupOf([-1.5, 0.015, -0.5], UP)).toEqual({ kind: 'floor' });
  });

  it('leaves the wall behind an Original to that Wall', () => {
    expect(groupOf([-1.99, 0.3, -0.5], [1, 0, 0])).toEqual(wall('wl_4'));
  });

  it('comes before the Ceiling, for an Original as tall as the room', () => {
    expect(groupOf([-0.8, 2.58, 1.2], UP)).toEqual(original('og_wardrobe'));
  });
});

describe('triangleClassifier, rule 2: Ceiling', () => {
  it('sends anything within 5 cm of the ceiling height to the Ceiling, before Floor and Walls', () => {
    expect(groupOf([0, 2.6, 0], [0, -1, 0])).toEqual({ kind: 'ceiling' });
    expect(groupOf([-1, 2.57, -1.49], [0, 0, 1])).toEqual({ kind: 'ceiling' });
    expect(groupOf([-1, 2.54, -1.49], [0, 0, 1])).toEqual(wall('wl_1'));
  });
});

describe('triangleClassifier, rule 3: Floor', () => {
  it('sends a triangle that faces up within 3 cm of y = 0, inside the floor polygon, to the Floor', () => {
    expect(groupOf([0, 0.025, 0], [0, 0.85, 0.527])).toEqual({ kind: 'floor' });
    expect(groupOf([0, -0.025, 0], UP)).toEqual({ kind: 'floor' });
  });

  it('leaves out triangles that are too high, tilted, facing down, or outside the polygon', () => {
    expect(groupOf([0, 0.035, 0], UP)).toEqual({ kind: 'shell' });
    expect(groupOf([0, 0, 0], [0, 0.75, 0.661])).toEqual({ kind: 'shell' });
    expect(groupOf([0, 0, 0], [0, -1, 0])).toEqual({ kind: 'shell' });
    expect(groupOf([1.2, 0, 1.6], UP)).toEqual({ kind: 'shell' });
  });
});

describe('triangleClassifier, rule 4: Walls', () => {
  it("sends a triangle within 4 cm of a wall's plane, facing along its normal either way, to that Wall", () => {
    expect(groupOf([-1, 1.5, -1.47], [0, 0, 1])).toEqual(wall('wl_1'));
    expect(groupOf([-1, 1.5, -1.535], [0, 0, -1])).toEqual(wall('wl_1'));
    expect(groupOf([0, 1, 1.5], [0.6, 0, -0.8])).toEqual(wall('wl_3'));
  });

  it("leaves out triangles that are too far, turned away, or outside the wall's extent", () => {
    expect(groupOf([-1, 1.5, -1.45], [0, 0, 1])).toEqual({ kind: 'shell' });
    expect(groupOf([-1, 1.5, -1.49], [0.8, 0, 0.6])).toEqual({ kind: 'shell' });
    expect(groupOf([2.1, 1.5, -1.49], [0, 0, 1])).toEqual({ kind: 'shell' });
  });

  it('leaves out triangles inside an Opening', () => {
    expect(groupOf([0.5, 1.5, -1.5], [0, 0, 1])).toEqual({ kind: 'shell' });
    expect(groupOf([0.5, 0.5, -1.5], [0, 0, 1])).toEqual(wall('wl_1'));
    expect(groupOf([1.2, 1, 1.5], [0, 0, -1])).toEqual({ kind: 'shell' });
  });
});

describe('triangleClassifier, rule 5: Shell', () => {
  it('sends everything else to the Shell, such as clutter on the floor', () => {
    expect(groupOf([0.3, 0.2, 0.4], [0, 0, 1])).toEqual({ kind: 'shell' });
  });

  it('lists one group for the Shell, Floor and Ceiling, and one per Wall and per Original', () => {
    expect(groups).toEqual([
      { kind: 'shell' }, { kind: 'floor' }, { kind: 'ceiling' },
      wall('wl_1'), wall('wl_2'), wall('wl_3'), wall('wl_4'),
      original('og_bed'), original('og_desk'), original('og_wardrobe'),
    ]);
  });
});
