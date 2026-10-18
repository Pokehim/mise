import type { Catalog, Category, Vec3 } from '../../shared/types';

const median = (values: number[]) => {
  const sorted = values.toSorted((a, b) => a - b);
  const middle = sorted.length / 2;
  return Number.isInteger(middle) ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[Math.floor(middle)];
};

/**
 * The box a generated item is scaled into when the Mover gave no size: the category's typical size, the median of its
 * Catalog items on each axis, or a 50 cm cube when it has none.
 */
export function targetBox(catalog: Catalog, category: Category): Vec3 {
  const sizes = catalog.items.filter((item) => item.category === category).map((item) => item.size);
  if (sizes.length === 0) return [0.5, 0.5, 0.5];
  return [0, 1, 2].map((axis) => median(sizes.map((size) => size[axis]))) as Vec3;
}

/** The axis a category's items are flat along: rugs lie flat and wall items hang, height and depth. */
const FLAT_AXIS: Partial<Record<Category, number>> = { rug: 1, wall_art: 2, mirror: 2 };

/**
 * The uniform scale that fits a model of `size` inside `box`: the tightest of its axes. A flat item's thin axis doesn't
 * count, since image-to-3D makes rugs and frames thicker than real ones and fitting it would shrink the whole item.
 */
export function fitScale(size: Vec3, box: Vec3, category: Category): number {
  const axes = [0, 1, 2].filter((axis) => axis !== FLAT_AXIS[category]);
  return Math.min(...axes.map((axis) => box[axis] / size[axis]));
}
