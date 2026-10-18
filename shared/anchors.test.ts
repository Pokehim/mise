import { describe, expect, it } from 'vitest';
import { type Along, type Anchor, type Resolution, resolveAnchor } from './anchors';
import { checkFit } from './fit';
import { replay } from './replay';
import { catalog, edit, item, onFloor, place, setup, withLampAndMirror } from './test-room';
import type { CatalogItem, Edit, Placement, RoomSetup, Vec3 } from './types';

// The room's floor is x −2 to 2, z −1.5 to 1.5. The bed covers x −2 to −1.01, z −1.5 to 0.53;
// the desk x 1.4 to 2, z −1.135 to −0.065. The window is x −0.6 to 0.6 on the North wall (z = −1.5).

const desk = catalog.items.find(({ id }) => id === 'desk-walnut')!; // 0.76 × 0.5, 0.75 tall
const chair = catalog.items.find(({ id }) => id === 'chair-ergo')!; // 0.6 × 0.6
const lamp = catalog.items.find(({ id }) => id === 'lamp-brass')!; // 0.2 × 0.2
const rug = catalog.items.find(({ id }) => id === 'rug-gray')!; // 1.52 × 2.13
const nightstand = item('nightstand-oak', 'nightstand', 'Oak Nightstand', [0.45, 0.6, 0.4]);
const sofa = item('sofa-gray', 'sofa', 'Gray Sofa', [2, 0.85, 0.9]);
const chest = item('chest-tall', 'dresser', 'Tall Chest', [0.6, 1.1, 0.45]);
const print = item('print-fern', 'wall_art', 'Fern Print', [0.6, 0.8, 0.03], { mount: 'wall' });
const plant = item('plant-fig', 'plant', 'Fiddle Leaf Fig', [0.4, 1.2, 0.4]);
const cube = item('cube-storage', 'storage', 'Storage Cube', [0.5, 0.5, 0.5]);
const furnished = { ...catalog, items: [...catalog.items, nightstand, sofa, chest, print, plant, cube] };

/** The room with nothing in it. */
const empty: RoomSetup = { ...setup, originals: [] };

/** What `catalogItem` resolves to with this Anchor, in the room after these Edits. */
const resolve = (catalogItem: CatalogItem, anchor: Anchor, edits: Edit[] = [], room: RoomSetup = setup) =>
  resolveAnchor(room, furnished, replay(room, furnished, edits), catalogItem, anchor);

/** The Placement an Anchor resolved to, failing the test when it resolved to an error. */
function placementOf(resolution: Resolution): Placement {
  if ('error' in resolution) throw new Error(resolution.error);
  return resolution.placement;
}

/** A number within 1 mm of `meters`, matched loosely enough for floating point. */
const closeTo = (meters: number) => expect.closeTo(meters, 3);

