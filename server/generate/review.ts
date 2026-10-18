// The review a designer makes walking through the room before handing a Design over (from #97's
// review_design): what breaks the design principles in the system prompt. finish_design sends Claude
// back once with these flags, so a Design that breaks none costs no extra turn. #97 also flagged art
// more than 35 cm above the furniture under it, an accent used once and Pieces off the styles asked
// for; here galleries hang at 1.45 m, a lone accent is common, and the Catalog's style tags are too
// sparse to judge by (2 of 124 decor items suit Japandi), so those stay principles in the prompt.
import { BY_WALL, isFurniture } from '../../shared/anchors';
import { COLOR_NAMES } from '../../shared/describe';
import { type Item, roomItems } from '../../shared/fit';
import { overlapLength, pointInPolygon, polygonsOverlap, spanFromLeft } from '../../shared/geometry';
import type { Catalog, CatalogItem, Category, RoomSetup, RoomState, Vec2, Wall } from '../../shared/types';
import { m } from './forClaude';
import { isLightOnWall } from './moves';

/** How far off the middle of the furniture under it, in meters, a piece of art may hang and still read as centered; a group, half as far again. */
const CENTERED = 0.08;
/** Art over furniture spans at least this share of its width; about 2/3 is ideal. */
const MIN_ART_SHARE = 0.45;
/** A group of frames spans at most this share of the furniture under it. */
const MAX_ART_SHARE = 1.15;
/** How far past a table a rug under it reaches, so pulled-out chairs stay on it. */
const CHAIR_ROOM = 0.45;
/** The most things that rest on one top before it reads as cluttered. */
export const MAX_ON_TOP = 3;
/** The most accent colors a Design uses, beyond its neutrals and woods. */
export const MAX_ACCENTS = 3;

/** Color names that read as neutrals or wood tones, not accents: the Catalog's earthy names among them. */
const NEUTRAL = new RegExp(`\\b(${[
  'white|off.?white|ivory|cream|beige|natural|linen|jute|oat|oatmeal|sand|stone|grey|gray|charcoal|black|silver|chrome|clear|brown|tan|taupe|khaki',
  'wood|oak|walnut|teak|ash|pine|birch|maple|bamboo|rattan|wicker|cane|espresso|mahogany|cherry|brass|gold|bronze|nickel|metal|multi|multicolor',
  'champagne|stucco|bear|chestnut|mocha|coffee|latte|camel|ecru|bone|pearl|smoke|slate|graphite|pewter|flax|hemp|driftwood|mushroom',
  'greige|putty|dove|fog|honey|caramel|cognac',
].join('|')})\\b`, 'i');
/** The History's color names, lowercased, longest first: "powder blue" before "blue". */
const FAMILIES = COLOR_NAMES.map(([name]) => name.toLowerCase()).toSorted((a, b) => b.length - a.length);
/** A color name's family: the History color name in it, as navy for "Navy Blue" or orange for "Coral/Orange", or the name itself. */
const family = (name: string) => FAMILIES.find((each) => name.includes(each)) ?? name;

interface Piece { id: string; item: CatalogItem }

/** What breaks the design principles in the room as the Design leaves it, in words Claude can act on. */
export function reviewFlags(setup: RoomSetup, catalog: Catalog, state: RoomState): string[] {
  const items = roomItems(setup, catalog, state);
  const catalogItems = new Map(catalog.items.map((item) => [item.id, item]));
  const pieces = Object.entries(state.pieces).flatMap(([id, { catalogId }]): Piece[] => {
    const item = catalogItems.get(catalogId);
    return item ? [{ id, item }] : [];
  });
  const isPiece = new Set(pieces.map(({ id }) => id));
  // Lights and greenery on a wall hang on their own, along its top or over a gallery: they're no art to judge as one.
  const isArt = new Set(pieces.filter(({ item }) => !isLightOnWall(item)).map(({ id }) => id));
  const furniture = items.filter(isFurniture);
  return [
    ...setup.walls.flatMap((wall) => artFlags(wall, items.filter(({ id, placement }) => isArt.has(id) && placement.wallId === wall.id), furniture)),
    ...topFlags(items, furniture, isPiece),
    ...rugFlags(items.filter(({ id, category }) => isPiece.has(id) && category === 'rug'), furniture),
    ...colorFlags(pieces),
    ...restraintFlags(setup, pieces),
  ];
}

