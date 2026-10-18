import { describe, expect, it } from 'vitest';
import type { Edit } from '@shared/types';
import { replay } from '@shared/replay';
import { catalog, edit, onFloor, place, setup } from '@shared/test-room';
import { OPENING_DEPTH, PAD, SLAB, splatEditPlan, wallSlab } from './splatEdits';
import { REGION_GROW } from './patchFrames';

const plan = (edits: Edit[]) => splatEditPlan(setup, replay(setup, catalog, edits));

describe('splatEditPlan', () => {
  it('leaves an untouched room all splat, with every mesh node hidden', () => {
    expect(plan([])).toEqual({ sdfs: [], mesh: { walls: [], originals: [], floor: false }, patches: [] });
  });

  it('ignores Pieces, which render on top as meshes', () => {
    expect(plan([place('pc_chair', 'chair-ergo', onFloor(0, 0))]).sdfs).toEqual([]);
  });

  it('hides a painted Wall as a thin slab and shows its node, keeping its Opening', () => {
    const { sdfs, mesh } = plan([edit('ed_paint', { type: 'finish', target: { kind: 'wall', wallId: 'wl_north' }, finish: { kind: 'paint', color: '#9caf88' } })]);

    expect(mesh).toEqual({ walls: ['wl_north'], originals: [], floor: false });
    const [slab, window] = sdfs;
    expect(slab).toMatchObject({ id: 'wl_north', opacity: 0, center: [0, 1.3, -1.5], size: [4, 2.6, 2 * SLAB] });
    expect(slab.rotationY).toBeCloseTo(0);
    // The window starts 1.4 m from the wall's start at x = −2, and is 1.2 m wide, 0.9–2.1 m up.
    expect(window).toMatchObject({ id: 'op_window', opacity: 1, size: [1.2, 1.2, 2 * (SLAB + OPENING_DEPTH)] });
    window.center.forEach((v, i) => expect(v).toBeCloseTo([0, 1.5, -1.5][i]));
    expect(sdfs).toHaveLength(2);
  });

  it('turns the slab of a Wall that runs along Z to lie along it', () => {
    const [slab] = plan([edit('ed_paint', { type: 'finish', target: { kind: 'wall', wallId: 'wl_east' }, finish: { kind: 'paint', color: '#9caf88' } })]).sdfs;

    // Box +X turned by rotationY points along (cos, −sin): from (2, −1.5) toward (2, 1.5).
    expect(Math.cos(slab.rotationY)).toBeCloseTo(0);
    expect(-Math.sin(slab.rotationY)).toBeCloseTo(1);
    expect(slab.size[0]).toBeCloseTo(3);
  });

  it('hides a slab over the whole Floor once it has a Finish', () => {
    const { sdfs, mesh } = plan([edit('ed_floor', { type: 'finish', target: { kind: 'floor' }, finish: { kind: 'material', materialId: 'oak' } })]);

    expect(mesh.floor).toBe(true);
    expect(sdfs).toEqual([{ id: 'floor', center: [0, 0, 0], size: [4, 2 * SLAB, 3], rotationY: 0, opacity: 0 }]);
  });

  it('goes back to the splat when a Finish is cleared', () => {
    const target = { kind: 'wall', wallId: 'wl_north' } as const;
    const { sdfs, mesh } = plan([
      edit('ed_paint', { type: 'finish', target, finish: { kind: 'paint', color: '#9caf88' } }),
      edit('ed_clear', { type: 'finish', target, finish: { kind: 'none' } }),
    ]);

    expect(sdfs).toEqual([]);
    expect(mesh.walls).toEqual([]);
  });

  it('hides a recolored Original just past its box and shows its node in place, with no Patch', () => {
    const { sdfs, mesh, patches } = plan([edit('ed_tint', { type: 'recolor', targetId: 'og_bed', partId: '*', color: '#334455' })]);

    expect(sdfs).toEqual([{ id: 'og_bed', center: [-1.505, 0.3, -0.485], size: [0.99 + 2 * PAD, 0.6 + 2 * PAD, 2.03 + 2 * PAD], rotationY: 0, opacity: 0 }]);
    expect(mesh.originals).toEqual(['og_bed']);
    expect(patches).toEqual([]);
  });

  it('hides a moved Original over its Patch region, its box grown by 10 cm, and shows both', () => {
    const { sdfs, mesh, patches } = plan([edit('ed_move', { type: 'move', targetId: 'og_desk', placement: onFloor(0, 1) })]);

    expect(REGION_GROW).toBe(0.1);
    expect(sdfs).toHaveLength(1);
    expect(sdfs[0]).toMatchObject({ id: 'og_desk', center: [1.7, 0.38, -0.6], rotationY: -Math.PI / 2, opacity: 0 });
    sdfs[0].size.forEach((v, i) => expect(v).toBeCloseTo([1.27, 0.96, 0.8][i]));
    expect(mesh.originals).toEqual(['og_desk']);
    expect(patches).toEqual(['og_desk']);
  });

  it('hides a replaced Original over its Patch region without showing its node', () => {
    const replaced = edit('ed_swap', { type: 'replace', originalId: 'og_desk', pieceId: 'pc_desk', catalogId: 'desk-walnut', placement: onFloor(1.7, -0.6, -Math.PI / 2), via: 'replace' });
    const { sdfs, mesh, patches } = plan([replaced]);

    expect(sdfs.map((s) => s.id)).toEqual(['og_desk']);
    expect(sdfs[0].size[0]).toBeCloseTo(1.07 + 2 * REGION_GROW);
    expect(mesh.originals).toEqual([]);
    expect(patches).toEqual(['og_desk']);
  });

  it('touches only what the Edits touched', () => {
    const { sdfs, mesh } = plan([
      edit('ed_remove', { type: 'remove', targetId: 'og_desk' }),
      edit('ed_paint', { type: 'finish', target: { kind: 'wall', wallId: 'wl_south' }, finish: { kind: 'paint', color: '#9caf88' } }),
    ]);

    expect(sdfs.map((s) => [s.id, s.opacity])).toEqual([['og_desk', 0], ['wl_south', 0], ['op_door', 1]]);
    expect(mesh).toEqual({ walls: ['wl_south'], originals: [], floor: false });
  });
});

describe('wallSlab', () => {
  it('reaches further out of the room than into it when asked', () => {
    const north = setup.walls.find((w) => w.id === 'wl_north')!;
    const slab = wallSlab(north, 0.05, 0.3);

    // The North wall's normal is +Z, so its outside is toward −Z.
    expect(slab.size[2]).toBeCloseTo(0.35);
    expect(slab.center[2]).toBeCloseTo(-1.5 - 0.125);
  });
});
