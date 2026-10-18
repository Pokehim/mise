import { type ThreeEvent, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { Euler, EventDispatcher, MathUtils, Vector3 } from 'three';
import { create } from 'zustand';
import { useEditor } from '../state/store';
import { NOTCH_PX, scrolledPx } from './DollhouseCamera';
import { floorGeometry, keepInside, roomBounds } from './floorPlan';
import { CLICK_TOLERANCE_PX } from './objects';
import { floorPointInView } from './placement';
import type { Shot } from './shots';

const EYE_HEIGHT = 1.6;
const GLIDE_SECONDS = 0.4;
const LOOK_RADIANS_PER_PX = 0.004;
const PITCH_LIMIT = 1.2;
const WALL_MARGIN = 0.25;   // keeps the eye out of the walls
const STEP_BACK = 1.5;      // how far behind the view center the Walk view starts
const START_PITCH = -0.25;  // looking slightly down, so the floor and furniture are in view
/** Mouse-wheel notches from eye height up to the bird's-eye view. */
const RISE_NOTCHES = 6;
/** How far down the bird's-eye view looks, at the top of the rise. */
const BIRD_PITCH = -1;
/** How quickly the camera catches up with the wheel: most of the way in 0.1 s. */
const RISE_DAMPING = 20;
/** Walking speed at eye height, in m/s; it triples at the top of the rise, where the room looks smaller. */
const WALK_SPEED = 1.4;
/** The lowest the camera goes, however far up it looks while raised. */
const MIN_HEIGHT = 0.2;
/** Where the ceiling is cut, below the ceiling itself, as in the Dollhouse view. */
const CEILING_CUT = 0.05;

/** Keys that walk, by position on the keyboard (so WASD works on any layout), as [forward, right]. */
const STEPS: Record<string, [number, number]> = {
  KeyW: [1, 0], ArrowUp: [1, 0],
  KeyS: [-1, 0], ArrowDown: [-1, 0],
  KeyA: [0, -1], ArrowLeft: [0, -1],
  KeyD: [0, 1], ArrowRight: [0, 1],
};

const easeInOut = (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);

interface Glide { from: Vector3; to: Vector3; elapsed: number; pitch?: [from: number, to: number] }

/** Whether the Walk view's camera has risen through the ceiling, which is then cut away as in the Dollhouse view. */
export const useWalkOverhead = create<{ overhead: boolean }>(() => ({ overhead: false }));

/** The height where the ceiling is cut, or null where it is drawn. */
export function useCeilingCut(): number | null {
  const dollhouse = useEditor((s) => s.view === 'dollhouse');
  const overhead = useWalkOverhead((s) => s.overhead);
  const ceilingHeight = useEditor((s) => s.setup!.ceilingHeight);
  return dollhouse || overhead ? ceilingHeight - CEILING_CUT : null;
}

/**
 * The Walk view (spec §10.2): the camera at eye height inside the room. Drag to look around;
 * click the floor to glide there in 400 ms, staying inside the floor polygon. WASD or the arrow
 * keys walk, and slide along the walls.
 *
 * Scrolling out raises the camera behind and above where the Mover stands, tilting it down as it
 * goes, up to a bird's-eye view of the whole room; scrolling back in brings it down to eye height.
 * Raised, the camera turns about where they stand, and still walks and glides.
 */
export function WalkControls({ start }: { start?: Shot['pose'] }) {
  const setup = useEditor((s) => s.setup!);
  const camera = useThree((s) => s.camera);
  const canvas = useThree((s) => s.gl.domElement);
  const setThree = useThree((s) => s.set);
  const look = useRef({ yaw: 0, pitch: 0 });
  /** Where the Mover stands, at eye height: the camera, until it rises. */
  const stand = useRef(new Vector3());
  /** How far up the rise the camera is, and is going, from 0 (eye height) to 1 (the bird's-eye view). */
  const rise = useRef({ now: 0, to: 0 });
  const walking = useRef(new Set<string>());
  const glide = useRef<Glide | null>(null);
  const floor = useMemo(() => floorGeometry(setup), [setup]);
  // At the top of the rise, the camera is this far back from where the Mover stands.
  const reach = useMemo(() => Math.max(4, roomBounds(setup).getSize(new Vector3()).setY(0).length() * 1.2), [setup]);

  const glideTo = (x: number, z: number, pitch?: number) => {
    const [ix, iz] = keepInside([x, z], setup, WALL_MARGIN);
    glide.current = {
      from: stand.current.clone(),
      to: new Vector3(ix, EYE_HEIGHT, iz),
      elapsed: 0,
      pitch: pitch === undefined ? undefined : [look.current.pitch, pitch],
    };
  };

  // Step down in front of where the view was centered, facing the same way; or stand where a shot says.
  useLayoutEffect(() => {
    if (start) {
      const [[x, y, z], [tx, ty, tz]] = [start.position, start.target];
      stand.current.set(x, y, z);
      // The camera looks along (-sin yaw, -cos yaw).
      look.current = { yaw: Math.atan2(x - tx, z - tz), pitch: Math.atan2(ty - y, Math.hypot(tx - x, tz - z)) };
      return;
    }
    const { x: pitch, y: yaw } = new Euler().setFromQuaternion(camera.quaternion, 'YXZ');
    look.current = { yaw, pitch };
    stand.current.copy(camera.position);
    const [x, z] = floorPointInView(camera);
    // The camera looks along (-sin yaw, -cos yaw), so step back the other way.
    glideTo(x + Math.sin(yaw) * STEP_BACK, z + Math.cos(yaw) * STEP_BACK, START_PITCH);
  }, []);   // only when the Walk view opens

  useEffect(() => () => useWalkOverhead.setState({ overhead: false }), []);

  // Like the Dollhouse view's CameraControls, these are the scene's controls, which a Piece drag
  // turns off while it has the pointer.
  const controls = useMemo(() => Object.assign(new EventDispatcher(), { enabled: true }), []);
  useEffect(() => {
    setThree({ controls });
    return () => setThree({ controls: null });
  }, [controls, setThree]);

  useEffect(() => {
    let last: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => {
      if (e.button === 0) last = { x: e.clientX, y: e.clientY };
    };
    const onMove = (e: PointerEvent) => {
      if (!last || !controls.enabled) return;
      // Dragging grabs the view: drag right to turn left, drag down to look up.
      look.current.yaw += (e.clientX - last.x) * LOOK_RADIANS_PER_PX;
      look.current.pitch = MathUtils.clamp(look.current.pitch + (e.clientY - last.y) * LOOK_RADIANS_PER_PX, -PITCH_LIMIT, PITCH_LIMIT);
      last = { x: e.clientX, y: e.clientY };
    };
    const onUp = () => (last = null);
    // Scrolling out (down) raises the camera, and in brings it back down. A Piece drag waits for it.
    const onWheel = (e: WheelEvent) => {
      if (!controls.enabled) return;
      e.preventDefault();
      const r = rise.current;
      r.to = MathUtils.clamp(r.to + scrolledPx(e) / NOTCH_PX / RISE_NOTCHES, 0, 1);
    };
    canvas.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      canvas.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('wheel', onWheel);
    };
  }, [canvas, controls]);

  useEffect(() => {
    const held = walking.current;
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.code in STEPS) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable]')) return;
      e.preventDefault();
      held.add(e.code);
    };
    const onKeyUp = (e: KeyboardEvent) => held.delete(e.code);
    // A key let go in another window never comes up here.
    const onBlur = () => held.clear();
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      held.clear();
    };
  }, []);

  useFrame((_, delta) => {
    const current = glide.current;
    if (current) {
      current.elapsed = Math.min(current.elapsed + delta, GLIDE_SECONDS);
      const t = easeInOut(current.elapsed / GLIDE_SECONDS);
      stand.current.lerpVectors(current.from, current.to, t);
      if (current.pitch) look.current.pitch = MathUtils.lerp(current.pitch[0], current.pitch[1], t);
      if (current.elapsed === GLIDE_SECONDS) glide.current = null;
    }

    const { yaw } = look.current;
    let [forward, right] = [0, 0];
    for (const code of walking.current) {
      forward += STEPS[code][0];
      right += STEPS[code][1];
    }
    if ((forward || right) && controls.enabled) {
      glide.current = null;
      const step = (WALK_SPEED * (1 + 2 * rise.current.now) * delta) / Math.hypot(forward, right);
      // The camera looks along (-sin yaw, -cos yaw), and its right is (cos yaw, -sin yaw).
      const x = stand.current.x + (-Math.sin(yaw) * forward + Math.cos(yaw) * right) * step;
      const z = stand.current.z + (-Math.cos(yaw) * forward - Math.sin(yaw) * right) * step;
      const [ix, iz] = keepInside([x, z], setup, WALL_MARGIN);
      stand.current.setX(ix).setZ(iz);
    }

    // The rise eases toward the wheel's level, tilting down toward the bird's-eye view on the way
    // up and back toward eye level on the way down, in step with how far it went.
    const r = rise.current;
    if (r.now !== r.to) {
      const next = Math.abs(r.to - r.now) < 1e-4 ? r.to : MathUtils.damp(r.now, r.to, RISE_DAMPING, delta);
      const [toward, left] = next > r.now ? [BIRD_PITCH, 1 - r.now] : [START_PITCH, r.now];
      look.current.pitch += ((toward - look.current.pitch) * Math.abs(next - r.now)) / left;
      r.now = next;
    }

    // Raised, the camera sits back along its view from where the Mover stands, never below MIN_HEIGHT.
    const back = r.now * reach;
    if (back > 0) {
      const highest = Math.asin(MathUtils.clamp((stand.current.y - MIN_HEIGHT) / back, -1, 1));
      look.current.pitch = Math.min(look.current.pitch, highest);
    }
    const { pitch } = look.current;
    camera.rotation.set(pitch, yaw, 0, 'YXZ');
    camera.position.set(
      stand.current.x + Math.sin(yaw) * Math.cos(pitch) * back,
      stand.current.y - Math.sin(pitch) * back,
      stand.current.z + Math.cos(yaw) * Math.cos(pitch) * back,
    );

    const overhead = camera.position.y > setup.ceilingHeight - CEILING_CUT;
    if (overhead !== useWalkOverhead.getState().overhead) useWalkOverhead.setState({ overhead });
  });

  // Clicks on the floor that nothing else took, such as a Piece or an Original.
  const onFloorClick = (event: ThreeEvent<MouseEvent>) => {
    if (event.delta <= CLICK_TOLERANCE_PX) glideTo(event.point.x, event.point.z);
  };
  return (
    <mesh geometry={floor} position-y={0.001} onClick={onFloorClick}>
      <meshBasicMaterial visible={false} />
    </mesh>
  );
}
