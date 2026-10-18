// The levels of the Catalog's shelves, read from their models, so that on_top_of can rest decor on a
// shelf and not only on top of it. RoomSetup and CatalogItem have no field for them (spec §5).
import { join } from 'node:path';
import { MeshoptDecoder } from 'meshoptimizer';
import { io } from '../../scripts/scan-import';
import type { ShelfLevel } from '../../shared/anchors';
import type { Catalog, Vec2 } from '../../shared/types';

/** How much of the shelf's footprint an upward face must cover to be a level things can stand on. */
const MIN_COVER = 0.25;
/** Upward faces within this many meters of each other are one level: a board's top and its trim. */
const SAME_LEVEL = 0.03;
/** How close to straight up, or down, a face must point. */
const LEVEL_FACE = 0.9;

/** Each model's levels, read once: the Catalog's models don't change while the server runs. */
const levelsByModel = new Map<string, Promise<ShelfLevel[] | undefined>>();

/** The levels of every shelf in the Catalog, by Catalog id; a shelf whose model can't be read has none. */
export async function shelfLevels(catalog: Catalog, dataDir: string): Promise<Record<string, ShelfLevel[]>> {
  const shelves = catalog.items.filter(({ category }) => category === 'shelf');
  const levels = await Promise.all(shelves.map(({ id, model, size: [width, , depth] }) => {
    const file = join(dataDir, model.replace(/^\/data\//, ''));
    if (!levelsByModel.has(file)) levelsByModel.set(file, levelsIn(file, width * depth).catch(() => undefined));
    return levelsByModel.get(file)!.then((found) => [id, found] as const);
  }));
  return Object.fromEntries(levels.filter((entry): entry is readonly [string, ShelfLevel[]] => !!entry[1]?.length));
}

/**
 * The levels in a model with a `footprint` m² footprint, bottom to top: its upward faces at each
 * height that cover a good part of the footprint, with the room above each up to the downward face
 * over it. Models are in the item's own frame: bottom-center origin, +Z front.
 */
async function levelsIn(file: string, footprint: number): Promise<ShelfLevel[]> {
  await MeshoptDecoder.ready;
  const document = await io.read(file);
  const ups: Face[] = [];
  const downs: Face[] = [];
  for (const node of document.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const matrix = node.getWorldMatrix();
    for (const primitive of mesh.listPrimitives()) {
      const position = primitive.getAttribute('POSITION');
      if (!position) continue;
      const indices = primitive.getIndices();
      const count = indices ? indices.getCount() : position.getCount();
      const vertex = (i: number) => {
        const [x, y, z] = position.getElement(indices ? indices.getScalar(i) : i, [0, 0, 0]);
        // The column-major world matrix, applied to the point.
        return [0, 1, 2].map((row) => matrix[row] * x + matrix[row + 4] * y + matrix[row + 8] * z + matrix[row + 12]);
      };
      for (let i = 0; i + 2 < count; i += 3) {
        const [a, b, c] = [vertex(i), vertex(i + 1), vertex(i + 2)];
        const [ux, uy, uz, vx, vy, vz] = [b[0] - a[0], b[1] - a[1], b[2] - a[2], c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        const normal = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
        const length = Math.hypot(...normal);
        if (!length) continue;
        const face = { y: (a[1] + b[1] + c[1]) / 3, area: length / 2, xs: [a[0], b[0], c[0]], zs: [a[2], b[2], c[2]] };
        if (normal[1] / length < -LEVEL_FACE) downs.push(face);
        if (normal[1] / length > LEVEL_FACE) ups.push(face);
      }
    }
  }

  const levels = byHeight(ups).filter((faces) => area(faces) >= MIN_COVER * footprint);
  const undersides = byHeight(downs);
  return levels.map((faces, i) => {
    // A level is at the top of its faces, as wide and deep as they reach.
    const height = faces.at(-1)!.y;
    const [xs, zs] = [faces.flatMap(({ xs: faceXs }) => faceXs), faces.flatMap(({ zs: faceZs }) => faceZs)];
    const center: Vec2 = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...zs) + Math.max(...zs)) / 2];
    const size: Vec2 = [Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)];
    // The room above it ends at the first underside over a good part of it: not at the trim or a rung over its edge.
    const over = (face: Face) => Math.abs(mean(face.xs) - center[0]) < size[0] / 2 && Math.abs(mean(face.zs) - center[1]) < size[1] / 2;
    const ceiling = i + 1 < levels.length
      ? undersides.find((under) => under[0].y > height + SAME_LEVEL && area(under.filter(over)) >= MIN_COVER * size[0] * size[1])
      : undefined;
    return { height, center, size, clearance: ceiling ? ceiling[0].y - height : Infinity };
  });
}

/** A triangle of a model facing straight up or down: its height, area, and corners' x and z. */
interface Face { y: number; area: number; xs: number[]; zs: number[] }

/** Faces grouped by height, bottom to top: faces a few cm apart are one group. */
function byHeight(faces: Face[]): Face[][] {
  const groups: Face[][] = [];
  for (const face of faces.toSorted((p, q) => p.y - q.y)) {
    const last = groups.at(-1);
    if (last && face.y - last.at(-1)!.y <= SAME_LEVEL) last.push(face);
    else groups.push([face]);
  }
  return groups;
}

const area = (faces: Face[]) => faces.reduce((total, face) => total + face.area, 0);
const mean = (values: number[]) => values.reduce((total, value) => total + value, 0) / values.length;
