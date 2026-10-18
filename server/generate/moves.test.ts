import { describe, expect, it } from 'vitest';
import { checkFit, roomItems } from '../../shared/fit';
import { spanFromLeft } from '../../shared/geometry';
import { catalog, item, lShaped, setup } from '../../shared/test-room';
import type { Edit } from '../../shared/types';
import { createSession, type DesignSession } from './tools';

// The decorating moves: one call each for a gallery wall, a rug, a reading corner, the bed and the
// furniture tops, so that Claude can design a room in one reply. The test room: 4 × 3 m, a Kept bed in
// the north-west corner (head on the North wall, x −2 to −1.01, z −1.5 to 0.53), a desk against the
// East wall, a window mid North wall (x −0.6 to 0.6, sill 0.9 m) and a door on the South wall.

const print = item('print-fern', 'wall_art', 'Fern Print', [0.5, 0.6, 0.03], { mount: 'wall', priceEstimateUsd: 40 });
const poster = item('poster-city', 'wall_art', 'City Poster', [0.4, 0.5, 0.02], { mount: 'wall', priceEstimateUsd: 30 });
const sketch = item('sketch-oak', 'wall_art', 'Oak Sketch', [0.3, 0.4, 0.02], { mount: 'wall', priceEstimateUsd: 25 });
const roundMirror = item('mirror-round', 'mirror', 'Round Mirror', [0.6, 0.6, 0.03], { mount: 'wall', priceEstimateUsd: 50 });
const pillow = item('pillow-navy', 'decor', 'Navy Pillow', [0.45, 0.45, 0.15], { priceEstimateUsd: 25 });
const vase = item('vase-white', 'decor', 'White Vase', [0.17, 0.33, 0.17], { priceEstimateUsd: 25 });
const fern = item('plant-fern', 'plant', 'Potted Fern', [0.3, 0.6, 0.3], { priceEstimateUsd: 30 });
const armchair = item('chair-reading', 'chair', 'Reading Chair', [0.75, 0.8, 0.7], { priceEstimateUsd: 120 });
const floorLamp = item('lamp-floor', 'lamp', 'Linen Floor Lamp', [0.35, 1.55, 0.35], { priceEstimateUsd: 45 });
const sideTable = item('table-side', 'table', 'Round Side Table', [0.45, 0.55, 0.45], { priceEstimateUsd: 60 });
const smallRug = item('rug-small', 'rug', 'Small Rug', [1.2, 0.01, 1], { priceEstimateUsd: 50 });
const twinBed = item('bed-twin', 'bed', 'Twin Bed', [0.99, 0.6, 2.03], { priceEstimateUsd: 150 });
const clock = item('clock-wall', 'wall_art', 'Vintage Decorative Wall Clock', [0.6, 0.6, 0.03], { mount: 'wall', priceEstimateUsd: 40 });
const memoBoard = item('board-memo', 'wall_art', 'Dry Erase Memo Board', [0.56, 0.46, 0.03], { mount: 'wall', priceEstimateUsd: 40 });
const ledStrip = item('led-strip', 'wall_art', 'Purple LED Strip Lights, 6.6 ft', [2, 0.36, 0.006], { mount: 'wall', priceEstimateUsd: 15 });
const fairyLights = item('lights-fairy', 'wall_art', 'Fairy String Lights on Copper Wire, Warm White', [1.55, 0.27, 0.012], { mount: 'wall', priceEstimateUsd: 12 });
const curtainLights = item('lights-curtain', 'wall_art', 'LED Curtain String Lights, Warm White', [1.21, 1.33, 0.013], { mount: 'wall', priceEstimateUsd: 22 });
const decorCatalog = {
  ...catalog,
  items: [...catalog.items, print, poster, sketch, roundMirror, pillow, vase, fern, armchair, floorLamp, sideTable, smallRug, twinBed, clock, memoBoard, ledStrip, fairyLights, curtainLights],
};

const start = (onEdit?: (edit: Edit) => void) =>
  createSession({ setup, catalog: decorCatalog, brief: { text: 'cozy' }, materials: [], onEdit });

async function call(session: DesignSession, name: string, input: unknown) {
  const tool = session.tools.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`No tool ${name}`);
  return JSON.parse((await tool.run(tool.parse(input))) as string);
}

const roomOf = (session: DesignSession) => roomItems(setup, decorCatalog, session.state);
const westWall = setup.walls.find(({ id }) => id === 'wl_west')!;
const fit = (session: DesignSession) => checkFit(setup, decorCatalog, session.state, Object.keys(session.state.pieces), { walkway: true });

