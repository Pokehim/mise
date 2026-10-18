// The per-triangle rules of the load-time split (spec §9.4), kept free of three.js so they can be tested.
import type { RoomSetup, Vec2 } from '@shared/types';
import type { TriangleInfo } from './mesh';
import { nearAnyWall, wallCoordinates, withAxis } from './walls';

export type SplitGroup =
  | { kind: 'shell' } | { kind: 'floor' } | { kind: 'ceiling' }
  | { kind: 'wall'; id: string } | { kind: 'original'; id: string };

/** The thresholds of spec §9.4, in meters. */
export const SPLIT = {
  originalGrowth: 0.02,
  /**
   * Spec §9.4 says 2 cm, which kept the floor out of rule 1. Rule 1 now leaves floor-like triangles
   * to the Floor anyway, and 2 cm left a line of an Original's own slivers along its base when hidden.
   */
  originalMinY: 0,
  originalWallGap: 0.02,
  ceilingBand: 0.05,
  /**
   * Spec §9.4 says 3 cm. Tuned on the venue test scan, whose floor is bumpy: ±3 cm around its
   * median height holds 48% of its up-facing floor area, ±6 cm holds 85%.
   */
  floorBand: 0.06,
  floorNormalY: 0.8,
  wallBand: 0.04,
  wallNormalDot: 0.7,
};

interface TriangleClassifier {
  /** Shell, Floor, Ceiling, then one per Wall and one per Original, in setup order. */
  groups: SplitGroup[];
  /** The index in `groups` of the first rule (spec §9.4) that matches the triangle, in the room frame. */
  classify(triangle: TriangleInfo): number;
}

const SHELL = 0;
const FLOOR = 1;
const CEILING = 2;

/** A triangle at this height, with this normal.y, faces up within the floor's band: rule 3, but for its polygon test. */
export const onFloor = (y: number, ny: number) => Math.abs(y) < SPLIT.floorBand && ny > SPLIT.floorNormalY;

export function triangleClassifier(setup: RoomSetup): TriangleClassifier {
  const walls = setup.walls.map((wall) => ({ ...withAxis(wall), openings: setup.openings.filter((o) => o.wallId === wall.id) }));
  const boxes = setup.originals.map(({ box: { position: [px, py, pz], size: [w, h, d], rotationY } }) => ({
    px, py, pz, c: Math.cos(rotationY), s: Math.sin(rotationY),
    halfW: w / 2 + SPLIT.originalGrowth, halfD: d / 2 + SPLIT.originalGrowth,
    bottom: -SPLIT.originalGrowth, top: h + SPLIT.originalGrowth,
    // A rug lies within the floor's band, so the floor-like triangles in its box are the rug.
    flat: h <= SPLIT.floorBand,
  }));
  const polygon = setup.floor.polygon;
  const firstWall = 3;
  const firstOriginal = firstWall + walls.length;

  const floorLike = (cx: number, cy: number, cz: number, ny: number) => onFloor(cy, ny) && insidePolygon(polygon, cx, cz);

  function classify({ cx, cy, cz, nx, ny, nz }: TriangleInfo): number {
    // 1. Inside an Original's box, grown by 2 cm, above the floor and away from the walls. Added to
    //    spec §9.4: unless the Original is flat (a rug), never a triangle rule 3 would call floor, so
    //    the floor stays under a hidden Original.
    if (cy > SPLIT.originalMinY) {
      const onTheFloor = floorLike(cx, cy, cz, ny);
      for (let i = 0; i < boxes.length; i++) {
        const b = boxes[i];
        const dx = cx - b.px;
        const dz = cz - b.pz;
        const ly = cy - b.py;
        // Into the box's frame: rotate by −rotationY.
        const lx = b.c * dx - b.s * dz;
        const lz = b.s * dx + b.c * dz;
        if (Math.abs(lx) <= b.halfW && Math.abs(lz) <= b.halfD && ly >= b.bottom && ly <= b.top
          && (b.flat || !onTheFloor) && !nearAnyWall(walls, cx, cz, SPLIT.originalWallGap)) return firstOriginal + i;
      }
    }
    // 2. Ceiling.
    if (cy > setup.ceilingHeight - SPLIT.ceilingBand) return CEILING;
    // 3. Floor.
    if (floorLike(cx, cy, cz, ny)) return FLOOR;
    // 4. A Wall, unless the triangle is inside one of its Openings.
    for (let i = 0; i < walls.length; i++) {
      const wall = walls[i];
      const { depth, along } = wallCoordinates(wall, cx, cz);
      if (Math.abs(depth) >= SPLIT.wallBand || along < 0 || along > wall.length || cy > wall.height) continue;
      if (Math.abs(nx * wall.normal[0] + nz * wall.normal[1]) <= SPLIT.wallNormalDot) continue;
      const inOpening = wall.openings.some((o) =>
        along >= o.offset && along <= o.offset + o.width && cy >= o.bottom && cy <= o.bottom + o.height);
      if (!inOpening) return firstWall + i;
    }
    // 5. Everything else.
    return SHELL;
  }

  return {
    groups: [
      { kind: 'shell' }, { kind: 'floor' }, { kind: 'ceiling' },
      ...setup.walls.map(({ id }) => ({ kind: 'wall' as const, id })),
      ...setup.originals.map(({ id }) => ({ kind: 'original' as const, id })),
    ],
    classify,
  };
}

/** Even-odd test of a point on the floor plane against a polygon of (x, z) corners. */
function insidePolygon(polygon: Vec2[], x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, zi] = polygon[i];
    const [xj, zj] = polygon[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
