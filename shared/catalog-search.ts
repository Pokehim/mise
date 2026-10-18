import type { Catalog, CatalogItem, Category, Vec3 } from './types';

/** What to look for in the Catalog (spec §8.2). Every field is optional. */
export interface SearchQuery {
  category?: Category;
  /**
   * Every word must appear in the title or a style tag, ignoring case. The best matches come first: those where each
   * word starts a word ("LED" in "LED Strip Lights", not in "Filled"), then those with the words earliest in the title.
   */
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

/** Whether `word` starts a word of `text`: "led" starts one in "led strip", not in "filled". */
const startsWord = (text: string, word: string) => new RegExp(`(^|[^a-z0-9])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(text);

/**
 * Catalog items that match the query, closest in size first when there is a targetSize (spec §8.2), and the best
 * text matches first among those as close. Items that match as well keep their Catalog order.
 */
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

  // How well an item matches the text: 0 when each word starts a word, else 1; then how far into the title the words are.
  const relevance = (item: CatalogItem): [number, number] => {
    const [title, haystack] = [item.title.toLowerCase(), [item.title, ...item.styleTags].join(' ').toLowerCase()];
    const inside = words.every((word) => startsWord(haystack, word)) ? 0 : 1;
    const at = words.reduce((sum, word) => sum + (title.includes(word) ? title.indexOf(word) : title.length), 0);
    return [inside, at];
  };

  return catalog.items
    .filter(matches)
    .map((item) => {
      const itemScore = score(item.size);
      return { result: { item, score: itemScore, label: itemScore <= FITS ? 'fits' : 'closest' } satisfies SearchResult, rank: relevance(item) };
    })
    .sort((a, b) => a.result.score - b.result.score || a.rank[0] - b.rank[0] || a.rank[1] - b.rank[1])
    .slice(0, limit)
    .map(({ result }) => result);
}
