import { describe, expect, it } from 'vitest';
import { replay } from './replay';
import { catalog, edit, onFloor, place, setup, withLampAndMirror, withMasterCopies } from './test-room';
import type { Finish, Hex, RoomSetup, RoomState, Vec2, Vec3, Wall } from './types';

/**
 * The test room reshaped to a floor polygon, with one Wall per edge (wl_1, wl_2, … in corner order)
 * and one Original: wall art at `position`. The corners run the same way round as the test
 * room's, so each normal, [−dz, dx] / length, points into the room.
 */
function withWallArt(polygon: Vec2[], position: Vec3, rotationY: number): RoomSetup {
  const walls = polygon.map((start, i): Wall => {
    const end = polygon[(i + 1) % polygon.length];
    const length = Math.hypot(end[0] - start[0], end[1] - start[1]);
    const normal: Vec2 = [(start[1] - end[1]) / length, (end[0] - start[0]) / length];
    return { id: `wl_${i + 1}`, name: `Wall ${i + 1}`, start, end, normal, height: 2.6 };
  });
  return {
    ...setup,
    floor: { polygon },
    walls,
    openings: [],
    originals: [{
      id: 'og_art', label: 'Wall art', category: 'wall_art', kept: false, floorColor: '#a89f91',
      box: { position, size: [0.6, 0.8, 0.03], rotationY },
    }],
  };
}

