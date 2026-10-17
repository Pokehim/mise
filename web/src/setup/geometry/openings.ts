// Room Setup step 4 (spec §9.3): an Opening from two clicks on a wall.
import type { Opening, Vec3, Wall } from '@shared/types';
import { wallAxis } from './walls';

/**
 * The rectangle between two opposite corners clicked on a wall, projected onto the wall's plane and
 * clipped to the wall. A door always starts at the floor.
 */
export function openingFromClicks(
  wall: Wall, a: Vec3, b: Vec3, kind: Opening['kind'],
): Pick<Opening, 'offset' | 'width' | 'bottom' | 'height'> {
  const { length, dx, dz } = wallAxis(wall);
  const along = (p: Vec3) => clamp((p[0] - wall.start[0]) * dx + (p[2] - wall.start[1]) * dz, 0, length);
  const up = (p: Vec3) => clamp(p[1], 0, wall.height);
  const [left, right] = [along(a), along(b)].sort((m, n) => m - n);
  const bottom = kind === 'door' ? 0 : Math.min(up(a), up(b));
  const top = Math.max(up(a), up(b));
  return { offset: round(left), width: round(right - left), bottom: round(bottom), height: round(top - bottom) };
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** Meters to 0.1 mm, which hides floating-point noise such as 1.2000000000000002 in setup.json. */
const round = (v: number) => Math.round(v * 1e4) / 1e4;
