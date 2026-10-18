import { Box3, MathUtils, Shape, ShapeGeometry, Vector2, Vector3 } from 'three';
import { distanceToWall, pointInPolygon, wallPoint } from '@shared/geometry';
import type { Opening, RoomSetup, Vec2, Wall } from '@shared/types';

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

export const wallLength = ({ start, end }: Wall) => Math.hypot(end[0] - start[0], end[1] - start[1]);

/** The rotationY that turns something's front (+Z) away from a wall, into the room. */
export const wallRotationY = ({ normal }: Wall) => Math.atan2(normal[0], normal[1]);

/** The center of an Opening in its wall, or `out` meters from the wall into the room. */
export function openingCenter(opening: Opening, wall: Wall, out = 0) {
  const [x, z] = wallPoint(wall, opening.offset + opening.width / 2, out);
  return new Vector3(x, opening.bottom + opening.height / 2, z);
}

/** Where a floor point lands on a wall's line: how far along it from its start, and how far into the room. */
export function wallCoordinates([x, z]: Vec2, wall: Wall) {
  const [sx, sz] = wall.start;
  const length = wallLength(wall);
  const along = ((x - sx) * (wall.end[0] - sx) + (z - sz) * (wall.end[1] - sz)) / length;
  return { along, into: distanceToWall([x, z], wall), length };
}

/** The wall nearest a floor point, the nearest point on it, and how far away that is. */
export function nearestWall(point: Vec2, walls: Wall[]) {
  return walls
    .map((wall) => {
      const { along, length } = wallCoordinates(point, wall);
      const onWall = wallPoint(wall, MathUtils.clamp(along, 0, length), 0);
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
    if (distance >= margin && pointInPolygon(p, setup.floor.polygon)) return p;
    p = [onWall[0] + wall.normal[0] * margin, onWall[1] + wall.normal[1] * margin];
  }
  return p;
}

/**
 * The middle of the room, on the floor: the center of its bounds, or, when that is off the floor
 * (in an L-shaped room), the nearest floor point to it, half a meter from the walls.
 */
export function roomCenter(setup: RoomSetup): Vec2 {
  const { x, z } = roomBounds(setup).getCenter(new Vector3());
  return keepInside([x, z], setup, 0.5);
}

/** Whether a wall's inside faces a point, such as the camera: the walls the Dollhouse view shows. */
export const faces = (wall: Wall, point: Vec2) => distanceToWall(point, wall) >= 0;
