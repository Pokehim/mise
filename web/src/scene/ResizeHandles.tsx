import { Billboard, Hud, useCursor } from '@react-three/drei';
import { type ThreeEvent, useThree } from '@react-three/fiber';
import { useMemo, useRef, useState } from 'react';
import { type Group, type Ray, Raycaster, Vector2 } from 'three';
import type { Vec2 } from '@shared/types';
import { type ResizeSession, setResizeSide, useResize } from '../state/resize';
import { useEditor } from '../state/store';
import { ignoreRaycast } from './objects';
import { touchTargetPx, useScreenScale } from './screenScale';
import { DASH, InkLine } from './sketch/InkLine';
import { boxEdges } from './sketch/lines';
import { token } from './sketch/tokens';
import { floorHit } from './placement';
import { swapPlacement } from './swapResize';

/** The smallest width or depth the handles draw, in meters. */
const MIN_SIZE = 0.1;
/** A handle's disc, in CSS pixels on screen at any zoom; it catches the pointer over a touch target's width. */
const HANDLE_RADIUS_PX = 8;
/** How far, in meters, a handle's center sits out from its face, so it isn't buried in the item. */
const HANDLE_OUT = 0.05;

/** A face handle: one on each side pulls the width out on both sides (the center stays); the front one pulls the depth (the back stays). */
type Handle = { axis: 0; side: 1 | -1 } | { axis: 2; side: 1 };
const HANDLES: Handle[] = [{ axis: 0, side: 1 }, { axis: 0, side: -1 }, { axis: 2, side: 1 }];

/** The Resize box and its handles while a Resize is open (spec §10.5). */
export function ResizeHandles() {
  const session = useResize((s) => s.session);
  return session && <ResizeBox session={session} />;
}

/**
 * The size being drawn, as a see-through box standing where the new item will (its back-center
 * kept), with face handles for its width and depth. It is drawn over the scene, above the Fit
 * warnings, and its handles catch the pointer before anything behind them.
 */
function ResizeBox({ session: { target, size } }: { session: ResizeSession }) {
  const setup = useEditor((s) => s.setup!);
  const catalog = useEditor((s) => s.catalog!);
  const roomState = useEditor((s) => s.roomState!);
  const get = useThree((s) => s.get);

  const [width, height, depth] = size;
  const edges = useMemo(() => boxEdges(size), [size]);
  const placement = swapPlacement({ setup, catalog, roomState }, target, depth);
  if (!placement) return null;
  const { position: [x, y, z], rotationY } = placement;
  const front: Vec2 = [Math.sin(rotationY), Math.cos(rotationY)];
  const right: Vec2 = [front[1], -front[0]];

  // Like a Piece drag (DragControls): until the pointer is released it pulls the handle, and the
  // camera and the rest of the scene ignore it.
  const onDown = (handle: Handle, onRelease: () => void) => (event: ThreeEvent<PointerEvent>) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    const { camera, gl, controls, setEvents } = get();
    const outward: Vec2 = handle.axis === 0 ? [right[0] * handle.side, right[1] * handle.side] : front;
    const middle = y + height / 2;
    /** How far out along the handle's direction a ray meets the plane through the box's middle. */
    const reach = (ray: Ray) => {
      const hit = floorHit(ray, middle);
      return hit && hit[0] * outward[0] + hit[1] * outward[1];
    };
    const grabbed = reach(event.ray);
    if (grabbed === null) return;
    // The canvas doesn't move during the drag, and reading its rect on each move would force a
    // layout, because the Inspector's candidates change on each move.
    const { left, top, width: viewWidth, height: viewHeight } = gl.domElement.getBoundingClientRect();
    const raycaster = new Raycaster();

    const onMove = ({ clientX, clientY }: PointerEvent) => {
      raycaster.setFromCamera(new Vector2(((clientX - left) / viewWidth) * 2 - 1, -((clientY - top) / viewHeight) * 2 + 1), camera);
      const reached = reach(raycaster.ray);
      if (reached === null) return;
      // A width handle moves both sides, so the width grows twice as far as the handle moves.
      setResizeSide(handle.axis, Math.max(MIN_SIZE, size[handle.axis] + (reached - grabbed) * (handle.axis === 0 ? 2 : 1)));
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      if (cameraControls) cameraControls.enabled = true;
      setEvents({ enabled: true });
      onRelease();
    };
    const cameraControls = controls as { enabled: boolean } | null;
    if (cameraControls) cameraControls.enabled = false;
    setEvents({ enabled: false });
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  // Priority 3: over FitHighlights (2), and both over SketchSelection's always-mounted Hud (1),
  // which is the one that draws the scene itself. A higher priority also gets the pointer first.
  return (
    <Hud renderPriority={3}>
      <group position={[x, y, z]} rotation-y={rotationY}>
        {/* A construction line in the wash: dashed, ruled, and with nothing laid over the room inside it. */}
        <InkLine segments={edges} color="--wash" width={1.5} dash={DASH} />
        {HANDLES.map((handle) => (
          <ResizeHandle
            key={`${handle.axis}${handle.side}`}
            handle={handle}
            position={handle.axis === 0 ? [handle.side * (width / 2 + HANDLE_OUT), height / 2, 0] : [0, height / 2, depth / 2 + HANDLE_OUT]}
            onDown={onDown}
          />
        ))}
      </group>
    </Hud>
  );
}

/**
 * A drafting handle: a paper disc ringed in the wash, always facing the camera and the same size on
 * screen at any zoom. Hovered or held, it fills with the wash, so a press shows before the pull does.
 */
function ResizeHandle({ handle, position, onDown }: {
  handle: Handle;
  position: [number, number, number];
  onDown: (handle: Handle, onRelease: () => void) => (event: ThreeEvent<PointerEvent>) => void;
}) {
  const scaled = useRef<Group>(null);
  // One unit of the group is one CSS pixel.
  useScreenScale(scaled, 1);
  const [hovered, setHovered] = useState(false);
  const [held, setHeld] = useState(false);
  // Across the screen for the width; the depth runs into it.
  useCursor(hovered || held, handle.axis === 0 ? 'ew-resize' : 'ns-resize');
  const press = onDown(handle, () => setHeld(false));
  return (
    <Billboard position={position}>
      <group ref={scaled}>
        {/* What catches the pointer: a touch target's width, drawn but see-through, since hidden objects take no hits. */}
        <mesh
          onPointerDown={(event) => {
            if (event.button === 0) setHeld(true);
            press(event);
          }}
          onClick={(event) => event.stopPropagation()}
          onPointerOver={() => setHovered(true)}
          onPointerOut={() => setHovered(false)}
        >
          <circleGeometry args={[touchTargetPx() / 2, 24]} />
          <meshBasicMaterial transparent opacity={0} depthTest={false} depthWrite={false} />
        </mesh>
        <mesh renderOrder={1} raycast={ignoreRaycast}>
          <circleGeometry args={[HANDLE_RADIUS_PX, 24]} />
          <meshBasicMaterial color={token(hovered || held ? '--wash-tint' : '--paper-raised')} depthTest={false} toneMapped={false} />
        </mesh>
        <mesh renderOrder={2} raycast={ignoreRaycast}>
          <ringGeometry args={[HANDLE_RADIUS_PX * (held ? 0.6 : 0.72), HANDLE_RADIUS_PX, 24]} />
          <meshBasicMaterial color={token('--wash')} depthTest={false} toneMapped={false} />
        </mesh>
      </group>
    </Billboard>
  );
}