/** Art over furniture: centered over it, and in scale with it, alone or as a group. Art over different furniture is judged apart. */
function artFlags(wall: Wall, hung: Item[], furniture: Item[]): string[] {
  const over = new Map<Item, Item[]>();
  for (const art of hung) {
    // What it hangs over: the furniture against the wall under it, below its bottom, that it overlaps most.
    const span = spanFromLeft(wall, art.corners);
    const [under] = furniture
      .filter((each) => each.heights[1] < art.heights[0] + 0.05 && nearWall(each, wall) && overlapLength(spanFromLeft(wall, each.corners), span) > 0)
      .sort((a, b) => overlapLength(spanFromLeft(wall, b.corners), span) - overlapLength(spanFromLeft(wall, a.corners), span));
    if (under) over.set(under, [...(over.get(under) ?? []), art]);
  }
  return [...over].flatMap(([under, group]) => groupFlags(wall, under, group));
}

/** One piece of art, or a group, over one piece of furniture. */
function groupFlags(wall: Wall, under: Item, hung: Item[]): string[] {
  const spans = hung.map((art) => spanFromLeft(wall, art.corners));
  const span: [number, number] = [Math.min(...spans.map(([from]) => from)), Math.max(...spans.map(([, to]) => to))];
  const [from, to] = spanFromLeft(wall, under.corners);
  const [width, underWidth, offset] = [span[1] - span[0], to - from, (span[0] + span[1]) / 2 - (from + to) / 2];
  const side = offset > 0 ? 'right' : 'left';
  const flags: string[] = [];
  if (hung.length === 1) {
    const [{ name }] = hung;
    if (width < underWidth * MIN_ART_SHARE) {
      flags.push(`${name} is ${m(width)} m wide over ${under.name}, which is ${m(underWidth)} m: too small to read. `
        + 'Use one piece about 2/3 its width, or a group of frames that spans that much');
    }
    if (Math.abs(offset) > CENTERED) flags.push(`${name} is ${m(Math.abs(offset))} m ${side} of the middle of ${under.name}: center it, or make it part of a group that is`);
    return flags;
  }
  if (Math.abs(offset) > CENTERED * 1.5) {
    flags.push(`The group of ${hung.length} wall pieces over ${under.name} on the ${wall.name} sits ${m(Math.abs(offset))} m ${side} of its middle: center the group over it`);
  }
  if (width < underWidth * MIN_ART_SHARE) {
    flags.push(`The wall pieces on the ${wall.name} span ${m(width)} m over ${under.name}, which is ${m(underWidth)} m: too small together. `
      + 'Use larger pieces, or one piece about 2/3 its width');
  }
  if (width > underWidth * MAX_ART_SHARE) {
    flags.push(`The wall pieces on the ${wall.name} span ${m(width)} m, wider than ${under.name} (${m(underWidth)} m): `
      + "keep a group within about 2/3 to the full width of what's under it");
  }
  return flags;
}

/** A top holding more than a few things reads as cluttered: flagged when the Design put some of them there, so it can take them off. */
function topFlags(items: Item[], furniture: Item[], isPiece: Set<string>): string[] {
  const holds = new Map<Item, Item[]>();
  for (const thing of items.filter(({ placement }) => placement.mount === 'surface')) {
    const [x, , z] = thing.placement.position;
    const [host] = furniture
      .filter((each) => pointInPolygon([x, z], each.corners) && Math.abs(each.heights[1] - thing.heights[0]) < 0.6)
      .sort((a, b) => Math.abs(a.heights[1] - thing.heights[0]) - Math.abs(b.heights[1] - thing.heights[0]));
    if (host) holds.set(host, [...(holds.get(host) ?? []), thing]);
  }
  return [...holds].filter(([, things]) => things.length > MAX_ON_TOP && things.some(({ id }) => isPiece.has(id)))
    .map(([host, things]) => `${host.name} holds ${things.length} things: keep a top to ${MAX_ON_TOP} or fewer, grouped, with bare space around them`);
}

