import { describe, expect, it } from 'vitest';
import { replay } from '@shared/replay';
import { catalog as testCatalog, item as catalogItem, onFloor, place, setup } from '@shared/test-room';
import type { Catalog, CatalogItem, Category, Edit, RoomSetup, Vec3 } from '@shared/types';
import type { NewEdit } from '../state/store';
import { resizeCandidates, swapCandidates, swapEdit } from './swapResize';

const item = (id: string, category: Category, size: Vec3) => catalogItem(id, category, id, size);

// Desks around a 1.20 × 0.60 m target: within 15% in width and depth, or not.
const desks: Catalog = {
  version: 1,
  items: [
    item('desk-far', 'desk', [1.6, 0.75, 0.8]),       // 33% off in width
    item('desk-exact', 'desk', [1.2, 0.75, 0.6]),
    item('desk-close', 'desk', [1.1, 0.75, 0.6]),     // 8% narrower
    item('desk-edge', 'desk', [1.2, 0.75, 0.51]),     // 15% shallower
    item('desk-wide', 'desk', [1.4, 0.75, 0.6]),      // 17% wider
    item('table-exact', 'table', [1.2, 0.75, 0.6]),
  ],
};

const ids = (results: { item: CatalogItem }[]) => results.map(({ item }) => item.id);
/** Where an Edit puts its Piece, to the millimeter. */
const positionOf = (edit: NewEdit) => ('placement' in edit ? edit.placement.position.map((n) => Math.round(n * 1000) / 1000 + 0) : null);

describe('resizeCandidates', () => {
  it('offers the 3 items closest to the target size, all labeled Fits when they are within 15%', () => {
    const results = resizeCandidates(desks, { category: 'desk', targetSize: [1.2, 0.75, 0.6] });
    expect(ids(results)).toEqual(['desk-exact', 'desk-close', 'desk-edge']);
    expect(results.map(({ label }) => label)).toEqual(['fits', 'fits', 'fits']);
  });

  it('fills the 3 with Closest available when fewer than 3 fit', () => {
    const results = resizeCandidates(desks, { category: 'desk', targetSize: [1.55, 0.75, 0.75] });
    expect(ids(results)).toEqual(['desk-far', 'desk-wide', 'desk-exact']);
    expect(results.map(({ label }) => label)).toEqual(['fits', 'closest', 'closest']);
  });

  it('offers the 3 closest, labeled Closest available, when nothing fits', () => {
    const results = resizeCandidates(desks, { category: 'desk', targetSize: [1.9, 0.75, 0.9] });   // desk-far is 16% off
    expect(ids(results)).toEqual(['desk-far', 'desk-wide', 'desk-exact']);
    expect(results.every(({ label }) => label === 'closest')).toBe(true);
  });

  it('searches the category asked for, so a desk can become a table', () => {
    expect(ids(resizeCandidates(desks, { category: 'table', targetSize: [1.2, 0.75, 0.6] }))).toEqual(['table-exact']);
    expect(resizeCandidates(desks, { category: 'sofa', targetSize: [1.2, 0.75, 0.6] })).toEqual([]);
  });

  it('ignores height unless it is locked', () => {
    const catalog: Catalog = { version: 1, items: [item('desk-low', 'desk', [1.2, 0.6, 0.6]), item('desk-tall', 'desk', [1.25, 0.9, 0.62])] };
    const targetSize: Vec3 = [1.2, 0.9, 0.6];
    expect(ids(resizeCandidates(catalog, { category: 'desk', targetSize }))).toEqual(['desk-low', 'desk-tall']);
    const locked = resizeCandidates(catalog, { category: 'desk', targetSize, lockHeight: true });
    expect(ids(locked)).toEqual(['desk-tall', 'desk-low']);
    expect(locked[1].label).toBe('closest');   // 33% too short
  });

  it('never offers a Piece its own item, and still offers 3', () => {
    const results = resizeCandidates(desks, { category: 'desk', targetSize: [1.2, 0.75, 0.6], currentId: 'desk-exact' });
    expect(ids(results)).toEqual(['desk-close', 'desk-edge', 'desk-wide']);
  });
});

describe('swapCandidates', () => {
  it('lists the other items of the same category, closest in size first', () => {
    const current = desks.items.find(({ id }) => id === 'desk-exact')!;
    expect(swapCandidates(desks, current).map(({ id }) => id)).toEqual(['desk-close', 'desk-edge', 'desk-wide', 'desk-far']);
  });
});

