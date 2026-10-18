import { describe, expect, it } from 'vitest';
import { checkFit } from './fit';
import { replay } from './replay';
import { catalog, edit, onFloor, place, setup } from './test-room';
import { PULL_IN, pushIn, pusher, tuckSnap } from './tuck';
import type { Edit, Placement } from './types';

// The room's floor is x −2 to 2, z −1.5 to 1.5. The desk faces west, its front edge at x = 1.4, from
// z −1.135 to −0.065; its back is to the East wall. The chair is 0.6 × 0.6 m, the lamp 0.2 × 0.2 m.

/** The room after these Edits. */
const stateAfter = (edits: Edit[]) => replay(setup, catalog, edits);

/** The chair, pc_chair, at a placement, and then the other Edits. */
const withChair = (at: Placement, ...edits: Edit[]) => stateAfter([place('pc_chair', 'chair-ergo', at), ...edits]);

/** Where the chair stands after it's pushed from `at` along a direction. */
const pushed = (at: Placement, direction: [number, number], maxDistance: number, ...edits: Edit[]) =>
  pushIn(setup, catalog, withChair(at, ...edits), 'pc_chair', at, direction, maxDistance);

describe('pushIn', () => {
  it('stops at first contact, within 5 mm of touching', () => {
    // Its east side starts at x = 1.2, 20 cm short of the desk.
    const { position: [x, , z], rotationY } = pushed(onFloor(0.9, -0.6), [1, 0], 1);

    expect(x).toBeGreaterThanOrEqual(1.095);
    expect(x).toBeLessThanOrEqual(1.1);
    expect([z, rotationY]).toEqual([-0.6, 0]);
  });

  it('leaves it with no Fit violation', () => {
    const at = pushed(onFloor(0.9, -0.6), [1, 0], 1);

    expect(checkFit(setup, catalog, withChair(at), ['pc_chair'])).toEqual([]);
  });

  it('stops at a wall', () => {
    // Toward the South wall, at z = 1.5, through the door's swing, which isn't in its way.
    const [, , z] = pushed(onFloor(-0.5, 0.8), [0, 1], 1).position;

    expect(z).toBeGreaterThanOrEqual(1.195);
    expect(z).toBeLessThanOrEqual(1.2);
  });

  it('moves 0 where there is no gap', () => {
    expect(pushed(onFloor(1.1, -0.6), [1, 0], 1)).toEqual(onFloor(1.1, -0.6));
  });

  it("doesn't move where it can't stand: already in the desk", () => {
    expect(pushed(onFloor(1.3, -0.6), [1, 0], 1)).toEqual(onFloor(1.3, -0.6));
    expect(pusher(setup, catalog, withChair(onFloor(1.3, -0.6)), 'pc_chair')(onFloor(1.3, -0.6), [1, 0], 1)).toBeNull();
  });

  it('never goes into a neighboring chair', () => {
    const neighbor = place('pc_chair2', 'chair-ergo', onFloor(0.3, -0.6));
    const [x] = pushed(onFloor(-0.6, -0.6), [1, 0], 2, neighbor).position;

    // The neighbor's west side is at x = 0.
    expect(x).toBeGreaterThanOrEqual(-0.305);
    expect(x).toBeLessThanOrEqual(-0.3);
  });

  it('goes the whole way when nothing is in its way', () => {
    expect(pushed(onFloor(-0.5, 0), [1, 0], 0.5)).toEqual(onFloor(0, 0));
  });

  it('pushes an Original the same way', () => {
    const state = stateAfter([edit('ed_1', { type: 'move', targetId: 'og_desk', placement: onFloor(0.5, -0.6, -Math.PI / 2) })]);
    // The desk, 1.07 wide across z, moved west to x 0.2–0.8: east, the wall at x = 2 stops it.
    const [x] = pushIn(setup, catalog, state, 'og_desk', onFloor(0.5, -0.6, -Math.PI / 2), [1, 0], 2).position;

    expect(x).toBeGreaterThanOrEqual(1.695);
    expect(x).toBeLessThanOrEqual(1.7);
  });
});

