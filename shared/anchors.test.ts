import { describe, expect, it } from 'vitest';
import { type Along, type Anchor, type Resolution, resolveAnchor } from './anchors';
import { checkFit } from './fit';
import { replay } from './replay';
import { catalog, edit, item, onFloor, place, setup, withLampAndMirror } from './test-room';
import type { CatalogItem, Edit, Placement, RoomSetup, Vec2, Vec3 } from './types';

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
const wardrobe = item('wardrobe-white', 'wardrobe', 'White Wardrobe', [1, 1.8, 0.58]);
const smallRug = item('rug-small', 'rug', 'Small Rug', [1.2, 0.01, 1]);
const poster = item('poster-city', 'wall_art', 'City Poster', [0.4, 0.5, 0.02], { mount: 'wall' });
const table = item('table-oak', 'table', 'Oak Table', [1.5, 0.75, 0.9]);
const twinBed = item('bed-twin', 'bed', 'Twin XL Bed', [0.99, 0.6, 2.03]);
const furnished = { ...catalog, items: [...catalog.items, nightstand, sofa, chest, print, plant, cube, smallRug, wardrobe, poster, table, twinBed] };

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

/** A number within half a millimeter of `meters`, loose enough for floating point. */
const closeTo = (meters: number) => expect.closeTo(meters, 3);

