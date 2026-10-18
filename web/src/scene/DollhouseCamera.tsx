import { CameraControls, CameraControlsImpl } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { MathUtils, PerspectiveCamera, Plane, Raycaster, Spherical, Vector2, Vector3 } from 'three';
import type { Vec3 } from '@shared/types';
import { useEditor } from '../state/store';
import { ControlsHint, hideControlsHint } from './ControlsHint';
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
 * How long the camera takes to catch up with the wheel or a drag, in seconds: most of the way in 2 of
 * them. camera-controls eases there with a critically damped spring, which never overshoots.
 */
const SMOOTH_TIME = 0.1;
/** A move drag let go while moving glides on as far as it would have gone in this long, in ms. */
const GLIDE_MS = 200;
/** How far back a let-go drag looks for its speed, in ms; a pointer held still this long doesn't glide. */
const GLIDE_WINDOW_MS = 80;
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
 * under it. Dragging turns the view around the room's center, wherever the zoom and the drags
 * have taken it. Shift+drag or a right-drag moves it across the room like a map, keeping the
 * grabbed point under the pointer. The press decides which: Shift pressed or let go mid-drag
 * changes nothing.
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

  // The controls hint, over the view. Not in a ?shot= view, which is a picture of the room.
  useEffect(() => {
    if (start) return;
    const host = document.createElement('div');
    element.append(host);
    const root = createRoot(host);
    root.render(<ControlsHint />);
    // After this render: a root can't unmount while React renders.
    return () => void setTimeout(() => {
      root.unmount();
      host.remove();
    });
  }, [element, start]);

  useEffect(() => {
    const cameraControls = controls.current;
    const raycaster = new Raycaster();
    const pivot = new Vector3();
    const target = new Vector3();
    const under = new Vector3();
    const center = room.getCenter(new Vector3());
    const floor = new Plane(UP, -room.min.y);
    // Where the camera is going, rather than where it is this frame: a move drag aims from it, so
    // pointer events between two frames, or while the view eases, don't count a move twice.
    const goal = new PerspectiveCamera();
    let last = { time: -Infinity, x: 0, y: 0 };
    let drag: {
      pointerId: number; x: number; y: number; downX: number; downY: number;
      // A move drag holds the grabbed point on the plane through it; a turn drag has none.
      grabbed: { point: Vector3; plane: Plane } | null; turn: boolean;
      // Where a move drag has sent the target lately, for the glide when it is let go.
      trail: { time: number; x: number; z: number }[];
    } | null = null;

    const aimFrom = (clientX: number, clientY: number, from = camera) => {
      const { left, top, width, height } = gl.domElement.getBoundingClientRect();
      raycaster.setFromCamera(new Vector2(((clientX - left) / width) * 2 - 1, -((clientY - top) / height) * 2 + 1), from);
    };
    const toGoal = () => {
      goal.copy(camera as PerspectiveCamera, false);
      cameraControls.getPosition(goal.position, true);
      goal.lookAt(cameraControls.getTarget(target, true));
      goal.updateMatrixWorld();
      return goal;
    };
    // What the ray is on: the Scan or a Piece, else the floor.
    const hitOf = () => {
      const supports = [scene.getObjectByName('scan'), scene.getObjectByName('pieces')].filter((object) => !!object);
      return raycaster.intersectObjects(supports, true).find(isDrawn)?.point
        ?? raycaster.ray.intersectPlane(floor, new Vector3());
    };

    // What the pointer is on, else (above the horizon) the target.
    const aimAt = (clientX: number, clientY: number) => {
      aimFrom(clientX, clientY);
      const hit = hitOf();
      if (hit) pivot.copy(hit);
      else cameraControls.getTarget(pivot, true);
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

    const endDrag = () => {
      drag = null;
      element.dataset.dollhouse = 'idle';
    };

    // A move drag moves the camera and its target together across the room, so the grabbed point,
    // on the Scan, a Piece or the floor, stays under the pointer: the target goes as far as the
    // point under the pointer would have, the other way. It holds that point's height, and from
    // above the horizon there is nothing to grab.
    //
    // A turn drag turns the camera and its target together about the vertical line through the
    // room's center, so the camera circles the room even when zoomed in on a corner of it. Tilting
    // stays about the target.
    //
    // One pointer only: two fingers pinch and move in camera-controls.
    const onPointerDown = (event: PointerEvent) => {
      // A second finger isn't primary, and hands the gesture over.
      const move = event.button === 2 || (event.button === 0 && event.shiftKey);
      const turn = event.button === 0 && !event.shiftKey;
      if (!event.isPrimary || !(turn || move) || !cameraControls.enabled) return endDrag();
      const { clientX: x, clientY: y } = event;
      let grabbed = null;
      if (!turn) {
        aimFrom(x, y, toGoal());
        // Not above the camera, where the ray from it would never meet that point's level again.
        const point = hitOf();
        if (point && point.y < goal.position.y - 0.1) grabbed = { point, plane: new Plane(UP, -point.y) };
      }
      drag = { pointerId: event.pointerId, x, y, downX: x, downY: y, grabbed, turn, trail: [] };
      element.dataset.dollhouse = 'moving';
    };
    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerId !== drag?.pointerId) return;
      // A Piece drag can start on this same press, and turns the controls off.
      if (!cameraControls.enabled) return endDrag();
      if (Math.hypot(event.clientX - drag.downX, event.clientY - drag.downY) > CLICK_TOLERANCE_PX) hideControlsHint();
      if (!drag.turn) {
        const { grabbed } = drag;
        if (!grabbed) return;
        aimFrom(event.clientX, event.clientY, toGoal());
        if (!raycaster.ray.intersectPlane(grabbed.plane, under)) return;
        // Eased like the zoom, so uneven pointer events don't jerk the view; it catches up within
        // a few frames. The boundary stops the target, and from there the grabbed point slips.
        cameraControls.getTarget(target, true).add(grabbed.point).sub(under);
        void cameraControls.moveTo(target.x, target.y, target.z, true);
        cameraControls.getTarget(target, true);
        drag.trail = [...drag.trail.filter(({ time }) => event.timeStamp - time <= GLIDE_WINDOW_MS), { time: event.timeStamp, x: target.x, z: target.z }];
        return;
      }
      const { height } = gl.domElement.getBoundingClientRect();
      // As camera-controls turns: a drag the view's height long is a full turn.
      const azimuth = (-2 * Math.PI * (event.clientX - drag.x)) / height;
      const polar = (-2 * Math.PI * (event.clientY - drag.y)) / height;
      drag = { ...drag, x: event.clientX, y: event.clientY };
      cameraControls.getTarget(target, true).sub(center).applyAxisAngle(UP, azimuth).add(center);
      void cameraControls.moveTo(target.x, target.y, target.z, true);
      void cameraControls.rotate(azimuth, polar, true);
    };
    // Let go while moving, a move drag glides on and eases to a stop, like a map.
    const onPointerUp = (event: PointerEvent) => {
      if (event.pointerId !== drag?.pointerId) return;
      const [first, last] = [drag.trail[0], drag.trail.at(-1)];
      if (first && last && last.time > first.time && event.timeStamp - last.time <= GLIDE_WINDOW_MS) {
        const glide = GLIDE_MS / (last.time - first.time);
        cameraControls.getTarget(target, true);
        void cameraControls.moveTo(target.x + (last.x - first.x) * glide, target.y, target.z + (last.z - first.z) * glide, true);
      }
      endDrag();
    };
    const onPointerCancel = (event: PointerEvent) => {
      if (event.pointerId === drag?.pointerId) endDrag();
    };
    // The right button moves the view, so it opens no menu.
    const onContextMenu = (event: MouseEvent) => event.preventDefault();

    element.dataset.dollhouse = 'idle';

    element.addEventListener('wheel', onWheel, { passive: false });
    element.addEventListener('pointerdown', onPointerDown);
    element.addEventListener('contextmenu', onContextMenu);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
    return () => {
      element.removeEventListener('wheel', onWheel);
      element.removeEventListener('pointerdown', onPointerDown);
      element.removeEventListener('contextmenu', onContextMenu);
      delete element.dataset.dollhouse;
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
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
      // The wheel and one-pointer drags are handled above; on a touch screen, two fingers still
      // pinch toward the fingers here, and move the view across the room, since one finger now
      // turns it. Screen pan keeps that move level: up the screen goes forward, not up.
      mouseButtons-wheel={CameraControlsImpl.ACTION.NONE}
      mouseButtons-left={CameraControlsImpl.ACTION.NONE}
      mouseButtons-right={CameraControlsImpl.ACTION.NONE}
      touches-one={CameraControlsImpl.ACTION.NONE}
      touches-two={CameraControlsImpl.ACTION.TOUCH_DOLLY_SCREEN_PAN}
      dollyToCursor
    />
  );
}
