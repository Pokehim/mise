import { Edges, Hud, useCursor } from '@react-three/drei';
import { type ThreeEvent, useThree } from '@react-three/fiber';
import { useState } from 'react';
import { Plane, type Ray, Raycaster, Vector2, Vector3 } from 'three';
import { create } from 'zustand';
import type { Vec2, Vec3 } from '@shared/types';
import { useEditor } from '../state/store';
import { ignoreRaycast } from './objects';
import { type SwapTarget, swapPlacement, targetBox } from './swapResize';

/** The Resize the Mover is doing (spec §10.5): what is being resized, and the box they are drawing. */
export interface ResizeSession {
  target: SwapTarget;
  /** [width, height, depth] in meters. The handles set the width and depth; the height stays the target's. */
  size: Vec3;
}

/** The Resize in progress, shared by the Inspector's Resize panel and the handles in the view. */
export const useResize = create<{ session: ResizeSession | null }>(() => ({ session: null }));

/** The smallest width or depth the handles draw, in meters. */
const MIN_SIZE = 0.1;
const HANDLE_RADIUS = 0.06;
/** How far, in meters, a handle's center sits out from its face, so it isn't buried in the item. */
const HANDLE_OUT = 0.05;
const COLOR = '#1f7a6d';

/** A face handle: one on each side pulls the width out on both sides (the center stays); the front one pulls the depth (the back stays). */
type Handle = { axis: 0; side: 1 | -1 } | { axis: 2; side: 1 };
const HANDLES: Handle[] = [{ axis: 0, side: 1 }, { axis: 0, side: -1 }, { axis: 2, side: 1 }];

/** How far along a direction on the floor a ray's hit on the plane at height y lies, or null if it misses the plane. */
function distanceAlong(ray: Ray, y: number, direction: Vec2): number | null {
  const hit = ray.intersectPlane(new Plane(new Vector3(0, 1, 0), -y), new Vector3());
  return hit && hit.x * direction[0] + hit.z * direction[1];
}

/** The Resize box and its handles while a Resize is in progress (spec §10.5). */
export function ResizeHandles() {
  const session = useResize((s) => s.session);
  return session && <ResizeBox session={session} />;
}

/**
 * The size being drawn, as a see-through box standing where the new item will (its back-center
 * kept), with face handles for its width and depth. It is drawn over the scene, and its handles
 * catch the pointer before anything behind them.
 */
function ResizeBox({ session }: { session: ResizeSession }) {
  const setup = useEditor((s) => s.setup!);
  const catalog = useEditor((s) => s.catalog!);
  const roomState = useEditor((s) => s.roomState!);
  const get = useThree((s) => s.get);
  const [hovered, setHovered] = useState(false);
  useCursor(hovered, 'ew-resize');

  const box = targetBox({ setup, catalog, roomState }, session.target);
  if (!box) return null;
  const { size } = session;
  const [width, height, depth] = size;
  const { position: [x, y, z], rotationY } = swapPlacement(setup, box.placement, box.size[2], depth);
  const front: Vec2 = [Math.sin(rotationY), Math.cos(rotationY)];
  const right: Vec2 = [front[1], -front[0]];

  // Like a Piece drag (DragControls): until the pointer is released it pulls the handle, and the
  // camera and the rest of the scene ignore it.
  const onDown = (handle: Handle) => (event: ThreeEvent<PointerEvent>) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    const { camera, gl, controls, setEvents } = get();
    const outward: Vec2 = handle.axis === 0 ? [right[0] * handle.side, right[1] * handle.side] : front;
    const middle = y + height / 2;
    const grabbed = distanceAlong(event.ray, middle, outward);
    if (grabbed === null) return;
    const raycaster = new Raycaster();

    const onMove = ({ clientX, clientY }: PointerEvent) => {
      const { left, top, width: w, height: h } = gl.domElement.getBoundingClientRect();
      raycaster.setFromCamera(new Vector2(((clientX - left) / w) * 2 - 1, -((clientY - top) / h) * 2 + 1), camera);
      const along = distanceAlong(raycaster.ray, middle, outward);
      const current = useResize.getState().session;
      if (along === null || !current) return;
      // A width handle moves both sides, so the width grows twice as far as the handle moves.
      const next: Vec3 = [...size];
      next[handle.axis] = Math.max(MIN_SIZE, size[handle.axis] + (along - grabbed) * (handle.axis === 0 ? 2 : 1));
      useResize.setState({ session: { ...current, size: next } });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      if (cameraControls) cameraControls.enabled = true;
      setEvents({ enabled: true });
      setHovered(false);
    };
    const cameraControls = controls as { enabled: boolean } | null;
    if (cameraControls) cameraControls.enabled = false;
    setEvents({ enabled: false });
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  return (
    <Hud renderPriority={3}>
      <group position={[x, y, z]} rotation-y={rotationY}>
        <mesh position-y={height / 2} raycast={ignoreRaycast}>
          <boxGeometry args={size} />
          <meshBasicMaterial color={COLOR} transparent opacity={0.12} depthWrite={false} />
          <Edges color={COLOR} lineWidth={2} />
        </mesh>
        {HANDLES.map((handle) => (
          <mesh
            key={`${handle.axis}${handle.side}`}
            position={handle.axis === 0 ? [handle.side * (width / 2 + HANDLE_OUT), height / 2, 0] : [0, height / 2, depth / 2 + HANDLE_OUT]}
            onPointerDown={onDown(handle)}
            onClick={(event) => event.stopPropagation()}
            onPointerOver={() => setHovered(true)}
            onPointerOut={() => setHovered(false)}
          >
            <sphereGeometry args={[HANDLE_RADIUS, 16, 8]} />
            <meshBasicMaterial color={COLOR} />
          </mesh>
        ))}
      </group>
    </Hud>
  );
}
