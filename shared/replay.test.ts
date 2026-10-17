import { describe, expect, it } from 'vitest';
import { replay } from './replay';
import { catalog, edit, onFloor, setup, withLampAndMirror } from './test-room';

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

  describe('place', () => {
    it('adds the Piece, with no colors', () => {
      const state = replay(setup, catalog, [
        edit('ed_1', { type: 'place', pieceId: 'pc_chair', catalogId: 'chair-ergo', placement: onFloor(0, 0) }),
      ]);

      expect(state.pieces).toEqual({ pc_chair: { catalogId: 'chair-ergo', placement: onFloor(0, 0), partColors: {} } });
      expect(state.skipped).toEqual([]);
    });

    it('skips a pieceId that is already taken, by a Piece or an Original', () => {
      const state = replay(setup, catalog, [
        edit('ed_1', { type: 'place', pieceId: 'pc_chair', catalogId: 'chair-ergo', placement: onFloor(0, 0) }),
        edit('ed_2', { type: 'place', pieceId: 'pc_chair', catalogId: 'desk-walnut', placement: onFloor(1, 1) }),
        edit('ed_3', { type: 'place', pieceId: 'og_desk', catalogId: 'desk-walnut', placement: onFloor(1, 1) }),
      ]);

      expect(state.pieces).toEqual({ pc_chair: { catalogId: 'chair-ergo', placement: onFloor(0, 0), partColors: {} } });
      expect(state.skipped).toEqual([
        { editId: 'ed_2', reason: 'duplicate-id' },
        { editId: 'ed_3', reason: 'duplicate-id' },
      ]);
    });

    it('skips a catalogId that is not in the Catalog', () => {
      const state = replay(setup, catalog, [
        edit('ed_1', { type: 'place', pieceId: 'pc_sofa', catalogId: 'no-such-item', placement: onFloor(0, 0) }),
      ]);

      expect(state.pieces).toEqual({});
      expect(state.skipped).toEqual([{ editId: 'ed_1', reason: 'unknown-catalog' }]);
    });
  });

  describe('move', () => {
    const placeChair = edit('ed_1', { type: 'place', pieceId: 'pc_chair', catalogId: 'chair-ergo', placement: onFloor(0, 0) });

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
        edit('ed_1', { type: 'place', pieceId: 'pc_chair', catalogId: 'chair-ergo', placement: onFloor(0, 0) }),
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
    const placeChair = edit('ed_1', { type: 'place', pieceId: 'pc_1', catalogId: 'chair-ergo', placement: onFloor(0, 0) });

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
      edit(id, { type: 'replace', originalId: 'og_desk', pieceId, catalogId, placement: onFloor(1.75, -0.6, -Math.PI / 2), via: 'replace' });

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
        edit('ed_1', { type: 'replace', originalId: 'og_bed', pieceId: 'pc_1', catalogId: 'desk-walnut', placement: onFloor(0, 0), via: 'replace' }),
        edit('ed_2', { type: 'replace', originalId: 'og_gone', pieceId: 'pc_2', catalogId: 'desk-walnut', placement: onFloor(0, 0), via: 'replace' }),
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
        edit('ed_1', { type: 'place', pieceId: 'pc_1', catalogId: 'chair-ergo', placement: onFloor(0, 0) }),
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
    const placeChair = edit('ed_1', { type: 'place', pieceId: 'pc_1', catalogId: 'chair-ergo', placement: onFloor(0, 0) });

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

  describe('rules of thumb (§6)', () => {
    it('leaves the spot empty, with its Patch, when the Piece that replaced an Original is removed', () => {
      const state = replay(setup, catalog, [
        edit('ed_1', {
          type: 'replace', originalId: 'og_desk', pieceId: 'pc_desk', catalogId: 'desk-walnut', placement: onFloor(1.75, -0.6), via: 'replace',
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
