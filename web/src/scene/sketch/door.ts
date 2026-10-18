import { wallPoint } from '@shared/geometry';
import type { Opening, Vec2, Wall } from '@shared/types';

/** Straight segments that stand in for the arc of a door's swing, as in shared/fit.ts. */
const SEGMENTS = 16;

/**
 * A door as a plan draws it: its hinge, and the arc its leaf sweeps into the room, from the latch
 * side of the doorway round to the open leaf. Null for a door that doesn't swing. The hinge side
 * follows doorZone in shared/fit.ts, so the drawing matches the Fit rule's door-swing zone.
 */
export function doorSwing({ offset, width, swing }: Opening, wall: Wall): { hinge: Vec2; arc: Vec2[] } | null {
  if (swing !== 'in-left' && swing !== 'in-right') return null;
  // `swing` names the hinge side as seen from inside the room, facing the wall, where right is [nz, −nx].
  const { start: [sx, sz], end: [ex, ez], normal: [nx, nz] } = wall;
  const endIsRight = (ex - sx) * nz - (ez - sz) * nx > 0;
  const hinge = endIsRight === (swing === 'in-right') ? offset + width : offset;
  const toLatch = hinge === offset ? 1 : -1;
  const arc = Array.from({ length: SEGMENTS + 1 }, (_, i) => {
    const angle = (i / SEGMENTS) * (Math.PI / 2);
    return wallPoint(wall, hinge + toLatch * width * Math.cos(angle), width * Math.sin(angle));
  });
  return { hinge: wallPoint(wall, hinge), arc };
}

/** How far into the room a door that doesn't swing needs the floor clear: DOORWAY_DEPTH in shared/fit.ts. */
const DOORWAY_DEPTH = 0.6;

/**
 * The outline of the floor a door needs clear, as the door-swing Fit rule checks it: the swing's
 * arc and open leaf, or, for a door that doesn't swing, the 0.6 m in front of the doorway.
 */
export function doorClearance(door: Opening, wall: Wall): Vec2[] {
  const swing = doorSwing(door, wall);
  if (swing) return [...swing.arc, swing.hinge];
  const { offset, width } = door;
  return [wallPoint(wall, offset), wallPoint(wall, offset, DOORWAY_DEPTH), wallPoint(wall, offset + width, DOORWAY_DEPTH), wallPoint(wall, offset + width)];
}
