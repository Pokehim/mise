// review_design (the eighth tool): the room as a designer would walk through it before handing a Design
// over. What hangs on each wall and what it's over, what rests on each top, what's on the floor, the
// colors and styles used, and the money, with flags for what breaks the design principles in the
// system prompt. Claude reads it, fixes what it flags, and only then calls finish_design.
import { BY_WALL, CENTER_HEIGHT } from '../../shared/anchors';
import { type Item, roomItems } from '../../shared/fit';
import { overlapLength, pointInPolygon, polygonsOverlap, spanFromLeft } from '../../shared/geometry';
import type { Brief, Catalog, CatalogItem, Category, RoomSetup, RoomState } from '../../shared/types';
import { m } from './forClaude';

/** Art hung over furniture: its bottom this far above the furniture's top, in meters. */
export const OVER_FURNITURE: [min: number, max: number] = [0.15, 0.35];
/** Art hung on its own: its center this high, in meters. */
export const EYE_LEVEL: [min: number, max: number] = [1.35, 1.6];
/** How far off the middle of the furniture below art may hang and still read as centered. */
const CENTERED = 0.08;
/** Art over furniture is at least this share of its width; about 2/3 is ideal. */
export const MIN_ART_SHARE = 0.45;
/** How far past a table a rug under it reaches, so pulled-out chairs stay on it. */
const CHAIR_ROOM = 0.45;
/** The most things that rest on one top before it reads as cluttered. */
export const MAX_ON_TOP = 3;
/** The most accent colors a Design uses, beyond its neutrals and woods. */
export const MAX_ACCENTS = 3;

/** Color names that read as neutrals or wood tones, not accents. */
const NEUTRAL = /white|ivory|cream|beige|off.?white|natural|linen|jute|oat|sand|stone|grey|gray|charcoal|black|silver|chrome|clear|brown|tan|taupe|khaki|wood|oak|walnut|teak|ash|pine|birch|maple|bamboo|rattan|wicker|cane|espresso|mahogany|cherry|brass|gold|bronze|nickel|metal|multi/i;

/** Catalog style tags that suit each style chip of the Brief dialog. */
const STYLE_FAMILIES: Record<string, RegExp> = {
  japandi: /japandi|japanese|scandinavian|nordic|minimal|zen|natural|wabi/i,
  minimal: /minimal|modern|contemporary|scandinavian|simple|clean/i,
  'mid-century': /mid.?century|retro|modern|vintage|danish/i,
  cozy: /cozy|farmhouse|rustic|traditional|cottage|bohemian|boho|shabby|country/i,
  industrial: /industrial|loft|urban|rustic|metal|vintage/i,
  boho: /boho|bohemian|eclectic|global|moroccan|rattan|natural/i,
};

export interface DesignReview {
  walls: { wall: string; hung: string[] }[];
  tops: { furniture: string; holds: string[] }[];
  floor: string[];
  colors: { neutrals: string[]; accents: string[]; paint: string[] };
  style?: { asked: string[]; on_style: string[]; off_style: string[]; untagged: string[] };
  budget: { total_usd: number; budget_usd?: number; left_usd?: number };
  /** What breaks the design principles: fix each, or keep it on purpose. */
  flags: string[];
}

