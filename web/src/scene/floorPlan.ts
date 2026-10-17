import { Box3, Vector3 } from 'three';
import type { RoomSetup, Vec2, Wall } from '@shared/types';

/** The room as a box: its floor polygon, from the floor up to the ceiling. */
export function roomBounds(setup: RoomSetup) {
  const box = new Box3();
  for (const [x, z] of setup.floor.polygon) {
    box.expandByPoint(new Vector3(x, 0, z)).expandByPoint(new Vector3(x, setup.ceilingHeight, z));
  }
  return box;
}

/** Whether a floor point is inside the room's floor polygon. */
export function insideFloor([x, z]: Vec2, polygon: Vec2[]) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, zi] = polygon[i];
    const [xj, zj] = polygon[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Where a floor point lands on a wall's line: how far along it, and how far into the room. */
export function wallCoordinates([x, z]: Vec2, wall: Wall) {
  const [sx, sz] = wall.start;
  const length = Math.hypot(wall.end[0] - sx, wall.end[1] - sz);
  const along = ((x - sx) * (wall.end[0] - sx) + (z - sz) * (wall.end[1] - sz)) / length;
  const into = (x - sx) * wall.normal[0] + (z - sz) * wall.normal[1];
  return { along, into, length };
}

/** The floor point `along` a wall and `into` the room from it. */
export function wallPoint(wall: Wall, along: number, into: number): Vec2 {
  const [sx, sz] = wall.start;
  const length = Math.hypot(wall.end[0] - sx, wall.end[1] - sz);
  return [
    sx + ((wall.end[0] - sx) * along) / length + wall.normal[0] * into,
    sz + ((wall.end[1] - sz) * along) / length + wall.normal[1] * into,
  ];
}

/** The nearest floor point at least `margin` inside every wall: the point itself when it already is. */
export function keepInside(point: Vec2, setup: RoomSetup, margin: number): Vec2 {
  let p = point;
  // A point pushed off one wall can land too close to the next one in a corner, so repeat.
  for (let i = 0; i < 3; i++) {
    const nearest = setup.walls
      .map((wall) => {
        const { along, length } = wallCoordinates(p, wall);
        const onWall = wallPoint(wall, Math.min(Math.max(along, 0), length), 0);
        return { wall, onWall, distance: Math.hypot(p[0] - onWall[0], p[1] - onWall[1]) };
      })
      .reduce((a, b) => (b.distance < a.distance ? b : a));
    if (nearest.distance >= margin && insideFloor(p, setup.floor.polygon)) return p;
    const [nx, nz] = nearest.wall.normal;
    p = [nearest.onWall[0] + nx * margin, nearest.onWall[1] + nz * margin];
  }
  return p;
}
