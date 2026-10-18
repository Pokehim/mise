import { describe, expect, it } from 'vitest';
import { replay } from '../../shared/replay';
import { catalog, edit, item, onFloor, setup } from '../../shared/test-room';
import type { Edit, Placement } from '../../shared/types';
import { reviewFlags } from './review';

// From #97's review_design: what a designer would flag walking through the room before handing a Design over.
// The desk stands against the East wall (x = 2), facing west: x 1.4–2, z −1.135 to −0.065, its top 0.76 m up.
const print = item('print-fern', 'wall_art', 'Fern Print', [0.5, 0.6, 0.03], { mount: 'wall', colors: ['Green'], styleTags: ['Scandinavian'] });
const vase = (n: number, colors: string[] = ['White']) => item(`vase-${n}`, 'decor', `Vase ${n}`, [0.12, 0.25, 0.12], { colors, priceEstimateUsd: 20 });
const rug = item('rug-oat', 'rug', 'Oat Rug', [1.2, 0.01, 1.8], { colors: ['Beige'], styleTags: ['Japandi'] });
const reviewCatalog = { ...catalog, items: [...catalog.items, print, rug, ...[1, 2, 3, 4, 5].map((n) => vase(n))] };

/** The print on the East wall, `bottom` meters up, `offset` meters along it from the desk's middle (z = −0.6). */
const onEastWall = (bottom: number, offset = 0): Placement => ({ position: [1.985, bottom, -0.6 + offset], rotationY: -Math.PI / 2, mount: 'wall', wallId: 'wl_east' });
const onDesk = (dz: number): Placement => ({ position: [1.7, 0.76, -0.6 + dz], rotationY: 0, mount: 'surface' });
const place = (pieceId: string, catalogId: string, placement: Placement) => edit(`ed_${pieceId}`, { type: 'place', pieceId, catalogId, placement });
const flagsOf = (edits: Edit[], catalogUsed = reviewCatalog) => reviewFlags(setup, catalogUsed, replay(setup, catalogUsed, edits));

