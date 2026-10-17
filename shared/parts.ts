import type { Category, PartDef, PartParams, Vec3 } from './types';

const part = (id: string, name: string): PartDef => ({ id, name });
const [top, legs, seatBack, frame, bedding, body, fronts, cushions] = [
  part('top', 'Top'), part('legs', 'Legs'), part('seat_back', 'Seat and back'), part('frame', 'Frame'),
  part('bedding', 'Bedding'), part('body', 'Body'), part('fronts', 'Fronts'), part('cushions', 'Cushions'),
];

const PARTS: Partial<Record<Category, PartDef[]>> = {
  table: [top, legs],
  desk: [top, legs],
  chair: [seatBack, legs],
  bed: [frame, bedding],
  dresser: [body, fronts],
  wardrobe: [body, fronts],
  nightstand: [body, fronts],
  storage: [body, fronts],
  sofa: [frame, cushions],
};

/** The Parts of a category, in Recolor picker order (spec §7). Categories without a rule have one Part, body. */
export function partsFor(category: Category): PartDef[] {
  return PARTS[category] ?? [body];
}

/**
 * The Part a triangle belongs to (spec §7, ADR-0006). The centroid and the unit normal are in the
 * object's own frame: bottom-center origin, +Z front. `size` is the box's [w, h, d], and `params`
 * overrides the rule's defaults (an Original's or Catalog item's `partParams`).
 */
export function assignPart(category: Category, size: Vec3, params: PartParams | undefined, centroid: Vec3, normal: Vec3): string {
  const [w, h, d] = size;
  const [x, y, z] = centroid;
  switch (category) {
    case 'table':
    case 'desk':
      return y >= h - (params?.topThickness ?? 0.06) ? 'top' : 'legs';
    case 'chair':
      return y < (params?.seatFraction ?? 0.45) * h ? 'legs' : 'seat_back';
    case 'bed': {
      const [low, high] = params?.beddingRange ?? [0.22, 0.7];
      return low <= y && y <= high && Math.abs(x) < 0.47 * w && z > -d / 2 + 0.12 ? 'bedding' : 'frame';
    }
    case 'dresser':
    case 'wardrobe':
    case 'nightstand':
    case 'storage':
      return normal[2] > 0.7 && z > d / 2 - (params?.frontDepth ?? 0.03) ? 'fronts' : 'body';
    case 'sofa':
      return 0.25 * h <= y && y <= 0.6 * h && Math.abs(x) < 0.45 * w && z > -d / 2 + 0.15 ? 'cushions' : 'frame';
    default:
      return 'body';
  }
}
