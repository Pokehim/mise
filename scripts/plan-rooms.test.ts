import { describe, expect, it } from 'vitest';
import { checkFit } from '../shared/fit';
import { replay } from '../shared/replay';
import { catalog as testCatalog, item } from '../shared/test-room';
import { moveInDesign, type PlanRoom, planSetup, settleOrDrop, surfacesFor } from './plan-rooms';

/** The shared tests' Catalog, plus a twin bed. */
const catalog = { ...testCatalog, items: [...testCatalog.items, item('bed-twin', 'bed', 'Twin Bed', [0.99, 0.62, 2.03])] };

/** A 4 × 3 m room read off a plan: a window in the North wall, a door in the South, a bed and a desk. */
const plan: PlanRoom = {
  id: 'test-hall-double', school: 'Test U', hall: 'Test Hall', roomType: 'Double', name: 'Test U · Test Hall double',
  sourceUrls: [], derivedFrom: 'printed dimensions', ceilingHeightM: null, confidence: 'high',
  finishes: { floor: 'carpet tile', walls: 'painted cinderblock', ceiling: 'acoustic tile' },
  polygon: [[-2, -1.5], [2, -1.5], [2, 1.5], [-2, 1.5]],
  openings: [
    { kind: 'window', wall: 0, offsetM: 1.4, widthM: 1.2 },
    { kind: 'door', wall: 2, offsetM: 0.3, widthM: 0.9, swing: 'in-left' },
  ],
  furniture: [
    { label: 'Bed', category: 'bed', center: [-1.5, 0], size: [0.99, 0.6, 2.03], facing: 'south' },
    { label: 'Desk', category: 'desk', center: [1.69, -0.6], size: [1.07, 0.76, 0.6], facing: 'west' },
  ],
};

describe('planSetup', () => {
  it('makes one wall per polygon edge, and puts each Opening on the edge the plan names', () => {
    const setup = planSetup(plan, 'test');
    expect(setup.walls.map(({ start }) => start)).toEqual(plan.polygon);
    expect(setup.openings).toEqual([
      { id: 'op_1', kind: 'window', wallId: setup.walls[0].id, offset: 1.4, width: 1.2, bottom: 0.9, height: 1.3 },
      { id: 'op_2', kind: 'door', wallId: setup.walls[2].id, offset: 0.3, width: 0.9, bottom: 0, height: 2.03, swing: 'in-left' },
    ]);
    // No ceiling height on the plan, so a typical one.
    expect(setup.ceilingHeight).toBe(2.6);
    expect(setup.originals).toEqual([]);
  });

  it('reads what the room is made of from its finishes', () => {
    expect(surfacesFor(plan, 'test')).toMatchObject({ walls: 'cinderblock', floor: 'carpet-grey', ceiling: 'acoustic-tile', baseboard: 'rubber' });
    const wood = { ...plan, finishes: { floor: 'vinyl plank', walls: 'painted drywall', ceiling: 'concrete' } };
    expect(surfacesFor(wood, 'test')).toMatchObject({ walls: 'drywall', floor: 'oak', ceiling: 'drywall', baseboard: 'wood' });
  });
});

describe('moveInDesign', () => {
  it("places each piece from the Catalog, turned to face the plan's way, its back where the plan's is", () => {
    const design = moveInDesign(plan, catalog, '2026-10-18T08:00:00.000Z');
    const [bed, desk] = design.edits.map((edit) => (edit.type === 'place' ? edit : null)!);
    expect(bed.placement.rotationY).toBe(0);
    expect(desk.placement.rotationY).toBeCloseTo(-Math.PI / 2);
    // The desk's back stays against the East wall (x = 2), whatever the Catalog desk's depth.
    const depth = catalog.items.find(({ id }) => id === desk.catalogId)!.size[2];
    expect(desk.placement.position[0] + depth / 2).toBeCloseTo(1.99, 2);
  });

  it('settles the layout so it breaks no Fit rule', () => {
    const setup = planSetup(plan, 'test');
    const crowded: PlanRoom = {
      ...plan,
      furniture: [...plan.furniture, { label: 'Chair', category: 'chair', center: [1.6, -0.6], size: [0.45, 0.85, 0.45], facing: 'east' }],
    };
    const design = moveInDesign(crowded, catalog, '2026-10-18T08:00:00.000Z');
    settleOrDrop(setup, catalog, design);
    expect(checkFit(setup, catalog, replay(setup, catalog, design.edits))).toEqual([]);
  });
});
