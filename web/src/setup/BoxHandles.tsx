// Step 5: drag handles on the selected Original's box. A handle on each side face and the top
// resizes the box with the opposite face fixed; the one on the floor moves it.
import { Billboard, useCursor } from '@react-three/drei';
import { type ThreeEvent, useThree } from '@react-three/fiber';
import { useRef, useState } from 'react';
import { type Group, Plane, type Ray, Vector3 } from 'three';
import type { Box, Vec3 } from '@shared/types';
import { touchTargetPx, useScreenScale } from '../scene/screenScale';
import { mm } from './geometry/mesh';
import { useSetup } from './store';
import { ignoreRaycast, tone } from './ui';

type Handle = { kind: 'side'; axis: 0 | 2; sign: 1 | -1 } | { kind: 'top' } | { kind: 'move' };

const HANDLES: Handle[] = [
  { kind: 'side', axis: 0, sign: 1 }, { kind: 'side', axis: 0, sign: -1 },
  { kind: 'side', axis: 2, sign: 1 }, { kind: 'side', axis: 2, sign: -1 },
  { kind: 'top' }, { kind: 'move' },
];

export function BoxHandles({ originalId }: { originalId: string }) {
  const original = useSetup((s) => s.setup!.originals.find((o) => o.id === originalId));
  const controls = useThree((s) => s.controls) as { enabled: boolean } | null;
  const drag = useRef<{ handle: Handle; start: Box; origin: Vector3; axis: Vector3; t0: number } | null>(null);
  const [pressed, setPressed] = useState<Handle | null>(null);
  if (!original) return null;
  const { position, size: [w, h, d], rotationY } = original.box;

  const setBox = (box: Box) => useSetup.getState().updateOriginal(originalId, { box });

  const onDown = (handle: Handle) => (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    const start = original.box;
    const { origin, axis } = handleLine(handle, start);
    const t0 = handle.kind === 'move' ? 0 : axisParameter(origin, axis, e.ray);
    // Looking straight down the handle's axis there is no drag, so onUp won't turn the controls back on.
    if (t0 === null) return;
    (e.target as unknown as Element).setPointerCapture(e.pointerId);
    if (controls) controls.enabled = false;
    drag.current = { handle, start, origin: handle.kind === 'move' ? floorPoint(e.ray, start.position[1]) ?? origin : origin, axis, t0 };
    setPressed(handle);
  };

  const onMove = (e: ThreeEvent<PointerEvent>) => {
    const current = drag.current;
    if (!current) return;
    e.stopPropagation();
    const { handle, start, origin, axis, t0 } = current;
    if (handle.kind === 'move') {
      const point = floorPoint(e.ray, start.position[1]);
      if (point) setBox({ ...start, position: [mm(start.position[0] + point.x - origin.x), start.position[1], mm(start.position[2] + point.z - origin.z)] });
      return;
    }
    const t = axisParameter(origin, axis, e.ray);
    if (t === null) return;
    if (handle.kind === 'top') {
      const size = [...start.size] as Box['size'];
      size[1] = mm(Math.max(0.02, start.size[1] + t - t0));
      setBox({ ...start, size });
      return;
    }
    const size = [...start.size] as Box['size'];
    size[handle.axis] = mm(Math.max(0.05, start.size[handle.axis] + t - t0));
    const grown = size[handle.axis] - start.size[handle.axis];
    // The opposite face stays put, so the center moves half the growth along the handle's axis.
    setBox({
      ...start,
      size,
      position: [mm(start.position[0] + (axis.x * grown) / 2), start.position[1], mm(start.position[2] + (axis.z * grown) / 2)],
    });
  };

  const onUp = (e: ThreeEvent<PointerEvent>) => {
    if (!drag.current) return;
    e.stopPropagation();
    (e.target as unknown as Element).releasePointerCapture(e.pointerId);
    drag.current = null;
    setPressed(null);
    if (controls) controls.enabled = true;
  };

  return (
    <group position={position} rotation-y={rotationY}>
      {HANDLES.map((handle, i) => (
        <HandleDisc
          key={i}
          position={handle.kind === 'top' ? [0, h, 0]
            : handle.kind === 'move' ? [0, 0.02, 0]
              : handle.axis === 0 ? [(handle.sign * w) / 2, h / 2, 0] : [0, h / 2, (handle.sign * d) / 2]}
          move={handle.kind === 'move'}
          pressed={pressed === handle}
          onPointerDown={onDown(handle)} onPointerMove={onMove} onPointerUp={onUp}
        />
      ))}
    </group>
  );
}