/** A rug anchors a group: furniture stands on it, and under a table, the chairs pulled out too. */
function rugFlags(rugs: Item[], furniture: Item[]): string[] {
  return rugs.flatMap((rug) => {
    const on = furniture.filter((each) => polygonsOverlap(each.corners, rug.corners));
    if (!on.length) return [`${rug.name} has no furniture on it, so it floats: a rug anchors a group. Lay it under a bed, sofa or table, or remove it`];
    return on.filter(isDiningTable).flatMap((table) => {
      const [rugLong, rugShort] = [...rug.rect.size].sort((a, b) => b - a);
      const [tableLong, tableShort] = [...table.rect.size].sort((a, b) => b - a);
      if (rugLong >= tableLong + 2 * CHAIR_ROOM && rugShort >= tableShort + 2 * CHAIR_ROOM) return [];
      return [`${rug.name} (${m(rugLong)} × ${m(rugShort)} m) is too small for ${table.name} and its chairs: it should reach about `
        + `${CHAIR_ROOM} m past the table on every side, about ${m(tableLong + 2 * CHAIR_ROOM)} × ${m(tableShort + 2 * CHAIR_ROOM)} m. Choose a larger rug`];
    });
  });
}

/**
 * A few accent colors, beyond the neutrals and woods, make one Palette: counted by each furnishing's main color.
 * Art holds a painting's many colors and plants are green, so neither counts.
 */
function colorFlags(pieces: Piece[]): string[] {
  const names = pieces
    .filter(({ item: { category } }) => category !== 'wall_art' && category !== 'plant')
    .map(({ item }) => item.colors[0]?.trim().toLowerCase() ?? '')
    .filter(Boolean);
  const accents = [...new Set(names.filter((name) => !NEUTRAL.test(name)).map(family).filter((name) => !NEUTRAL.test(name)))];
  if (accents.length <= MAX_ACCENTS) return [];
  return [`The Pieces bring ${accents.length} accent colors (${accents.join(', ')}): use ${MAX_ACCENTS} or fewer, each repeated at least twice, so the room reads as one Palette`];
}

/** A small room needs fewer, better things. */
function restraintFlags(setup: RoomSetup, pieces: Piece[]): string[] {
  const area = polygonArea(setup.floor.polygon);
  const small = pieces.filter(({ item }) => (['decor', 'plant'] as Category[]).includes(item.category)).length;
  return small > Math.max(4, area / 3) ? [`${small} pieces of decor and plants in ${m(area)} m² is a lot: keep the best few, in groups of 1 or 3`] : [];
}

/** A table people sit around on chairs, unlike a side or coffee table: long enough and table-high. */
const isDiningTable = ({ category, rect: { size }, heights: [, top] }: Item) => category === 'table' && Math.max(...size) >= 1 && top >= 0.65;

/** Whether furniture stands against a wall, close enough for art on it to read as over it. */
const nearWall = (furniture: Item, { start, normal }: Wall) =>
  Math.min(...furniture.corners.map(([x, z]) => (x - start[0]) * normal[0] + (z - start[1]) * normal[1])) <= BY_WALL;

/** The area of a polygon, by the shoelace formula. */
function polygonArea(polygon: Vec2[]): number {
  return Math.abs(polygon.reduce((sum, [x0, z0], i) => {
    const [x1, z1] = polygon[(i + 1) % polygon.length];
    return sum + x0 * z1 - x1 * z0;
  }, 0)) / 2;
}
