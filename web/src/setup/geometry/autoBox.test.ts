import { describe, expect, it } from 'vitest';
import type { Wall } from '@shared/types';
import { autoBox } from './autoBox';
import { mergeMeshes } from './mesh';
import { box, horizontal } from './testShapes';

// The fixture room: 4 × 3 m, floor at y = 0, ceiling at 2.6 m.
const walls: Wall[] = [
  { id: 'wl_1', name: 'North wall', start: [-2, -1.5], end: [2, -1.5], normal: [0, 1], height: 2.6 },
  { id: 'wl_2', name: 'East wall', start: [2, -1.5], end: [2, 1.5], normal: [-1, 0], height: 2.6 },
  { id: 'wl_3', name: 'South wall', start: [2, 1.5], end: [-2, 1.5], normal: [0, -1], height: 2.6 },
  { id: 'wl_4', name: 'West wall', start: [-2, 1.5], end: [-2, -1.5], normal: [1, 0], height: 2.6 },
];
const room = { walls, ceilingHeight: 2.6 };
const shell = box([-2, 0, -1.5], [2, 2.6, 1.5], true);

describe('autoBox', () => {
  it('boxes the clicked piece of furniture, standing on the floor, facing away from the nearest wall', () => {
    const table = box([-0.4, 0, -1], [0.4, 0.75, -0.5]);
    expect(autoBox(mergeMeshes([shell, table]), [0.1, 0.75, -0.7], room))
      .toEqual({ position: [0, 0, -0.75], size: [0.8, 0.75, 0.5], rotationY: 0 });
  });

  it('leaves out a neighbor that is not touching it', () => {
    const table = box([-0.4, 0, -1], [0.4, 0.75, -0.5]);
    const chair = box([0.5, 0, -0.9], [0.9, 0.9, -0.5]);
    expect(autoBox(mergeMeshes([shell, table, chair]), [0.1, 0.75, -0.7], room))
      .toEqual({ position: [0, 0, -0.75], size: [0.8, 0.75, 0.5], rotationY: 0 });
  });

  it('grows across a piece made of separate touching parts, such as a desk on legs', () => {
    const legs = [-0.35, 0.35].flatMap((x) => [-0.95, -0.55].map((z) => box([x - 0.02, 0, z - 0.02], [x + 0.02, 0.72, z + 0.02])));
    const top = box([-0.4, 0.72, -1], [0.4, 0.75, -0.5]);
    expect(autoBox(mergeMeshes([shell, top, ...legs]), [0.37, 0.4, -0.95], room))
      .toEqual({ position: [0, 0, -0.75], size: [0.8, 0.75, 0.5], rotationY: 0 });
  });

  it('stops at the wall behind it, and extends the box to touch that wall', () => {
    const desk = box([1.4, 0, -1.135], [2, 0.76, -0.065]);
    expect(autoBox(mergeMeshes([shell, desk]), [1.6, 0.76, -0.6], room))
      .toEqual({ position: [1.7, 0, -0.6], size: [1.07, 0.76, 0.6], rotationY: -Math.PI / 2 });
  });

  it("turns a bed's front to its foot: along its length, away from the wall at its head", () => {
    // Along the West wall with its head in the North-West corner, like a dorm bed.
    const bed = box([-2, 0, -1.5], [-1.01, 0.6, 0.4]);
    expect(autoBox(mergeMeshes([shell, bed]), [-1.5, 0.6, -0.55], room, 'length'))
      .toEqual({ position: [-1.505, 0, -0.55], size: [0.99, 0.6, 1.9], rotationY: 0 });
  });

  it('keeps the bottom of something mounted on a wall, such as a shelf', () => {
    const shelf = box([-0.5, 1.2, -1.5], [0.5, 1.5, -1.25]);
    expect(autoBox(mergeMeshes([shell, shelf]), [0, 1.5, -1.4], room))
      .toEqual({ position: [0, 1.2, -1.375], size: [1, 0.3, 0.25], rotationY: 0 });
  });

  it('finds nothing when the click is on the bare floor or a wall', () => {
    const mesh = mergeMeshes([shell, box([-0.4, 0, -1], [0.4, 0.75, -0.5])]);
    expect(autoBox(mesh, [1, 0, 0.5], room)).toBeNull();
    expect(autoBox(mesh, [0, 1.2, 1.5], room)).toBeNull();
  });

  it('only reaches 1 m from the click', () => {
    const bench = box([-1.8, 0, 0.6], [1.8, 0.45, 1]);
    const floor = horizontal([-2, -1.5], [2, 1.5], 0);
    const found = autoBox(mergeMeshes([floor, bench]), [0, 0.45, 0.8], { walls: [], ceilingHeight: 2.6 });
    expect(found!.size[0]).toBeCloseTo(2, 1);
  });
});
