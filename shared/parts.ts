import type { Category, PartDef, PartParams, Vec3 } from './types';

const top: PartDef = { id: 'top', name: 'Top' };
const legs: PartDef = { id: 'legs', name: 'Legs' };
const seatBack: PartDef = { id: 'seat_back', name: 'Seat and back' };
const frame: PartDef = { id: 'frame', name: 'Frame' };
const bedding: PartDef = { id: 'bedding', name: 'Bedding' };
const body: PartDef = { id: 'body', name: 'Body' };
const fronts: PartDef = { id: 'fronts', name: 'Fronts' };
const cushions: PartDef = { id: 'cushions', name: 'Cushions' };

/** A §7 rule: a category's Parts, and which one a triangle belongs to. */
interface Rule {
  parts: PartDef[];
  assign: (size: Vec3, params: PartParams | undefined, centroid: Vec3, normal: Vec3) => PartDef;
}

const topBand: Rule = {
  parts: [top, legs],
  assign: ([, h], params, [, y]) => (y >= h - (params?.topThickness ?? 0.06) ? top : legs),
};

const frontSlab: Rule = {
  parts: [body, fronts],
  assign: ([, , d], params, [, , z], [, , nz]) => (nz > 0.7 && z > d / 2 - (params?.frontDepth ?? 0.03) ? fronts : body),
};

const RULES: Partial<Record<Category, Rule>> = {
  table: topBand,
  desk: topBand,
  chair: {
    parts: [seatBack, legs],
    assign: ([, h], params, [, y]) => (y < (params?.seatFraction ?? 0.45) * h ? legs : seatBack),
  },
  bed: {
    parts: [frame, bedding],
    assign: ([w, , d], params, [x, y, z]) => {
      const [low, high] = params?.beddingRange ?? [0.22, 0.7];
      return low <= y && y <= high && Math.abs(x) < 0.47 * w && z > -d / 2 + 0.12 ? bedding : frame;
    },
  },
  dresser: frontSlab,
  wardrobe: frontSlab,
  nightstand: frontSlab,
  storage: frontSlab,
  sofa: {
    parts: [frame, cushions],
    assign: ([w, h, d], _params, [x, y, z]) =>
      (0.25 * h <= y && y <= 0.6 * h && Math.abs(x) < 0.45 * w && z > -d / 2 + 0.15 ? cushions : frame),
  },
};

/** The Parts of a category, in Recolor picker order (spec §7). Categories without a rule have one Part, body. */
export function partsFor(category: Category): PartDef[] {
  return RULES[category]?.parts ?? [body];
}

/**
 * The Part a triangle belongs to (spec §7, ADR-0006). The centroid and the unit normal are in the
 * object's own frame: bottom-center origin, +Z front. `size` is the box's [w, h, d], and `params`
 * overrides the rule's defaults (an Original's or Catalog item's `partParams`).
 */
export function assignPart(category: Category, size: Vec3, params: PartParams | undefined, centroid: Vec3, normal: Vec3): string {
  return (RULES[category]?.assign(size, params, centroid, normal) ?? body).id;
}
