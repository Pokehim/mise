import { describe, expect, it } from 'vitest';
import { replay } from '../../shared/replay';
import { catalog, item, lShaped, onFloor, place, setup } from '../../shared/test-room';
import type { Edit, RoomSetup } from '../../shared/types';
import { roomSummary } from './roomSummary';

// The test room: 4 × 3 m. Its Kept bed is in the north-west corner, head against the North wall
// (x −2 to −1.01, z −1.5 to 0.53); the desk stands against the East wall (x 1.4 to 2, z −1.135 to −0.065).
// The window is x −0.6 to 0.6 on the North wall, 0.9 to 2.1 m up; the door is x 0.8 to 1.7 on the South wall.

const wardrobe = item('wardrobe-white', 'wardrobe', 'White Wardrobe', [1, 1.8, 0.58]);
const nightstand = item('nightstand-oak', 'nightstand', 'Oak Nightstand', [0.45, 0.6, 0.4]);
const chest = item('chest-tall', 'dresser', 'Tall Chest', [0.6, 1.1, 0.45]);
const furnished = { ...catalog, items: [...catalog.items, wardrobe, nightstand, chest] };

/** A number within a centimeter of `meters`: the summary rounds to the centimeter. */
const closeTo = (meters: number) => expect.toSatisfy((rounded: number) => Math.abs(rounded - meters) <= 0.01);

const summarize = (edits: Edit[] = [], room: RoomSetup = setup) => roomSummary(room, furnished, replay(room, furnished, edits));