describe('the decorating moves', () => {
  describe('hang_gallery', () => {
    it('hangs the frames as one gallery wall centered over the target: the largest in the middle, 8 cm apart, centers 1.45 m up', async () => {
      const session = start();

      const report = await call(session, 'hang_gallery', { over_id: 'og_bed', wall_id: 'wl_west', catalog_ids: ['print-fern', 'poster-city', 'sketch-oak'] });

      // The widest in the middle, hung first, then outward.
      expect(report.placed.map(({ catalog_id }: { catalog_id: string }) => catalog_id)).toEqual(['print-fern', 'sketch-oak', 'poster-city']);
      // Left to right on the West wall: 0.4 + 0.08 + 0.5 + 0.08 + 0.3 = 1.36 m, centered on the bed's 0.97 to 3 m.
      const frames = roomOf(session).filter(({ placement }) => placement.mount === 'wall').map((frame) => ({
        span: spanFromLeft(westWall, frame.corners), center: (frame.heights[0] + frame.heights[1]) / 2,
      })).sort((a, b) => a.span[0] - b.span[0]);
      expect(frames.map(({ span }) => span[0])).toEqual([expect.closeTo(1.305), expect.closeTo(1.785), expect.closeTo(2.365)]);
      expect(frames.every(({ center }) => Math.abs(center - 1.45) < 1e-6)).toBe(true);
      expect(fit(session)).toEqual([]);
    });

    it('keeps the row centered over furniture narrower than the row', async () => {
      const session = start();
      const eastWall = setup.walls.find(({ id }) => id === 'wl_east')!;

      // 0.5 + 0.08 + 0.6 + 0.08 + 0.4 = 1.66 m of frames over the 1.07 m desk.
      await call(session, 'hang_gallery', { over_id: 'og_desk', wall_id: 'wl_east', catalog_ids: ['print-fern', 'mirror-round', 'poster-city'] });

      const room = roomOf(session);
      const spans = room.filter(({ placement }) => placement.mount === 'wall').map((frame) => spanFromLeft(eastWall, frame.corners));
      const [deskFrom, deskTo] = spanFromLeft(eastWall, room.find(({ id }) => id === 'og_desk')!.corners);
      expect((Math.min(...spans.map(([from]) => from)) + Math.max(...spans.map(([, to]) => to))) / 2).toBeCloseTo((deskFrom + deskTo) / 2);
      expect(fit(session)).toEqual([]);
    });

    it("hangs no clock or memo board in a gallery: they aren't art, and hang on their own", async () => {
      const report = await call(start(), 'hang_gallery', { over_id: 'og_bed', wall_id: 'wl_west', catalog_ids: ['print-fern', 'clock-wall', 'board-memo'] });

      expect(report.placed.map(({ catalog_id }: { catalog_id: string }) => catalog_id)).toEqual(['print-fern']);
      expect(report.skipped).toEqual([
        { catalog_id: 'clock-wall', why: "Vintage Decorative Wall Clock isn't art: hang it on its own with place_piece (on_wall), by the desk or the door" },
        { catalog_id: 'board-memo', why: "Dry Erase Memo Board isn't art: hang it on its own with place_piece (on_wall), by the desk or the door" },
      ]);
    });

    it('hangs no LED strip or string lights in a gallery: they light the wall on their own', async () => {
      const report = await call(start(), 'hang_gallery', { over_id: 'og_bed', wall_id: 'wl_west', catalog_ids: ['print-fern', 'led-strip'] });

      expect(report.placed.map(({ catalog_id }: { catalog_id: string }) => catalog_id)).toEqual(['print-fern']);
      expect(report.skipped).toEqual([
        { catalog_id: 'led-strip', why: "Purple LED Strip Lights, 6.6 ft isn't art: hang it on its own with hang_lights, over the bed, the desk or a window" },
      ]);
    });

    it('skips what it can not hang, saying why, and fails only when it hangs nothing', async () => {
      const session = start();

      const report = await call(session, 'hang_gallery', { over_id: 'og_bed', wall_id: 'wl_west', catalog_ids: ['print-fern', 'pillow-navy', 'B000NOPE'] });

      expect(report.placed).toHaveLength(1);
      expect(report.skipped).toEqual([
        { catalog_id: 'pillow-navy', why: 'Navy Pillow is not wall art or a mirror' },
        { catalog_id: 'B000NOPE', why: 'The Catalog has no item "B000NOPE"' },
      ]);
      await expect(call(session, 'hang_gallery', { over_id: 'og_bed', wall_id: 'wl_west', catalog_ids: ['pillow-navy'] }))
        .rejects.toThrow('Hung nothing: Navy Pillow is not wall art or a mirror');
    });
  });

  describe('hang_lights', () => {
    /** The Piece of this Catalog item in the room. */
    const pieceOf = (session: DesignSession, catalogId: string) => roomOf(session).find(({ id }) => session.state.pieces[id]?.catalogId === catalogId)!;
    /** How far along the West wall, from its left end, the middle of a Piece on it is. */
    const middleOf = (session: DesignSession, catalogId: string) => {
      const [from, to] = spanFromLeft(westWall, pieceOf(session, catalogId).corners);
      return (from + to) / 2;
    };

    it('runs an LED strip along the top of the wall over the bed, its glow just under the ceiling', async () => {
      const session = start();

      await call(session, 'hang_lights', { catalog_id: 'led-strip', over_id: 'og_bed', wall_id: 'wl_west' });

      // The wall is 2.6 m tall: the strip's 0.36 m of glow reaches to 2 cm under its top, centered over the bed's 0.97 to 3 m.
      expect(pieceOf(session, 'led-strip').heights).toEqual([expect.closeTo(2.22), expect.closeTo(2.58)]);
      expect(middleOf(session, 'led-strip')).toBeCloseTo(1.985);
      expect(fit(session)).toEqual([]);
    });

    it('hangs string lights centered over the bed, above the gallery already there', async () => {
      const session = start();
      // The Fern Print, 0.6 m tall and centered 1.45 m up, reaches 1.75 m.
      await call(session, 'hang_gallery', { over_id: 'og_bed', wall_id: 'wl_west', catalog_ids: ['print-fern', 'poster-city'] });

      await call(session, 'hang_lights', { catalog_id: 'lights-fairy', over_id: 'og_bed', wall_id: 'wl_west' });

      expect(pieceOf(session, 'lights-fairy').heights).toEqual([expect.closeTo(1.83), expect.closeTo(2.1)]);
      expect(middleOf(session, 'lights-fairy')).toBeCloseTo(1.985);
      expect(fit(session)).toEqual([]);
    });

    it("hangs string lights over a window, on the window's wall, just clear of its top", async () => {
      const session = start();

      await call(session, 'hang_lights', { catalog_id: 'lights-fairy', over_id: 'op_window', wall_id: '' });

      // The window, x −0.6 to 0.6 on the North wall, reaches 2.1 m up.
      expect(pieceOf(session, 'lights-fairy')).toMatchObject({ heights: [expect.closeTo(2.15), expect.closeTo(2.42)], placement: { wallId: 'wl_north', position: [expect.closeTo(0), expect.any(Number), expect.any(Number)] } });
      expect(fit(session)).toEqual([]);
    });

    it('hangs them centered on a wall when there is nothing to hang them over', async () => {
      const session = start();

      await call(session, 'hang_lights', { catalog_id: 'lights-fairy', over_id: '', wall_id: 'wl_south' });

      expect(pieceOf(session, 'lights-fairy')).toMatchObject({ heights: [expect.closeTo(1.315), expect.closeTo(1.585)], placement: { wallId: 'wl_south', position: [expect.closeTo(0), expect.any(Number), expect.any(Number)] } });
      expect(fit(session)).toEqual([]);
    });

    it('says why when they fit nowhere over the target, and where else they can go', async () => {
      // 1.33 m of curtain lights can't hang over a window whose top is 2.1 m up, under a 2.6 m ceiling.
      await expect(call(start(), 'hang_lights', { catalog_id: 'lights-curtain', over_id: 'op_window', wall_id: '' }))
        .rejects.toThrow(/doesn't fit on the North wall .*: hang it over something else, or on another wall/);
    });

    it('hangs only lights and greenery: art goes in a gallery', async () => {
      await expect(call(start(), 'hang_lights', { catalog_id: 'print-fern', over_id: 'og_bed', wall_id: 'wl_west' }))
        .rejects.toThrow("Fern Print is art: hang it with hang_gallery");
    });
  });

  describe('lay_rug', () => {
    it('lays the rug centered under the target', async () => {
      const session = start();

      const { placed } = await call(session, 'lay_rug', { catalog_id: 'rug-gray', under_id: 'og_bed' });

      expect(placed).toEqual([expect.objectContaining({ catalog_id: 'rug-gray', as: 'centered under your bed' })]);
      expect(fit(session)).toEqual([]);
    });

    it('lays it on the open floor nearest the target when it can not center it there', async () => {
      // A small rug already lies in front of the bed, where the new one would go.
      const session = start();
      await call(session, 'lay_rug', { catalog_id: 'rug-small', under_id: 'og_bed' });

      const { placed } = await call(session, 'lay_rug', { catalog_id: 'rug-gray', under_id: 'og_bed' });

      expect(placed).toEqual([expect.objectContaining({ catalog_id: 'rug-gray', as: 'on the open floor near your bed' })]);
      expect(fit(session)).toEqual([]);
    });
  });

  describe('make_corner', () => {
    it('makes a reading corner by the window: the chair, a floor lamp beside it, and a plant on its other side', async () => {
      const session = start();

      const { placed } = await call(session, 'make_corner', { chair_id: 'chair-reading', lamp_id: 'lamp-floor', side_id: 'plant-fern', near_id: 'op_window' });

      expect(placed.map(({ catalog_id }: { catalog_id: string }) => catalog_id)).toEqual(['chair-reading', 'lamp-floor', 'plant-fern']);
      const [chairItem, lampItem, plantItem] = placed.map(({ piece_id }: { piece_id: string }) => roomOf(session).find(({ id }) => id === piece_id)!);
      const distance = (a: typeof chairItem, b: typeof chairItem) =>
        Math.hypot(a.placement.position[0] - b.placement.position[0], a.placement.position[2] - b.placement.position[2]);
      expect(distance(chairItem, lampItem)).toBeLessThan(0.75);
      expect(distance(chairItem, plantItem)).toBeLessThan(0.75);
      expect(fit(session)).toEqual([]);
    });

    it('puts a table lamp on the side table beside the chair', async () => {
      const session = start();

      const { placed } = await call(session, 'make_corner', { chair_id: 'chair-reading', lamp_id: 'lamp-brass', side_id: 'table-side', near_id: 'op_window' });

      const [, table, lamp] = placed.map(({ piece_id }: { piece_id: string }) => session.state.pieces[piece_id]);
      expect(table.catalogId).toBe('table-side');
      expect(lamp).toMatchObject({ catalogId: 'lamp-brass', placement: { mount: 'surface', position: [expect.any(Number), expect.closeTo(0.55), expect.any(Number)] } });
    });

    it('puts a small plant on the furniture top nearest the chair, not on the floor', async () => {
      const session = start();

      const { placed } = await call(session, 'make_corner', { chair_id: 'chair-reading', lamp_id: 'lamp-floor', side_id: 'vase-white', near_id: 'og_desk' });

      expect(placed[2]).toMatchObject({ catalog_id: 'vase-white', as: 'on the nearest furniture top' });
    });

    it('stands a table lamp with no side table on the furniture top nearest the chair', async () => {
      const session = start();

      const { placed } = await call(session, 'make_corner', { chair_id: 'chair-reading', lamp_id: 'lamp-brass', side_id: '', near_id: 'og_desk' });

      expect(placed[1]).toMatchObject({ catalog_id: 'lamp-brass', as: 'on the nearest furniture top' });
      expect(session.state.pieces[placed[1].piece_id].placement).toMatchObject({ mount: 'surface', position: [expect.any(Number), expect.closeTo(0.76), expect.any(Number)] });
    });

    it('makes the corner around a chair already in the room, which stays where it is', async () => {
      const session = start();
      const { piece_id: chairId } = await call(session, 'place_piece', { catalog_id: 'chair-reading', anchor: { kind: 'open_floor', near_id: 'op_window' } });
      const chairAt = session.state.pieces[chairId].placement;

      const { placed } = await call(session, 'make_corner', { chair_id: chairId, lamp_id: 'lamp-floor', side_id: '', near_id: 'og_desk' });

      expect(placed).toEqual([{ catalog_id: 'lamp-floor', piece_id: expect.any(String), as: 'by the chair' }]);
      expect(session.state.pieces[chairId].placement).toEqual(chairAt);
      const [x, , z] = session.state.pieces[placed[0].piece_id].placement.position;
      expect(Math.hypot(x - chairAt.position[0], z - chairAt.position[2])).toBeLessThan(0.75);
      expect(fit(session)).toEqual([]);
    });
  });

  describe('in an empty room, furnished in the same reply', () => {
    it('takes the Catalog id of a Piece placed earlier wherever a move takes a room id, as it has no Piece id yet', async () => {
      const session = createSession({ setup: lShaped, catalog: decorCatalog, brief: { text: 'dorm' }, materials: [] });
      await call(session, 'place_piece', { catalog_id: 'bed-twin', anchor: { kind: 'against_wall', wall_id: 'wl_west', along: 0.5 } });

      const gallery = await call(session, 'hang_gallery', { over_id: 'bed-twin', wall_id: 'wl_west', catalog_ids: ['print-fern', 'poster-city'] });
      const pillows = await call(session, 'dress_bed', { bed_id: 'bed-twin', catalog_ids: ['pillow-navy'] });
      const rug = await call(session, 'lay_rug', { catalog_id: 'rug-small', under_id: 'bed-twin' });

      expect([...gallery.placed, ...pillows.placed, ...rug.placed].map(({ as }: { as: string }) => as))
        .toEqual(['over Twin Bed', 'over Twin Bed', 'on Twin Bed', 'centered under Twin Bed']);
    });
  });

  describe('two of the same item, as the beds of a double room', () => {
    it('names each by its place in the order placed', async () => {
      const session = createSession({ setup: lShaped, catalog: decorCatalog, brief: { text: 'double' }, materials: [] });
      await call(session, 'place_piece', { catalog_id: 'bed-twin', anchor: { kind: 'against_wall', wall_id: 'wl_west', along: 0.2 } });
      await call(session, 'place_piece', { catalog_id: 'bed-twin', anchor: { kind: 'against_wall', wall_id: 'wl_west', along: 0.8 } });
      const [first] = Object.keys(session.state.pieces);

      const pillows = await call(session, 'dress_bed', { bed_id: 'bed-twin#1', catalog_ids: ['pillow-navy'] });

      expect(session.state.pieces[pillows.placed[0].piece_id].placement.position[2]).toBeCloseTo(session.state.pieces[first].placement.position[2], 0);
    });

    it('takes a Catalog chair in make_corner as a chair to place, though one like it is in the room', async () => {
      const session = start();
      await call(session, 'place_piece', { catalog_id: 'chair-reading', anchor: { kind: 'open_floor', near_id: 'og_desk' } });

      const { placed } = await call(session, 'make_corner', { chair_id: 'chair-reading', lamp_id: 'lamp-floor', side_id: '', near_id: 'op_window' });

      expect(placed.map(({ catalog_id }: { catalog_id: string }) => catalog_id)).toEqual(['chair-reading', 'lamp-floor']);
    });
  });

  describe('dress_bed and style_tops', () => {
    it('rests pillows on the bed, and decor and plants on furniture tops', async () => {
      const session = start();

      await call(session, 'dress_bed', { bed_id: 'og_bed', catalog_ids: ['pillow-navy'] });
      const { placed, skipped } = await call(session, 'style_tops', {
        items: [{ catalog_id: 'vase-white', on_id: 'og_desk' }, { catalog_id: 'plant-fern', on_id: 'og_desk' }, { catalog_id: 'sofa-x', on_id: 'og_desk' }],
      });

      expect(placed).toHaveLength(2);
      expect(skipped).toEqual([{ catalog_id: 'sofa-x', why: 'The Catalog has no item "sofa-x"' }]);
      const surface = Object.values(session.state.pieces).filter(({ placement }) => placement.mount === 'surface');
      expect(surface.map(({ placement }) => placement.position[1])).toEqual([expect.closeTo(0.6), expect.closeTo(0.76), expect.closeTo(0.76)]);
    });
  });

  it('streams each Edit a move makes as it makes it', async () => {
    const streamed: Edit[] = [];
    const session = start((edit) => streamed.push(edit));

    await call(session, 'hang_gallery', { over_id: 'og_bed', wall_id: 'wl_west', catalog_ids: ['print-fern', 'poster-city'] });
    await call(session, 'dress_bed', { bed_id: 'og_bed', catalog_ids: ['pillow-navy'] });

    expect(streamed).toEqual(session.edits);
    expect(streamed).toHaveLength(3);
  });

  it('keeps every Fit rule across a whole room decorated by moves', async () => {
    const session = start();

    await call(session, 'hang_gallery', { over_id: 'og_bed', wall_id: 'wl_west', catalog_ids: ['print-fern', 'poster-city', 'sketch-oak'] });
    await call(session, 'lay_rug', { catalog_id: 'rug-gray', under_id: 'og_bed' });
    await call(session, 'make_corner', { chair_id: 'chair-reading', lamp_id: 'lamp-floor', side_id: 'plant-fern', near_id: 'op_window' });
    await call(session, 'dress_bed', { bed_id: 'og_bed', catalog_ids: ['pillow-navy'] });
    await call(session, 'style_tops', { items: [{ catalog_id: 'vase-white', on_id: 'og_desk' }] });

    expect(session.edits).toHaveLength(9);
    expect(fit(session)).toEqual([]);
  });
});
