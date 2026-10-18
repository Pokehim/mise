// The Catalog as Claude reads it before it designs: a shortlist of what decorating draws on, and a few
// of each kind of furniture to furnish an empty room with in the same reply. It's the same for every
// Brief so that it caches, and the same size however large the Catalog grows; search_catalog finds the rest.
import type { Catalog, CatalogItem, Category } from '../../shared/types';
import { m, offeredToClaude } from './forClaude';
import { isFloorLamp } from './moves';

/** Chairs for sitting at a desk or a counter, not in a reading corner. */
const WORK_CHAIR = /\b(office|desk chair|task|counter|stool|kitchen|dining|gaming)\b/i;
/** Chairs for sitting at a desk. */
const DESK_CHAIR = /\b(office|desk chair|task|gaming)\b/i;
/** A table this wide is a desk or a dining table, not a side table. */
const SIDE_TABLE_WIDTH = 0.7;
/** The longest title shown, in characters. */
const TITLE_LENGTH = 50;

const of = (category: Category) => (item: CatalogItem) => item.category === category;
/** The shortlist's sections: how many items each shows, and which items belong in it. */
const SECTIONS: { name: string; count: number; includes: (item: CatalogItem) => boolean }[] = [
  { name: 'wall_art', count: 12, includes: of('wall_art') },
  { name: 'mirror', count: 4, includes: of('mirror') },
  { name: 'rug', count: 10, includes: of('rug') },
  { name: 'lamp', count: 10, includes: of('lamp') },
  { name: 'plant', count: 8, includes: of('plant') },
  { name: 'decor', count: 12, includes: of('decor') },
  { name: 'chair', count: 8, includes: (item) => item.category === 'chair' && !WORK_CHAIR.test(item.title) },
  { name: 'desk_chair', count: 3, includes: (item) => item.category === 'chair' && DESK_CHAIR.test(item.title) },
  { name: 'table', count: 6, includes: (item) => item.category === 'table' && item.size[0] <= SIDE_TABLE_WIDTH },
  { name: 'nightstand', count: 4, includes: of('nightstand') },
  { name: 'bed', count: 5, includes: of('bed') },
  { name: 'desk', count: 4, includes: of('desk') },
  { name: 'dresser', count: 3, includes: of('dresser') },
  { name: 'wardrobe', count: 3, includes: of('wardrobe') },
  { name: 'shelf', count: 4, includes: of('shelf') },
  { name: 'sofa', count: 3, includes: of('sofa') },
];

/** How many items each section of the shortlist shows. */
export const SHORTLIST: Record<string, number> = Object.fromEntries(SECTIONS.map(({ name, count }) => [name, count]));

/** The shortlist, as lines grouped by section: id, title, size, first color and estimated price. */
export function catalogList(catalog: Catalog): string {
  const offered = catalog.items.filter(offeredToClaude);
  const sections = SECTIONS.flatMap(({ name, count, includes }) => {
    const items = spread(offered.filter(includes), count);
    return items.length ? [[`${name}:`, ...items.map(line)].join('\n')] : [];
  });
  return [
    'Catalog shortlist, by category (size is width×height×depth; prices are estimates). search_catalog finds the rest.',
    ...sections,
  ].join('\n\n');
}

/**
 * Up to `count` items spread over their colors: the cheapest of each color first, then the next
 * cheapest of each, so that no color repeats while another is missing.
 */
function spread(items: CatalogItem[], count: number): CatalogItem[] {
  const byColor = new Map<string, CatalogItem[]>();
  for (const item of items.toSorted((a, b) => a.priceEstimateUsd - b.priceEstimateUsd || a.id.localeCompare(b.id))) {
    const color = item.colors[0]?.toLowerCase() ?? '';
    byColor.set(color, [...(byColor.get(color) ?? []), item]);
  }
  const picked: CatalogItem[] = [];
  for (let round = 0; picked.length < count && [...byColor.values()].some((group) => group.length > round); round++) {
    for (const group of byColor.values()) if (group[round] && picked.length < count) picked.push(group[round]);
  }
  return picked;
}

/** One item as a shortlist line. */
function line(item: CatalogItem): string {
  const { id, title, category, size, colors, priceEstimateUsd } = item;
  const kind = category === 'lamp' ? (isFloorLamp(item) ? ' (floor lamp)' : ' (table lamp)') : '';
  return `- ${id} | ${shorten(title)}${kind} | ${size.map(m).join('×')} m | ${colors[0] ?? '—'} | $${priceEstimateUsd}`;
}

/** A title cut to TITLE_LENGTH at a word, or before a comma, whichever is shorter. */
function shorten(title: string): string {
  const [first] = title.split(',');
  if (first.length <= TITLE_LENGTH) return first;
  return `${first.slice(0, TITLE_LENGTH).replace(/\s+\S*$/, '')}…`;
}