describe('replay', () => {
  it('starts from the Scan: every Original visible at its Room Setup box, no Pieces, no Finishes', () => {
    expect(replay(setup, catalog, [])).toEqual({
      originals: {
        og_bed: {
          visible: true, moved: false, partColors: {}, partFinishes: {},
          placement: { position: [-1.505, 0, -0.485], rotationY: 0, mount: 'floor' },
        },
        og_desk: {
          visible: true, moved: false, partColors: {}, partFinishes: {},
          placement: { position: [1.7, 0, -0.6], rotationY: -Math.PI / 2, mount: 'floor' },
        },
      },
      pieces: {},
      surfaces: { walls: {} },
      patches: [],
      skipped: [],
    });
  });

  it('starts an Original above the floor on a surface, or on its nearest wall if it hangs on walls', () => {
    const { originals } = replay(withLampAndMirror, catalog, []);

    expect(originals.og_lamp.placement).toEqual({ position: [1.7, 0.76, -0.6], rotationY: 0, mount: 'surface' });
    expect(originals.og_mirror.placement).toEqual({ position: [-1.985, 1, 0], rotationY: Math.PI / 2, mount: 'wall', wallId: 'wl_west' });
  });

  it('hangs wall art on the Wall it is beside in a U-shaped room', () => {
    // wl_1 (x 0–2) and wl_5 (x 4–6) both lie on the line z = 0, with the notch between them.
    const room = withWallArt([[0, 0], [2, 0], [2, 4], [4, 4], [4, 0], [6, 0], [6, 6], [0, 6]], [5, 1.4, 0.02], 0);

    expect(replay(room, catalog, []).originals.og_art.placement).toEqual({
      position: [5, 1.4, 0.02], rotationY: 0, mount: 'wall', wallId: 'wl_5',
    });
  });

  it('hangs wall art on the Wall it is beside in an L-shaped room', () => {
    // On the West wall (wl_6) at z = 2, the line of wl_3 (x 2–4), which is 2 m away.
    const room = withWallArt([[0, 0], [4, 0], [4, 2], [2, 2], [2, 4], [0, 4]], [0.02, 1.4, 2], Math.PI / 2);

    expect(replay(room, catalog, []).originals.og_art.placement).toEqual({
      position: [0.02, 1.4, 2], rotationY: Math.PI / 2, mount: 'wall', wallId: 'wl_6',
    });
  });

  it('still picks the nearest Wall in a rectangular room', () => {
    // Near the north-east corner: 0.02 m from the East wall (wl_2), 0.5 m from the North wall (wl_1).
    const room = withWallArt([[0, 0], [4, 0], [4, 3], [0, 3]], [3.98, 1.4, 0.5], -Math.PI / 2);

    expect(replay(room, catalog, []).originals.og_art.placement).toEqual({
      position: [3.98, 1.4, 0.5], rotationY: -Math.PI / 2, mount: 'wall', wallId: 'wl_2',
    });
  });

  describe('place', () => {
    it('adds the Piece, with no colors', () => {
      const state = replay(setup, catalog, [
        place('pc_chair', 'chair-ergo', onFloor(0, 0), 'ed_1'),
      ]);

      expect(state.pieces).toEqual({ pc_chair: { catalogId: 'chair-ergo', placement: onFloor(0, 0), partColors: {} } });
      expect(state.skipped).toEqual([]);
    });

    it('skips a pieceId that is already taken, by a Piece or an Original', () => {
      const state = replay(setup, catalog, [
        place('pc_chair', 'chair-ergo', onFloor(0, 0), 'ed_1'),
        place('pc_chair', 'desk-walnut', onFloor(1, 1), 'ed_2'),
        place('og_desk', 'desk-walnut', onFloor(1, 1), 'ed_3'),
      ]);

      expect(state.pieces).toEqual({ pc_chair: { catalogId: 'chair-ergo', placement: onFloor(0, 0), partColors: {} } });
      expect(state.skipped).toEqual([
        { editId: 'ed_2', reason: 'duplicate-id' },
        { editId: 'ed_3', reason: 'duplicate-id' },
      ]);
    });

    it('skips a catalogId that is not in the Catalog', () => {
      const state = replay(setup, catalog, [
        place('pc_sofa', 'no-such-item', onFloor(0, 0), 'ed_1'),
      ]);

      expect(state.pieces).toEqual({});
      expect(state.skipped).toEqual([{ editId: 'ed_1', reason: 'unknown-catalog' }]);
    });
  });

  describe('move', () => {
    const placeChair = place('pc_chair', 'chair-ergo', onFloor(0, 0), 'ed_1');

    it('sets the placement of a Piece', () => {
      const state = replay(setup, catalog, [
        placeChair,
        edit('ed_2', { type: 'move', targetId: 'pc_chair', placement: onFloor(0.5, 0.2, Math.PI) }),
      ]);

      expect(state.pieces.pc_chair.placement).toEqual(onFloor(0.5, 0.2, Math.PI));
      expect(state.skipped).toEqual([]);
    });

    it('sets the placement of an Original, marks it moved and adds a Patch where it stood', () => {
      const state = replay(setup, catalog, [edit('ed_1', { type: 'move', targetId: 'og_desk', placement: onFloor(0, 1) })]);

      expect(state.originals.og_desk).toMatchObject({ visible: true, moved: true, placement: onFloor(0, 1) });
      expect(state.patches).toEqual(['og_desk']);
    });

    it('skips moving a Kept Original, and a target that does not exist', () => {
      const state = replay(setup, catalog, [
        edit('ed_1', { type: 'move', targetId: 'og_bed', placement: onFloor(0, 0) }),
        edit('ed_2', { type: 'move', targetId: 'pc_gone', placement: onFloor(0, 0) }),
      ]);

      expect(state.skipped).toEqual([
        { editId: 'ed_1', reason: 'kept' },
        { editId: 'ed_2', reason: 'missing-target' },
      ]);
      expect(state.originals.og_bed).toMatchObject({ moved: false, placement: { position: [-1.505, 0, -0.485] } });
      expect(state.patches).toEqual([]);
    });

    it('skips moving an Original that is no longer visible', () => {
      const state = replay(setup, catalog, [
        edit('ed_1', { type: 'remove', targetId: 'og_desk' }),
        edit('ed_2', { type: 'move', targetId: 'og_desk', placement: onFloor(0, 1) }),
      ]);

      expect(state.skipped).toEqual([{ editId: 'ed_2', reason: 'missing-target' }]);
      expect(state.originals.og_desk).toMatchObject({ moved: false, placement: { position: [1.7, 0, -0.6] } });
    });
  });

  describe('remove', () => {
    it('deletes a Piece', () => {
      const state = replay(setup, catalog, [
        place('pc_chair', 'chair-ergo', onFloor(0, 0), 'ed_1'),
        edit('ed_2', { type: 'remove', targetId: 'pc_chair' }),
      ]);

      expect(state.pieces).toEqual({});
      expect(state.skipped).toEqual([]);
    });

    it('hides an Original and adds a Patch where it stood', () => {
      const state = replay(setup, catalog, [edit('ed_1', { type: 'remove', targetId: 'og_desk' })]);

      expect(state.originals.og_desk).toMatchObject({ visible: false, moved: false });
      expect(state.patches).toEqual(['og_desk']);
      expect(state.skipped).toEqual([]);
    });

    it('skips removing a Kept Original, and a target that does not exist', () => {
      const state = replay(setup, catalog, [
        edit('ed_1', { type: 'remove', targetId: 'og_bed' }),
        edit('ed_2', { type: 'remove', targetId: 'pc_gone' }),
      ]);

      expect(state.skipped).toEqual([
        { editId: 'ed_1', reason: 'kept' },
        { editId: 'ed_2', reason: 'missing-target' },
      ]);
      expect(state.originals.og_bed.visible).toBe(true);
      expect(state.patches).toEqual([]);
    });
  });

  describe('swap', () => {
    const placeChair = place('pc_1', 'chair-ergo', onFloor(0, 0), 'ed_1');

    it('changes the catalog item and the placement of a Piece', () => {
      const state = replay(setup, catalog, [
        placeChair,
        edit('ed_2', { type: 'swap', pieceId: 'pc_1', catalogId: 'desk-walnut', placement: onFloor(0, 0.1), via: 'swap' }),
      ]);

      expect(state.pieces.pc_1).toEqual({ catalogId: 'desk-walnut', placement: onFloor(0, 0.1), partColors: {} });
      expect(state.skipped).toEqual([]);
    });

    it('keeps only the Part colors whose Part exists in both items', () => {
      const state = replay(setup, catalog, [
        placeChair,
        edit('ed_2', { type: 'recolor', targetId: 'pc_1', partId: 'legs', color: '#1a1a1a' }),
        edit('ed_3', { type: 'recolor', targetId: 'pc_1', partId: 'seat_back', color: '#9caf88' }),
        edit('ed_4', { type: 'swap', pieceId: 'pc_1', catalogId: 'desk-walnut', placement: onFloor(0, 0), via: 'swap' }),
      ]);

      // A chair has seat_back and legs; a desk has top and legs.
      expect(state.pieces.pc_1.partColors).toEqual({ legs: '#1a1a1a' });
    });

    it('skips a catalogId that is not in the Catalog, and a Piece that does not exist', () => {
      const state = replay(setup, catalog, [
        placeChair,
        edit('ed_2', { type: 'swap', pieceId: 'pc_1', catalogId: 'no-such-item', placement: onFloor(1, 1), via: 'swap' }),
        edit('ed_3', { type: 'swap', pieceId: 'pc_gone', catalogId: 'desk-walnut', placement: onFloor(1, 1), via: 'swap' }),
        edit('ed_4', { type: 'swap', pieceId: 'og_desk', catalogId: 'desk-walnut', placement: onFloor(1, 1), via: 'resize' }),
      ]);

      expect(state.skipped).toEqual([
        { editId: 'ed_2', reason: 'unknown-catalog' },
        { editId: 'ed_3', reason: 'missing-target' },
        { editId: 'ed_4', reason: 'missing-target' },
      ]);
      expect(state.pieces).toEqual({ pc_1: { catalogId: 'chair-ergo', placement: onFloor(0, 0), partColors: {} } });
    });
  });

  describe('replace', () => {
    const replaceDesk = (id: string, pieceId = 'pc_desk', catalogId = 'desk-walnut') =>
      edit(id, {
        type: 'replace', originalId: 'og_desk', pieceId, catalogId, via: 'replace',
        placement: onFloor(1.75, -0.6, -Math.PI / 2),
      });

    it('hides the Original, adds a Patch where it stood, and adds the Piece that replaces it', () => {
      const state = replay(setup, catalog, [replaceDesk('ed_1')]);

      expect(state.originals.og_desk.visible).toBe(false);
      expect(state.patches).toEqual(['og_desk']);
      expect(state.pieces).toEqual({
        pc_desk: {
          catalogId: 'desk-walnut', placement: onFloor(1.75, -0.6, -Math.PI / 2), partColors: {}, replacesOriginalId: 'og_desk',
        },
      });
      expect(state.skipped).toEqual([]);
    });

    it('skips a Kept Original, and an Original that is gone or no longer visible', () => {
      const state = replay(setup, catalog, [
        edit('ed_1', {
          type: 'replace', originalId: 'og_bed', pieceId: 'pc_1', catalogId: 'desk-walnut', placement: onFloor(0, 0), via: 'replace',
        }),
        edit('ed_2', {
          type: 'replace', originalId: 'og_gone', pieceId: 'pc_2', catalogId: 'desk-walnut', placement: onFloor(0, 0), via: 'replace',
        }),
        replaceDesk('ed_3', 'pc_3'),
        replaceDesk('ed_4', 'pc_4'),
      ]);

      expect(state.skipped).toEqual([
        { editId: 'ed_1', reason: 'kept' },
        { editId: 'ed_2', reason: 'missing-target' },
        { editId: 'ed_4', reason: 'missing-target' },
      ]);
      expect(state.originals.og_bed.visible).toBe(true);
      expect(Object.keys(state.pieces)).toEqual(['pc_3']);
    });

    it('skips a pieceId that is already taken, leaving the Original in place', () => {
      const state = replay(setup, catalog, [
        place('pc_1', 'chair-ergo', onFloor(0, 0), 'ed_1'),
        replaceDesk('ed_2', 'pc_1'),
      ]);

      expect(state.skipped).toEqual([{ editId: 'ed_2', reason: 'duplicate-id' }]);
      expect(state.originals.og_desk.visible).toBe(true);
      expect(state.patches).toEqual([]);
      expect(state.pieces.pc_1.catalogId).toBe('chair-ergo');
    });

    // §6 lists this check for place and swap only; without it, replace would add a Piece nothing can render.
    it('skips a catalogId that is not in the Catalog, leaving the Original in place', () => {
      const state = replay(setup, catalog, [replaceDesk('ed_1', 'pc_desk', 'no-such-item')]);

      expect(state.skipped).toEqual([{ editId: 'ed_1', reason: 'unknown-catalog' }]);
      expect(state.originals.og_desk.visible).toBe(true);
      expect(state.patches).toEqual([]);
      expect(state.pieces).toEqual({});
    });
  });

  describe('recolor', () => {
    const placeChair = place('pc_1', 'chair-ergo', onFloor(0, 0), 'ed_1');

    it('sets the color of one Part of a Piece', () => {
      const state = replay(setup, catalog, [
        placeChair,
        edit('ed_2', { type: 'recolor', targetId: 'pc_1', partId: 'legs', color: '#1a1a1a' }),
      ]);

      expect(state.pieces.pc_1.partColors).toEqual({ legs: '#1a1a1a' });
      expect(state.skipped).toEqual([]);
    });

    it('clears the color of one Part when the color is null', () => {
      const state = replay(setup, catalog, [
        placeChair,
        edit('ed_2', { type: 'recolor', targetId: 'pc_1', partId: 'legs', color: '#1a1a1a' }),
        edit('ed_3', { type: 'recolor', targetId: 'pc_1', partId: 'seat_back', color: '#9caf88' }),
        edit('ed_4', { type: 'recolor', targetId: 'pc_1', partId: 'legs', color: null }),
      ]);

      expect(state.pieces.pc_1.partColors).toEqual({ seat_back: '#9caf88' });
    });

    it("sets every Part of the item's category when the partId is '*'", () => {
      const state = replay(setup, catalog, [
        placeChair,
        edit('ed_2', { type: 'recolor', targetId: 'pc_1', partId: '*', color: '#9caf88' }),
      ]);

      expect(state.pieces.pc_1.partColors).toEqual({ seat_back: '#9caf88', legs: '#9caf88' });
      expect(state.skipped).toEqual([]);
    });

    it("skips a Part that the item's category doesn't have", () => {
      const state = replay(setup, catalog, [
        placeChair,
        edit('ed_2', { type: 'recolor', targetId: 'pc_1', partId: 'top', color: '#1a1a1a' }),
      ]);

      expect(state.skipped).toEqual([{ editId: 'ed_2', reason: 'unknown-part' }]);
      expect(state.pieces.pc_1.partColors).toEqual({});
    });

    it('recolors a visible Original, even a Kept one', () => {
      const state = replay(setup, catalog, [edit('ed_1', { type: 'recolor', targetId: 'og_bed', partId: 'frame', color: '#1f2a44' })]);

      expect(state.originals.og_bed.partColors).toEqual({ frame: '#1f2a44' });
      expect(state.skipped).toEqual([]);
    });

    it('skips a Piece whose place Edit was deleted from History', () => {
      const recolorLegs = edit('ed_2', { type: 'recolor', targetId: 'pc_1', partId: 'legs', color: '#1a1a1a' });
      expect(replay(setup, catalog, [placeChair, recolorLegs]).skipped).toEqual([]);

      const state = replay(setup, catalog, [recolorLegs]);

      expect(state.skipped).toEqual([{ editId: 'ed_2', reason: 'missing-target' }]);
      expect(state.pieces).toEqual({});
    });

    it('skips an Original that is no longer visible', () => {
      const state = replay(setup, catalog, [
        edit('ed_1', { type: 'remove', targetId: 'og_desk' }),
        edit('ed_2', { type: 'recolor', targetId: 'og_desk', partId: '*', color: '#1a1a1a' }),
      ]);

      expect(state.skipped).toEqual([{ editId: 'ed_2', reason: 'missing-target' }]);
      expect(state.originals.og_desk.partColors).toEqual({});
    });

    describe('of an Original drawn from a Master Copy', () => {
      it("takes the Master Copy's Parts, not its category's", () => {
        const state = replay(withMasterCopies, catalog, [
          edit('ed_1', { type: 'recolor', targetId: 'og_chair1', partId: 'seat', color: '#1f2a44' }),
        ]);

        expect(state.skipped).toEqual([]);
        expect(state.originals.og_chair1.partColors).toEqual({ seat: '#1f2a44' });
      });

      it("recolors the whole item with '*', over its Parts' colors, and clears all of them with null", () => {
        const recolorChair = (id: string, partId: string, color: Hex | null) => edit(id, { type: 'recolor', targetId: 'og_chair1', partId, color });
        const whole = [recolorChair('ed_1', 'seat', '#1f2a44'), recolorChair('ed_2', '*', '#9caf88'), recolorChair('ed_3', 'legs', '#1c1c1c')];

        expect(replay(withMasterCopies, catalog, whole).originals.og_chair1.partColors).toEqual({ '*': '#9caf88', legs: '#1c1c1c' });
        expect(replay(withMasterCopies, catalog, [...whole, recolorChair('ed_4', '*', null)]).originals.og_chair1.partColors).toEqual({});
      });

      it('with sameModel, recolors every Original drawn from the same Master Copy, as one Edit', () => {
        const state = replay(withMasterCopies, catalog, [
          edit('ed_1', { type: 'recolor', targetId: 'og_chair2', partId: 'legs', color: '#1c1c1c', sameModel: true }),
        ]);

        expect(state.skipped).toEqual([]);
        expect(state.originals.og_chair1.partColors).toEqual({ legs: '#1c1c1c' });
        expect(state.originals.og_chair2.partColors).toEqual({ legs: '#1c1c1c' });
        expect(state.originals.og_stool.partColors).toEqual({});
        expect(state.originals.og_desk.partColors).toEqual({});
      });

      it('with sameModel, leaves out a removed Original of the same Master Copy', () => {
        const state = replay(withMasterCopies, catalog, [
          edit('ed_1', { type: 'remove', targetId: 'og_chair1' }),
          edit('ed_2', { type: 'recolor', targetId: 'og_chair2', partId: '*', color: '#1c1c1c', sameModel: true }),
        ]);

        expect(state.skipped).toEqual([]);
        expect(state.originals.og_chair1.partColors).toEqual({});
        expect(state.originals.og_chair2.partColors).toEqual({ '*': '#1c1c1c' });
      });
    });
  });

  describe('finish', () => {
    const sage = { kind: 'paint', color: '#9caf88' } as const;

    it('sets the Finish of a wall', () => {
      const state = replay(setup, catalog, [edit('ed_1', { type: 'finish', target: { kind: 'wall', wallId: 'wl_north' }, finish: sage })]);

      expect(state.surfaces).toEqual({ walls: { wl_north: sage } });
      expect(state.skipped).toEqual([]);
    });

    it("removes the Finish of a wall with { kind: 'none' }", () => {
      const state = replay(setup, catalog, [
        edit('ed_1', { type: 'finish', target: { kind: 'wall', wallId: 'wl_north' }, finish: sage }),
        edit('ed_2', { type: 'finish', target: { kind: 'wall', wallId: 'wl_east' }, finish: sage }),
        edit('ed_3', { type: 'finish', target: { kind: 'wall', wallId: 'wl_north' }, finish: { kind: 'none' } }),
      ]);

      expect(state.surfaces).toEqual({ walls: { wl_east: sage } });
    });

    it('skips a wall that is not in the Room Setup', () => {
      const state = replay(setup, catalog, [edit('ed_1', { type: 'finish', target: { kind: 'wall', wallId: 'wl_gone' }, finish: sage })]);

      expect(state.skipped).toEqual([{ editId: 'ed_1', reason: 'missing-target' }]);
      expect(state.surfaces).toEqual({ walls: {} });
    });

    it("sets the Finish of the floor, and removes it with { kind: 'none' }", () => {
      const oak = { kind: 'material', materialId: 'oak' } as const;
      const finishFloor = edit('ed_1', { type: 'finish', target: { kind: 'floor' }, finish: oak });

      expect(replay(setup, catalog, [finishFloor]).surfaces).toEqual({ walls: {}, floor: oak });
      expect(replay(setup, catalog, [
        finishFloor,
        edit('ed_2', { type: 'finish', target: { kind: 'floor' }, finish: { kind: 'none' } }),
      ]).surfaces).toEqual({ walls: {} });
    });

    it("sets the Finish of one Part of an Original, or of every Part with '*'", () => {
      const walnut = { kind: 'material', materialId: 'walnut' } as const;

      const state = replay(setup, catalog, [
        edit('ed_1', { type: 'finish', target: { kind: 'original', originalId: 'og_desk', partId: 'top' }, finish: walnut }),
        edit('ed_2', { type: 'finish', target: { kind: 'original', originalId: 'og_bed', partId: '*' }, finish: sage }),
        edit('ed_3', { type: 'finish', target: { kind: 'original', originalId: 'og_bed', partId: 'bedding' }, finish: { kind: 'none' } }),
      ]);

      expect(state.originals.og_desk.partFinishes).toEqual({ top: walnut });
      expect(state.originals.og_bed.partFinishes).toEqual({ frame: sage });
      expect(state.skipped).toEqual([]);
    });

    it("skips an Original that is not in the Room Setup, and a Part that its category doesn't have", () => {
      const state = replay(setup, catalog, [
        edit('ed_1', { type: 'finish', target: { kind: 'original', originalId: 'og_gone', partId: '*' }, finish: sage }),
        edit('ed_2', { type: 'finish', target: { kind: 'original', originalId: 'og_desk', partId: 'cushions' }, finish: sage }),
      ]);

      expect(state.skipped).toEqual([
        { editId: 'ed_1', reason: 'missing-target' },
        { editId: 'ed_2', reason: 'unknown-part' },
      ]);
      expect(state.originals.og_desk.partFinishes).toEqual({});
    });
  });

  describe('one look per Part of an Original', () => {
    const navy: Hex = '#1f2a44';
    const oak = { kind: 'material', materialId: 'oak' } as const;
    const walnut = { kind: 'material', materialId: 'walnut' } as const;
    const recolorDesk = (id: string, partId: string, color: Hex | null) =>
      edit(id, { type: 'recolor', targetId: 'og_desk', partId, color });
    const finishDesk = (id: string, partId: string, finish: Finish) =>
      edit(id, { type: 'finish', target: { kind: 'original', originalId: 'og_desk', partId }, finish });
    // Both looks of the desk, each compared whole: a look left behind on a Part fails the test.
    const deskLooks = ({ originals: { og_desk: { partColors, partFinishes } } }: RoomState) => ({ partColors, partFinishes });

    it('a recolor after a material Finish replaces it on that Part', () => {
      const state = replay(setup, catalog, [
        finishDesk('ed_1', 'top', oak),
        finishDesk('ed_2', 'legs', walnut),
        recolorDesk('ed_3', 'top', navy),
        recolorDesk('ed_4', 'cushions', '#1a1a1a'),
      ]);

      expect(deskLooks(state)).toEqual({ partColors: { top: navy }, partFinishes: { legs: walnut } });
      expect(state.skipped).toEqual([{ editId: 'ed_4', reason: 'unknown-part' }]);
    });

    it('a Finish after a recolor replaces it on that Part', () => {
      const state = replay(setup, catalog, [
        recolorDesk('ed_1', 'top', navy),
        recolorDesk('ed_2', 'legs', '#1a1a1a'),
        finishDesk('ed_3', 'top', oak),
      ]);

      expect(deskLooks(state)).toEqual({ partColors: { legs: '#1a1a1a' }, partFinishes: { top: oak } });
      expect(state.skipped).toEqual([]);
    });

    it("Reset color keeps a Part's material", () => {
      const state = replay(setup, catalog, [
        finishDesk('ed_1', 'top', oak),
        recolorDesk('ed_2', 'legs', navy),
        recolorDesk('ed_3', '*', null),
      ]);

      expect(deskLooks(state)).toEqual({ partColors: {}, partFinishes: { top: oak } });
    });

    it("finish none clears a Part's paint too", () => {
      const state = replay(setup, catalog, [
        recolorDesk('ed_1', 'top', navy),
        recolorDesk('ed_2', 'legs', navy),
        finishDesk('ed_3', 'top', { kind: 'none' }),
      ]);

      expect(deskLooks(state)).toEqual({ partColors: { legs: navy }, partFinishes: {} });
    });

    it("'*' clears the other look on every Part", () => {
      const finishAll = finishDesk('ed_1', '*', oak);
      const recolorAll = recolorDesk('ed_2', '*', navy);

      expect(deskLooks(replay(setup, catalog, [finishAll, recolorAll])))
        .toEqual({ partColors: { top: navy, legs: navy }, partFinishes: {} });
      expect(deskLooks(replay(setup, catalog, [recolorAll, finishAll])))
        .toEqual({ partColors: {}, partFinishes: { top: oak, legs: oak } });
    });
  });

  describe('rules of thumb (§6)', () => {
    it('leaves the spot empty, with its Patch, when the Piece that replaced an Original is removed', () => {
      const state = replay(setup, catalog, [
        edit('ed_1', {
          type: 'replace', originalId: 'og_desk', pieceId: 'pc_desk', catalogId: 'desk-walnut', via: 'replace',
          placement: onFloor(1.75, -0.6),
        }),
        edit('ed_2', { type: 'remove', targetId: 'pc_desk' }),
      ]);

      expect(state.pieces).toEqual({});
      expect(state.originals.og_desk.visible).toBe(false);
      expect(state.patches).toEqual(['og_desk']);
    });

    it('never throws: Edits that point at nothing are all skipped, and the room is the Scan', () => {
      const edits = [
        edit('ed_1', { type: 'move', targetId: 'pc_gone', placement: onFloor(0, 0) }),
        edit('ed_2', { type: 'remove', targetId: 'constructor' }),
        edit('ed_3', { type: 'swap', pieceId: '__proto__', catalogId: 'desk-walnut', placement: onFloor(0, 0), via: 'swap' }),
        edit('ed_4', { type: 'recolor', targetId: 'toString', partId: '*', color: '#1a1a1a' }),
        edit('ed_5', { type: 'finish', target: { kind: 'wall', wallId: 'hasOwnProperty' }, finish: { kind: 'none' } }),
      ];

      const state = replay(setup, catalog, edits);

      expect(state.skipped.map((skip) => skip.reason)).toEqual(Array(5).fill('missing-target'));
      expect({ ...state, skipped: [] }).toEqual(replay(setup, catalog, []));
    });
  });
});

