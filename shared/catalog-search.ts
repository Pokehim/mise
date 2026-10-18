import type { Catalog, CatalogItem, Category, Vec3 } from './types';

/** What to look for in the Catalog (spec §8.2). Every field is optional. */
export interface SearchQuery {
  category?: Category;
  /** Every word must appear in the title or a style tag, ignoring case. */
  text?: string;
  /** A color name, matched by whole words ("gray" finds "Light Gray"), or a hex code. */
  color?: string;
  /** Only items that fit within this width and depth; its height is ignored. */
  maxSize?: Vec3;
  /** Rank by how close each item's size is to this one, as Swap and Resize do; Resize asks for `limit: 3`. */
  targetSize?: Vec3;
  /** Count the height in the size closeness too (Resize's 🔒). */
  lockHeight?: boolean;
  /** The most results to return; 12 by default. */
  limit?: number;
}

export interface SearchResult {
  item: CatalogItem;
  /**
   * How far the item's size is from targetSize: its largest relative miss in width or depth, and in
   * height with lockHeight. 0 with no targetSize.
   */
  score: number;
  /** 'fits' within 15% of targetSize, shown as "Fits"; otherwise 'closest', shown as "Closest available". */
  label: 'fits' | 'closest';
}

/** An item within this score of the target size fits it (spec §8.2). */
const FITS = 0.15;

/** Catalog items that match the query, closest in size first when there is a targetSize (spec §8.2). */
export function search(catalog: Catalog, query: SearchQuery): SearchResult[] {
  const { targetSize, limit = 12 } = query;
  const words = query.text?.toLowerCase().split(/\s+/).filter(Boolean) ?? [];
  const color = query.color?.toLowerCase();
  const matches = (item: CatalogItem) => {
    const haystack = [item.title, ...item.styleTags].join(' ').toLowerCase();
    return (!query.category || item.category === query.category)
      && words.every((word) => haystack.includes(word))
      && (!color || item.colorHex?.toLowerCase() === color
        || item.colors.some((name) => ` ${name.toLowerCase()} `.includes(` ${color} `)))
      && (!query.maxSize || (item.size[0] <= query.maxSize[0] && item.size[2] <= query.maxSize[2]));
  };
  const miss = (size: Vec3, axis: number) => (targetSize ? Math.abs(size[axis] - targetSize[axis]) / targetSize[axis] : 0);
  const score = (size: Vec3) => Math.max(miss(size, 0), miss(size, 2), query.lockHeight ? miss(size, 1) : 0);

  return catalog.items
    .filter(matches)
    .map((item): SearchResult => {
      const itemScore = score(item.size);
      return { item, score: itemScore, label: itemScore <= FITS ? 'fits' : 'closest' };
    })
    .sort((a, b) => a.score - b.score)
    .slice(0, limit);
}