/** A handle's disc on screen, in CSS pixels. Its hit area is a fingertip's (touchTargetPx), or a mouse's. */
const DISC_PX = 16;
const MOVE_PX = 22;

interface HandleDiscProps {
  position: Vec3;
  move: boolean;
  pressed: boolean;
  onPointerDown: (e: ThreeEvent<PointerEvent>) => void;
  onPointerMove: (e: ThreeEvent<PointerEvent>) => void;
  onPointerUp: (e: ThreeEvent<PointerEvent>) => void;
}

/**
 * A drafting handle, as in the editor's Resize: a paper disc ringed in the wash, facing the camera and
 * the same size on screen at any zoom, filled with the wash while hovered or dragged. The move handle
 * is larger, with an ink dot at its center. A wider disc around it takes the pointer: hidden by
 * opacity, not `visible`, as the raycaster skips what isn't visible.
 */
function HandleDisc({ position, move, pressed, onPointerDown, onPointerMove, onPointerUp }: HandleDiscProps) {
  const ref = useRef<Group>(null);
  useScreenScale(ref, 1);   // one unit is one CSS pixel
  const [hovered, setHovered] = useState(false);
  useCursor(hovered || pressed, move ? 'move' : 'grab');
  const radius = (move ? MOVE_PX : DISC_PX) / 2;
  // Transparent, so that renderOrder draws them over the overlays' lines and labels, which are too.
  const material = { depthTest: false, depthWrite: false, transparent: true, toneMapped: false } as const;
  return (
    <Billboard ref={ref} position={position}>
      <mesh renderOrder={40} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
        onPointerOver={() => setHovered(true)} onPointerOut={() => setHovered(false)} onClick={(e) => e.stopPropagation()}>
        <circleGeometry args={[Math.max(radius, touchTargetPx() / 2), 24]} />
        <meshBasicMaterial opacity={0} {...material} />
      </mesh>
      <mesh renderOrder={41} raycast={ignoreRaycast}>
        <circleGeometry args={[radius, 24]} />
        <meshBasicMaterial color={tone(hovered || pressed ? '--wash-tint-strong' : '--paper-raised')} {...material} />
      </mesh>
      <mesh renderOrder={42} raycast={ignoreRaycast}>
        <ringGeometry args={[radius - 2, radius, 24]} />
        <meshBasicMaterial color={tone('--wash')} {...material} />
      </mesh>
      {move && (
        <mesh renderOrder={42} raycast={ignoreRaycast}>
          <circleGeometry args={[2.5, 12]} />
          <meshBasicMaterial color={tone('--ink')} {...material} />
        </mesh>
      )}
    </Billboard>
  );
}

/** A handle's line in the room frame: through its face's center, along the direction it pulls. */
function handleLine(handle: Handle, { position: [x, y, z], size: [w, h, d], rotationY }: Box) {
  const c = Math.cos(rotationY);
  const s = Math.sin(rotationY);
  if (handle.kind !== 'side') return { origin: new Vector3(x, y + h, z), axis: new Vector3(0, 1, 0) };
  // The box's local +X and +Z in the room frame, for a rotation of rotationY about +Y.
  const axis = handle.axis === 0 ? new Vector3(c, 0, -s) : new Vector3(s, 0, c);
  axis.multiplyScalar(handle.sign);
  const half = handle.axis === 0 ? w / 2 : d / 2;
  return { origin: new Vector3(x, y + h / 2, z).addScaledVector(axis, half), axis };
}

/** The parameter t of the point on the line origin + t·axis closest to the ray; null when they are parallel. */
function axisParameter(origin: Vector3, axis: Vector3, ray: Ray): number | null {
  const w0 = origin.clone().sub(ray.origin);
  const b = axis.dot(ray.direction);
  const denominator = 1 - b * b;
  if (denominator < 1e-6) return null;
  return (b * ray.direction.dot(w0) - axis.dot(w0)) / denominator;
}

function floorPoint(ray: Ray, y: number): Vector3 | null {
  return ray.intersectPlane(new Plane(new Vector3(0, 1, 0), -y), new Vector3());
}
