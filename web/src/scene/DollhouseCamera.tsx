import { CameraControls, CameraControlsImpl } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { MathUtils, Plane, Raycaster, Vector2, Vector3 } from 'three';
import { useEditor } from '../state/store';
import { roomBounds } from './floorPlan';
import { CLICK_TOLERANCE_PX, isDrawn } from './objects';

/** How many times closer one mouse-wheel notch takes the camera: 5 go from the whole room to one chair. */
const ZOOM_PER_NOTCH = 1.8;
/** How far a notch scrolls in Chrome, Edge and Firefox on Windows and Linux, which report pixels. */
const NOTCH_PX = 100;
/** Safari and Chrome on a Mac report a notch as a multiple of this, where a trackpad's are rarely one. */
const MAC_NOTCH_PX = 4.000244140625;
/** Firefox reports a notch as 3 lines. */
const LINE_PX = NOTCH_PX / 3;
/** A trackpad pinch scrolls far less than a swipe, so it counts for more. */
const PINCH_GAIN = 2;
/** Wheel events further apart than this start a new zoom, which looks again at what is under the pointer. */
const GESTURE_GAP_MS = 200;
/**
 * How long the camera takes to catch up with the wheel, in seconds: most of the way in 2 of them.
 * camera-controls eases there with a critically damped spring, which never overshoots.
 */
const SMOOTH_TIME = 0.1;

/** How far the wheel event scrolled, in pixels, where a mouse-wheel notch is NOTCH_PX on every platform. */
function scrolledPx({ deltaY, deltaMode, ctrlKey }: WheelEvent) {
  if (deltaMode === WheelEvent.DOM_DELTA_LINE) return deltaY * LINE_PX;
  if (deltaMode === WheelEvent.DOM_DELTA_PAGE) return deltaY * NOTCH_PX * 3;
  if (deltaY !== 0 && deltaY % MAC_NOTCH_PX === 0) return (deltaY / MAC_NOTCH_PX) * NOTCH_PX;
  // Chrome reports a trackpad pinch as a wheel event with ctrlKey set.
  return ctrlKey ? deltaY * PINCH_GAIN : deltaY;
}

/**
 * An orbiting camera that looks down into the room from about 45° (spec §10.2). Its target stays
 * within 2 m of the room's box, and never below the floor. The camera itself can't: from inside
 * that box, a 45° view is too close to frame the room, so its distance is capped instead.
 *
 * The wheel, a trackpad swipe and a pinch all zoom toward what is under the pointer, which stays
 * under it.
 */
export function DollhouseCamera() {
  const setup = useEditor((s) => s.setup!);
  const controls = useRef<CameraControls>(null!);
  const room = useMemo(() => roomBounds(setup), [setup]);
  const distance = room.getSize(new Vector3()).setY(0).length() * 1.4;
  const boundary = useMemo(() => {
    const box = room.clone().expandByScalar(2);
    box.min.y = room.min.y;
    return box;
  }, [room]);
  const { gl, scene, camera } = useThree();
  const element = useThree((s) => (s.events.connected as HTMLElement | undefined) ?? s.gl.domElement);

  useEffect(() => {
    controls.current.setBoundary(boundary);
    const { x, z } = room.getCenter(new Vector3());
    const offset = distance * Math.SQRT1_2;
    void controls.current.setLookAt(x, 0.5 + offset, z + offset, x, 0.5, z, true);
  }, [room, boundary, distance]);

  useEffect(() => {
    const cameraControls = controls.current;
    const raycaster = new Raycaster();
    const pivot = new Vector3();
    const position = new Vector3();
    const target = new Vector3();
    const inside = new Vector3();
    let last = { time: -Infinity, x: 0, y: 0 };

    // What the pointer is on: the Scan or a Piece, else the floor, else (above the horizon) the target.
    const aimAt = (clientX: number, clientY: number) => {
      const { left, top, width, height } = gl.domElement.getBoundingClientRect();
      raycaster.setFromCamera(new Vector2(((clientX - left) / width) * 2 - 1, -((clientY - top) / height) * 2 + 1), camera);
      const supports = [scene.getObjectByName('scan'), scene.getObjectByName('pieces')].filter((object) => !!object);
      const hit = raycaster.intersectObjects(supports, true).find(isDrawn);
      if (hit) pivot.copy(hit.point);
      else if (!raycaster.ray.intersectPlane(new Plane(new Vector3(0, 1, 0), -room.min.y), pivot)) {
        cameraControls.getTarget(pivot, true);
      }
    };

    // The zoom scales the camera and its target about the point under the pointer, so that point
    // stays put on screen and the view keeps its direction.
    const onWheel = (event: WheelEvent) => {
      // A Piece drag turns the controls off; the wheel waits for it too.
      if (!cameraControls.enabled) return;
      event.preventDefault();
      const { timeStamp: time, clientX: x, clientY: y } = event;
      if (time - last.time > GESTURE_GAP_MS || Math.hypot(x - last.x, y - last.y) > CLICK_TOLERANCE_PX) aimAt(x, y);
      last = { time, x, y };

      cameraControls.getPosition(position, true);
      cameraControls.getTarget(target, true);
      const radius = position.distanceTo(target);
      const zoomed = radius * ZOOM_PER_NOTCH ** (scrolledPx(event) / NOTCH_PX);
      const scale = MathUtils.clamp(zoomed, cameraControls.minDistance, cameraControls.maxDistance) / radius;
      position.sub(pivot).multiplyScalar(scale).add(pivot);
      target.sub(pivot).multiplyScalar(scale).add(pivot);
      // Past the boundary, the camera slides back with its target, still looking the same way.
      position.add(boundary.clampPoint(target, inside).sub(target));
      target.add(inside);
      void cameraControls.setLookAt(position.x, position.y, position.z, target.x, target.y, target.z, true);
    };

    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [element, gl, scene, camera, room, boundary]);

  return (
    <CameraControls
      ref={controls}
      makeDefault
      minDistance={0.5}
      maxDistance={distance * 2}
      maxPolarAngle={Math.PI * 0.45}
      smoothTime={SMOOTH_TIME}
      // The wheel is handled above; a touch screen's pinch still zooms toward the fingers here.
      mouseButtons-wheel={CameraControlsImpl.ACTION.NONE}
      dollyToCursor
    />
  );
}
