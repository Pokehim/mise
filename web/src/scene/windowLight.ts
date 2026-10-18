import { DirectionalLight, Vector3 } from 'three';
import type { Opening, RoomSetup } from '@shared/types';
import { openingCenter, roomBounds } from './floorPlan';

const SHADOW_MAP_SIZE = 2048;
/** How far a shadow's edge blurs, in shadow-map pixels. */
const SHADOW_SOFTNESS = 4;
const WINDOW_LIGHT_INTENSITY = 1.5;

const area = ({ width, height }: Opening) => width * height;

/** The center of the largest window, in the room frame, or null when the room has none. */
function largestWindowCenter(setup: RoomSetup): Vector3 | null {
  const windows = setup.openings.filter(({ kind }) => kind === 'window');
  if (!windows.length) return null;
  const largest = windows.reduce((a, b) => (area(b) > area(a) ? b : a));
  const wall = setup.walls.find(({ id }) => id === largest.wallId);
  return wall ? openingCenter(largest, wall) : null;
}

/**
 * The Max level's light (spec §12): a directional light from the largest window, aimed at the room's
 * center on the floor, casting shadows. Its shadow camera is fitted to the room's bounds. A room
 * without a window gets it from the ceiling.
 */
export function windowLight(setup: RoomSetup): DirectionalLight {
  const bounds = roomBounds(setup);
  const center = bounds.getCenter(new Vector3()).setY(0);
  const from = largestWindowCenter(setup) ?? center.clone().setY(setup.ceilingHeight);
  const light = new DirectionalLight('#ffffff', WINDOW_LIGHT_INTENSITY);
  light.target.position.copy(center);
  // Back along the same line, far enough that the whole room is in front of the shadow camera.
  light.position.copy(from).sub(center).setLength(bounds.getSize(new Vector3()).length()).add(center);
  light.castShadow = true;
  light.shadow.mapSize.setScalar(SHADOW_MAP_SIZE);
  light.shadow.radius = SHADOW_SOFTNESS;

  // The shadow camera looks from the light to its target, as three.js aims it every frame.
  const camera = light.shadow.camera;
  camera.position.copy(light.position);
  camera.lookAt(center);
  camera.updateMatrixWorld();
  const inView = bounds.clone().applyMatrix4(camera.matrixWorldInverse);   // the room's bounds, as the camera sees them
  Object.assign(camera, {
    left: inView.min.x, right: inView.max.x, bottom: inView.min.y, top: inView.max.y,
    // The camera looks down its -z.
    near: -inView.max.z, far: -inView.min.z,
  });
  camera.updateProjectionMatrix();
  return light;
}