describe('resolveAnchor', () => {
  describe('in_corner', () => {
    it('lays a bed along the wall, its long side flush to it and its head in the corner, as a dorm bed goes', () => {
      // The West wall runs from its left end at the South wall (z = 1.5) to the North wall. The bed's head
      // is at the South wall, so its center is 1.015 m north of it, and 0.495 m off the West wall.
      expect(resolve(twinBed, { kind: 'in_corner', wall_id: 'wl_west', end: 'left' }, [], empty)).toEqual({
        placement: { position: [closeTo(-1.505), 0, closeTo(0.485)], rotationY: closeTo(Math.PI), mount: 'floor' },
      });
    });

    it('stands anything but a bed with its back to the wall at that end', () => {
      expect(resolve(chest, { kind: 'in_corner', wall_id: 'wl_north', end: 'right' }, [], empty))
        .toEqual(resolve(chest, { kind: 'against_wall', wall_id: 'wl_north', along: 'right' }, [], empty));
    });

    it('slides out of the corner along the wall when something stands in it, and fails where it would block the door', () => {
      // A storage cube fills the North wall's west corner to x = −1.5: slid half a meter east, the bed's head clears it.
      const cubeInCorner = place('pc_cube', 'cube-storage', onFloor(-1.75, -1.25));
      expect(resolve(twinBed, { kind: 'in_corner', wall_id: 'wl_north', end: 'left' }, [cubeInCorner], empty)).toEqual({
        placement: { position: [closeTo(-0.485), 0, closeTo(-1.005)], rotationY: closeTo(Math.PI / 2), mount: 'floor' },
      });
      // The South wall's left end is the door's: no slide of a meter clears its swing.
      expect(resolve(twinBed, { kind: 'in_corner', wall_id: 'wl_south', end: 'left' }, [], empty)).toMatchObject({ error: expect.stringContaining("doesn't fit") });
    });
  });

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

    it('keeps the whole item inside the room, moving it just as far as it must, where a slanted wall cuts the corner', () => {
      // The East wall runs from [2, −1.5] to [1, 1.5]: at the desk's front, z = −1, it is at x = 1.833. So the
      // desk, 0.76 wide, stops with its front-right corner on it, at x = 1.453, not at the next 10 cm step.
      const slanted: RoomSetup = {
        ...empty,
        floor: { polygon: [[-2, -1.5], [2, -1.5], [1, 1.5], [-2, 1.5]] },
        walls: [
          { id: 'wl_north', name: 'North wall', start: [-2, -1.5], end: [2, -1.5], normal: [0, 1], height: 2.6 },
          { id: 'wl_east', name: 'East wall', start: [2, -1.5], end: [1, 1.5], normal: [-3 / Math.hypot(3, 1), -1 / Math.hypot(3, 1)], height: 2.6 },
          { id: 'wl_south', name: 'South wall', start: [1, 1.5], end: [-2, 1.5], normal: [0, -1], height: 2.6 },
          { id: 'wl_west', name: 'West wall', start: [-2, 1.5], end: [-2, -1.5], normal: [1, 0], height: 2.6 },
        ],
        openings: [],
      };

      expect(resolve(desk, { kind: 'against_wall', wall_id: 'wl_north', along: 'right' }, [], slanted)).toEqual({
        placement: { position: [closeTo(1.453), 0, closeTo(-1.25)], rotationY: closeTo(0), mount: 'floor' },
      });
    });

    it('returns an error, with the violations where it asked for, when nothing within 1 m fits', () => {
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
    it('goes to the other side when the side asked for is a wall, as by a bed in a corner', () => {
      // The room's bed is in the north-west corner: its left, seen facing its front, is the West wall.
      expect(resolve(nightstand, { kind: 'beside', target_id: 'og_bed', side: 'left' }))
        .toEqual(resolve(nightstand, { kind: 'beside', target_id: 'og_bed', side: 'right' }));
    });

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

    it("returns an error rather than slide past the end of the target's side", () => {
      // A cube fills the desk's right side, south of it: sliding the nightstand toward the desk's front
      // would take it past the desk's front edge, at x = 1.4, where it is no longer beside the desk.
      const cubeByDesk = place('pc_cube', 'cube-storage', onFloor(1.75, 0.185));

      expect(resolve(nightstand, { kind: 'beside', target_id: 'og_desk', side: 'right' }, [cubeByDesk])).toMatchObject({
        error: "Oak Nightstand doesn't fit there, even slid up to 1 m either way",
      });
    });

    it('stands in front of the target facing it, like a chair pulled up to a desk', () => {
      expect(resolve(chair, { kind: 'beside', target_id: 'og_desk', side: 'front' })).toEqual({
        placement: { position: [closeTo(1.1), 0, closeTo(-0.6)], rotationY: closeTo(Math.PI / 2), mount: 'floor' },
      });
    });

    describe('tucked', () => {
      it('pushes the chair in toward the desk until it touches, still facing it: flush with a solid desk', () => {
        expect(resolve(chair, { kind: 'beside', target_id: 'og_desk', side: 'front', tucked: true })).toEqual({
          placement: { position: [closeTo(1.1), 0, closeTo(-0.6)], rotationY: closeTo(Math.PI / 2), mount: 'floor' },
        });
      });

      it('slides along the front after the push, past a chair already there', () => {
        // At z −1.2 to −0.6, so the middle of the front is taken.
        const atDesk = place('pc_chair', 'chair-ergo', onFloor(1.1, -0.9, Math.PI / 2));

        expect(resolve(chair, { kind: 'beside', target_id: 'og_desk', side: 'front', tucked: true }, [atDesk])).toEqual({
          placement: { position: [closeTo(1.1), 0, closeTo(-0.3)], rotationY: closeTo(Math.PI / 2), mount: 'floor' },
        });
      });

      it('is for the front only', () => {
        expect(resolve(nightstand, { kind: 'beside', target_id: 'og_desk', side: 'right', tucked: true })).toEqual({
          error: "tucked is for side 'front' only, not 'right'", violations: [],
        });
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

    it('slides along under the window, but never out from under it', () => {
      // A cube already stands under the middle of the window, x −0.25 to 0.25: 0.5 m along, the nightstand clears it.
      const cubeUnderWindow = place('pc_cube', 'cube-storage', onFloor(0, -1.25));
      expect(resolve(nightstand, { kind: 'under_window', opening_id: 'op_window' }, [cubeUnderWindow])).toMatchObject({
        placement: { position: [closeTo(0.5), 0, closeTo(-1.3)] },
      });
      // 1.1 m tall, the chest would block the 0.9 m sill anywhere under the window.
      expect(resolve(chest, { kind: 'under_window', opening_id: 'op_window' })).toEqual({
        error: "Tall Chest doesn't fit there, even slid up to 1 m either way",
        violations: [{ rule: 'blocks-window', subjectId: 'chest-tall', otherId: 'op_window', message: 'Blocks the window' }],
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
        error: 'Fern Print hangs on a wall: use on_wall, on_wall_over or on_wall_beside', violations: [],
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
        error: "Wide Print doesn't fit there, even slid up to 1 m either way",
        violations: [{ rule: 'overlap', subjectId: 'print-wide', otherId: 'op_window', message: 'Covers the window' }],
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

  describe('on_wall_over', () => {
    it('hangs the item centered over the furniture against the wall, as the first frame of a gallery wall', () => {
      // The bed runs along the West wall from z −1.5 to 0.53: its middle is at z = −0.485.
      expect(resolve(print, { kind: 'on_wall_over', target_id: 'og_bed', wall_id: 'wl_west' })).toEqual({
        placement: {
          position: [closeTo(-1.985), closeTo(1.05), closeTo(-0.485)], rotationY: closeTo(Math.PI / 2), mount: 'wall', wallId: 'wl_west',
        },
      });
    });

    it("takes the wall the target's back is to, offsets the item to the right seen facing it, and hangs it clear of tall furniture", () => {
      // The 1.8 m wardrobe's back is to the South wall, x −2 to −1. Facing the South wall, right is west: 0.3 m right is x = −1.8.
      // Over the wardrobe, the print's bottom keeps 15 cm above it: 1.95 m up.
      const wardrobeOnSouthWall = place('pc_wardrobe', 'wardrobe-white', onFloor(-1.5, 1.21, Math.PI));
      const smallPrint = item('print-small', 'wall_art', 'Small Print', [0.3, 0.4, 0.02], { mount: 'wall' });

      expect(resolve(smallPrint, { kind: 'on_wall_over', target_id: 'pc_wardrobe', offset_m: 0.3 }, [wardrobeOnSouthWall], empty)).toMatchObject({
        placement: { position: [closeTo(-1.8), closeTo(1.95), closeTo(1.49)], wallId: 'wl_south' },
      });
    });

    it('slides along the wall, but keeps the item over the target', () => {
      // A mirror already hangs at z −0.25 to 0.25 on the West wall: 0.1 m north, the print clears it, still over the bed.
      expect(resolve(print, { kind: 'on_wall_over', target_id: 'og_bed', wall_id: 'wl_west' }, [], withLampAndMirror)).toMatchObject({
        placement: { position: [closeTo(-1.985), closeTo(1.05), closeTo(-0.585)] },
      });
    });

    it('returns an error for a target on the wall itself, or with no wall behind it', () => {
      expect(resolve(print, { kind: 'on_wall_over', target_id: 'og_mirror' }, [], withLampAndMirror)).toEqual({
        error: 'your mirror hangs on a wall: use on_wall_beside', violations: [],
      });
      const deskMidRoom = place('pc_desk', 'desk-walnut', onFloor(0, 0));
      expect(resolve(print, { kind: 'on_wall_over', target_id: 'pc_desk' }, [deskMidRoom], empty)).toEqual({
        error: '30″ Walnut Desk stands against no wall: give wall_id', violations: [],
      });
    });
  });

  describe('on_wall_beside', () => {
    // The print hangs over the bed on the West wall, its center at z = −0.485, from z −0.785 to −0.185, 1.05 to 1.85 m up.
    const printOverBed = place('pc_print', 'print-fern', {
      position: [-1.985, 1.05, -0.485], rotationY: Math.PI / 2, mount: 'wall', wallId: 'wl_west',
    });

    it('hangs the item beside another on its wall, the gap apart, centers level: left and right seen facing the wall', () => {
      // Facing the West wall, left is south (+z): 0.08 m past the print's south edge, the poster's center is at z 0.095.
      expect(resolve(poster, { kind: 'on_wall_beside', target_id: 'pc_print', side: 'left', gap_m: 0.08 }, [printOverBed])).toEqual({
        placement: { position: [closeTo(-1.99), closeTo(1.2), closeTo(0.095)], rotationY: closeTo(Math.PI / 2), mount: 'wall', wallId: 'wl_west' },
      });
      // 8 cm by default, on the right (north).
      expect(resolve(poster, { kind: 'on_wall_beside', target_id: 'pc_print', side: 'right' }, [printOverBed])).toMatchObject({
        placement: { position: [closeTo(-1.99), closeTo(1.2), closeTo(-1.065)] },
      });
    });

    it("keeps exactly the gap, so the gallery wall's spacing holds: when that spot is taken, it fails", () => {
      const firstPoster = place('pc_poster', 'poster-city', {
        position: [-1.99, 1.2, -1.065], rotationY: Math.PI / 2, mount: 'wall', wallId: 'wl_west',
      });

      expect(resolve(poster, { kind: 'on_wall_beside', target_id: 'pc_print', side: 'right' }, [printOverBed, firstPoster])).toMatchObject({
        error: "City Poster doesn't fit 0.08 m to the right of Fern Print: try its other side, or another frame",
      });
    });

    it('returns an error for a target that does not hang on a wall', () => {
      expect(resolve(poster, { kind: 'on_wall_beside', target_id: 'og_bed', side: 'left' })).toEqual({
        error: "your bed doesn't hang on a wall: use on_wall_over", violations: [],
      });
    });
  });

  describe('wall items and the furniture against their wall', () => {
    it('slides wall art along the wall clear of tall furniture standing in front of it', () => {
      // The wardrobe takes the South wall's right end, x −2 to −1, 1.8 m up: the print slides east until it clears it.
      const wardrobeOnSouthWall = place('pc_wardrobe', 'wardrobe-white', onFloor(-1.5, 1.21, Math.PI));

      expect(resolve(print, { kind: 'on_wall', wall_id: 'wl_south', along: 'right' }, [wardrobeOnSouthWall], empty)).toMatchObject({
        placement: { position: [closeTo(-0.7), closeTo(1.05), closeTo(1.485)] },
      });
    });

    it('keeps tall furniture from standing in front of art that hangs low enough to clip it', () => {
      // The print hangs over the South wall's right end, 1.05 m up: the wardrobe can't stand there, and slides east past it.
      const printOnSouthWall = place('pc_print', 'print-fern', {
        position: [-1.6, 1.05, 1.485], rotationY: Math.PI, mount: 'wall', wallId: 'wl_south',
      });

      expect(resolve(wardrobe, { kind: 'against_wall', wall_id: 'wl_south', along: 'right' }, [printOnSouthWall], empty)).toMatchObject({
        placement: { position: [closeTo(-0.8), 0, closeTo(1.21)] },
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
        error: "Gray Sofa doesn't fit on top of your desk", violations: [],
      });
    });

    describe('on a shelf', () => {
      // A 0.79 m cube shelf against the North wall, x −0.395 to 0.395, z −1.5 to −1.11, with shelves 0.04, 0.4 and 0.79 m up.
      const cubeShelf = item('shelf-cube', 'shelf', 'Cube Shelf', [0.79, 0.79, 0.39]);
      const level = (height: number, clearance: number) => ({ height, center: [0, 0] as Vec2, size: [0.75, 0.37] as Vec2, clearance });
      const shelfLevels = { 'shelf-cube': [level(0.04, 0.34), level(0.4, 0.37), level(0.79, Infinity)] };
      const shelfRoom = { ...furnished, items: [...furnished.items, cubeShelf] };
      const shelfOnNorthWall = place('pc_shelf', 'shelf-cube', onFloor(0, -1.305));
      const onShelf = (catalogItem: CatalogItem, at?: number) => resolveAnchor(
        empty, shelfRoom, replay(empty, shelfRoom, [shelfOnNorthWall]), catalogItem, { kind: 'on_top_of', target_id: 'pc_shelf', level: at }, { shelfLevels },
      );
      const vase = item('vase-white', 'decor', 'White Vase', [0.17, 0.33, 0.17]);

      it('rests the item on the shelf level it names, counted from 0 at the bottom', () => {
        expect(onShelf(vase, 1)).toEqual({
          placement: { position: [closeTo(0), closeTo(0.4), closeTo(-1.305)], rotationY: closeTo(0), mount: 'surface' },
        });
      });

      it('rests it on top without a level', () => {
        expect(onShelf(vase)).toMatchObject({ placement: { position: [closeTo(0), closeTo(0.79), closeTo(-1.305)] } });
      });

      it('returns an error for an item taller than the room under the next shelf, or a level the shelf lacks', () => {
        expect(onShelf(lamp, 0)).toEqual({
          error: 'Brass Desk Lamp, 0.45 m tall, is too tall for level 0 of Cube Shelf: it has 0.34 m above it', violations: [],
        });
        expect(onShelf(vase, 3)).toEqual({ error: 'Cube Shelf has levels 0 (the bottom) to 2 (the top), not 3', violations: [] });
      });
    });

    describe('on a bed', () => {
      // A bed with a headboard 0.97 m tall, its head against the North wall: z −1.5 to 0.43.
      const tallBed = item('bed-metal', 'bed', 'Metal Bed', [0.99, 0.97, 1.93]);
      const pillow = item('pillow-navy', 'decor', 'Navy Pillow', [0.52, 0.51, 0.17]);
      const bedRoom = { ...furnished, items: [...furnished.items, tallBed, pillow] };
      const bedOnNorthWall = place('pc_bed', 'bed-metal', onFloor(0, -0.535));
      /** Where the pillow rests on top of `bedId`, in the room after these Edits. */
      const onBed = (bedId: string, edits: Edit[], room: RoomSetup = empty, inCatalog = bedRoom) =>
        resolveAnchor(room, inCatalog, replay(room, inCatalog, edits), pillow, { kind: 'on_top_of', target_id: bedId });

      it('rests decor on the bedding, 0.70 m up, not on top of the headboard', () => {
        // Back to the headboard's 12 cm, so the pillow's center is 0.205 m from the bed's head at z = −1.5.
        expect(onBed('pc_bed', [bedOnNorthWall])).toEqual({
          placement: { position: [closeTo(0), closeTo(0.7), closeTo(-1.295)], rotationY: closeTo(0), mount: 'surface' },
        });
      });

      it("rests it at the top of the bed's own bedding range", () => {
        const lowBed = { ...tallBed, partParams: { beddingRange: [0.2, 0.55] as [number, number] } };
        const lowRoom = { ...bedRoom, items: [...furnished.items, lowBed, pillow] };

        expect(onBed('pc_bed', [bedOnNorthWall], empty, lowRoom)).toMatchObject({ placement: { position: [closeTo(0), closeTo(0.55), closeTo(-1.295)] } });
      });

      it('never rests it higher than the bed is tall', () => {
        // The Kept bed of the room is 0.6 m tall, its head against the North wall.
        expect(onBed('og_bed', [], setup)).toMatchObject({ placement: { position: [closeTo(-1.505), closeTo(0.6), closeTo(-1.295)] } });
      });

      it('lays a second pillow in front of the first once the bed is too narrow for two side by side', () => {
        // 0.99 m wide, the bed has room for one 0.52 m pillow across: the next goes 0.2 m toward the foot.
        const firstPillow = place('pc_pillow', 'pillow-navy', { position: [0, 0.7, -1.295], rotationY: 0, mount: 'surface' });

        expect(onBed('pc_bed', [bedOnNorthWall, firstPillow])).toMatchObject({ placement: { position: [closeTo(0), closeTo(0.7), closeTo(-1.095)] } });
      });
    });
  });

  describe('centered_under', () => {
    it("centers a rug under a table, its long side along the table's, so the chairs around it stand on it too", () => {
      // From #97. The table runs east–west, 1.5 × 0.9; the rug, 1.52 wide and 2.13 deep, turns a quarter to lie along it.
      const tableMidRoom = place('pc_table', 'table-oak', onFloor(0, 0));

      expect(resolve(rug, { kind: 'centered_under', target_id: 'pc_table' }, [tableMidRoom], empty)).toEqual({
        placement: { position: [closeTo(0), 0, closeTo(0)], rotationY: closeTo(Math.PI / 2), mount: 'floor' },
      });
    });

    it('lays a rug centered under the target, its long side across it, with a third of it under the target', () => {
      // The sofa faces south from the North wall, z −1.5 to −0.6. Turned, the rug is 2.13 wide and 1.52 deep:
      // z −1.107 to 0.413, so 0.507 m of it is under the sofa.
      const sofaOnNorthWall = place('pc_sofa', 'sofa-gray', onFloor(0, -1.05));

      expect(resolve(rug, { kind: 'centered_under', target_id: 'pc_sofa' }, [sofaOnNorthWall], empty)).toEqual({
        placement: { position: [closeTo(0), 0, closeTo(-0.3467)], rotationY: closeTo(Math.PI / 2), mount: 'floor' },
      });
    });

    it('slides the rug further under the target when the floor in front of it runs out', () => {
      // With the sofa's front at z = 0.65, a third under would reach z 1.663, past the South wall at 1.5: it
      // goes just that much further under, to z −0.02 to 1.5, flush with the wall.
      const sofaMidRoom = place('pc_sofa', 'sofa-gray', onFloor(0, 0.2));

      expect(resolve(rug, { kind: 'centered_under', target_id: 'pc_sofa' }, [sofaMidRoom], empty)).toMatchObject({
        placement: { position: [closeTo(0), 0, closeTo(0.74)] },
      });
    });

    it('slides the rug sideways, out from the wall, when the target is too near one to center it, as a bed in a corner is', () => {
      // Turned across the bed, the rug is 2.13 m wide, but the bed's center is 0.495 m from the West wall:
      // 0.57 m toward the room it fits, x −2 to 0.13, flush with that wall and under all of the bed's width.
      // A third under the bed, it would reach past the South wall, so it also goes further under, flush
      // with that wall too: z −0.02 to 1.5.
      expect(resolve(rug, { kind: 'centered_under', target_id: 'og_bed' })).toEqual({
        placement: { position: [closeTo(-0.935), 0, closeTo(0.74)], rotationY: closeTo(Math.PI / 2), mount: 'floor' },
      });
    });

    it('never slides the rug out from under the target', () => {
      // A small rug already lies in front of the sofa, at z −1.4 to −0.4. Slid out past it, the new rug
      // would have nothing under the sofa.
      const sofaOnNorthWall = place('pc_sofa', 'sofa-gray', onFloor(0, -1.05));
      const rugInFront = place('pc_rug', 'rug-small', onFloor(0, -0.9));

      expect(resolve(rug, { kind: 'centered_under', target_id: 'pc_sofa' }, [sofaOnNorthWall, rugInFront], empty)).toMatchObject({
        error: "Mainstays 5×7 Rug doesn't fit there, even slid up to 1 m either way",
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

    it('puts the item in the free spot nearest to a window, given its id: a reading corner by the window', () => {
      // The window is x −0.6 to 0.6 on the North wall, z = −1.5. The 0.95 m chair keeps the 0.4 m in front
      // of the 0.9 m sill clear, so the nearest free spot is beside the window, its edge within 10 cm of it.
      const { position } = placementOf(resolve(chair, { kind: 'open_floor', near_id: 'op_window' }, [], empty));

      expect(gap(position, 0.6, [-0.6, -1.5, 0.6, -1.5])).toBeLessThan(0.1);
    });

    it('passes over free spots that would block the walkway', () => {
      // A 2 m sofa in the largest free spots, mid-room, would be in the door's swing or close off the desk from the door.
      const placement = placementOf(resolve(sofa, { kind: 'open_floor' }));

      const state = replay(setup, furnished, [place('pc_sofa', 'sofa-gray', placement)]);
      expect(checkFit(setup, furnished, state, undefined, { walkway: true })).toEqual([]);
    });

    it('returns an error when no open floor fits the item', () => {
      const banquet = item('table-banquet', 'table', 'Banquet Table', [3.5, 0.75, 1]);

      expect(resolve(banquet, { kind: 'open_floor' })).toEqual({ error: 'No open floor fits Banquet Table', violations: [] });
    });
  });
});