/** Walks through the room as the Design leaves it; the Pieces in `state` are what the Design added. */
export function reviewDesign(setup: RoomSetup, catalog: Catalog, state: RoomState, brief: Brief): DesignReview {
  const items = roomItems(setup, catalog, state);
  const catalogItem = (id: string) => catalog.items.find((item) => item.id === id);
  const pieces = Object.entries(state.pieces).map(([id, piece]) => ({ id, item: catalogItem(piece.catalogId)! }));
  const pieceItem = (id: string) => pieces.find((piece) => piece.id === id)?.item;
  const flags: string[] = [];
  const floorStanding = items.filter(({ placement, category }) => placement.mount === 'floor' && category !== 'rug');

  // Walls: each hung item, what it's over, and whether it hangs where art should.
  const walls = setup.walls.map((wall) => {
    const hung = items.filter(({ placement }) => placement.mount === 'wall' && placement.wallId === wall.id);
    return {
      wall: `${wall.name} (${wall.id})`,
      hung: hung.map((art) => {
        const span = spanFromLeft(wall, art.corners);
        const middle = (span[0] + span[1]) / 2;
        const center = (art.heights[0] + art.heights[1]) / 2;
        const below = floorStanding
          .filter((furniture) => furniture.heights[1] < art.heights[0] + 0.05)
          .map((furniture) => ({ furniture, overlap: overlapLength(spanFromLeft(wall, furniture.corners), span), span: spanFromLeft(wall, furniture.corners) }))
          .filter(({ furniture, overlap }) => overlap > 0 && nearWall(furniture, wall))
          .sort((a, b) => b.overlap - a.overlap)[0];
        let where = `${m(span[0])}–${m(span[1])} m from the left, center ${m(center)} m up`;
        if (below) {
          const gap = art.heights[0] - below.furniture.heights[1];
          const offset = middle - (below.span[0] + below.span[1]) / 2;
          where += `, ${m(gap)} m above ${below.furniture.name}`;
          if (gap < OVER_FURNITURE[0] || gap > OVER_FURNITURE[1]) {
            flags.push(`${art.name} hangs ${m(gap)} m above ${below.furniture.name}: hang art ${OVER_FURNITURE[0]}–${OVER_FURNITURE[1]} m above the furniture under it`);
          }
          const alone = hung.filter((other) => other !== art).length === 0;
          const furnitureWidth = below.span[1] - below.span[0];
          if (alone && span[1] - span[0] < furnitureWidth * MIN_ART_SHARE) {
            flags.push(`${art.name} is ${m(span[1] - span[0])} m wide over ${below.furniture.name}, which is ${m(furnitureWidth)} m: too small to read. `
              + `Use one piece about 2/3 its width, or a group of frames that spans that much`);
          }
          if (Math.abs(offset) > CENTERED && alone) {
            flags.push(`${art.name} is ${m(Math.abs(offset))} m ${offset > 0 ? 'right' : 'left'} of the middle of ${below.furniture.name}: center it, or make it part of a group that is`);
          }
        } else if (center < EYE_LEVEL[0] || center > EYE_LEVEL[1]) {
          flags.push(`${art.name} has its center ${m(center)} m up: on a bare wall, hang art with its center ${EYE_LEVEL[0]}–${EYE_LEVEL[1]} m up (${CENTER_HEIGHT} m is standard)`);
        }
        return `${art.name}: ${where}`;
      }),
    };
  });
  // A gallery of frames should read as one group, centered as a whole over what's below it.
  for (const wall of setup.walls) {
    const hung = items.filter(({ placement, id }) => placement.mount === 'wall' && placement.wallId === wall.id && pieceItem(id));
    if (hung.length < 2) continue;
    const spans = hung.map((art) => spanFromLeft(wall, art.corners));
    const group: [number, number] = [Math.min(...spans.map(([from]) => from)), Math.max(...spans.map(([, to]) => to))];
    const below = floorStanding.filter((furniture) => nearWall(furniture, wall) && overlapLength(spanFromLeft(wall, furniture.corners), group) > 0);
    const main = below.sort((a, b) => overlapLength(spanFromLeft(wall, b.corners), group) - overlapLength(spanFromLeft(wall, a.corners), group))[0];
    if (main) {
      const furnitureSpan = spanFromLeft(wall, main.corners);
      const offset = (group[0] + group[1]) / 2 - (furnitureSpan[0] + furnitureSpan[1]) / 2;
      if (Math.abs(offset) > CENTERED * 1.5) {
        flags.push(`The group of ${hung.length} wall pieces on the ${wall.name} sits ${m(Math.abs(offset))} m ${offset > 0 ? 'right' : 'left'} of the middle of ${main.name}: center the group over it`);
      }
      if (group[1] - group[0] < (furnitureSpan[1] - furnitureSpan[0]) * MIN_ART_SHARE) {
        flags.push(`The wall pieces on the ${wall.name} span ${m(group[1] - group[0])} m over ${main.name}, which is ${m(furnitureSpan[1] - furnitureSpan[0])} m: `
          + 'too small together. Use larger pieces, or one piece about 2/3 its width');
      }
      if (group[1] - group[0] > (furnitureSpan[1] - furnitureSpan[0]) * 1.15) {
        flags.push(`The wall pieces on the ${wall.name} span ${m(group[1] - group[0])} m, wider than ${main.name} (${m(furnitureSpan[1] - furnitureSpan[0])} m): keep a group within about 2/3 to the full width of what's under it`);
      }
    }
  }

  // Tops: what rests on each piece of furniture, and whether it's crowded.
  const resting = items.filter(({ placement }) => placement.mount === 'surface');
  const hosts = new Map<Item, Item[]>();
  for (const thing of resting) {
    const [x, , z] = thing.placement.position;
    const host = floorStanding
      .filter((furniture) => pointInPolygon([x, z], furniture.corners) && Math.abs(furniture.heights[1] - thing.heights[0]) < 0.6)
      .sort((a, b) => Math.abs(a.heights[1] - thing.heights[0]) - Math.abs(b.heights[1] - thing.heights[0]))[0];
    if (host) hosts.set(host, [...(hosts.get(host) ?? []), thing]);
  }
  const tops = [...hosts].map(([furniture, things]) => {
    if (things.length > MAX_ON_TOP) {
      flags.push(`${furniture.name} holds ${things.length} things: keep a top to ${MAX_ON_TOP} or fewer, grouped, with bare space around them`);
    }
    return { furniture: furniture.name, holds: things.map(({ name }) => name) };
  });

  // Floor: rugs and what stands on them, lamps and what they're by.
  const FLOOR_PIECES: Category[] = ['rug', 'lamp', 'plant', 'chair', 'table', 'shelf', 'storage', 'sofa'];
  const floor = items.filter(({ id, category, placement }) => pieceItem(id) && placement.mount === 'floor' && FLOOR_PIECES.includes(category))
    .map((thing) => {
      if (thing.category === 'rug') {
        const on = floorStanding.filter((furniture) => polygonsOverlap(furniture.corners, thing.corners)).map(({ name }) => name);
        if (!on.length) {
          flags.push(`${thing.name} has no furniture on it, so it floats: a rug anchors a group. Place it with centered_under a table, sofa or bed `
            + '(under a table it is centered, with the chairs on it), or remove it');
        }
        for (const table of floorStanding.filter((furniture) => furniture.category === 'table' && polygonsOverlap(furniture.corners, thing.corners))) {
          const [rugLong, rugShort] = [...thing.rect.size].sort((a, b) => b - a);
          const [tableLong, tableShort] = [...table.rect.size].sort((a, b) => b - a);
          if (rugLong < tableLong + 2 * CHAIR_ROOM || rugShort < tableShort + 2 * CHAIR_ROOM) {
            flags.push(`${thing.name} (${m(rugLong)} × ${m(rugShort)} m) is too small for ${table.name} and its chairs: it should reach about `
              + `${CHAIR_ROOM} m past the table on every side, about ${m(tableLong + 2 * CHAIR_ROOM)} × ${m(tableShort + 2 * CHAIR_ROOM)} m. Choose a larger rug`);
          }
        }
        return `${thing.name}: under ${on.length ? on.join(', ') : 'nothing'}`;
      }
      const near = floorStanding.filter((other) => other !== thing && polygonsOverlap(grow(other.corners, 0.5), thing.corners)).map(({ name }) => name);
      return `${thing.name}: by ${near.length ? near.join(', ') : 'nothing'}`;
    });
  if (!pieces.some(({ item }) => item.category === 'lamp')) flags.push('No lamp: add one where people sit or read, away from the windows');

  // Colors: the Pieces' colors, split into neutrals and accents, and the paint.
  const colorNames = [...new Set(pieces.flatMap(({ item }) => item.colors.map((name) => name.trim().toLowerCase())).filter(Boolean))];
  const accents = colorNames.filter((name) => !NEUTRAL.test(name));
  const paint = [
    ...Object.entries(state.surfaces.walls).map(([wallId, finish]) => `${setup.walls.find(({ id }) => id === wallId)?.name ?? wallId}: ${describeFinish(finish)}`),
    ...(state.surfaces.floor ? [`Floor: ${describeFinish(state.surfaces.floor)}`] : []),
  ];
  if (accents.length > MAX_ACCENTS) {
    flags.push(`The Pieces bring ${accents.length} accent colors (${accents.join(', ')}): use ${MAX_ACCENTS} or fewer, each repeated at least twice, so the room reads as one Palette`);
  }
  for (const accent of accents) {
    if (pieces.filter(({ item }) => item.colors.some((name) => name.trim().toLowerCase() === accent)).length === 1 && accents.length > 1) {
      flags.push(`${accent} appears only once: repeat it elsewhere (a recolor, a pillow, a print) or swap that Piece for one in the Palette`);
    }
  }

  // Style: how many Pieces carry a tag that suits the styles asked for.
  let style: DesignReview['style'];
  const asked = (brief.styles ?? []).map((name) => name.toLowerCase());
  if (asked.length) {
    const suits = (item: CatalogItem) => item.styleTags.some((tag) => asked.some((name) => (STYLE_FAMILIES[name] ?? new RegExp(name, 'i')).test(tag)));
    const tagged = pieces.filter(({ item }) => item.styleTags.length);
    style = {
      asked: brief.styles!,
      on_style: tagged.filter(({ item }) => suits(item)).map(({ item }) => item.title),
      off_style: tagged.filter(({ item }) => !suits(item)).map(({ item }) => `${item.title} (${item.styleTags.join(', ')})`),
      untagged: pieces.filter(({ item }) => !item.styleTags.length).map(({ item }) => item.title),
    };
    if (style.off_style.length > Math.max(1, tagged.length / 3)) {
      flags.push(`${style.off_style.length} of the ${tagged.length} style-tagged Pieces don't suit ${brief.styles!.join(' or ')}: swap the worst of them for ones that do`);
    }
  }

  // Restraint: a Design that adds a lot to a small room reads as cluttered.
  const area = polygonArea(setup.floor.polygon);
  const smallThings = pieces.filter(({ item }) => (['decor', 'plant'] as Category[]).includes(item.category)).length;
  if (smallThings > Math.max(4, area / 3)) {
    flags.push(`${smallThings} pieces of decor and plants in ${m(area)} m² is a lot: keep the best few, in groups of 1 or 3`);
  }

  const total = pieces.reduce((sum, { item }) => sum + item.priceEstimateUsd, 0);
  return {
    walls: walls.filter(({ hung }) => hung.length),
    tops,
    floor,
    colors: { neutrals: colorNames.filter((name) => NEUTRAL.test(name)), accents, paint },
    ...(style && { style }),
    budget: { total_usd: total, ...(brief.budgetUsd !== undefined && { budget_usd: brief.budgetUsd, left_usd: brief.budgetUsd - total }) },
    flags,
  };
}

