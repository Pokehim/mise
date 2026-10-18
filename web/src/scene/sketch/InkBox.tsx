import { useFrame } from '@react-three/fiber';
import { memo, useMemo, useRef, useState } from 'react';
import { type Group, Vector3 } from 'three';
import type { Vec3 } from '@shared/types';
import { InkLine } from './InkLine';
import { facingMask, sketchBox, visibleSegments } from './lines';

const eye = new Vector3();

/**
 * A box sketched in ink around the selection, its bottom-center at the parent's origin: 1.5 px,
 * crossing corners, a slight wobble seeded by `seed`, and only the edges that face the camera.
 * It draws on over 200 ms when it mounts; key it to the selection to restart.
 */
export const InkBox = memo(function InkBox({ size, seed }: { size: Vec3; seed: string }) {
  const group = useRef<Group>(null!);
  const edges = useMemo(() => sketchBox(size, seed), [size, seed]);
  // Which faces look at the camera; until the first frame says, the top and the front.
  const [mask, setMask] = useState(0b010100);
  const { segments, length } = useMemo(() => visibleSegments(edges, mask), [edges, mask]);

  useFrame(({ camera }) => {
    const next = facingMask(group.current.worldToLocal(eye.copy(camera.position)).toArray(), size);
    if (next !== mask) setMask(next);
  });

  return (
    <group ref={group}>
      <InkLine segments={segments} width={1.5} drawOn={length} />
    </group>
  );
});
