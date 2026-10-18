// Touched means mesh (ADR-0005, spec §12): which splat regions to hide, and which mesh nodes to show
// in their place, for a Design's RoomState. Pure, so SplatLook only has to turn each SdfBox into a
// SplatEditSdf of type BOX.
import type { Box, Opening, RoomSetup, RoomState, Vec2, Vec3, Wall } from '@shared/types';
import { wallPoint } from '@shared/geometry';
import { REGION_GROW } from './patchFrames';

/** Half the thickness of the slab hidden over a painted Wall or the finished Floor, in meters. */
export const SLAB = 0.05;
/** How far past its box a recolored, unmoved Original's hidden region reaches. */
export const PAD = 0.05;
/** How much thicker an Opening's kept region is than the Wall slab it sits in, on each side. */
export const OPENING_DEPTH = 0.02;

/** A box-shaped splat edit in the room frame. `size` is the full extent along the box's own axes. */
export interface SdfBox {
  /** The Wall, Original or Opening id it covers, or 'floor'. */
  id: string;
  center: Vec3;
  size: Vec3;
  rotationY: number;
  /** 0 hides the splats inside; 1 keeps them (an Opening on a painted Wall). */
  opacity: 0 | 1;
}

export interface SplatEditPlan {
  /** Every opacity-0 box first, then the opacity-1 boxes that win back the Openings. */
  sdfs: SdfBox[];
  /** Mesh nodes to show, with their change applied. Every other Wall, Original, and the Floor stay hidden. */
  mesh: { walls: string[]; originals: string[]; floor: boolean };
  /** Originals whose Patch shows: the ones lifted or removed. */
  patches: string[];
}

export function splatEditPlan(setup: RoomSetup, state: RoomState): SplatEditPlan {
  const hide: SdfBox[] = [];
  const keep: SdfBox[] = [];
  const mesh: SplatEditPlan['mesh'] = { walls: [], originals: [], floor: false };
  const patches: string[] = [];

  for (const original of setup.originals) {
    const now = state.originals[original.id];
    if (!now) continue;
    const lifted = now.moved || !now.visible;
    const recolored = Object.keys(now.partColors).length > 0 || Object.keys(now.partFinishes).length > 0;
    if (!lifted && !recolored) continue;
    // A lifted or removed Original hides the same region as its Patch, so the splat's contact shadow
    // and the strip of wall behind it go too (#34).
    hide.push(grownBox(original.id, original.box, lifted ? REGION_GROW : PAD));
    if (now.visible) mesh.originals.push(original.id);
    if (lifted) patches.push(original.id);
  }

  for (const wall of setup.walls) {
    if (!state.surfaces.walls[wall.id]) continue;
    hide.push(wallSlab(wall));
    mesh.walls.push(wall.id);
    // The Wall node has holes where its Openings are (classify rule 4), so keep their splats.
    for (const opening of setup.openings) if (opening.wallId === wall.id) keep.push(openingBox(wall, opening));
  }

  if (state.surfaces.floor) {
    hide.push(floorSlab(setup.floor.polygon));
    mesh.floor = true;
  }

  return { sdfs: [...hide, ...keep], mesh, patches };
}

function grownBox(id: string, { position: [x, y, z], size: [w, h, d], rotationY }: Box, grow: number): SdfBox {
  return { id, center: [x, y + h / 2, z], size: [w + 2 * grow, h + 2 * grow, d + 2 * grow], rotationY, opacity: 0 };
}

// The box's own +X runs from the Wall's start to its end.
function wallYaw({ start: [sx, sz], end: [ex, ez] }: Wall): number {
  return Math.atan2(-(ez - sz), ex - sx);
}

/** An opacity-0 slab over a Wall: `inside` meters into the room from the wall line, and `outside` meters out of it. */
export function wallSlab(wall: Wall, inside = SLAB, outside = SLAB): SdfBox {
  const length = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]);
  const [x, z] = wallPoint(wall, length / 2, (inside - outside) / 2);
  return { id: wall.id, center: [x, wall.height / 2, z], size: [length, wall.height, inside + outside], rotationY: wallYaw(wall), opacity: 0 };
}

function openingBox(wall: Wall, opening: Opening): SdfBox {
  const [x, z] = wallPoint(wall, opening.offset + opening.width / 2);
  return {
    id: opening.id,
    center: [x, opening.bottom + opening.height / 2, z],
    size: [opening.width, opening.height, 2 * (SLAB + OPENING_DEPTH)],
    rotationY: wallYaw(wall),
    opacity: 1,
  };
}

function floorSlab(polygon: Vec2[]): SdfBox {
  const xs = polygon.map(([x]) => x);
  const zs = polygon.map(([, z]) => z);
  const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
  return { id: 'floor', center: [(x0 + x1) / 2, 0, (z0 + z1) / 2], size: [x1 - x0, 2 * SLAB, z1 - z0], rotationY: 0, opacity: 0 };
}
