import { describe, expect, it } from 'vitest';
import { resolveAnchor } from './anchors';
import { checkFit } from './fit';
import { replay } from './replay';
import { catalog, edit, item, onFloor, place, setup } from './test-room';
import { CAPTURE, pushIn, pusher, RELEASE, tuckSnap } from './tuck';
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

  it('snaps a chair within 6 cm of the desk in until it touches, without turning it or moving it along the edge', () => {
    // Turned 0.2, it reaches 0.3 cos 0.2 + 0.3 sin 0.2 ≈ 0.354 m east of its center: its east side is 5 cm short of the desk's front.
    const { position: [x, , z], rotationY } = snapped(onFloor(1.4 - 0.354 - 0.05, -0.5, 0.2));

    expect(x).toBeGreaterThanOrEqual(1.4 - 0.354 - 0.006);
    expect(x).toBeLessThanOrEqual(1.4 - 0.354 + 0.001);
    expect([z, rotationY]).toEqual([-0.5, 0.2]);
  });

  it('leaves a chair further out where the drag puts it', () => {
    expect(snapped(onFloor(1.1 - CAPTURE - 0.01, -0.6))).toEqual(onFloor(1.1 - CAPTURE - 0.01, -0.6));
  });

  it('never puts it past first contact: the desk is solid', () => {
    const [x] = snapped(onFloor(1.3, -0.6)).position;

    expect(x).toBeGreaterThanOrEqual(1.095);
    expect(x).toBeLessThanOrEqual(1.1);
  });

  it('holds the edge as the pointer goes on through the desk, so it never comes out the far side', () => {
    const drag = tuck();
    const xs = [1.06, 1.3, 1.5, 1.7].map((x) => drag(onFloor(x, -0.6), onFloor(x, -0.6)).position[0]);

    for (const x of xs) expect(x).toBeCloseTo(1.1, 2);
  });

  it('holds a snapped chair until it is pulled 20 cm back from the desk, then lets go', () => {
    const drag = tuck();
    drag(onFloor(1.05, -0.6), onFloor(1.05, -0.6));

    expect(drag(onFloor(1.1 - RELEASE + 0.01, -0.6), onFloor(1.1 - RELEASE + 0.01, -0.6)).position[0]).toBeCloseTo(1.1, 2);
    expect(drag(onFloor(1.1 - RELEASE - 0.01, -0.6), onFloor(1.1 - RELEASE - 0.01, -0.6))).toEqual(onFloor(1.1 - RELEASE - 0.01, -0.6));
  });

  it("stops at a side with no room under it: the desk's south end", () => {
    // The desk's south side is at z = −0.065; the chair's north side is 5 cm short of it.
    const [x, , z] = snapped(onFloor(1.7, 0.285)).position;

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

  it('stops within a millimetre of the same spot wherever it comes in from, so it never flickers', () => {
    const [x] = snapped(onFloor(1.08, -0.6)).position;

    expect(Math.abs(snapped(onFloor(1.05, -0.6)).position[0] - x)).toBeLessThan(0.001);
    expect(Math.abs(snapped(onFloor(1.3, -0.6)).position[0] - x)).toBeLessThan(0.001);
  });

  it('gives back exactly where it stood when snapped again from there, so a drag that ends where it began makes no Edit', () => {
    // Each from a drag of its own, as the drag that starts where the last one ended is a new one.
    const missed = Array.from({ length: 40 }, (_, i) => onFloor(1.04 + i * 0.0017, -0.81 + i * 0.0113, (i % 5) * 0.07))
      .map((at) => tuck()(at, at))
      .filter((once) => JSON.stringify(tuck()(once, once)) !== JSON.stringify(once));

    expect(missed).toEqual([]);
  });

  it('lets the wall win: where the wall snap moved it across the edge, it stays put', () => {
    const unsnapped = onFloor(0.98, -0.6);
    const wallSnapped = onFloor(0.95, -0.6);

    expect(tuck()(wallSnapped, unsnapped)).toEqual(wallSnapped);
  });

  it('still tucks in where the wall snap moved it only along the edge', () => {
    const [x, , z] = tuck()(onFloor(1.05, -0.6), onFloor(1.05, -0.55)).position;

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

describe('under a desk with knee space (#130)', () => {
  // A 1 × 0.6 m desk: a top 0.7 to 0.75 m up, full-height side panels, and a modesty panel at the back.
  const kneeDesk = item('desk-knee', 'desk', 'Knee Desk', [1, 0.75, 0.6], {
    collision: [
      { min: [-0.5, 0.7, -0.3], max: [0.5, 0.75, 0.3] },
      { min: [-0.5, 0, -0.3], max: [-0.46, 0.7, 0.3] },
      { min: [0.46, 0, -0.3], max: [0.5, 0.7, 0.3] },
      { min: [-0.46, 0.3, -0.3], max: [0.46, 0.7, -0.27] },
    ],
  });
  // A 0.5 × 0.5 m chair: a seat 0.4 to 0.5 m up over a base, and a back rising to 0.9 m at its back (−Z).
  const deskChair = item('chair-desk', 'chair', 'Desk Chair', [0.5, 0.9, 0.5], {
    collision: [
      { min: [-0.2, 0, -0.2], max: [0.2, 0.4, 0.2] },
      { min: [-0.25, 0.4, -0.25], max: [0.25, 0.5, 0.25] },
      { min: [-0.25, 0.5, -0.25], max: [0.25, 0.9, -0.2] },
    ],
  });
  const withDesk = { ...catalog, items: [...catalog.items, kneeDesk, deskChair] };
  /** The desk against the North wall, facing south: x −0.5 to 0.5, z −1.5 to −0.9. */
  const desk = place('pc_desk', 'desk-knee', onFloor(0, -1.2));
  /** The chair facing the desk, its back to the south, then the other Edits. */
  const roomWith = (at: Placement, ...edits: Edit[]) =>
    replay(setup, withDesk, [desk, place('pc_dchair', 'chair-desk', at), ...edits]);
  const facingDesk = (x: number, z: number) => onFloor(x, z, Math.PI);

  it('pushIn slides the chair under until its back meets the top', () => {
    const at = facingDesk(0, -0.5);
    const [x, , z] = pushIn(setup, withDesk, roomWith(at), 'pc_dchair', at, [0, -1], 1).position;

    // Its back, 0.2 to 0.25 m behind its center, meets the top's front edge at z = −0.9.
    expect(x).toBe(0);
    expect(z).toBeGreaterThanOrEqual(-1.1);
    expect(z).toBeLessThanOrEqual(-1.095);
  });

  it('the drag follows the pointer in under the top, then snaps the last 6 cm to where its back meets it', () => {
    const drag = tuckSnap(setup, withDesk, roomWith(facingDesk(0, 0.5)), 'pc_dchair')!;
    // 15 cm short of the desk's front, then 25 cm in under its top, the chair is where the pointer puts it.
    expect(drag(facingDesk(0.05, -0.5), facingDesk(0.05, -0.5))).toEqual(facingDesk(0.05, -0.5));
    expect(drag(facingDesk(0.05, -0.9), facingDesk(0.05, -0.9))).toEqual(facingDesk(0.05, -0.9));
    // 5 cm short of its back meeting the top, it snaps there, without turning, and the Fit rules find nothing.
    const at = drag(facingDesk(0.05, -1.05), facingDesk(0.05, -1.05));

    expect(at.position[0]).toBe(0.05);
    expect(at.position[2]).toBeCloseTo(-1.1, 2);
    expect(at.rotationY).toBe(Math.PI);
    expect(checkFit(setup, withDesk, roomWith(at), ['pc_dchair'])).toEqual([]);
  });

  it('pushed further, so its back goes through the top, the Fit rules flag it', () => {
    expect(checkFit(setup, withDesk, roomWith(facingDesk(0, -1.2)), ['pc_dchair'])).toMatchObject([{ rule: 'overlap', otherId: 'pc_desk' }]);
  });

  it("stops at the desk's side, which has no knee space", () => {
    // From the east, facing west, 5 cm out: the side panel is full height, at x = 0.5.
    const drag = tuckSnap(setup, withDesk, roomWith(onFloor(0.9, 0.5)), 'pc_dchair')!;
    const [x, , z] = drag(onFloor(0.8, -1.2, -Math.PI / 2), onFloor(0.8, -1.2, -Math.PI / 2)).position;

    expect(x).toBeGreaterThanOrEqual(0.75);
    expect(x).toBeLessThanOrEqual(0.755);
    expect(z).toBe(-1.2);
  });

  it('never goes into a chair already under the desk', () => {
    // One chair tucked in at x −0.5 to 0; the dragged one comes in at x −0.05 to 0.45, 5 cm in its way.
    const neighbor = place('pc_dchair2', 'chair-desk', facingDesk(-0.25, -1.1));
    const drag = tuckSnap(setup, withDesk, roomWith(facingDesk(0.2, 0.5), neighbor), 'pc_dchair')!;
    const [, , z] = drag(facingDesk(0.2, -0.56), facingDesk(0.2, -0.56)).position;

    // The neighbor reaches out to z = −0.85: 4 cm short of it, the dragged one snaps against it.
    expect(z).toBeGreaterThanOrEqual(-0.6);
    expect(z).toBeLessThanOrEqual(-0.595);
  });

  it('backs a chair out of a neighbor the pointer pushed it into, and stops against it, never out through the desk', () => {
    const neighbor = place('pc_dchair2', 'chair-desk', facingDesk(-0.25, -1.1));
    const drag = tuckSnap(setup, withDesk, roomWith(facingDesk(0.2, 0.5), neighbor), 'pc_dchair')!;
    // 15 cm into the neighbor, which reaches out to z = −0.85.
    const [x, , z] = drag(facingDesk(0.2, -0.75), facingDesk(0.2, -0.75)).position;

    expect(x).toBe(0.2);
    expect(z).toBeGreaterThanOrEqual(-0.6);
    expect(z).toBeLessThanOrEqual(-0.59);
  });

  it("beside: front, tucked, puts Claude's chair under the desk, facing it, with no Fit violation", () => {
    const state = replay(setup, withDesk, [desk]);
    const resolution = resolveAnchor(setup, withDesk, state, deskChair, { kind: 'beside', target_id: 'pc_desk', side: 'front', tucked: true });
    if ('error' in resolution) throw new Error(resolution.error);
    const { position: [x, , z], rotationY } = resolution.placement;

    expect(x).toBeCloseTo(0);
    expect(z).toBeCloseTo(-1.1, 2);
    expect(Math.abs(rotationY)).toBeCloseTo(Math.PI);
    // Without tucked, it stands outside the desk's front.
    const outside = resolveAnchor(setup, withDesk, state, deskChair, { kind: 'beside', target_id: 'pc_desk', side: 'front' });
    expect('placement' in outside && outside.placement.position[2]).toBeCloseTo(-0.65);
  });
});