describe('resolveAnchor', () => {
  describe('against_wall', () => {
    it('puts a desk against the middle of the North wall: back flush to it, facing into the room', () => {
      // 0.5 deep, so its center is 0.25 m off the wall at z = −1.5.
      expect(resolve(desk, { kind: 'against_wall', wall_id: 'wl_north', along: 'center' })).toEqual({
        placement: { position: [closeTo(0), 0, closeTo(-1.25)], rotationY: closeTo(0), mount: 'floor' },
      });
    });

    it('goes flush with the left or right end seen from inside the room, facing the wall, or a fraction between', () => {
      const at = (wallId: string, along: Along) =>
        resolve(nightstand, { kind: 'against_wall', wall_id: wallId, along }, [], empty);

      // The nightstand is 0.45 wide, so it can stand anywhere from x −1.775 to 1.775 along the North wall.
      expect(at('wl_north', 'left')).toMatchObject({ placement: { position: [closeTo(-1.775), 0, closeTo(-1.3)] } });
      expect(at('wl_north', 'right')).toMatchObject({ placement: { position: [closeTo(1.775), 0, closeTo(-1.3)] } });
      expect(at('wl_north', 0.25)).toMatchObject({ placement: { position: [closeTo(-0.8875), 0, closeTo(-1.3)] } });
      // Facing the South wall from inside, its left end is the east corner.
      expect(at('wl_south', 'right')).toEqual({
        placement: { position: [closeTo(-1.775), 0, closeTo(1.3)], rotationY: closeTo(Math.PI), mount: 'floor' },
      });
    });

    it('slides along the wall, in 10 cm steps, to the nearest spot that breaks no Fit rule', () => {
      // At the right end, x 1.24–2, it would overlap the desk, which starts at x = 1.4: 0.6 m to the left, it's flush with it.
      expect(resolve(desk, { kind: 'against_wall', wall_id: 'wl_north', along: 'right' })).toEqual({
        placement: { position: [closeTo(1.02), 0, closeTo(-1.25)], rotationY: closeTo(0), mount: 'floor' },
      });
    });

    it("returns an error, with the violations where it asked for, when nothing within 1 m fits", () => {
      // The bed takes 2.03 m of the 3 m West wall, so a 2 m sofa against it always overlaps the bed.
      expect(resolve(sofa, { kind: 'against_wall', wall_id: 'wl_west', along: 'center' })).toEqual({
        error: "Gray Sofa doesn't fit there, even slid up to 1 m either way",
        violations: [{ rule: 'overlap', subjectId: 'sofa-gray', otherId: 'og_bed', message: 'Overlaps your bed' }],
      });
    });

    it('returns an error for a wall the room does not have', () => {
      expect(resolve(desk, { kind: 'against_wall', wall_id: 'wl_9', along: 'center' })).toEqual({
        error: 'The room has no wall "wl_9"', violations: [],
      });
    });

    it('returns an error for a fraction past either end, or an item wider than the wall', () => {
      expect(resolve(desk, { kind: 'against_wall', wall_id: 'wl_north', along: 1.5 })).toEqual({
        error: 'along goes from 0 (the left end) to 1 (the right end), not 1.5', violations: [],
      });
      const counter = item('counter-long', 'table', 'Long Counter', [4.2, 0.9, 0.6]);
      expect(resolve(counter, { kind: 'against_wall', wall_id: 'wl_north', along: 'center' })).toEqual({
        error: 'Long Counter is wider than the North wall', violations: [],
      });
    });
  });

  describe('beside', () => {
    it('stands next to the target, backs in line: left and right are as seen facing its front', () => {
      // The bed faces south (+z), so its right is the room side, x > −1.01; its back is on the North wall.
      expect(resolve(nightstand, { kind: 'beside', target_id: 'og_bed', side: 'right' })).toEqual({
        placement: { position: [closeTo(-0.785), 0, closeTo(-1.3)], rotationY: closeTo(0), mount: 'floor' },
      });
      // The desk faces west, so its right is south of it, z > −0.065; its back is on the East wall.
      expect(resolve(nightstand, { kind: 'beside', target_id: 'og_desk', side: 'right' })).toEqual({
        placement: { position: [closeTo(1.8), 0, closeTo(0.16)], rotationY: closeTo(-Math.PI / 2), mount: 'floor' },
      });
    });

    it("slides along the target's side, so that it stays next to it", () => {
      // A cube already stands at the bed's right, against the North wall, to z −1: 0.5 m toward the foot, the nightstand clears it.
      const cubeByBed = place('pc_cube', 'cube-storage', onFloor(-0.76, -1.25));

      expect(resolve(nightstand, { kind: 'beside', target_id: 'og_bed', side: 'right' }, [cubeByBed])).toEqual({
        placement: { position: [closeTo(-0.785), 0, closeTo(-0.8)], rotationY: closeTo(0), mount: 'floor' },
      });
    });

    it('stands in front of the target facing it, like a chair pulled up to a desk', () => {
      expect(resolve(chair, { kind: 'beside', target_id: 'og_desk', side: 'front' })).toEqual({
        placement: { position: [closeTo(1.1), 0, closeTo(-0.6)], rotationY: closeTo(Math.PI / 2), mount: 'floor' },
      });
    });

    it('returns an error for a target that is not in the room, such as a removed Original', () => {
      const removeDesk = edit('ed_1', { type: 'remove', targetId: 'og_desk' });

      expect(resolve(chair, { kind: 'beside', target_id: 'og_desk', side: 'front' }, [removeDesk])).toEqual({
        error: 'The room has no Original or Piece "og_desk"', violations: [],
      });
    });
  });

  describe('under_window', () => {
    it('centers the item below the window, back flush to its wall', () => {
      expect(resolve(nightstand, { kind: 'under_window', opening_id: 'op_window' })).toEqual({
        placement: { position: [closeTo(0), 0, closeTo(-1.3)], rotationY: closeTo(0), mount: 'floor' },
      });
    });

    it('slides an item taller than the sill along the wall until it clears the window', () => {
      // 1.1 m tall under a 0.9 m sill: 0.9 m along, x 0.6–1.2, it's just past the window's edge at x = 0.6.
      expect(resolve(chest, { kind: 'under_window', opening_id: 'op_window' })).toMatchObject({
        placement: { position: [closeTo(0.9), 0, closeTo(-1.275)] },
      });
    });

    it('returns an error for a door', () => {
      expect(resolve(nightstand, { kind: 'under_window', opening_id: 'op_door' })).toEqual({
        error: 'op_door is a door, not a window', violations: [],
      });
    });
  });

  describe('on_wall', () => {
    it('hangs the item flat on the wall, its center 1.45 m up unless asked otherwise', () => {
      // 0.8 tall: from 1.05 to 1.85 m up. Facing the West wall from inside, its left end is the south one.
      expect(resolve(print, { kind: 'on_wall', wall_id: 'wl_west', along: 'center' })).toEqual({
        placement: {
          position: [closeTo(-1.985), closeTo(1.05), closeTo(0)], rotationY: closeTo(Math.PI / 2), mount: 'wall', wallId: 'wl_west',
        },
      });
      expect(resolve(print, { kind: 'on_wall', wall_id: 'wl_west', along: 'left', center_height_m: 1.2 })).toMatchObject({
        placement: { position: [closeTo(-1.985), closeTo(0.8), closeTo(1.2)] },
      });
    });

    it('is the only Anchor for an item that hangs on a wall, and only for one', () => {
      expect(resolve(print, { kind: 'against_wall', wall_id: 'wl_west', along: 'center' })).toEqual({
        error: 'Fern Print hangs on a wall: use on_wall', violations: [],
      });
      expect(resolve(sofa, { kind: 'on_wall', wall_id: 'wl_west', along: 'center' })).toEqual({
        error: 'Gray Sofa stands on the floor: on_wall is for wall items', violations: [],
      });
    });

    it("slides along the wall off a window, and doesn't reach past the floor or the ceiling", () => {
      // The window takes x −0.6 to 0.6, 0.9 to 2.1 m up: 0.9 m along, at x 0.6 to 1.2, the print is beside it.
      expect(resolve(print, { kind: 'on_wall', wall_id: 'wl_north', along: 'center' })).toMatchObject({
        placement: { position: [closeTo(0.9), closeTo(1.05), closeTo(-1.485)] },
      });
      // 0.9 m wide, a print would have to slide 1.05 m to clear the window.
      const widePrint = item('print-wide', 'wall_art', 'Wide Print', [0.9, 1.2, 0.03], { mount: 'wall' });
      expect(resolve(widePrint, { kind: 'on_wall', wall_id: 'wl_north', along: 'center' })).toEqual({
        error: "Wide Print doesn't fit there, even slid up to 1 m either way: there, it would hang over op_window", violations: [],
      });
      expect(resolve(print, { kind: 'on_wall', wall_id: 'wl_north', along: 'left', center_height_m: 2.4 })).toEqual({
        error: "Fern Print, 0.8 m tall, doesn't fit on the North wall 2.4 m up: the wall is 2.6 m tall", violations: [],
      });
    });

    it('slides along the wall past another wall item', () => {
      // The mirror hangs at z −0.25 to 0.25, 1 to 1.8 m up: 0.6 m north, at z −0.9 to −0.3, the print clears it.
      expect(resolve(print, { kind: 'on_wall', wall_id: 'wl_west', along: 'center' }, [], withLampAndMirror)).toMatchObject({
        placement: { position: [closeTo(-1.985), closeTo(1.05), closeTo(-0.6)] },
      });
    });
  });

  describe('on_top_of', () => {
    it("rests the item on the target's top, turned the same way", () => {
      // The desk is 0.76 m tall.
      expect(resolve(lamp, { kind: 'on_top_of', target_id: 'og_desk' })).toEqual({
        placement: { position: [closeTo(1.7), closeTo(0.76), closeTo(-0.6)], rotationY: closeTo(-Math.PI / 2), mount: 'surface' },
      });
    });

    it('slides along the top past something already on it, and never off it', () => {
      // The lamp already on the desk takes z −0.7 to −0.5; the desk top runs from z −1.135 to −0.065.
      expect(resolve(lamp, { kind: 'on_top_of', target_id: 'og_desk' }, [], withLampAndMirror)).toMatchObject({
        placement: { position: [closeTo(1.7), closeTo(0.76), closeTo(-0.4)] },
      });
    });

    it('returns an error when the item is bigger than the top', () => {
      expect(resolve(sofa, { kind: 'on_top_of', target_id: 'og_desk' })).toEqual({
        error: "Gray Sofa doesn't fit on top of og_desk", violations: [],
      });
    });
  });

  describe('centered_under', () => {
    it('lays a rug centered under the target, its long side across it, with a third of it under the target', () => {
      // The sofa faces south from the North wall, z −1.5 to −0.6. Turned, the rug is 2.13 wide and 1.52 deep:
      // z −1.107 to 0.413, so 0.507 m of it is under the sofa.
      const sofaOnNorthWall = place('pc_sofa', 'sofa-gray', onFloor(0, -1.05));

      expect(resolve(rug, { kind: 'centered_under', target_id: 'pc_sofa' }, [sofaOnNorthWall], empty)).toEqual({
        placement: { position: [closeTo(0), 0, closeTo(-0.3467)], rotationY: closeTo(Math.PI / 2), mount: 'floor' },
      });
    });

    it('slides the rug further under the target when the floor in front of it runs out', () => {
      // With the sofa's front at z = 0.65, a third under would reach z 1.663, past the South wall at 1.5: 0.2 m further under, it fits.
      const sofaMidRoom = place('pc_sofa', 'sofa-gray', onFloor(0, 0.2));

      expect(resolve(rug, { kind: 'centered_under', target_id: 'pc_sofa' }, [sofaMidRoom], empty)).toMatchObject({
        placement: { position: [closeTo(0), 0, closeTo(0.7033)] },
      });
    });

    it("returns an error when the target is too near a wall to center the rug on, as the bed is", () => {
      // Turned across the bed, the rug is 2.13 m wide, but the bed's center is 0.495 m from the West wall.
      expect(resolve(rug, { kind: 'centered_under', target_id: 'og_bed' })).toEqual({
        error: "Mainstays 5×7 Rug doesn't fit there, even slid up to 1 m either way",
        violations: [{ rule: 'outside-floor', subjectId: 'rug-gray', message: 'Outside the room' }],
      });
    });

    it('returns an error for anything but a rug', () => {
      expect(resolve(nightstand, { kind: 'centered_under', target_id: 'og_bed' })).toEqual({
        error: 'Only a rug goes centered under something: Oak Nightstand is a nightstand', violations: [],
      });
    });
  });

  describe('open_floor', () => {
    /** The gap between a square item `size` wide at `position` and a rectangle square to the room, from x0, z0 to x1, z1. */
    const gap = ([x, , z]: Vec3, size: number, [x0, z0, x1, z1]: [number, number, number, number]) =>
      Math.hypot(Math.max(0, x0 - x - size / 2, x - x1 - size / 2), Math.max(0, z0 - z - size / 2, z - z1 - size / 2));

    it('puts the item in the largest free spot: over 1 m from every wall and item', () => {
      const { position } = placementOf(resolve(plant, { kind: 'open_floor' }));

      expect(Math.min(2 - Math.abs(position[0]), 1.5 - Math.abs(position[2]))).toBeGreaterThan(1); // the walls
      expect(gap(position, 0, [-2, -1.5, -1.01, 0.53])).toBeGreaterThan(1); // the bed
      expect(gap(position, 0, [1.4, -1.135, 2, -0.065])).toBeGreaterThan(1); // the desk
    });

    it('puts the item in the free spot nearest to the target, given one', () => {
      const { position } = placementOf(resolve(plant, { kind: 'open_floor', near_id: 'og_bed' }));

      expect(gap(position, 0.4, [-2, -1.5, -1.01, 0.53])).toBeLessThan(0.1);
    });

    it('passes over free spots that would block the walkway', () => {
      // A 2 m sofa in the largest free spots, mid-room, would be in the door's swing or close off the desk from the door.
      const placement = placementOf(resolve(sofa, { kind: 'open_floor' }));

      expect(checkFit(setup, furnished, replay(setup, furnished, [place('pc_sofa', 'sofa-gray', placement)]))).toEqual([]);
    });

    it('returns an error when no open floor fits the item', () => {
      const banquet = item('table-banquet', 'table', 'Banquet Table', [3.5, 0.75, 1]);

      expect(resolve(banquet, { kind: 'open_floor' })).toEqual({ error: 'No open floor fits Banquet Table', violations: [] });
    });
  });
});
