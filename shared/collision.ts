// shared/collision.ts — an item's collision boxes (#129): the solid parts of a Catalog item or an Original, so the
// Fit rules can leave its open spaces open, such as the knee space under a desk. scripts/collision.ts fits them.
import type { CatalogItem, CollisionBox, Original, Vec3 } from './types';

/** The box an item of this size fills, from its bottom-center pivot: what an item with no collision boxes is. */
export const sizeBox = ([w, h, d]: Vec3): CollisionBox => ({ min: [-w / 2, 0, -d / 2], max: [w / 2, h, d / 2] });

/** An item's collision boxes, in its own frame: its fitted boxes, or else one solid box of its size. */
export function collisionBoxes(item: Pick<CatalogItem, 'size' | 'collision'> | Pick<Original, 'box' | 'collision'>): CollisionBox[] {
  if (item.collision?.length) return item.collision;
  return [sizeBox('box' in item ? item.box.size : item.size)];
}
