// The per-triangle rules of the load-time split (spec §9.4), kept free of three.js so they can be tested.
import type { RoomSetup, Vec2 } from '@shared/types';
import type { TriangleInfo } from './mesh';
import { wallAxis } from './walls';

export type SplitGroup =
  | { kind: 'shell' } | { kind: 'floor' } | { kind: 'ceiling' }
  | { kind: 'wall'; id: string } | { kind: 'original'; id: string };

/** The thresholds of spec §9.4, in meters. */
export const SPLIT = {
  originalGrowth: 0.02,
  originalMinY: 0.02,
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

export interface TriangleClassifier {
  /** Shell, Floor, Ceiling, then one per Wall and one per Original, in setup order. */
  groups: SplitGroup[];
  /** The index in `groups` of the first rule (spec §9.4) that matches the triangle, in the room frame. */
  classify(triangle: TriangleInfo): number;
}

const SHELL = 0;
const FLOOR = 1;
const CEILING = 2;

export function triangleClassifier(setup: RoomSetup): TriangleClassifier {
  const walls = setup.walls.map((wall) => ({
    ...wall,
    ...wallAxis(wall),
    openings: setup.openings.filter((o) => o.wallId === wall.id),
  }));
  const boxes = setup.originals.map(({ box: { position: [px, py, pz], size: [w, h, d], rotationY } }) => ({
    px, py, pz, c: Math.cos(rotationY), s: Math.sin(rotationY),
    halfW: w / 2 + SPLIT.originalGrowth, halfD: d / 2 + SPLIT.originalGrowth,
    bottom: -SPLIT.originalGrowth, top: h + SPLIT.originalGrowth,
  }));
  const polygon = setup.floor.polygon;
  const firstWall = 3;
  const firstOriginal = firstWall + walls.length;

  /** The signed distance from a wall's plane (positive inside the room), and the distance along it from its start. */
  const wallCoordinates = (wall: (typeof walls)[number], x: number, z: number) => {
    const rx = x - wall.start[0];
    const rz = z - wall.start[1];
    return { depth: rx * wall.normal[0] + rz * wall.normal[1], along: rx * wall.dx + rz * wall.dz };
  };

  /** True when the point is within `band` of a wall's plane and inside the wall's extent. */
  const nearAnyWall = (x: number, z: number, band: number) => walls.some((wall) => {
    const { depth, along } = wallCoordinates(wall, x, z);
    return Math.abs(depth) <= band && along >= 0 && along <= wall.length;
  });

  const floorLike = (cx: number, cy: number, cz: number, ny: number) =>
    Math.abs(cy) < SPLIT.floorBand && ny > SPLIT.floorNormalY && insidePolygon(polygon, cx, cz);

  function classify({ cx, cy, cz, nx, ny, nz }: TriangleInfo): number {
    // 1. Inside an Original's box, grown by 2 cm, above the floor and away from the walls. Added to
    //    spec §9.4: never a triangle rule 3 would call floor, so a bumpy floor stays under a hidden Original.
    if (cy > SPLIT.originalMinY && !floorLike(cx, cy, cz, ny)) {
      for (let i = 0; i < boxes.length; i++) {
        const b = boxes[i];
        const dx = cx - b.px;
        const dz = cz - b.pz;
        const ly = cy - b.py;
        // Into the box's frame: rotate by −rotationY.
        const lx = b.c * dx - b.s * dz;
        const lz = b.s * dx + b.c * dz;
        if (Math.abs(lx) <= b.halfW && Math.abs(lz) <= b.halfD && ly >= b.bottom && ly <= b.top
          && !nearAnyWall(cx, cz, SPLIT.originalWallGap)) return firstOriginal + i;
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
export function insidePolygon(polygon: Vec2[], x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, zi] = polygon[i];
    const [xj, zj] = polygon[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
