import { describe, expect, it } from 'vitest';
import { draftScale, type DraftRoom, type FloorPlanDraft } from '@shared/floor-plan';
import { pointInPolygon } from '@shared/geometry';
import type { RoomSetup } from '@shared/types';
import cmu from './fixtures/cmu-draft.json';
import { DEFAULT_CEILING, planFrame, planToSetup } from './planToSetup';

const draft = cmu as FloorPlanDraft;
/** A plan drawn at 100 px to the meter. */
const S = 0.01;
const room = (corners: [number, number][], extra: Partial<DraftRoom> = {}): DraftRoom =>
  ({ label: 'Room', corners: corners.map(([x, y]) => ({ x, y })), openings: [], ...extra });
const wallNamed = (setup: RoomSetup, name: string) => setup.walls.find((wall) => wall.name === name)!;

describe('planToSetup', () => {
  it('keeps an L-shaped room\'s six corners, with every wall facing into it', () => {
    const setup = planToSetup('l', room([[0, 0], [400, 0], [400, 200], [200, 200], [200, 400], [0, 400]]), { metersPerPixel: S });
    expect(setup.floor.polygon).toHaveLength(6);
    for (const { start, end, normal } of setup.walls) {
      const middle: [number, number] = [(start[0] + end[0]) / 2 + normal[0] * 0.1, (start[1] + end[1]) / 2 + normal[1] * 0.1];
      expect(pointInPolygon(middle, setup.floor.polygon)).toBe(true);
    }
    // 4 × 4 m, centered on the room.
    expect(setup.floor.polygon[0]).toEqual([-2, -2]);
    expect(setup.ceilingHeight).toBe(DEFAULT_CEILING);
  });

  it('squares an edge drawn a little off, and drops a stray corner on a straight edge', () => {
    // The top edge rises 7 px over 300 (about 1.3°); (150, 3) sits on it.
    const setup = planToSetup('r', room([[0, 0], [150, 3], [300, 7], [300, 400], [0, 400]]), { metersPerPixel: S });
    expect(setup.floor.polygon).toHaveLength(4);
    const [a, b] = setup.floor.polygon;
    expect(a[1]).toBeCloseTo(b[1], 9);
  });

  it('puts the top of the page to the North', () => {
    const plan = room([[0, 0], [400, 0], [400, 300], [0, 300]], {
      openings: [{ kind: 'window', from: { x: 100, y: 0 }, to: { x: 220, y: 0 }, swing: null }],
    });
    const setup = planToSetup('n', plan, { metersPerPixel: S });
    const [window] = setup.openings;
    expect(setup.walls.find(({ id }) => id === window.wallId)!.name).toBe('North wall');
    expect(window).toMatchObject({ kind: 'window', offset: 1, width: 1.2, bottom: 0.91, height: 1.22 });
  });

  it('clamps an Opening that runs past its wall, and leaves out one far from any wall', () => {
    const plan = room([[0, 0], [400, 0], [400, 300], [0, 300]], {
      openings: [
        { kind: 'door', from: { x: 330, y: 300 }, to: { x: 450, y: 300 }, swing: 'in-left' },
        { kind: 'window', from: { x: 150, y: 150 }, to: { x: 250, y: 150 }, swing: null },
      ],
    });
    const setup = planToSetup('c', plan, { metersPerPixel: S });
    expect(setup.openings).toHaveLength(1);
    // The South wall runs from x 4 to 0, so the door's nearer edge, at x = 4 m, is at its start.
    expect(setup.openings[0]).toMatchObject({ kind: 'door', offset: 0, width: 0.7, bottom: 0, height: 2.03, swing: 'in-left' });
  });

  it("builds CMU's Donner double from its plan as printed: 13'-3⅛\" by 15'-11 1/16\"", () => {
    const [plan] = draft.rooms;
    const metersPerPixel = draftScale(draft, plan)!;
    const setup = planToSetup('cmu', plan, { metersPerPixel });
    const north = wallNamed(setup, 'North wall');
    const east = wallNamed(setup, 'East wall');
    expect(Math.hypot(north.end[0] - north.start[0], north.end[1] - north.start[1])).toBeCloseTo(4.042, 2);
    expect(Math.hypot(east.end[0] - east.start[0], east.end[1] - east.start[1])).toBeCloseTo(4.853, 1);
    expect(setup.openings.map(({ kind, wallId }) => [kind, setup.walls.find((w) => w.id === wallId)!.name]))
      .toEqual([['window', 'North wall'], ['door', 'South wall']]);
    // It starts empty: the Mover furnishes it.
    expect(setup.originals).toEqual([]);
    expect(setup.surfaces).toBeDefined();
  });

  it('maps a plan point to the room and back', () => {
    const { toRoom, toPlan } = planFrame(draft.rooms[0], 0.0127);
    const point = { x: 500, y: 400 };
    const back = toPlan(toRoom(point));
    expect(back.x).toBeCloseTo(500);
    expect(back.y).toBeCloseTo(400);
  });
});
