import { Billboard } from '@react-three/drei';
import { useRef } from 'react';
import type { Group } from 'three';
import type { Vec3 } from '@shared/types';
import { useScreenScale } from '../scene/screenScale';
import { ignoreRaycast, tone } from './ui';

interface DotProps {
  position: Vec3;
  /** Its diameter on screen, in CSS pixels, at any distance or zoom. */
  size?: number;
  /** Its fill and ring, as tokens. */
  fill?: `--${string}`;
  ring?: `--${string}`;
}

/**
 * A point marked on the drawing: a disc that faces the camera, ringed in ink, the same size on screen
 * at any zoom. Drawn over the room, and never in the way of a click.
 */
export function Dot({ position, size = 9, fill = '--ink', ring = '--ink' }: DotProps) {
  const ref = useRef<Group>(null);
  useScreenScale(ref, 1);   // one unit is one CSS pixel
  const material = { depthTest: false, depthWrite: false, transparent: true, toneMapped: false } as const;
  return (
    <Billboard ref={ref} position={position}>
      <mesh renderOrder={25} raycast={ignoreRaycast}>
        <circleGeometry args={[size / 2, 24]} />
        <meshBasicMaterial color={tone(fill)} {...material} />
      </mesh>
      <mesh renderOrder={26} raycast={ignoreRaycast}>
        <ringGeometry args={[size / 2 - 1.5, size / 2, 24]} />
        <meshBasicMaterial color={tone(ring)} {...material} />
      </mesh>
    </Billboard>
  );
}
