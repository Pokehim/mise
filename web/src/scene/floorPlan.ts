import { Box3, Shape, ShapeGeometry, Vector2, Vector3 } from 'three';
import type { RoomSetup, Vec2, Wall } from '@shared/types';

/** The room as a box: its floor polygon, from the floor up to the ceiling. */
export function roomBounds(setup: RoomSetup) {
  const box = new Box3();
  for (const [x, z] of setup.floor.polygon) {
    box.expandByPoint(new Vector3(x, 0, z)).expandByPoint(new Vector3(x, setup.ceilingHeight, z));
  }
  return box;
}

/** The floor polygon as a flat geometry at y = 0, facing up. */
export function floorGeometry(setup: RoomSetup) {
  // The shape is drawn as (x, -z), so turning it flat puts it at (x, 0, z).
  return new ShapeGeometry(new Shape(setup.floor.polygon.map(([x, z]) => new Vector2(x, -z)))).rotateX(-Math.PI / 2);
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

export const wallLength = ({ start, end }: Wall) => Math.hypot(end[0] - start[0], end[1] - start[1]);

/** Where a floor point lands on a wall's line: how far along it from its start, and how far into the room. */
export function wallCoordinates([x, z]: Vec2, wall: Wall) {
  const [sx, sz] = wall.start;
  const length = wallLength(wall);
  const along = ((x - sx) * (wall.end[0] - sx) + (z - sz) * (wall.end[1] - sz)) / length;
  const into = (x - sx) * wall.normal[0] + (z - sz) * wall.normal[1];
  return { along, into, length };
}

/** The floor point `along` a wall from its start and `into` the room from it. */
export function wallPoint(wall: Wall, along: number, into: number): Vec2 {
  const [sx, sz] = wall.start;
  const length = wallLength(wall);
  return [
    sx + ((wall.end[0] - sx) * along) / length + wall.normal[0] * into,
    sz + ((wall.end[1] - sz) * along) / length + wall.normal[1] * into,
  ];
}

/** The wall nearest a floor point, the nearest point on it, and how far away that is. */
export function nearestWall(point: Vec2, walls: Wall[]) {
  return walls
    .map((wall) => {
      const { along, length } = wallCoordinates(point, wall);
      const onWall = wallPoint(wall, Math.min(Math.max(along, 0), length), 0);
      return { wall, onWall, distance: Math.hypot(point[0] - onWall[0], point[1] - onWall[1]) };
    })
    .reduce((a, b) => (b.distance < a.distance ? b : a));
}

/** The nearest floor point at least `margin` inside every wall: the point itself when it already is. */
export function keepInside(point: Vec2, setup: RoomSetup, margin: number): Vec2 {
  let p = point;
  // A point pushed off one wall can land too close to the next one in a corner, so repeat.
  for (let i = 0; i < 3; i++) {
    const { wall, onWall, distance } = nearestWall(p, setup.walls);
    if (distance >= margin && insideFloor(p, setup.floor.polygon)) return p;
    p = [onWall[0] + wall.normal[0] * margin, onWall[1] + wall.normal[1] * margin];
  }
  return p;
}

/** Whether a wall's inside faces a point, such as the camera: the walls the Dollhouse view shows. */
export const faces = ({ start, normal }: Wall, [x, z]: Vec2) => (x - start[0]) * normal[0] + (z - start[1]) * normal[1] >= 0;
