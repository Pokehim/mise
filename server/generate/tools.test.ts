import { describe, expect, it } from 'vitest';
import { checkFit } from '../../shared/fit';
import { catalog, item, setup } from '../../shared/test-room';
import type { Brief, LibraryMaterial } from '../../shared/types';
import { createSession, type DesignSession } from './tools';

// The test room: 4 × 3 m, a Kept bed in the north-west corner (head on the North wall, x −2 to −1.01,
// z −1.5 to 0.53), a desk against the East wall, a window mid North wall and a door on the South wall.

const print = item('print-fern', 'wall_art', 'Fern Print', [0.5, 0.6, 0.03], { mount: 'wall', priceEstimateUsd: 40, colors: ['Green'] });
const poster = item('poster-city', 'wall_art', 'City Poster', [0.4, 0.5, 0.02], { mount: 'wall', priceEstimateUsd: 30, colors: ['Black'] });
const pillow = item('pillow-navy', 'decor', 'Navy Pillow', [0.45, 0.45, 0.15], { priceEstimateUsd: 25, colors: ['Navy'] });
const plant = item('plant-fig', 'plant', 'Small Fig', [0.2, 0.3, 0.2], { priceEstimateUsd: 30, colors: ['Green'] });
const nightstand = item('nightstand-oak', 'nightstand', 'Oak Nightstand', [0.45, 0.6, 0.4], { priceEstimateUsd: 70 });
const sofa = item('sofa-gray', 'sofa', 'Gray Sofa', [2, 0.85, 0.9], { priceEstimateUsd: 450 });
const wardrobe = item('wardrobe-white', 'wardrobe', 'White Wardrobe', [1, 1.8, 0.58], { priceEstimateUsd: 260 });
const bookcase = item('bookcase-tall', 'shelf', 'Tall Bookcase', [0.66, 1.89, 0.38], { priceEstimateUsd: 90 });
const armchair = item('chair-reading', 'chair', 'Reading Chair', [0.8, 0.8, 0.7], { priceEstimateUsd: 120 });
const rugs = catalog.items.filter(({ category }) => category === 'rug');
const decorCatalog = { ...catalog, items: [...catalog.items, print, poster, pillow, plant, nightstand, sofa, wardrobe, bookcase, armchair] };
const materials: LibraryMaterial[] = [
  { id: 'oak', name: 'Oak', kind: 'wood', maps: { color: 'oak.jpg' }, tileSize: 1, source: 'CC0' },
  { id: 'wallpaper-striped', name: 'Striped wallpaper', kind: 'wallpaper', maps: { color: 'w.jpg' }, tileSize: 1, source: 'CC0' },
];

const start = (brief: Brief = { text: 'cozy', budgetUsd: 400 }) => createSession({ setup, catalog: decorCatalog, brief, materials });

/** Runs one of the session's tools the way the Tool Runner does: its input parsed against the tool's schema first. */
async function call(session: DesignSession, name: string, input: unknown) {
  const tool = session.tools.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`No tool ${name}`);
  return JSON.parse((await tool.run(tool.parse(input))) as string);
}

