// Room Setup step 4 (spec §9.3): an Opening from two clicks on a wall.
import { MathUtils } from 'three';
import type { Opening, Vec3, Wall } from '@shared/types';
import { mm } from './mesh';
import { wallCoordinates, withAxis } from './walls';

/**
 * The rectangle between two opposite corners clicked on a wall, projected onto the wall's plane and
 * clipped to the wall. A door always starts at the floor.
 */
export function openingFromClicks(
  wall: Wall, a: Vec3, b: Vec3, kind: Opening['kind'],
): Pick<Opening, 'offset' | 'width' | 'bottom' | 'height'> {
  const axisWall = withAxis(wall);
  const along = (p: Vec3) => MathUtils.clamp(wallCoordinates(axisWall, p[0], p[2]).along, 0, axisWall.length);
  const up = (p: Vec3) => MathUtils.clamp(p[1], 0, wall.height);
  const [left, right] = [along(a), along(b)].sort((m, n) => m - n);
  const bottom = kind === 'door' ? 0 : Math.min(up(a), up(b));
  const top = Math.max(up(a), up(b));
  return { offset: mm(left), width: mm(right - left), bottom: mm(bottom), height: mm(top - bottom) };
}
