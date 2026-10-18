// How the tools and the first message write things for Claude to read.
import { roomItems } from '../../shared/fit';
import type { Catalog, CatalogItem, RoomSetup, RoomState } from '../../shared/types';

/** Meters rounded to the centimeter. */
export const m = (meters: number) => Math.round(meters * 100) / 100;

/** Whether Claude may choose the item: the Catalog's placeholder boxes, stand-ins for real products, are never shown to it (from #97). */
export const offeredToClaude = ({ id }: CatalogItem) => !id.startsWith('placeholder-');

/** A Catalog item as Claude reads it: size_m is [width, height, depth], and prices are estimates. */
export const catalogEntry = ({ id, title, category, size, colors, styleTags, priceEstimateUsd }: CatalogItem) =>
  ({ id, title, category, size_m: size.map(m), colors, styles: styleTags, price_usd: priceEstimateUsd });

/**
 * What a Design has put in the room, as Claude reads it before it builds on the Design (a Refine, or
 * Generate from the current Design): its Pieces by id, its Finishes, and the Originals it changed.
 */
export function designInWords(setup: RoomSetup, catalog: Catalog, state: RoomState) {
  const walls = new Map(setup.walls.map((wall) => [wall.id, wall.name]));
  const items = new Map(catalog.items.map((item) => [item.id, item]));
  const standing = new Map(roomItems(setup, catalog, state).map((item) => [item.id, item]));
  const pieces = Object.entries(state.pieces).flatMap(([id, { catalogId, placement, partColors, replacesOriginalId }]) => {
    const item = items.get(catalogId);
    if (!item) return [];
    const { id: catalog_id, ...entry } = catalogEntry(item);
    return [{
      id, catalog_id, ...entry,
      mount: placement.mount,
      ...(placement.wallId && { wall: walls.get(placement.wallId) }),
      position_m: placement.position.map(m),
      ...(replacesOriginalId && { replaces: replacesOriginalId }),
      ...(Object.keys(partColors).length && { part_colors: partColors }),
    }];
  });
  const originals = Object.entries(state.originals).flatMap(([id, { visible, moved, partColors, partFinishes }]) => {
    const changes = [
      !visible && (Object.values(state.pieces).some(({ replacesOriginalId }) => replacesOriginalId === id) ? 'replaced' : 'removed'),
      moved && standing.has(id) && 'moved',
      Object.keys(partColors).length && `recolored ${JSON.stringify(partColors)}`,
      Object.keys(partFinishes).length && `finished ${JSON.stringify(partFinishes)}`,
    ].filter(Boolean);
    return changes.length ? [{ id, changes }] : [];
  });
  const finishes = [
    ...Object.entries(state.surfaces.walls).map(([id, finish]) => ({ target: walls.get(id) ?? id, wall_id: id, finish })),
    ...(state.surfaces.floor ? [{ target: 'floor', finish: state.surfaces.floor }] : []),
  ];
  return { pieces, finishes, originals };
}

/** The items in a random order (Fisher–Yates). */
export function shuffled<T>(items: T[], random = Math.random): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
