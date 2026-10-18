// The Catalog as Claude reads it before it designs: a shortlist of what decorating draws on, the same
// for every Brief so that it caches, and the same size however large the Catalog grows. search_catalog
// finds the rest.
import type { Catalog, CatalogItem, Category } from '../../shared/types';
import { m } from './forClaude';

/** How many items of each category the shortlist shows. */
export const SHORTLIST: Partial<Record<Category, number>> = {
  wall_art: 12, mirror: 4, rug: 10, lamp: 10, plant: 8, decor: 12, chair: 8, table: 6, nightstand: 4,
};

/** A lamp this tall, in meters, stands on the floor; a shorter one goes on a table. */
export const FLOOR_LAMP = 1;
/** Chairs for sitting at a desk or a counter, not in a reading corner. */
const WORK_CHAIR = /\b(office|desk chair|task|counter|stool|kitchen|dining|gaming)\b/i;
/** A table this wide is a desk or a dining table, not a side table. */
const SIDE_TABLE_WIDTH = 0.7;
/** The longest title shown, in characters. */
const TITLE_LENGTH = 50;

/** Whether an item belongs on the shortlist of its category. */
function fits({ category, title, size: [width] }: CatalogItem) {
  if (category === 'chair') return !WORK_CHAIR.test(title);
  if (category === 'table') return width <= SIDE_TABLE_WIDTH;
  return true;
}

/** The shortlist, as lines grouped by category: id, title, size, first color and estimated price. */
export function catalogList(catalog: Catalog): string {
  const sections = (Object.entries(SHORTLIST) as [Category, number][]).flatMap(([category, count]) => {
    const items = spread(catalog.items.filter((item) => item.category === category && fits(item)), count);
    return items.length ? [[`${category}:`, ...items.map(line)].join('\n')] : [];
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
function line({ id, title, category, size, colors, priceEstimateUsd }: CatalogItem): string {
  const kind = category === 'lamp' ? (size[1] >= FLOOR_LAMP ? ' (floor lamp)' : ' (table lamp)') : '';
  return `- ${id} | ${shorten(title)}${kind} | ${size.map(m).join('×')} m | ${colors[0] ?? '—'} | $${priceEstimateUsd}`;
}

/** A title cut to TITLE_LENGTH at a word, or before a comma, whichever is shorter. */
function shorten(title: string): string {
  const [first] = title.split(',');
  if (first.length <= TITLE_LENGTH) return first;
  return `${first.slice(0, TITLE_LENGTH).replace(/\s+\S*$/, '')}…`;
}