describe('swapEdit', () => {
  const catalog: Catalog = { ...testCatalog, items: [...testCatalog.items, item('desk-oak', 'desk', [1.2, 0.75, 0.7])] };
  const walnut = catalog.items.find(({ id }) => id === 'desk-walnut')!;
  const room = (edits: Edit[] = []) => ({ setup, catalog, roomState: replay(setup, catalog, edits) });

  it('resizes an Original with a replace Edit, keeping its back against the wall', () => {
    // og_desk's back is on the East wall (x = 2), and it faces west; the walnut desk is 0.5 m deep.
    const edit = swapEdit(room(), { kind: 'original', id: 'og_desk' }, walnut, [1.2, 0.76, 0.6]);
    expect(edit).toMatchObject({
      type: 'replace', originalId: 'og_desk', pieceId: expect.stringMatching(/^pc_[0-9a-z]{8}$/), catalogId: 'desk-walnut',
      via: 'resize', targetSize: [1.2, 0.76, 0.6], placement: { rotationY: -Math.PI / 2, mount: 'floor' },
    });
    expect(positionOf(edit)).toEqual([1.75, 0, -0.6]);
  });

  it('resizes a Piece with a swap Edit, keeping its back-center where it stood', () => {
    // Mid-room, turned 30°: the oak desk is 0.2 m deeper, so its center moves 0.1 m forward.
    const roomWithDesk = room([place('pc_1', 'desk-walnut', onFloor(0, 0, Math.PI / 6))]);
    const oak = catalog.items.find(({ id }) => id === 'desk-oak')!;
    const edit = swapEdit(roomWithDesk, { kind: 'piece', id: 'pc_1' }, oak, [1.2, 0.75, 0.7]);
    expect(edit).toMatchObject({
      type: 'swap', pieceId: 'pc_1', catalogId: 'desk-oak', via: 'resize', targetSize: [1.2, 0.75, 0.7],
      placement: { rotationY: Math.PI / 6, mount: 'floor' },
    });
    expect(positionOf(edit)).toEqual([0.05, 0, 0.087]);
  });

  it('swaps a Piece without a target size as a plain swap', () => {
    const oak = catalog.items.find(({ id }) => id === 'desk-oak')!;
    const edit = swapEdit(room([place('pc_1', 'desk-walnut', onFloor(0, 0))]), { kind: 'piece', id: 'pc_1' }, oak);
    expect(edit).toMatchObject({ type: 'swap', pieceId: 'pc_1', catalogId: 'desk-oak', via: 'swap' });
    expect(edit).not.toHaveProperty('targetSize');
  });

  it('puts the new item flush against the wall when the old one stood a few cm off it', () => {
    // As scanned, the desk's back is 3 cm off the East wall.
    const offWall: RoomSetup = {
      ...setup,
      originals: setup.originals.map((o) => (o.id === 'og_desk' ? { ...o, box: { ...o.box, position: [1.67, 0, -0.6] } } : o)),
    };
    const edit = swapEdit({ setup: offWall, catalog, roomState: replay(offWall, catalog, []) }, { kind: 'original', id: 'og_desk' }, walnut, [1.2, 0.76, 0.6]);
    expect(positionOf(edit)).toEqual([1.75, 0, -0.6]);
  });

  it('replaces an Original without a target size as a plain replace', () => {
    const edit = swapEdit(room(), { kind: 'original', id: 'og_desk' }, walnut);
    expect(edit).toMatchObject({ type: 'replace', originalId: 'og_desk', catalogId: 'desk-walnut', via: 'replace' });
    expect(edit).not.toHaveProperty('targetSize');
  });

  it('leaves a Piece turned off a wall where it was, instead of squaring it up', () => {
    // Turned 15° from facing straight out of the North wall, its back 2 cm off it: a drag would snap it.
    const turned = place('pc_1', 'desk-walnut', onFloor(0, -1.23, Math.PI / 12));
    const oak = catalog.items.find(({ id }) => id === 'desk-oak')!;
    const edit = swapEdit(room([turned]), { kind: 'piece', id: 'pc_1' }, oak);
    expect(edit).toMatchObject({ placement: { rotationY: Math.PI / 12 } });
  });
});
