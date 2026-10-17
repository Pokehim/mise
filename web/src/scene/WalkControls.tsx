import { type ThreeEvent, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { Euler, EventDispatcher, MathUtils, Vector3 } from 'three';
import { useEditor } from '../state/store';
import { floorGeometry, keepInside } from './floorPlan';
import { CLICK_TOLERANCE_PX } from './objects';
import { viewCenterOnFloor } from './placement';

const EYE_HEIGHT = 1.6;
const GLIDE_SECONDS = 0.4;
const LOOK_RADIANS_PER_PX = 0.004;
const WALL_MARGIN = 0.25;   // keeps the eye out of the walls
const STEP_BACK = 1.5;      // how far behind the view center the Walk view starts
const START_PITCH = -0.25;  // looking slightly down, so the floor and furniture are in view

const easeInOut = (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);

interface Glide { from: Vector3; to: Vector3; elapsed: number; pitch?: [from: number, to: number] }

/**
 * The Walk view (spec §10.2): the camera at eye height inside the room. Drag to look around;
 * click the floor to glide there in 400 ms, staying inside the floor polygon.
 */
export function WalkControls() {
  const setup = useEditor((s) => s.setup!);
  const camera = useThree((s) => s.camera);
  const canvas = useThree((s) => s.gl.domElement);
  const setThree = useThree((s) => s.set);
  const look = useRef({ yaw: 0, pitch: 0 });
  const glide = useRef<Glide | null>(null);
  const floor = useMemo(() => floorGeometry(setup), [setup]);

  const glideTo = (x: number, z: number, pitch?: number) => {
    const [ix, iz] = keepInside([x, z], setup, WALL_MARGIN);
    glide.current = {
      from: camera.position.clone(),
      to: new Vector3(ix, EYE_HEIGHT, iz),
      elapsed: 0,
      pitch: pitch === undefined ? undefined : [look.current.pitch, pitch],
    };
  };

  // Step down in front of where the view was centered, facing the same way.
  useLayoutEffect(() => {
    const { x: pitch, y: yaw } = new Euler().setFromQuaternion(camera.quaternion, 'YXZ');
    look.current = { yaw, pitch };
    const [x, z] = viewCenterOnFloor(camera);
    // The camera looks along (-sin yaw, -cos yaw), so step back the other way.
    glideTo(x + Math.sin(yaw) * STEP_BACK, z + Math.cos(yaw) * STEP_BACK, START_PITCH);
  }, []);   // only when the Walk view opens

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
      look.current.pitch = MathUtils.clamp(look.current.pitch + (e.clientY - last.y) * LOOK_RADIANS_PER_PX, -1.2, 1.2);
      last = { x: e.clientX, y: e.clientY };
    };
    const onUp = () => (last = null);
    canvas.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      canvas.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [canvas, controls]);

  useFrame((_, delta) => {
    const current = glide.current;
    if (current) {
      current.elapsed = Math.min(current.elapsed + delta, GLIDE_SECONDS);
      const t = easeInOut(current.elapsed / GLIDE_SECONDS);
      camera.position.lerpVectors(current.from, current.to, t);
      if (current.pitch) look.current.pitch = MathUtils.lerp(current.pitch[0], current.pitch[1], t);
      if (current.elapsed === GLIDE_SECONDS) glide.current = null;
    }
    camera.rotation.set(look.current.pitch, look.current.yaw, 0, 'YXZ');
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
