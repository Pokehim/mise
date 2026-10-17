// Defaults for tagging Originals in Room Setup step 5.
import type { Box, Category, Original, PartParams, RoomSetup, Vec3, Wall } from '@shared/types';
import { autoBox } from './geometry/autoBox';
import { type TriangleMesh, mm } from './geometry/mesh';
import { nearestWall, wallCoordinates, withAxis } from './geometry/walls';
import { scanTriangles, useSetup } from './store';

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

// How each category is tagged when the Mover clicks it: auto-boxed (beds facing along their
// length, everything else away from the nearest wall), or, for things too flat for auto-box (rugs)
// or too close to their wall (wall art, mirrors), placed by hand at a usual size.
const HANG_ON_WALL: Category[] = ['wall_art', 'mirror'];
const BY_HAND: Category[] = ['rug', ...HANG_ON_WALL];
// [width, height, depth] for a box placed by hand, including when auto-box finds nothing.
const HAND_SIZES: Partial<Record<Category, Vec3>> = {
  rug: [1.5, 0.02, 1], wall_art: [0.6, 0.6, 0.04], mirror: [0.5, 1, 0.04], lamp: [0.3, 1.5, 0.3], plant: [0.4, 0.8, 0.4],
};

/** Step 5: tag the furniture at a clicked point as an Original of the chosen category, and select it. */
export function tagOriginalAt(point: Vec3) {
  const { setup, manifest, scene, tagCategory, updateSetup } = useSetup.getState();
  const { box, found } = boxForClick(tagCategory, scanTriangles(scene!, manifest!.meshTransform), point, setup!);
  const original = newOriginal(tagCategory, box, setup!.originals);
  updateSetup((s) => ({ ...s, originals: [...s.originals, original] }));
  useSetup.setState({
    selectedOriginalId: original.id,
    notice: found ? undefined : 'Auto-box found no furniture there, so this box has a default size. Drag its handles to fit.',
  });
}

/**
 * The box for a click on the scan while tagging a category, and whether auto-box found furniture
 * there. When it didn't, the box is the category's usual size at the click, for the Mover to fit.
 */
function boxForClick(category: Category, scan: TriangleMesh, point: Vec3, setup: RoomSetup): { box: Box; found: boolean } {
  if (!BY_HAND.includes(category)) {
    const box = autoBox(scan, point, setup, category === 'bed' ? 'length' : 'away-from-wall');
    if (box) return { box, found: true };
  }
  return { box: handPlacedBox(category, point, setup.walls), found: BY_HAND.includes(category) };
}

/** A box of the category's usual size at a point: hung on the nearest wall for wall art and mirrors, otherwise standing on the floor. */
function handPlacedBox(category: Category, [x, y, z]: Vec3, walls: Wall[]): Box {
  const size = HAND_SIZES[category] ?? [0.5, 0.5, 0.5];
  const { wall } = HANG_ON_WALL.includes(category) ? nearestWall(walls.map(withAxis), x, z) : { wall: undefined };
  if (!wall) return { position: [mm(x), 0, mm(z)], size, rotationY: 0 };
  const [nx, nz] = wall.normal;
  const { along } = wallCoordinates(wall, x, z);
  const [wx, wz] = [wall.start[0] + along * wall.dx, wall.start[1] + along * wall.dz];
  return {
    position: [mm(wx + nx * (size[2] / 2)), mm(Math.max(0, y - size[1] / 2)), mm(wz + nz * (size[2] / 2))],
    size,
    rotationY: Math.atan2(nx, nz),
  };
}
