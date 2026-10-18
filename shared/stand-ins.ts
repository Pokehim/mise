// Which Catalog items can stand in for a piece of furniture drawn on a Floor Plan (ADR-0011): the
// plan gives its kind and size, and the Catalog item closest to them is drawn in its place.
import { search, type SearchResult } from './catalog-search';
import type { Catalog, Category, Vec3 } from './types';

/** A piece of furniture as a plan draws it: its kind, a label, and its size [width, height, depth] in meters. */
export interface DrawnPiece {
  label: string;
  category: Category;
  size: Vec3;
}

/** Furniture that can stand in for another kind when the Catalog has none near its size: a small dresser is a chest. */
const RELATED: Partial<Record<Category, Category[]>> = {
  dresser: ['nightstand', 'storage'],
  nightstand: ['dresser', 'storage'],
  wardrobe: ['shelf'],
  desk: ['table'],
};

/** How far off in size the best item of the piece's own kind may be before related kinds are searched too. */
const NEAR_ENOUGH = 0.25;

/**
 * The Catalog items that could stand in for a drawn piece, closest first: of its own kind, by size,
 * and of a related kind when its own is far off; a swivel chair first at a desk; and only low beds,
 * as dorm beds are, which clear a window sill. Placeholder items are never offered.
 */
export function standInCandidates(catalog: Catalog, piece: DrawnPiece, limit = 5): SearchResult[] {
  const real: Catalog = {
    ...catalog,
    items: catalog.items.filter((item) => !item.id.startsWith('placeholder') && (piece.category !== 'bed' || item.size[1] < 0.8)),
  };
  const own = search(real, { category: piece.category, targetSize: piece.size, limit });
  const related = own[0] && own[0].score <= NEAR_ENOUGH ? []
    : (RELATED[piece.category] ?? []).flatMap((category) => search(real, { category, targetSize: piece.size, limit }));
  const ranked = [...own, ...related].sort((a, b) => a.score - b.score);
  if (piece.category === 'chair' && /desk/i.test(piece.label)) {
    const swivels = search(real, { category: 'chair', text: 'swivel', limit });
    const ids = new Set(swivels.map(({ item }) => item.id));
    return [...swivels, ...ranked.filter(({ item }) => !ids.has(item.id))].slice(0, limit);
  }
  return ranked.slice(0, limit);
}

/** The Catalog item closest to a drawn piece (standInCandidates), or undefined when the Catalog has none of its kind. */
export const standInFor = (catalog: Catalog, piece: DrawnPiece) => standInCandidates(catalog, piece, 1)[0]?.item;