describe('roomSummary', () => {
  it("gives the room's size, and each wall's name and length", () => {
    expect(summarize()).toMatchObject({
      room: { width_m: 4, depth_m: 3, ceiling_height_m: 2.6 },
      walls: [
        { id: 'wl_north', name: 'North wall', length_m: 4 },
        { id: 'wl_east', name: 'East wall', length_m: 3 },
        { id: 'wl_south', name: 'South wall', length_m: 4 },
        { id: 'wl_west', name: 'West wall', length_m: 3 },
      ],
    });
  });

  describe('layout', () => {
    it('takes a rectangular room as all main area, with every wall along it', () => {
      expect(summarize().layout).toEqual({
        main: {
          width_m: 4, depth_m: 3,
          walls: [
            { wall_id: 'wl_north', from_left_m: 0, to_left_m: 4, along: [0, 1] },
            { wall_id: 'wl_east', from_left_m: 0, to_left_m: 3, along: [0, 1] },
            { wall_id: 'wl_south', from_left_m: 0, to_left_m: 4, along: [0, 1] },
            { wall_id: 'wl_west', from_left_m: 0, to_left_m: 3, along: [0, 1] },
          ],
        },
        passages: [],
        alcoves: [],
      });
    });

    it('tells the main area from the passage to the door, and which stretch of a wall runs along each', () => {
      const { layout } = summarize([], lShaped);

      expect(layout.main).toEqual({
        width_m: 3, depth_m: 3,
        walls: [
          // Seen from inside, facing north, the North wall's left end is its west end.
          { wall_id: 'wl_north', from_left_m: 0, to_left_m: 3, along: [0, 0.6] },
          { wall_id: 'wl_east_2', from_left_m: 0, to_left_m: 2, along: [0, 1] },
          { wall_id: 'wl_south_2', from_left_m: 0, to_left_m: 3, along: [0, 1] },
          { wall_id: 'wl_west', from_left_m: 0, to_left_m: 3, along: [0, 1] },
        ],
      });
      expect(layout.passages).toEqual([{
        width_m: 2, depth_m: 1, doors: ['op_door'],
        walls: [
          { wall_id: 'wl_north', from_left_m: 3, to_left_m: 5, along: [0.6, 1] },
          { wall_id: 'wl_east', from_left_m: 0, to_left_m: 1, along: [0, 1] },
          { wall_id: 'wl_south', from_left_m: 0, to_left_m: 2, along: [0, 1] },
        ],
      }]);
      expect(layout.alcoves).toEqual([]);
    });
  });

  it('lists the Openings, with where each is along its wall, seen from inside the room', () => {
    expect(summarize().openings).toEqual([
      // Facing the South wall from inside, its left end is the east one: the door is 0.3 to 1.2 m from it.
      { id: 'op_door', kind: 'door', wall_id: 'wl_south', position: 'South wall, left side', from_left_m: 0.3, width_m: 0.9, bottom_m: 0, height_m: 2.03 },
      { id: 'op_window', kind: 'window', wall_id: 'wl_north', position: 'North wall, center', from_left_m: 1.4, width_m: 1.2, bottom_m: 0.9, height_m: 1.2 },
    ]);
  });

  it('describes each Original: its size, whether it is Kept, and where it stands in words', () => {
    expect(summarize().originals).toEqual([
      {
        id: 'og_bed', label: 'Bed', category: 'bed', kept: true, size_m: { width: 0.99, height: 0.6, depth: 2.03 },
        position: 'against the North wall, left side, in the corner with the West wall',
      },
      {
        id: 'og_desk', label: 'Desk', category: 'desk', kept: false, size_m: { width: 1.07, height: 0.76, depth: 0.6 },
        position: 'against the East wall, left side',
      },
    ]);
  });

  it('says how far from the walls an Original stands when it stands against none', () => {
    const awayFromWalls: RoomSetup = {
      ...setup,
      originals: [{ ...setup.originals[1], box: { position: [0, 0, 0], size: [1.07, 0.76, 0.6], rotationY: 0 } }],
    };

    expect(summarize([], awayFromWalls).originals[0].position).toBe('in the middle of the room');
  });

  it('finds the largest free floor rectangles: clear of furniture and of the door swing', () => {
    // Between the bed (to x −1.01) and the door's swing (from x 0.8), the floor is clear from wall to wall.
    const [largest, ...others] = summarize().free_floor;

    expect(largest).toEqual({ width_m: 1.8, depth_m: 3, position: 'in the middle of the room', next_to: ['og_bed'] });
    expect(others.every(({ width_m, depth_m }) => width_m * depth_m <= 1.8 * 3)).toBe(true);
  });

  it("counts the Catalog's items by category", () => {
    expect(summarize().catalog).toEqual({ chair: 1, desk: 1, rug: 1, lamp: 1, wardrobe: 1, nightstand: 1, dresser: 1 });
  });

  describe('where decor can go', () => {
    it("lists each wall's free spans 1.0 to 2.0 m up, around its Openings, and the furniture below them", () => {
      expect(summarize().decor.wall_spans).toEqual([
        // The window takes 1.4 to 2.6 m from the North wall's left end; art keeps 10 cm from it.
        { wall_id: 'wl_north', from_left_m: 0, to_left_m: 1.3, width_m: 1.3, below: [{ id: 'og_bed', label: 'Bed', from_left_m: 0, to_left_m: 0.99, top_m: 0.6 }] },
        { wall_id: 'wl_north', from_left_m: 2.7, to_left_m: 4, width_m: 1.3, below: [] },
        { wall_id: 'wl_east', from_left_m: 0, to_left_m: 3, width_m: 3, below: [{ id: 'og_desk', label: 'Desk', from_left_m: closeTo(0.365), to_left_m: closeTo(1.435), top_m: 0.76 }] },
        // The door takes 0.3 to 1.2 m from the South wall's left end, leaving too little room for art before it.
        { wall_id: 'wl_south', from_left_m: 1.3, to_left_m: 4, width_m: 2.7, below: [] },
        { wall_id: 'wl_west', from_left_m: 0, to_left_m: 3, width_m: 3, below: [{ id: 'og_bed', label: 'Bed', from_left_m: 0.97, to_left_m: 3, top_m: 0.6 }] },
      ]);
    });

    it('leaves out the wall behind furniture too tall to hang art over in the band, and lists lower furniture under its span', () => {
      // A 1.8 m wardrobe against the South wall's right end, x −2 to −1, takes 3 to 4 m from its left end.
      // A 1.1 m chest at x −0.3 to 0.3 leaves room above it: art hangs over it, clear of it.
      const wardrobeOnSouthWall = place('pc_wardrobe', 'wardrobe-white', onFloor(-1.5, 1.21, Math.PI));
      const chestOnSouthWall = place('pc_chest', 'chest-tall', onFloor(0, 1.275, Math.PI));

      expect(summarize([wardrobeOnSouthWall, chestOnSouthWall]).decor.wall_spans.filter(({ wall_id }) => wall_id === 'wl_south')).toEqual([
        {
          wall_id: 'wl_south', from_left_m: 1.3, to_left_m: 3, width_m: 1.7,
          below: [{ id: 'pc_chest', label: 'Tall Chest', from_left_m: 1.7, to_left_m: 2.3, top_m: 1.1 }],
        },
      ]);
    });

    it('lists each furniture top decor can rest on, Originals and Pieces, at the height it rests at', () => {
      const nightstandByBed = place('pc_nightstand', 'nightstand-oak', onFloor(-0.76, -1.3));
      const lampOnDesk = place('pc_lamp', 'lamp-brass', { position: [1.7, 0.76, -0.6], rotationY: 0, mount: 'surface' });

      expect(summarize([nightstandByBed, lampOnDesk]).decor.tops).toEqual([
        // The bed is lower than its bedding usually reaches, so decor rests on top of it.
        { target_id: 'og_bed', label: 'Bed', category: 'bed', top_m: 0.6, width_m: 0.99, depth_m: 2.03, holds: [] },
        { target_id: 'og_desk', label: 'Desk', category: 'desk', top_m: 0.76, width_m: 1.07, depth_m: 0.6, holds: ['pc_lamp'] },
        { target_id: 'pc_nightstand', label: 'Oak Nightstand', category: 'nightstand', top_m: 0.6, width_m: 0.45, depth_m: 0.4, holds: [] },
      ]);
    });
  });
});