/** Whether furniture stands against a wall, close enough for art on it to read as over it. */
const nearWall = (furniture: Item, wall: RoomSetup['walls'][number]) =>
  Math.min(...furniture.corners.map(([x, z]) => (x - wall.start[0]) * wall.normal[0] + (z - wall.start[1]) * wall.normal[1])) <= BY_WALL;

/** A polygon's corners pushed out from its center by `by` meters, roughly. */
function grow(corners: Item['corners'], by: number): Item['corners'] {
  const cx = corners.reduce((sum, [x]) => sum + x, 0) / corners.length;
  const cz = corners.reduce((sum, [, z]) => sum + z, 0) / corners.length;
  return corners.map(([x, z]) => {
    const length = Math.hypot(x - cx, z - cz) || 1;
    return [x + ((x - cx) / length) * by, z + ((z - cz) / length) * by];
  });
}

function polygonArea(polygon: RoomSetup['floor']['polygon']): number {
  let sum = 0;
  for (let i = 0; i < polygon.length; i++) {
    const [x0, z0] = polygon[i];
    const [x1, z1] = polygon[(i + 1) % polygon.length];
    sum += x0 * z1 - x1 * z0;
  }
  return Math.abs(sum) / 2;
}

function describeFinish(finish: RoomState['surfaces']['walls'][string]): string {
  switch (finish.kind) {
    case 'paint': return `painted ${finish.color}`;
    case 'material': return `${finish.materialId}${finish.tint ? ` tinted ${finish.tint}` : ''}`;
    default: return 'as scanned';
  }
}