describe('the Design tools', () => {
  it('are the 6 decorating moves and the 7 tools of spec §13.2, each strict but stock_shelves and place_piece, for the grammar\'s size', () => {
    expect(start().tools.map(({ name, strict }) => [name, strict])).toEqual([
      ['hang_gallery', true], ['lay_rug', true], ['make_corner', true], ['dress_bed', true], ['style_tops', true], ['stock_shelves', undefined],
      ['search_catalog', true], ['place_piece', undefined], ['replace_original', true], ['recolor', true],
      ['apply_finish', true], ['remove', true], ['finish_design', true],
    ]);
  });

  describe('search_catalog', () => {
    it("never offers the Catalog's placeholder boxes", async () => {
      const placeholder = item('placeholder-chair', 'chair', 'Placeholder Desk Chair', [0.6, 0.9, 0.6], { source: 'generated' });
      const session = createSession({ setup, catalog: { ...decorCatalog, items: [...decorCatalog.items, placeholder] }, brief: { text: 'cozy' }, materials });

      const { items } = await call(session, 'search_catalog', { category: 'chair' });
      expect(items.map(({ id }: { id: string }) => id)).not.toContain('placeholder-chair');
    });

    it('finds Catalog items of a category, with their size, colors, styles and estimated price, in a shuffled order', async () => {
      const { items } = await call(start(), 'search_catalog', { category: 'wall_art' });
      expect(items).toHaveLength(2);
      expect(items).toEqual(expect.arrayContaining([
        { id: 'print-fern', title: 'Fern Print', category: 'wall_art', size_m: [0.5, 0.6, 0.03], colors: ['Green'], styles: [], price_usd: 40 },
        { id: 'poster-city', title: 'City Poster', category: 'wall_art', size_m: [0.4, 0.5, 0.02], colors: ['Black'], styles: [], price_usd: 30 },
      ]));
    });

    it('shows different matches first to different takes', async () => {
      const chairs = Array.from({ length: 30 }, (_, i) => item(`chair-${i}`, 'chair', `Chair ${i}`, [0.6, 0.9, 0.6]));
      const catalog = { ...decorCatalog, items: [...decorCatalog.items, ...chairs] };
      const firstTen = async (seed: number) => {
        let s = seed;
        const random = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
        const { items } = await call(createSession({ setup, catalog, brief: { text: 'cozy' }, materials, random }), 'search_catalog', { category: 'chair' });
        return items.map(({ id }: { id: string }) => id).join();
      };
      expect(await firstTen(1)).not.toBe(await firstTen(2));
    });

    it('narrows by size and estimated price', async () => {
      const { items } = await call(start(), 'search_catalog', { category: 'wall_art', max_width_m: 0.45, max_price_usd: 35 });

      expect(items.map(({ id }: { id: string }) => id)).toEqual(['poster-city']);
    });
  });

  describe('place_piece', () => {
    it('places a Piece where an Anchor says, as a place Edit by Claude', async () => {
      const session = start();

      const result = await call(session, 'place_piece', { catalog_id: 'nightstand-oak', anchor: { kind: 'beside', target_id: 'og_bed', side: 'right' } });

      expect(result).toMatchObject({ piece_id: expect.stringMatching(/^pc_/), total_usd: 70, budget_left_usd: 330 });
      expect(session.edits).toEqual([expect.objectContaining({ type: 'place', by: 'claude', pieceId: result.piece_id, catalogId: 'nightstand-oak' })]);
      expect(session.state.pieces[result.piece_id].placement).toMatchObject({ mount: 'floor', rotationY: expect.closeTo(0) });
    });

    it('fails with the Fit violations when nothing near the Anchor fits, and makes no Edit', async () => {
      const session = start({ text: 'a sofa' });

      // The bed takes 2.03 m of the 3 m West wall, so a 2 m sofa against it always overlaps the bed.
      await expect(call(session, 'place_piece', { catalog_id: 'sofa-gray', anchor: { kind: 'against_wall', wall_id: 'wl_west', along: 'center' } }))
        .rejects.toThrow("Gray Sofa doesn't fit there, even slid up to 1 m either way. Fit violations: Overlaps your bed (overlap, og_bed)");
      expect(session.edits).toEqual([]);
    });

    it('fails when the Piece would take the estimated total over the budget', async () => {
      const session = start({ text: 'cozy', budgetUsd: 100 });
      await call(session, 'place_piece', { catalog_id: 'nightstand-oak', anchor: { kind: 'beside', target_id: 'og_bed', side: 'right' } });

      await expect(call(session, 'place_piece', { catalog_id: 'print-fern', anchor: { kind: 'on_wall', wall_id: 'wl_south', along: 'right' } }))
        .rejects.toThrow('Fern Print (≈ $40) would take the estimated total to $110, and it must stay under the $100 budget: $30 is left');
    });

    it('fails for an id the Catalog does not have', async () => {
      await expect(call(start(), 'place_piece', { catalog_id: 'B000NOPE', anchor: { kind: 'open_floor' } }))
        .rejects.toThrow('The Catalog has no item "B000NOPE": use an id from search_catalog');
    });

    it('rests decor on the bedding of a bed', async () => {
      const session = start();

      const { piece_id } = await call(session, 'place_piece', { catalog_id: 'pillow-navy', anchor: { kind: 'on_top_of', target_id: 'og_bed' } });

      // The Kept bed is 0.6 m tall, lower than bedding reaches.
      expect(session.state.pieces[piece_id].placement).toMatchObject({ mount: 'surface', position: [expect.closeTo(-1.505), expect.closeTo(0.6), expect.any(Number)] });
    });

    it("tells Claude a shelf's levels, and rests decor on the level it names", async () => {
      const levels = [0.17, 0.56, 0.95, 1.3, 1.59].map((height, i, all) => ({ height, center: [0, 0] as [number, number], size: [0.66, 0.36] as [number, number], clearance: (all[i + 1] ?? 1.89) - height - 0.02 }));
      const session = createSession({ setup, catalog: decorCatalog, brief: { text: 'books' }, materials, shelfLevels: { 'bookcase-tall': levels } });

      const bookcase = await call(session, 'place_piece', { catalog_id: 'bookcase-tall', anchor: { kind: 'against_wall', wall_id: 'wl_south', along: 'right' } });
      const { piece_id } = await call(session, 'place_piece', { catalog_id: 'plant-fig', anchor: { kind: 'on_top_of', target_id: bookcase.piece_id, level: 1 } });

      expect(bookcase.shelf_levels).toEqual([
        { level: 0, height_m: 0.17, room_above_m: 0.37 }, { level: 1, height_m: 0.56, room_above_m: 0.37 }, { level: 2, height_m: 0.95, room_above_m: 0.33 },
        { level: 3, height_m: 1.3, room_above_m: 0.27 }, { level: 4, height_m: 1.59, room_above_m: 0.28 },
      ]);
      expect(session.state.pieces[piece_id].placement).toMatchObject({ mount: 'surface', position: [expect.any(Number), expect.closeTo(0.56), expect.any(Number)] });
    });

    describe('stock_shelves', () => {
      const levels = [0.17, 0.56, 0.95, 1.3, 1.59].map((height, i, all) => ({ height, center: [0, 0] as [number, number], size: [0.66, 0.36] as [number, number], clearance: (all[i + 1] ?? 1.89) - height - 0.02 }));
      const books = item('books-row', 'decor', 'Hardcover Books, Row of 10', [0.4, 0.22, 0.17], { priceEstimateUsd: 60 });
      const shelving = (editRange?: [number, number]) => createSession({
        setup, catalog: { ...decorCatalog, items: [...decorCatalog.items, books] }, brief: { text: 'a library' }, materials,
        shelfLevels: { 'bookcase-tall': levels }, editRange,
      });

      it('fills a bookcase from the top down, the items in turn, each level taking the next that fits', async () => {
        const session = shelving();
        await call(session, 'place_piece', { catalog_id: 'bookcase-tall', anchor: { kind: 'against_wall', wall_id: 'wl_south', along: 'right' } });

        // Named by its Catalog id, as a Piece placed in the same reply is. The fig, 0.3 m tall, is too tall for levels 3 and 4.
        const { placed } = await call(session, 'stock_shelves', { shelves: [{ shelf_id: 'bookcase-tall', catalog_ids: ['books-row', 'plant-fig'] }] });

        expect(placed.map(({ catalog_id, as }: { catalog_id: string; as: string }) => [catalog_id, as])).toEqual([
          ['books-row', 'on level 4 of Tall Bookcase'], ['books-row', 'on level 3 of Tall Bookcase'], ['plant-fig', 'on level 2 of Tall Bookcase'],
          ['books-row', 'on level 1 of Tall Bookcase'], ['plant-fig', 'on level 0 of Tall Bookcase'],
        ]);
        const heights = placed.map(({ piece_id }: { piece_id: string }) => session.state.pieces[piece_id].placement.position[1]);
        expect(heights).toEqual([1.59, 1.3, 0.95, 0.56, 0.17].map((height) => expect.closeTo(height)));
      });

      it('counts what it puts inside a shelf toward neither the Edit limit nor the Piece limit', async () => {
        const session = shelving([1, 2]);
        await call(session, 'place_piece', { catalog_id: 'bookcase-tall', anchor: { kind: 'against_wall', wall_id: 'wl_south', along: 'right' } });
        await call(session, 'stock_shelves', { shelves: [{ shelf_id: 'bookcase-tall', catalog_ids: ['books-row'] }] });

        await call(session, 'place_piece', { catalog_id: 'print-fern', anchor: { kind: 'on_wall', wall_id: 'wl_east', along: 'right' } });
        await expect(call(session, 'place_piece', { catalog_id: 'poster-city', anchor: { kind: 'on_wall', wall_id: 'wl_north', along: 'left' } }))
          .rejects.toThrow('This Design has 2 Edits, the most it may have: call finish_design');
        expect(session.edits).toHaveLength(7);
      });

      it('says why it puts nothing on furniture without levels', async () => {
        await expect(call(shelving(), 'stock_shelves', { shelves: [{ shelf_id: 'og_desk', catalog_ids: ['books-row'] }] }))
          .rejects.toThrow(/has no shelf levels: style_tops puts things on its top/);
      });
    });

    it('hangs a gallery wall: one frame centered over furniture, the next beside it, the gap apart', async () => {
      const session = start();

      // The bed runs along the West wall from 0.97 to 3 m from its left (south) end: its middle is 1.985 m along.
      const middle = await call(session, 'place_piece', { catalog_id: 'print-fern', anchor: { kind: 'on_wall_over', target_id: 'og_bed', wall_id: 'wl_west' } });
      const next = await call(session, 'place_piece', {
        catalog_id: 'poster-city', anchor: { kind: 'on_wall_beside', target_id: middle.piece_id, side: 'left', gap_m: 0.08 },
      });

      // Seen from inside facing the West wall, left is south (+z): 0.25 + 0.08 + 0.2 m south of the print's center.
      expect(session.state.pieces[middle.piece_id].placement).toMatchObject({
        mount: 'wall', wallId: 'wl_west', position: [expect.closeTo(-1.985), expect.closeTo(1.15), expect.closeTo(1.5 - 1.985)],
      });
      expect(session.state.pieces[next.piece_id].placement).toMatchObject({
        mount: 'wall', wallId: 'wl_west', position: [expect.closeTo(-1.99), expect.closeTo(1.2), expect.closeTo(1.5 - 1.985 + 0.53)],
      });
    });

    it('hangs wall art clear of tall furniture, or fails saying what it would hang behind', async () => {
      const session = start({ text: 'storage' });
      // The wardrobe takes the South wall's right end, x −2 to −1, 1.8 m up.
      const wardrobe = await call(session, 'place_piece', { catalog_id: 'wardrobe-white', anchor: { kind: 'against_wall', wall_id: 'wl_south', along: 'right' } });

      const slid = await call(session, 'place_piece', { catalog_id: 'print-fern', anchor: { kind: 'on_wall', wall_id: 'wl_south', along: 'right' } });
      expect(slid.placement.position_m[0]).toBeGreaterThanOrEqual(-0.75);
      await expect(call(session, 'place_piece', {
        catalog_id: 'poster-city', anchor: { kind: 'on_wall_over', target_id: wardrobe.piece_id, center_height_m: 1.2 },
      })).rejects.toThrow(`Fit violations: Hangs behind White Wardrobe (overlap, ${wardrobe.piece_id})`);
    });

    it('allows at most the large furniture changes it is given, not counting removed Originals', async () => {
      // From #97: a remodel clears what doesn't belong before it furnishes.
      const session = createSession({ setup, catalog: decorCatalog, brief: { text: 'cozy' }, materials, maxLargeChanges: 2 });
      await call(session, 'remove', { target_ids: ['og_desk'] });
      await call(session, 'place_piece', { catalog_id: 'wardrobe-white', anchor: { kind: 'against_wall', wall_id: 'wl_south', along: 'right' } });
      await call(session, 'place_piece', { catalog_id: 'desk-walnut', anchor: { kind: 'against_wall', wall_id: 'wl_east', along: 'center' } });

      await expect(call(session, 'place_piece', { catalog_id: 'bookcase-tall', anchor: { kind: 'against_wall', wall_id: 'wl_east', along: 'right' } }))
        .rejects.toThrow('This Design already has 2 large furniture changes, the most it may have: decorate instead');
      // A reading chair isn't large furniture.
      await call(session, 'place_piece', { catalog_id: 'chair-reading', anchor: { kind: 'open_floor' } });
    });

    it("starts from another Design's Edits, whose Pieces count toward neither the budget nor the large furniture changes", async () => {
      // The Mover's current Design: a wardrobe and a nightstand, $330.
      const current = createSession({ setup, catalog: decorCatalog, brief: { text: 'move in' }, materials });
      await call(current, 'place_piece', { catalog_id: 'wardrobe-white', anchor: { kind: 'against_wall', wall_id: 'wl_south', along: 'right' } });
      await call(current, 'place_piece', { catalog_id: 'nightstand-oak', anchor: { kind: 'beside', target_id: 'og_bed', side: 'right' } });
      const session = createSession({ setup, catalog: decorCatalog, brief: { text: 'cozy', budgetUsd: 200 }, materials, startsFrom: current.edits, maxLargeChanges: 1 });

      const print = await call(session, 'place_piece', { catalog_id: 'print-fern', anchor: { kind: 'on_wall', wall_id: 'wl_east', along: 'left' } });
      expect(print).toMatchObject({ total_usd: 40, budget_left_usd: 160 });
      await call(session, 'place_piece', { catalog_id: 'bookcase-tall', anchor: { kind: 'against_wall', wall_id: 'wl_east', along: 'right' } });
      await expect(call(session, 'place_piece', { catalog_id: 'chair-reading', anchor: { kind: 'open_floor' } }))
        .rejects.toThrow('would take the estimated total to $250, and it must stay under the $200 budget: $70 is left');

      expect(session.edits.slice(0, 2)).toEqual(current.edits);
      expect(session.edits).toHaveLength(4);
      expect(Object.keys(session.state.pieces)).toEqual(expect.arrayContaining(Object.keys(current.state.pieces)));
    });
  });

  describe('replace_original', () => {
    it("puts the Piece in the Original's place, its back where the Original's was", async () => {
      const session = start();

      const { piece_id } = await call(session, 'replace_original', { original_id: 'og_desk', catalog_id: 'desk-walnut' });

      // The desk's back is on the East wall at x = 2; the walnut desk is 0.5 deep.
      expect(session.state.pieces[piece_id]).toMatchObject({ replacesOriginalId: 'og_desk', placement: { position: [expect.closeTo(1.75), 0, expect.closeTo(-0.6)] } });
      expect(session.state.originals.og_desk.visible).toBe(false);
    });

    it('fails for a Kept Original', async () => {
      await expect(call(start(), 'replace_original', { original_id: 'og_bed', catalog_id: 'sofa-gray' }))
        .rejects.toThrow('your bed is Kept: it stays in the room. You can recolor it, but not move, replace or remove it');
    });
  });

  describe('recolor', () => {
    it("recolors one Part of an Original or a Piece, Kept ones too", async () => {
      const session = start();

      expect(await call(session, 'recolor', { target_id: 'og_bed', part_id: 'bedding', color: '#9caf88' })).toEqual({ ok: true });
      expect(session.state.originals.og_bed.partColors).toEqual({ bedding: '#9caf88' });
    });

    it('fails for a Part the item does not have, naming the ones it has', async () => {
      await expect(call(start(), 'recolor', { target_id: 'og_desk', part_id: 'cushions', color: '#9caf88' }))
        .rejects.toThrow('your desk has no Part "cushions": its Parts are top, legs, or "*" for all of them');
    });
  });

  describe('apply_finish', () => {
    it('paints a wall', async () => {
      const session = start();

      await call(session, 'apply_finish', { target: { kind: 'wall', wall_id: 'wl_north' }, finish: { kind: 'paint', color: '#9caf88' } });

      expect(session.state.surfaces.walls).toEqual({ wl_north: { kind: 'paint', color: '#9caf88' } });
    });

    it('puts a Material Library material on the floor, or fails for one it does not have', async () => {
      const session = start();

      await call(session, 'apply_finish', { target: { kind: 'floor' }, finish: { kind: 'material', material_id: 'oak' } });

      expect(session.state.surfaces.floor).toEqual({ kind: 'material', materialId: 'oak' });
      await expect(call(session, 'apply_finish', { target: { kind: 'floor' }, finish: { kind: 'material', material_id: 'lava' } }))
        .rejects.toThrow('The Material Library has no material "lava": it has oak, wallpaper-striped');
    });
  });

  describe('remove', () => {
    it('removes Pieces and Originals that are not Kept, several in one call', async () => {
      const session = start();
      const { piece_id } = await call(session, 'place_piece', { catalog_id: 'plant-fig', anchor: { kind: 'open_floor' } });

      expect(await call(session, 'remove', { target_ids: [piece_id, 'og_desk'] })).toMatchObject({ ok: true, removed: 2 });

      expect(session.state.pieces).toEqual({});
      expect(session.state.originals.og_desk.visible).toBe(false);
    });

    it('removes a Piece named twice once', async () => {
      const session = start();
      const { piece_id } = await call(session, 'place_piece', { catalog_id: 'plant-fig', anchor: { kind: 'open_floor' } });

      expect(await call(session, 'remove', { target_ids: [piece_id, piece_id] })).toMatchObject({ ok: true, removed: 1 });
    });

    it('removes nothing when one of them is Kept', async () => {
      const session = start();

      await expect(call(session, 'remove', { target_ids: ['og_desk', 'og_bed'] })).rejects.toThrow('your bed is Kept');
      expect(session.state.originals.og_desk.visible).toBe(true);
    });
  });

  describe('finish_design', () => {
    const palette = { wall: '#f4efe6', accents: ['#9caf88', '#2f3e46'], materials: ['oak', 'linen'] };

    it('ends the Design with its name, rationale and Palette, once it decorates enough', async () => {
      const session = start({ text: 'cozy', budgetUsd: 400 });
      const place = (catalog_id: string, anchor: unknown) => call(session, 'place_piece', { catalog_id, anchor });
      // Off the bed's middle by half the poster beside it, so the two hang centered over the bed.
      const middle = await place('print-fern', { kind: 'on_wall_over', target_id: 'og_bed', wall_id: 'wl_west', offset_m: -0.23 });
      await place('poster-city', { kind: 'on_wall_beside', target_id: middle.piece_id, side: 'right', gap_m: 0.06 });
      await place(rugs[0].id, { kind: 'centered_under', target_id: 'og_bed' });
      await place('lamp-brass', { kind: 'on_top_of', target_id: 'og_desk' });
      await place('pillow-navy', { kind: 'on_top_of', target_id: 'og_bed' });
      await place('plant-fig', { kind: 'on_top_of', target_id: 'og_desk' });
      await call(session, 'apply_finish', { target: { kind: 'wall', wall_id: 'wl_west' }, finish: { kind: 'paint', color: '#9caf88' } });
      await call(session, 'recolor', { target_id: 'og_bed', part_id: 'bedding', color: '#f4efe6' });

      expect(await call(session, 'finish_design', { name: 'Sage Nook', rationale: 'A cozy sage corner, as the Brief asks.', palette })).toEqual({ ok: true });
      expect(session.finished).toEqual({ name: 'Sage Nook', rationale: 'A cozy sage corner, as the Brief asks.', palette });
      expect(checkFit(setup, decorCatalog, session.state, Object.keys(session.state.pieces), { walkway: true })).toEqual([]);
      await expect(call(session, 'recolor', { target_id: 'og_bed', part_id: 'frame', color: '#000000' })).rejects.toThrow('The Design is finished');
    });

    it('sends Claude back once with what the review flags, as a designer would before handing it over', async () => {
      const session = start({ text: 'cozy', budgetUsd: 400 });
      const place = (catalog_id: string, anchor: unknown) => call(session, 'place_piece', { catalog_id, anchor });
      const middle = await place('print-fern', { kind: 'on_wall_over', target_id: 'og_bed', wall_id: 'wl_west' });
      await place('poster-city', { kind: 'on_wall_beside', target_id: middle.piece_id, side: 'right', gap_m: 0.06 });
      await place(rugs[0].id, { kind: 'open_floor' });
      await place('lamp-brass', { kind: 'on_top_of', target_id: 'og_desk' });
      await place('pillow-navy', { kind: 'on_top_of', target_id: 'og_bed' });
      await place('plant-fig', { kind: 'on_top_of', target_id: 'og_desk' });
      await call(session, 'apply_finish', { target: { kind: 'wall', wall_id: 'wl_west' }, finish: { kind: 'paint', color: '#9caf88' } });
      await call(session, 'recolor', { target_id: 'og_bed', part_id: 'bedding', color: '#f4efe6' });

      // The rug on the open floor has nothing standing on it.
      await expect(call(session, 'finish_design', { name: 'Sage Nook', rationale: 'Sage.', palette })).rejects.toThrow(/Review: .* has no furniture on it, so it floats/);
      expect(await call(session, 'finish_design', { name: 'Sage Nook', rationale: 'Sage.', palette })).toEqual({ ok: true });
    });

    it('sends Claude back once to add what a decorated room lacks', async () => {
      const session = start();
      await call(session, 'apply_finish', { target: { kind: 'wall', wall_id: 'wl_west' }, finish: { kind: 'paint', color: '#9caf88' } });

      await expect(call(session, 'finish_design', { name: 'Sage', rationale: 'Sage walls.', palette }))
        .rejects.toThrow('Not finished: this Design has 1 Edit besides removals, and needs 8 to 24. It still needs wall art (2 to 4 frames), a rug, a lamp, decor on the bed or a furniture top');
      expect(await call(session, 'finish_design', { name: 'Sage', rationale: 'Sage walls.', palette })).toEqual({ ok: true });
    });

    it("sends Claude back once for a name another take on the Brief already has", async () => {
      const takenNames = new Set<string>();
      const [first, second] = [0, 1].map(() => createSession({ setup, catalog: decorCatalog, brief: { text: 'cozy' }, materials, takenNames }));
      const finish = (session: DesignSession, name: string) => call(session, 'finish_design', { name, rationale: 'Oat walls.', palette });
      for (const session of [first, second]) await expect(finish(session, 'Quiet Oat Nook')).rejects.toThrow('Not finished');

      expect(await finish(first, 'Quiet Oat Nook')).toEqual({ ok: true });
      await expect(finish(second, 'quiet oat nook')).rejects.toThrow('Another take on this Brief is called "Quiet Oat Nook": give this one a name of its own');
      expect(await finish(second, 'Thrifty Oat Nook')).toEqual({ ok: true });
    });

    it('fails for a name longer than 3 words', async () => {
      await expect(call(start(), 'finish_design', { name: 'A Very Cozy Sage Nook', rationale: 'x', palette }))
        .rejects.toThrow('The name "A Very Cozy Sage Nook" has 5 words: use 3 or fewer');
    });
  });

  it('stops every tool but finish_design once the tool calls run out', async () => {
    const session = createSession({ setup, catalog: decorCatalog, brief: { text: 'cozy' }, materials, maxToolCalls: 2 });
    await call(session, 'search_catalog', { category: 'rug' });
    await call(session, 'search_catalog', { category: 'lamp' });

    await expect(call(session, 'search_catalog', { category: 'plant' })).rejects.toThrow('No tool calls are left: call finish_design now');
  });
});
