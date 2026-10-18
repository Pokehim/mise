import { CameraControls, CameraControlsImpl } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { MathUtils, type PerspectiveCamera, Plane, Raycaster, Spherical, Vector2, Vector3 } from 'three';
import type { Vec3 } from '@shared/types';
import { useEditor } from '../state/store';
import { roomBounds } from './floorPlan';
import { CLICK_TOLERANCE_PX, isDrawn } from './objects';
import type { Shot } from './shots';

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
const UP = new Vector3(0, 1, 0);

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
 * under it. Dragging turns the view around the room's center, wherever the zoom has taken it.
 *
 * Nothing here sets the camera's azimuth from a position (setLookAt does), since that gives an
 * angle within ±180° while the camera's own adds up as it turns: smoothing from one to the other
 * spins the camera through every turn between them.
 */
export function DollhouseCamera({ start }: { start?: Shot }) {
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
    const cameraControls = controls.current;
    cameraControls.setBoundary(boundary);
    const { x, z } = room.getCenter(new Vector3());
    if (start?.pose || start?.topDown) {
      // A shot (?shot=): there at once, by turn, tilt and distance about its target. Without easing,
      // there are no turns in between to spin through.
      const target: Vec3 = start.pose?.target ?? [x, 0, z];
      let position = start.pose?.position ?? target;
      if (start.topDown) {
        // High enough that the floor fits the view, with its long side across. The small offset sets which way is up.
        const { x: width, z: depth } = room.getSize(new Vector3());
        const [long, short] = [Math.max(width, depth), Math.min(width, depth)];
        const { fov, aspect } = camera as PerspectiveCamera;
        const tan = Math.tan(MathUtils.degToRad(fov / 2));
        const height = 1.08 * Math.max(long / 2 / (tan * aspect), short / 2 / tan);
        position = depth > width ? [x + 0.001, height, z] : [x, height, z + 0.001];
      }
      const { radius, theta, phi } = new Spherical().setFromVector3(new Vector3(...position).sub(new Vector3(...target)));
      void cameraControls.rotateTo(theta, phi, false);
      void cameraControls.moveTo(...target, false);
      void cameraControls.dollyTo(radius, false);
      return;
    }
    // From the south, at the turn nearest the camera's.
    void cameraControls.rotateTo(Math.round(cameraControls.azimuthAngle / (2 * Math.PI)) * 2 * Math.PI, Math.PI / 4, true);
    void cameraControls.moveTo(x, 0.5, z, true);
    void cameraControls.dollyTo(distance, true);
  }, [room, boundary, distance, start, camera]);

  useEffect(() => {
    const cameraControls = controls.current;
    const raycaster = new Raycaster();
    const pivot = new Vector3();
    const target = new Vector3();
    const center = room.getCenter(new Vector3());
    let last = { time: -Infinity, x: 0, y: 0 };
    let drag: { pointerId: number; x: number; y: number } | null = null;

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

    // The zoom scales the camera's distance, and its target about the point under the pointer: the
    // camera keeps its angles, so the view keeps its direction and that point stays put on screen.
    // Past the boundary, the camera slides back with its target, still looking the same way.
    const onWheel = (event: WheelEvent) => {
      // A Piece drag turns the controls off; the wheel waits for it too.
      if (!cameraControls.enabled) return;
      event.preventDefault();
      const { timeStamp: time, clientX: x, clientY: y } = event;
      if (time - last.time > GESTURE_GAP_MS || Math.hypot(x - last.x, y - last.y) > CLICK_TOLERANCE_PX) aimAt(x, y);
      last = { time, x, y };

      const radius = cameraControls.getSpherical(new Spherical(), true).radius;
      const zoomed = MathUtils.clamp(radius * ZOOM_PER_NOTCH ** (scrolledPx(event) / NOTCH_PX), cameraControls.minDistance, cameraControls.maxDistance);
      cameraControls.getTarget(target, true).sub(pivot).multiplyScalar(zoomed / radius).add(pivot);
      void cameraControls.moveTo(target.x, target.y, target.z, true);
      void cameraControls.dollyTo(zoomed, true);
    };

    // A drag turns the camera and its target together about the vertical line through the room's
    // center, so the camera circles the room even when zoomed in on a corner of it. Tilting stays
    // about the target. One pointer only: two fingers pinch and pan in camera-controls.
    const onPointerDown = (event: PointerEvent) => {
      // A second finger isn't primary, and hands the gesture over.
      drag = event.isPrimary && event.button === 0 && cameraControls.enabled
        ? { pointerId: event.pointerId, x: event.clientX, y: event.clientY }
        : null;
    };
    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerId !== drag?.pointerId) return;
      // A Piece drag can start on this same press, and turns the controls off.
      if (!cameraControls.enabled) return void (drag = null);
      const { height } = gl.domElement.getBoundingClientRect();
      // As camera-controls turns: a drag the view's height long is a full turn.
      const azimuth = (-2 * Math.PI * (event.clientX - drag.x)) / height;
      const polar = (-2 * Math.PI * (event.clientY - drag.y)) / height;
      drag = { ...drag, x: event.clientX, y: event.clientY };
      cameraControls.getTarget(target, true).sub(center).applyAxisAngle(UP, azimuth).add(center);
      void cameraControls.moveTo(target.x, target.y, target.z, true);
      void cameraControls.rotate(azimuth, polar, true);
    };
    const onPointerUp = (event: PointerEvent) => {
      if (event.pointerId === drag?.pointerId) drag = null;
    };

    element.addEventListener('wheel', onWheel, { passive: false });
    element.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    return () => {
      element.removeEventListener('wheel', onWheel);
      element.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    };
  }, [element, gl, scene, camera, room]);

  return (
    <CameraControls
      ref={controls}
      makeDefault
      minDistance={0.5}
      maxDistance={distance * 2}
      maxPolarAngle={Math.PI * 0.45}
      smoothTime={SMOOTH_TIME}
      // The wheel and a one-pointer drag are handled above; a touch screen's pinch still zooms
      // toward the fingers here.
      mouseButtons-wheel={CameraControlsImpl.ACTION.NONE}
      mouseButtons-left={CameraControlsImpl.ACTION.NONE}
      touches-one={CameraControlsImpl.ACTION.NONE}
      dollyToCursor
    />
  );
}
