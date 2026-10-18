import { describe, expect, it } from 'vitest';
import { checkFit } from './fit';
import { replay } from './replay';
import { dragSnap, snapTogether } from './snap-together';
import { catalog, item, onFloor, place, setup } from './test-room';
import { tuckSnap } from './tuck';
import type { Edit, Placement } from './types';

// The room's floor is x −2 to 2, z −1.5 to 1.5. The bed covers x −2 to −1.01, z −1.5 to 0.53; the
// desk x 1.4 to 2, z −1.135 to −0.065. The chair is 0.6 × 0.6 m; the table 1.5 × 0.9 m.

const withTable = { ...catalog, items: [...catalog.items, item('table-oak', 'table', 'Oak Table', [1.5, 0.75, 0.9])] };

/** One table, pc_table, at x −1.25 to 0.25 and z 0.55 to 1.45: a second one flush to its east end stands at x = 1. */
const firstTable = place('pc_table', 'table-oak', onFloor(-0.5, 1));

/** The snap for a drag of `subjectId`, the second table by default, after these Edits. */
const snapFor = (edits: Edit[], subjectId = 'pc_table2') => snapTogether(setup, withTable, replay(setup, withTable, edits), subjectId)!;

/** Where the second table goes when the drag puts it at `placed`, with no wall snap. */
const snapped = (placed: Placement) => snapFor([firstTable, place('pc_table2', 'table-oak', onFloor(0, -1))])(placed, placed);

describe('snapTogether', () => {
  it('pushes a table dropped into another one out, flush against it, instead of overlapping', () => {
    // 5 cm into the first table's east end.
    const at = snapped(onFloor(0.95, 1));

    expect(at.position[0]).toBeCloseTo(1, 2);
    expect(at.position[0]).toBeGreaterThanOrEqual(1);
    expect(at.position[2]).toBe(1);
    expect(at.rotationY).toBeCloseTo(0);
  });

  it('leaves the two tables with no Fit violation', () => {
    const at = snapped(onFloor(0.95, 1));
    const state = replay(setup, withTable, [firstTable, place('pc_table2', 'table-oak', at)]);

    expect(checkFit(setup, withTable, state, ['pc_table2']).filter(({ rule }) => rule === 'overlap')).toEqual([]);
  });

  it('pulls a table within 15 cm in until it touches', () => {
    const [x] = snapped(onFloor(1.1, 1)).position;

    expect(x).toBeGreaterThanOrEqual(1);
    expect(x).toBeLessThanOrEqual(1.005);
  });

  it('leaves a table further out where the drag puts it', () => {
    expect(snapped(onFloor(1.16, 1))).toEqual(onFloor(1.16, 1));
  });

  it('lines up ends within 10 cm, so two tables make one', () => {
    expect(snapped(onFloor(1.05, 1.07)).position[2]).toBeCloseTo(1);
    expect(snapped(onFloor(1.05, 0.85)).position[2]).toBe(0.85);
  });

  it('turns a table within 20° of square to the other square to it', () => {
    // Turned, it reaches over the first table's end; square, it stands flush to it.
    const at = snapped(onFloor(1.05, 0.75, 0.3));

    expect(at.rotationY).toBeCloseTo(0);
    expect(at.position[0]).toBeGreaterThanOrEqual(1);
    expect(at.position[0]).toBeLessThanOrEqual(1.006);
    expect(at.position[2]).toBe(0.75);
  });

  it("doesn't turn one further off square", () => {
    expect(snapped(onFloor(1.1, 0.75, 0.5)).rotationY).toBe(0.5);
  });

  it('lets the wall win: where the wall snap moved it across the side, or turned it, it keeps that', () => {
    const snap = snapFor([firstTable, place('pc_table2', 'table-oak', onFloor(0, -1))]);

    expect(snap(onFloor(1.1, 1), onFloor(1.05, 1))).toEqual(onFloor(1.1, 1));
    expect(snap(onFloor(1.05, 0.75, 0.2), onFloor(1.05, 0.75, 0.1)).rotationY).toBe(0.2);
  });

  it('stops in the same spot wherever it comes in from', () => {
    expect(snapped(onFloor(1.03, 1))).toEqual(snapped(onFloor(1.14, 1)));
    expect(snapped(onFloor(0.9, 1))).toEqual(snapped(onFloor(1.14, 1)));
  });

  it('comes out of the table it overlaps, even when another item is nearer', () => {
    // A chair against the first table's north side, its east side at x = 0.2: the second table, 5 cm
    // into the first's end, touches the chair's side and runs 8 cm alongside it.
    const chair = place('pc_chair', 'chair-ergo', onFloor(-0.1, 0.25));
    const snap = snapFor([firstTable, chair, place('pc_table2', 'table-oak', onFloor(0, -1))]);
    const { position: [x, , z] } = snap(onFloor(0.95, 0.92), onFloor(0.95, 0.92));

    expect(x).toBeGreaterThanOrEqual(1);
    expect(x).toBeLessThanOrEqual(1.005);
    expect(z).toBeCloseTo(1);
  });

  it("doesn't snap to an item it is only beyond the back of, however far", () => {
    // Behind the chair's back edge line, and alongside it, but 85 cm past its front.
    const snap = snapFor([place('pc_chair', 'chair-ergo', onFloor(0, 0)), place('pc_table2', 'table-oak', onFloor(0, -1))]);

    expect(snap(onFloor(0.2, 1), onFloor(0.2, 1))).toEqual(onFloor(0.2, 1));
  });

  it('snaps a chair against the bed', () => {
    const snap = snapFor([place('pc_chair', 'chair-ergo', onFloor(0, 0))], 'pc_chair');
    // Its west side 11 cm from the bed's east side, at x = −1.01.
    const [x] = snap(onFloor(-0.6, 0), onFloor(-0.6, 0)).position;

    expect(x).toBeGreaterThanOrEqual(-0.71);
    expect(x).toBeLessThanOrEqual(-0.705);
  });

  it("leaves a chair's desk to the tuck", () => {
    const snap = snapFor([place('pc_chair', 'chair-ergo', onFloor(0, 0))], 'pc_chair');

    expect(snap(onFloor(0.98, -0.6), onFloor(0.98, -0.6))).toEqual(onFloor(0.98, -0.6));
  });

  it('is only for furniture on the floor', () => {
    const rug = place('pc_rug', 'rug-gray', onFloor(0, 0));

    expect(snapTogether(setup, withTable, replay(setup, withTable, [rug]), 'pc_rug')).toBeUndefined();
  });
});

describe('dragSnap', () => {
  const state = replay(setup, withTable, [place('pc_chair', 'chair-ergo', onFloor(0, 0))]);

  it('tucks a chair in at a desk, as tuckSnap does', () => {
    const at = onFloor(0.98, -0.6);

    expect(dragSnap(setup, withTable, state, 'pc_chair')!(at, at)).toEqual(tuckSnap(setup, withTable, state, 'pc_chair')!(at, at));
    expect(dragSnap(setup, withTable, state, 'pc_chair')!(at, at).position[0]).toBeCloseTo(1.1, 2);
  });

  it('snaps a chair against other furniture away from any desk', () => {
    const [x] = dragSnap(setup, withTable, state, 'pc_chair')!(onFloor(-0.6, 0), onFloor(-0.6, 0)).position;

    expect(x).toBeGreaterThanOrEqual(-0.71);
    expect(x).toBeLessThanOrEqual(-0.705);
  });
});
