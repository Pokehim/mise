// Step 5: drag handles on the selected Original's box. A handle on each side face and the top
// resizes the box with the opposite face fixed; the ring on the floor moves it.
import { type ThreeEvent, useThree } from '@react-three/fiber';
import { useRef } from 'react';
import { Plane, type Ray, Vector3 } from 'three';
import type { Box } from '@shared/types';
import { mm } from './geometry/mesh';
import { useSetup } from './store';

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
  if (!original) return null;
  const { position, size: [w, h, d], rotationY } = original.box;

  const setBox = (box: Box) => useSetup.getState().updateOriginal(originalId, { box });

  const onDown = (handle: Handle) => (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    (e.target as unknown as Element).setPointerCapture(e.pointerId);
    if (controls) controls.enabled = false;
    const start = original.box;
    const { origin, axis } = handleLine(handle, start);
    const t0 = handle.kind === 'move' ? 0 : axisParameter(origin, axis, e.ray);
    if (t0 === null) return;
    drag.current = { handle, start, origin: handle.kind === 'move' ? floorPoint(e.ray, start.position[1]) ?? origin : origin, axis, t0 };
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
    if (controls) controls.enabled = true;
  };

  return (
    <group position={position} rotation-y={rotationY}>
      {HANDLES.map((handle, i) => {
        const at: [number, number, number] =
          handle.kind === 'top' ? [0, h, 0]
            : handle.kind === 'move' ? [0, 0.02, 0]
              : handle.axis === 0 ? [(handle.sign * w) / 2, h / 2, 0] : [0, h / 2, (handle.sign * d) / 2];
        return (
          <mesh key={i} position={at} rotation-x={handle.kind === 'move' ? -Math.PI / 2 : 0} renderOrder={20}
            onPointerDown={onDown(handle)} onPointerMove={onMove} onPointerUp={onUp} onClick={(e) => e.stopPropagation()}>
            {handle.kind === 'move' ? <ringGeometry args={[0.07, 0.11, 32]} /> : <sphereGeometry args={[0.045, 16, 8]} />}
            <meshBasicMaterial color={handle.kind === 'move' ? '#ffffff' : '#e5b567'} depthTest={false} />
          </mesh>
        );
      })}
    </group>
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