describe('what rests on something', () => {
  const lowDesk = { ...catalog.items.find(({ id }) => id === 'desk-walnut')!, id: 'desk-low', size: [0.76, 0.6, 0.5] as Vec3 };
  const withLowDesk = { ...catalog, items: [...catalog.items, lowDesk] };
  const onDesk = { position: [0.2, 0.75, 0] as Vec3, rotationY: 0, mount: 'surface' as const };
  const deskWithLamp = [place('pc_desk', 'desk-walnut', onFloor(0, 0)), place('pc_lamp', 'lamp-brass', onDesk), place('pc_chair', 'chair-ergo', onFloor(0, 0.1))];

  it('goes with it when it is moved, turning with it', () => {
    const state = replay(setup, catalog, [...deskWithLamp, edit('ed_move', { type: 'move', targetId: 'pc_desk', placement: onFloor(1, 1, Math.PI / 2) })]);

    const { position: [x, y, z], rotationY } = state.pieces.pc_lamp.placement;
    expect([x, y, z, rotationY].map((n) => Number(n.toFixed(6)))).toEqual([1, 0.75, 0.8, Number((Math.PI / 2).toFixed(6))]);
    // The chair stands on the floor under the desk's edge: it stays.
    expect(state.pieces.pc_chair.placement).toEqual(onFloor(0, 0.1));
  });

  it('goes up or down with the top of what it is swapped for', () => {
    const state = replay(setup, withLowDesk, [...deskWithLamp, edit('ed_swap', { type: 'swap', pieceId: 'pc_desk', catalogId: 'desk-low', placement: onFloor(0, 0), via: 'swap' })]);

    expect(state.pieces.pc_lamp.placement.position[1]).toBeCloseTo(0.6);
  });

  it('goes with an Original, which is then moved too', () => {
    const state = replay(withLampAndMirror, catalog, [edit('ed_move', { type: 'move', targetId: 'og_desk', placement: { position: [1.7, 0, 0.4], rotationY: -Math.PI / 2, mount: 'floor' } })]);

    expect(state.originals.og_lamp).toMatchObject({ moved: true, placement: { position: [1.7, 0.76, expect.closeTo(0.4)] } });
    expect(state.patches).toEqual(['og_lamp', 'og_desk']);
  });

  it('stays when what is beside it moves', () => {
    const beside = place('pc_lamp2', 'lamp-brass', { position: [1, 0.75, 0], rotationY: 0, mount: 'surface' });
    const state = replay(setup, catalog, [...deskWithLamp, beside, edit('ed_move', { type: 'move', targetId: 'pc_desk', placement: onFloor(-1, 0) })]);

    expect(state.pieces.pc_lamp2.placement.position).toEqual([1, 0.75, 0]);
  });
});