describe('tuckSnap', () => {
  /** A tuck for the chair, standing where the drag started. */
  const tuck = (start = onFloor(0, 0.8), ...edits: Edit[]) => tuckSnap(setup, catalog, withChair(start, ...edits), 'pc_chair')!;
  /** Where the tuck puts the chair when the drag puts it at `placed`, with no wall snap. */
  const snapped = (placed: Placement, ...edits: Edit[]) => tuck(onFloor(0, 0.8), ...edits)(placed, placed);

  it('pulls a chair within 15 cm of the desk in until it touches, without turning it or moving it along the edge', () => {
    // Its east side 15 cm short of the desk's front.
    const { position: [x, , z], rotationY } = snapped(onFloor(1.1 - PULL_IN, -0.5, 0.2));

    // Turned 0.2, it reaches 0.3 cos 0.2 + 0.3 sin 0.2 ≈ 0.354 m east of its center.
    expect(x).toBeGreaterThanOrEqual(1.4 - 0.354 - 0.006);
    expect(x).toBeLessThanOrEqual(1.4 - 0.354 + 0.001);
    expect([z, rotationY]).toEqual([-0.5, 0.2]);
  });

  it('leaves a chair further out where the drag puts it', () => {
    expect(snapped(onFloor(1.1 - PULL_IN - 0.01, -0.6))).toEqual(onFloor(1.1 - PULL_IN - 0.01, -0.6));
  });

  it('never puts it past first contact: the desk is solid', () => {
    const [x] = snapped(onFloor(1.3, -0.6)).position;

    expect(x).toBeGreaterThanOrEqual(1.095);
    expect(x).toBeLessThanOrEqual(1.1);
  });

  it('holds the edge as the pointer goes on through the desk, so it never comes out the far side', () => {
    const drag = tuck();
    const xs = [1.0, 1.3, 1.5, 1.7].map((x) => drag(onFloor(x, -0.6), onFloor(x, -0.6)).position[0]);

    for (const x of xs) expect(x).toBeCloseTo(1.1, 2);
  });

  it('lets go once the chair is pulled out past 15 cm', () => {
    const drag = tuck();
    drag(onFloor(1.05, -0.6), onFloor(1.05, -0.6));

    expect(drag(onFloor(0.8, -0.6), onFloor(0.8, -0.6))).toEqual(onFloor(0.8, -0.6));
  });

  it("stops at a side with no room under it: the desk's south end", () => {
    // The desk's south side is at z = −0.065; the chair's north side is 10 cm short of it.
    const [x, , z] = snapped(onFloor(1.7, 0.335)).position;

    expect(x).toBe(1.7);
    expect(z).toBeGreaterThanOrEqual(0.235);
    expect(z).toBeLessThanOrEqual(0.24);
  });

  it("doesn't pull a chair through from far beyond a desk's back", () => {
    // A desk in the middle of the room facing south, at z −0.75 to −0.25; the chair is 95 cm past its front,
    // so it is only lined up with the desk's back edge from behind.
    const desk = place('pc_desk', 'desk-walnut', onFloor(0, -0.5));

    expect(snapped(onFloor(0, 1), desk)).toEqual(onFloor(0, 1));
  });

  it('stops in the same spot wherever it comes in from', () => {
    expect(snapped(onFloor(0.96, -0.6))).toEqual(snapped(onFloor(1.04, -0.6)));
    expect(snapped(onFloor(1.3, -0.6))).toEqual(snapped(onFloor(1.04, -0.6)));
  });

  it('lets the wall win: where the wall snap moved it across the edge, it stays put', () => {
    const unsnapped = onFloor(0.98, -0.6);
    const wallSnapped = onFloor(0.95, -0.6);

    expect(tuck()(wallSnapped, unsnapped)).toEqual(wallSnapped);
  });

  it('still tucks in where the wall snap moved it only along the edge', () => {
    const [x, , z] = tuck()(onFloor(1.0, -0.6), onFloor(1.0, -0.55)).position;

    expect(x).toBeCloseTo(1.1, 2);
    expect(z).toBe(-0.6);
  });

  it('is only for chairs', () => {
    const state = stateAfter([place('pc_lamp', 'lamp-brass', onFloor(0, 0))]);

    expect(tuckSnap(setup, catalog, state, 'pc_lamp')).toBeUndefined();
    expect(tuckSnap(setup, catalog, state, 'og_desk')).toBeUndefined();
  });

  it('takes under 1 ms a move', () => {
    const drag = tuck();
    const moves = 200;
    const began = performance.now();
    for (let i = 0; i < moves; i++) drag(onFloor(0.95 + (i % 30) * 0.01, -0.6), onFloor(0.95 + (i % 30) * 0.01, -0.6));

    expect((performance.now() - began) / moves).toBeLessThan(1);
  });
});
