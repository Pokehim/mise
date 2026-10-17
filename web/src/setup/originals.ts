// Defaults for tagging Originals in Room Setup step 5.
import type { Box, Category, Original, PartParams, Vec3, Wall } from '@shared/types';
import { wallAxis } from './geometry/walls';

export const CATEGORY_NAMES: Record<Category, string> = {
  bed: 'Bed', desk: 'Desk', chair: 'Chair', table: 'Table', nightstand: 'Nightstand', sofa: 'Sofa',
  dresser: 'Dresser', wardrobe: 'Wardrobe', shelf: 'Shelf', storage: 'Storage',
  rug: 'Rug', lamp: 'Lamp', wall_art: 'Wall art', mirror: 'Mirror', plant: 'Plant', decor: 'Decor',
};

export const CATEGORIES = Object.keys(CATEGORY_NAMES) as Category[];

/** The Part rule defaults of spec §7, written into each new Original so they can be tuned per Original. */
export function defaultPartParams(category: Category): PartParams | undefined {
  switch (category) {
    case 'table': case 'desk': return { topThickness: 0.06 };
    case 'chair': return { seatFraction: 0.45 };
    case 'bed': return { beddingRange: [0.22, 0.7] };
    case 'dresser': case 'wardrobe': case 'nightstand': case 'storage': return { frontDepth: 0.03 };
    default: return undefined;
  }
}

/** Before Bake (step 6) measures it. */
export const UNBAKED_FLOOR_COLOR = '#808080';

/** A new Original of a category, with an id and label that no other Original has, such as og_chair_2 and "Chair 2". */
export function newOriginal(category: Category, box: Box, existing: Original[]): Original {
  const idFor = (n: number) => (n === 1 ? `og_${category}` : `og_${category}_${n}`);
  let n = 1;
  while (existing.some((o) => o.id === idFor(n))) n++;
  return {
    id: idFor(n),
    label: n === 1 ? CATEGORY_NAMES[category] : `${CATEGORY_NAMES[category]} ${n}`,
    category,
    box,
    kept: false,
    ...(defaultPartParams(category) && { partParams: defaultPartParams(category) }),
    floorColor: UNBAKED_FLOOR_COLOR,
  };
}

// [width, height, depth] for a box placed by hand, when auto-box finds nothing (rugs are too flat
// for it and wall art too close to the wall).
const HAND_SIZES: Partial<Record<Category, Vec3>> = {
  rug: [1.5, 0.02, 1], wall_art: [0.6, 0.6, 0.04], mirror: [0.5, 1, 0.04], lamp: [0.3, 1.5, 0.3], plant: [0.4, 0.8, 0.4],
};

/**
 * A box of the category's usual size at a clicked point. Wall art and mirrors hang centered on the
 * click against the nearest wall; everything else stands on the floor.
 */
export function handPlacedBox(category: Category, [x, y, z]: Vec3, walls: Wall[]): Box {
  const size = HAND_SIZES[category] ?? [0.5, 0.5, 0.5];
  if (category === 'wall_art' || category === 'mirror') {
    const wall = nearestWall(walls, x, z);
    if (wall) {
      const [nx, nz] = wall.normal;
      const { dx, dz } = wallAxis(wall);
      const along = (x - wall.start[0]) * dx + (z - wall.start[1]) * dz;
      const [wx, wz] = [wall.start[0] + along * dx, wall.start[1] + along * dz];
      return {
        position: [mm(wx + nx * (size[2] / 2)), mm(Math.max(0, y - size[1] / 2)), mm(wz + nz * (size[2] / 2))],
        size,
        rotationY: Math.atan2(nx, nz),
      };
    }
  }
  return { position: [mm(x), 0, mm(z)], size, rotationY: 0 };
}

const mm = (v: number) => Math.round(v * 1000) / 1000;

function nearestWall(walls: Wall[], x: number, z: number): Wall | undefined {
  let best: Wall | undefined;
  let bestDistance = Infinity;
  for (const wall of walls) {
    const d = Math.abs((x - wall.start[0]) * wall.normal[0] + (z - wall.start[1]) * wall.normal[1]);
    if (d < bestDistance) [best, bestDistance] = [wall, d];
  }
  return best;
}
