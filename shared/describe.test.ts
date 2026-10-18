import { describe, expect, it } from 'vitest';
import { describe as describeEdit } from './describe';
import { catalog, edit, onFloor, setup } from './test-room';

// The ** around names in the §6 examples are the spec's emphasis, not part of the text.
describe('describe', () => {
  const history = (fields: Parameters<typeof edit>[1]) => describeEdit(edit('ed_1', fields), setup, catalog);

  it('names the Catalog item a place Edit added', () => {
    expect(history({ type: 'place', pieceId: 'pc_1', catalogId: 'rug-gray', placement: onFloor(0, 0) })).toBe('Placed Mainstays 5×7 Rug');
  });

  it('names the category and the new item of a swap made by Resize', () => {
    expect(history({
      type: 'swap', pieceId: 'pc_1', catalogId: 'desk-walnut', placement: onFloor(0, 0), via: 'resize', targetSize: [0.8, 0.75, 0.5],
    })).toBe('Resized desk → 30″ Walnut Desk');
  });

  it('names the category and the new item of a swap, with the category in words', () => {
    const print = { ...catalog.items[0], id: 'print-fern', category: 'wall_art', title: 'Fern Print', mount: 'wall' } as const;
    const swap = edit('ed_1', { type: 'swap', pieceId: 'pc_1', catalogId: 'print-fern', placement: onFloor(0, 0), via: 'swap' });

    expect(describeEdit(swap, setup, { ...catalog, items: [...catalog.items, print] })).toBe('Swapped wall art → Fern Print');
  });

  it("calls an Original the Mover's own, and names the item that replaced it", () => {
    expect(history({
      type: 'replace', originalId: 'og_desk', pieceId: 'pc_1', catalogId: 'desk-walnut', placement: onFloor(1.75, -0.6), via: 'replace',
    })).toBe('Replaced your desk with 30″ Walnut Desk');
  });

  it('describes a replace made by Resize like a resized swap', () => {
    expect(history({
      type: 'replace', originalId: 'og_desk', pieceId: 'pc_1', catalogId: 'desk-walnut', placement: onFloor(1.75, -0.6), via: 'resize',
    })).toBe('Resized your desk → 30″ Walnut Desk');
  });

  it('names the wall and the paint color of a finish', () => {
    expect(history({ type: 'finish', target: { kind: 'wall', wallId: 'wl_north' }, finish: { kind: 'paint', color: '#9caf88' } }))
      .toBe('Painted North wall · Sage');
  });

  // A Piece's item is only known from the Edits before it, which describe doesn't get.
  it('names the Part of a recolored Piece, and the nearest named color', () => {
    expect(history({ type: 'recolor', targetId: 'pc_1', partId: 'legs', color: '#1a1a1a' })).toBe('Recolored legs · Black');
  });

  it('names the Original and the Part of a recolored Original', () => {
    expect(history({ type: 'recolor', targetId: 'og_bed', partId: 'frame', color: '#1f2a44' })).toBe('Recolored your bed frame · Navy');
  });

  it("names the whole Original, or all Parts of a Piece, when the partId is '*'", () => {
    expect(history({ type: 'recolor', targetId: 'og_bed', partId: '*', color: '#9caf88' })).toBe('Recolored your bed · Sage');
    expect(history({ type: 'recolor', targetId: 'pc_1', partId: '*', color: '#9caf88' })).toBe('Recolored all Parts · Sage');
  });

  it('says a recolor with no color cleared it', () => {
    expect(history({ type: 'recolor', targetId: 'pc_1', partId: 'legs', color: null })).toBe('Cleared the color of legs');
  });

  it('names a moved Original; a moved Piece is "a Piece"', () => {
    expect(history({ type: 'move', targetId: 'og_desk', placement: onFloor(0, 1) })).toBe('Moved your desk');
    expect(history({ type: 'move', targetId: 'pc_1', placement: onFloor(0, 1) })).toBe('Moved a Piece');
  });

  it('names a removed Original; a removed Piece is "a Piece"', () => {
    expect(history({ type: 'remove', targetId: 'og_desk' })).toBe('Removed your desk');
    expect(history({ type: 'remove', targetId: 'pc_1' })).toBe('Removed a Piece');
  });

  it('names a moved or removed Piece by its item when the Pieces so far are given, with the given namer', () => {
    const pieces = new Map([['pc_1', 'rug-gray']]);
    const short = { name: () => 'Rug', pieces };
    expect(describeEdit(edit('ed_1', { type: 'move', targetId: 'pc_1', placement: onFloor(0, 1) }), setup, catalog, { pieces })).toBe('Moved the Mainstays 5×7 Rug');
    expect(describeEdit(edit('ed_1', { type: 'remove', targetId: 'pc_1' }), setup, catalog, short)).toBe('Removed the Rug');
    expect(describeEdit(edit('ed_1', { type: 'place', pieceId: 'pc_2', catalogId: 'rug-gray', placement: onFloor(0, 0) }), setup, catalog, short)).toBe('Placed Rug');
  });

  it("says a finish of { kind: 'none' } reset the Surface to the scanned look", () => {
    expect(history({ type: 'finish', target: { kind: 'wall', wallId: 'wl_north' }, finish: { kind: 'none' } }))
      .toBe('Reset North wall to scanned');
  });

  it('names the material of a finish on the floor', () => {
    expect(history({ type: 'finish', target: { kind: 'floor' }, finish: { kind: 'material', materialId: 'oak' } }))
      .toBe('Finished the floor · Oak');
  });

  it('names the Original and the Part of a finish on an Original', () => {
    expect(history({
      type: 'finish', target: { kind: 'original', originalId: 'og_bed', partId: 'frame' }, finish: { kind: 'paint', color: '#1f2a44' },
    })).toBe('Painted your bed frame · Navy');
  });

  // Skipped Edits still get a History row, so what they point at may be gone.
  it('still reads as words when the item, Original or wall is gone', () => {
    expect(history({ type: 'place', pieceId: 'pc_1', catalogId: 'B0GONE', placement: onFloor(0, 0) })).toBe('Placed B0GONE');
    expect(history({ type: 'swap', pieceId: 'pc_1', catalogId: 'B0GONE', placement: onFloor(0, 0), via: 'resize' }))
      .toBe('Resized a Piece → B0GONE');
    expect(history({
      type: 'replace', originalId: 'og_gone', pieceId: 'pc_1', catalogId: 'desk-walnut', placement: onFloor(0, 0), via: 'replace',
    }))
      .toBe('Replaced an Original with 30″ Walnut Desk');
    expect(history({ type: 'finish', target: { kind: 'wall', wallId: 'wl_gone' }, finish: { kind: 'paint', color: '#9caf88' } }))
      .toBe('Painted a wall · Sage');
  });
});
