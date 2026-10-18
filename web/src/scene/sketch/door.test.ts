import { describe, expect, it } from 'vitest';
import { checkFit } from '@shared/fit';
import { pointInPolygon } from '@shared/geometry';
import { replay } from '@shared/replay';
import { catalog, item, onFloor, place, setup } from '@shared/test-room';
import type { Opening, RoomSetup, Vec2 } from '@shared/types';
import { doorClearance } from './door';

// door.ts copies the door-swing zone of shared/fit.ts, which doesn't export it: the red-pencil
// drawing of a blocked door must outline exactly the floor the Fit rule checks.

const tiny = item('tiny', 'decor', 'Tiny', [0.02, 0.5, 0.02]);
const withTiny = { ...catalog, items: [...catalog.items, tiny] };

/** Whether the Fit rule says a 2 cm item standing at [x, z] blocks a door. */
function blocks(room: RoomSetup, [x, z]: Vec2) {
  const state = replay(room, withTiny, [place('pc_tiny', 'tiny', onFloor(x, z))]);
  return checkFit(room, withTiny, state, ['pc_tiny']).some(({ rule }) => rule === 'door-swing');
}

/** How far [x, z] is from the nearest edge of a polygon. */
function distanceToOutline([x, z]: Vec2, polygon: Vec2[]) {
  return Math.min(...polygon.map(([ax, az], i) => {
    const [bx, bz] = polygon[(i + 1) % polygon.length];
    const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / ((bx - ax) ** 2 + (bz - az) ** 2)));
    return Math.hypot(x - ax - t * (bx - ax), z - az - t * (bz - az));
  }));
}

// The test room's door is in the South wall at x 0.8–1.7: points across the floor in front of it.
const points: Vec2[] = Array.from({ length: 16 * 11 }, (_, i): Vec2 => [0.5 + (i % 16) * 0.1, 0.45 + Math.floor(i / 16) * 0.1]);

describe('doorClearance', () => {
  for (const swing of ['in-right', 'in-left', 'none'] as const) {
    it(`outlines the floor the door-swing Fit rule keeps clear, for a door that swings ${swing}`, () => {
      const door: Opening = { ...setup.openings.find(({ kind }) => kind === 'door')!, swing };
      const room = { ...setup, openings: [door] };
      const zone = doorClearance(door, room.walls.find(({ id }) => id === door.wallId)!);
      // Away from the outline, where the item's own size and the rule's tolerance can't tip it.
      const clear = points.filter((point) => distanceToOutline(point, zone) > 0.03);
      const inside = clear.filter((point) => pointInPolygon(point, zone));
      expect(inside.length).toBeGreaterThan(10);
      expect(clear.length - inside.length).toBeGreaterThan(10);
      for (const point of clear) expect(blocks(room, point), `at [${point}]`).toBe(pointInPolygon(point, zone));
    });
  }
});
