import { describe, expect, it } from 'vitest';
import type { Wall } from '@shared/types';
import { openingFromClicks } from './openings';

// The fixture's North wall: 4 m long, from x = −2 to x = 2 along z = −1.5, facing +Z.
const north: Wall = { id: 'wl_1', name: 'North wall', start: [-2, -1.5], end: [2, -1.5], normal: [0, 1], height: 2.6 };

describe('openingFromClicks', () => {
  it('measures a window from two opposite corners, in either order', () => {
    const window = { offset: 1.5, width: 1.2, bottom: 0.9, height: 1.2 };
    expect(openingFromClicks(north, [0.7, 2.1, -1.5], [-0.5, 0.9, -1.5], 'window')).toEqual(window);
    expect(openingFromClicks(north, [-0.5, 2.1, -1.5], [0.7, 0.9, -1.5], 'window')).toEqual(window);
  });

  it('projects clicks onto the wall plane, so a recessed window measures the same', () => {
    expect(openingFromClicks(north, [-0.5, 0.9, -1.62], [0.7, 2.1, -1.55], 'window'))
      .toEqual({ offset: 1.5, width: 1.2, bottom: 0.9, height: 1.2 });
  });

  it('starts a door at the floor', () => {
    expect(openingFromClicks(north, [1, 0.12, -1.5], [1.9, 2.03, -1.5], 'door'))
      .toEqual({ offset: 3, width: 0.9, bottom: 0, height: 2.03 });
  });

  it('keeps the Opening inside the wall', () => {
    expect(openingFromClicks(north, [1.4, 0.8, -1.5], [2.3, 2.9, -1.5], 'window'))
      .toEqual({ offset: 3.4, width: 0.6, bottom: 0.8, height: 1.8 });
  });

  it('measures along the wall from its start, whichever way the wall runs', () => {
    const south: Wall = { id: 'wl_3', name: 'South wall', start: [2, 1.5], end: [-2, 1.5], normal: [0, -1], height: 2.6 };
    expect(openingFromClicks(south, [1.7, 0, 1.5], [0.8, 2.03, 1.5], 'door'))
      .toEqual({ offset: 0.3, width: 0.9, bottom: 0, height: 2.03 });
  });
});
