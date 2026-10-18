import { describe, expect, it } from 'vitest';
import { replay } from '../../shared/replay';
import { catalog, edit, item, onFloor, setup } from '../../shared/test-room';
import type { Brief, Edit, Placement } from '../../shared/types';
import { reviewDesign } from './review';

// The desk stands against the East wall (x = 2), facing west: x 1.4–2, z −1.135 to −0.065, its top 0.76 m up.
const print = item('print-fern', 'wall_art', 'Fern Print', [0.5, 0.6, 0.03], { mount: 'wall', colors: ['Green'], styleTags: ['Scandinavian'] });
const vase = (n: number, colors: string[] = ['White']) =>
  item(`vase-${n}`, 'decor', `Vase ${n}`, [0.12, 0.25, 0.12], { colors, styleTags: ['Modern'], priceEstimateUsd: 20 });
const rug = item('rug-oat', 'rug', 'Oat Rug', [1.2, 0.01, 1.8], { colors: ['Beige'], styleTags: ['Japandi'] });
const reviewCatalog = { ...catalog, items: [...catalog.items, print, rug, ...[1, 2, 3, 4, 5].map((n) => vase(n))] };
const brief: Brief = { text: 'calm study corner', styles: ['Japandi'], budgetUsd: 400 };

/** The print on the East wall, `bottom` meters up, `offset` meters along it from the desk's middle (z = −0.6). */
const onEastWall = (bottom: number, offset = 0): Placement => ({ position: [1.985, bottom, -0.6 + offset], rotationY: -Math.PI / 2, mount: 'wall', wallId: 'wl_east' });
const onDesk = (dz: number): Placement => ({ position: [1.7, 0.76, -0.6 + dz], rotationY: 0, mount: 'surface' });
const place = (pieceId: string, catalogId: string, placement: Placement) => edit(`ed_${pieceId}`, { type: 'place', pieceId, catalogId, placement });
const review = (edits: Edit[], catalogUsed = reviewCatalog, briefUsed = brief) =>
  reviewDesign(setup, catalogUsed, replay(setup, catalogUsed, edits), briefUsed);

describe('reviewDesign', () => {
  it('says what hangs over the desk, and flags nothing when it hangs centered, 15–35 cm above it', () => {
    const { walls, flags } = review([place('pc_print', 'print-fern', onEastWall(0.76 + 0.25))]);

    expect(walls).toHaveLength(1);
    expect(walls[0].wall).toBe('East wall (wl_east)');
    expect(walls[0].hung[0]).toMatch(/^Fern Print: .* 0\.25 m above your desk$/);
    expect(flags.filter((flag) => flag.includes('Fern Print'))).toEqual([]);
  });

  it('flags art hung too high above the furniture under it, and art off its middle', () => {
    expect(review([place('pc_print', 'print-fern', onEastWall(0.76 + 0.7))]).flags)
      .toContain('Fern Print hangs 0.7 m above your desk: hang art 0.15–0.35 m above the furniture under it');
    expect(review([place('pc_print', 'print-fern', onEastWall(0.76 + 0.25, 0.3))]).flags.join('\n'))
      .toMatch(/Fern Print is 0\.3 m (left|right) of the middle of your desk/);
  });

  it('lists what rests on each top, and flags a crowded one', () => {
    const vases = [1, 2, 3, 4].map((n) => place(`pc_vase${n}`, `vase-${n}`, onDesk(-0.4 + n * 0.16)));
    const { tops, flags } = review(vases);

    expect(tops).toEqual([{ furniture: 'your desk', holds: ['Vase 1', 'Vase 2', 'Vase 3', 'Vase 4'] }]);
    expect(flags).toContain('your desk holds 4 things: keep a top to 3 or fewer, grouped, with bare space around them');
  });

  it('flags more than 3 accent colors, and an accent used only once', () => {
    const colorful = { ...reviewCatalog, items: [...reviewCatalog.items, vase(6, ['Red']), vase(7, ['Teal']), vase(8, ['Mustard'])] };
    const { colors, flags } = review([
      place('pc_print', 'print-fern', onEastWall(1.01)),
      place('pc_v6', 'vase-6', onDesk(-0.3)), place('pc_v7', 'vase-7', onDesk(0)), place('pc_v8', 'vase-8', onDesk(0.3)),
    ], colorful);

    expect(colors.accents).toEqual(['green', 'red', 'teal', 'mustard']);
    expect(flags.join('\n')).toContain('The Pieces bring 4 accent colors (green, red, teal, mustard)');
    expect(flags).toContain('red appears only once: repeat it elsewhere (a recolor, a pillow, a print) or swap that Piece for one in the Palette');
  });

  it('sorts the Pieces by whether they suit the styles asked for, and flags a rug with nothing on it', () => {
    const { style, flags } = review([
      place('pc_print', 'print-fern', onEastWall(1.01)),
      place('pc_vase1', 'vase-1', onDesk(0)),
      place('pc_rug', 'rug-oat', onFloor(0.3, 0.8)),
    ]);

    expect(style).toEqual({ asked: ['Japandi'], on_style: ['Fern Print', 'Oat Rug'], off_style: ['Vase 1 (Modern)'], untagged: [] });
    expect(flags.join('\n')).toContain('Oat Rug has no furniture on it');
    expect(flags.join('\n')).toContain('No lamp');
  });

  it('flags art too small for the furniture under it, and a rug too small for the table it anchors', () => {
    const tiny = item('print-tiny', 'wall_art', 'Tiny Print', [0.3, 0.4, 0.02], { mount: 'wall' });
    const table = item('table-oak', 'table', 'Oak Table', [1.5, 0.75, 0.9]);
    const small = { ...reviewCatalog, items: [...reviewCatalog.items, tiny, table] };
    const flags = review([
      place('pc_tiny', 'print-tiny', onEastWall(1.01)),
      place('pc_table', 'table-oak', onFloor(-0.6, 0.6)),
      place('pc_rug', 'rug-oat', { ...onFloor(-0.6, 0.6), rotationY: Math.PI / 2 }),
    ], small).flags.join('\n');

    expect(flags).toContain('Tiny Print is 0.3 m wide over your desk, which is 1.07 m: too small to read');
    expect(flags).toContain('Oat Rug (1.8 × 1.2 m) is too small for Oak Table and its chairs');
  });

  it('adds up the money against the budget', () => {
    expect(review([place('pc_rug', 'rug-oat', onFloor(0.3, 0.8))]).budget).toEqual({ total_usd: 100, budget_usd: 400, left_usd: 300 });
  });
});