describe('reviewFlags', () => {
  it('flags nothing about art hung centered over the furniture under it', () => {
    expect(flagsOf([place('pc_print', 'print-fern', onEastWall(1.2))]).filter((flag) => flag.includes('Fern Print'))).toEqual([]);
  });

  it('flags art hung off the middle of the furniture under it', () => {
    expect(flagsOf([place('pc_print', 'print-fern', onEastWall(1.2, 0.3))]).join('\n')).toMatch(/Fern Print is 0\.3 m (left|right) of the middle of your desk/);
  });

  it('takes art over different furniture on one wall as separate pieces, not one group', () => {
    // The bed's head is on the North wall at x −2 to −1.01; the dresser stands against it at x 0.6 to 1.4.
    const dresser = item('dresser-oak', 'dresser', 'Oak Dresser', [0.8, 0.8, 0.45]);
    const both = { ...reviewCatalog, items: [...reviewCatalog.items, dresser] };
    const onNorthWall = (x: number, bottom: number): Placement => ({ position: [x, bottom, -1.485], rotationY: 0, mount: 'wall', wallId: 'wl_north' });

    expect(flagsOf([
      place('pc_dresser', 'dresser-oak', onFloor(1, -1.275)),
      place('pc_over_bed', 'print-fern', onNorthWall(-1.505, 1.2)),
      place('pc_over_dresser', 'print-fern', onNorthWall(1, 1.2)),
    ], both).filter((flag) => flag.includes('group') || flag.includes('wider'))).toEqual([]);
  });

  it('judges no lights as art: an LED strip along the top of the wall is no part of the gallery under it', () => {
    const strip = item('led-strip', 'wall_art', 'Purple LED Strip Lights, 6.6 ft', [2, 0.36, 0.006], { mount: 'wall', colors: ['Purple'] });
    const withStrip = { ...reviewCatalog, items: [...reviewCatalog.items, strip] };

    expect(flagsOf([place('pc_print', 'print-fern', onEastWall(1.2)), place('pc_strip', 'led-strip', onEastWall(2.22, 0.2))], withStrip)).toEqual([]);
  });

  it('flags a crowded top', () => {
    const vases = [1, 2, 3, 4].map((n) => place(`pc_vase${n}`, `vase-${n}`, onDesk(-0.4 + n * 0.16)));

    expect(flagsOf(vases)).toContain('your desk holds 4 things: keep a top to 3 or fewer, grouped, with bare space around them');
  });

  it("flags more than 3 accent colors among the furnishings' main colors, but not the colors of art or plants", () => {
    const poster = item('poster-wave', 'wall_art', 'The Great Wave', [0.46, 0.61, 0.003], { mount: 'wall', colors: ['Orange', 'Gray', 'Blue'] });
    const fern = item('plant-fern', 'plant', 'Fern', [0.3, 0.6, 0.3], { colors: ['Green'] });
    const colorful = {
      ...reviewCatalog,
      items: [...reviewCatalog.items, poster, fern, vase(6, ['Red', 'Purple']), vase(7, ['Teal']), vase(8, ['Mustard']), vase(9, ['Navy'])],
    };
    const vases = [6, 7, 8].map((n, i) => place(`pc_v${n}`, `vase-${n}`, onDesk(-0.3 + i * 0.3)));
    const accents = (edits: Edit[]) => flagsOf(edits, colorful).filter((flag) => flag.includes('accent colors'));

    expect(accents([...vases, place('pc_wave', 'poster-wave', onEastWall(1.2)), place('pc_fern', 'plant-fern', onFloor(0.3, 0.8))])).toEqual([]);
    expect(accents([...vases, place('pc_v9', 'vase-9', onFloor(0.3, 0.8))]).join('\n')).toContain('The Pieces bring 4 accent colors (red, teal, mustard, navy)');
  });

  it('counts accent colors by family, and earthy names as neutrals', () => {
    const named = ['Navy', 'Navy Blue', 'Champagne', 'Stucco', 'Bear', 'Chestnut', 'Mustard', 'Coral/Orange', 'Teal'];
    const colorful = { ...reviewCatalog, items: [...reviewCatalog.items, ...named.map((color, i) => vase(10 + i, [color]))] };
    const placed = (count: number) => named.slice(0, count).map((_, i) => place(`pc_v${i}`, `vase-${10 + i}`, onFloor(-0.5 + (i % 3) * 0.3, 0.5 + Math.floor(i / 3) * 0.3)));

    expect(flagsOf(placed(8), colorful).join('\n')).not.toContain('accent colors');
    expect(flagsOf(placed(9), colorful).join('\n')).toContain('The Pieces bring 4 accent colors (navy, mustard, orange, teal)');
  });

  it('flags a rug with nothing on it', () => {
    expect(flagsOf([place('pc_rug', 'rug-oat', onFloor(0.3, 0.8))]).join('\n')).toContain('Oat Rug has no furniture on it');
  });

  it('flags art too small for the furniture under it, and a rug too small for the table it anchors', () => {
    const tiny = item('print-tiny', 'wall_art', 'Tiny Print', [0.3, 0.4, 0.02], { mount: 'wall' });
    const table = item('table-oak', 'table', 'Oak Table', [1.5, 0.75, 0.9]);
    const small = { ...reviewCatalog, items: [...reviewCatalog.items, tiny, table] };
    const flags = flagsOf([
      place('pc_tiny', 'print-tiny', onEastWall(1.2)),
      place('pc_table', 'table-oak', onFloor(-0.6, 0.6)),
      place('pc_rug', 'rug-oat', { ...onFloor(-0.6, 0.6), rotationY: Math.PI / 2 }),
    ], small).join('\n');

    expect(flags).toContain('Tiny Print is 0.3 m wide over your desk, which is 1.07 m: too small to read');
    expect(flags).toContain('Oat Rug (1.8 × 1.2 m) is too small for Oak Table and its chairs');
  });
});
