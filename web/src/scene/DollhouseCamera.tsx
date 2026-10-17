import { CameraControls } from '@react-three/drei';
import { useEffect, useMemo, useRef } from 'react';
import { Vector3 } from 'three';
import { useEditor } from '../state/store';
import { roomBounds } from './floorPlan';

/**
 * An orbiting camera that looks down into the room from about 45° (spec §10.2). Its target stays
 * within 2 m of the room's box. The camera itself can't: from inside that box, a 45° view is
 * too close to frame the room, so its distance is capped instead.
 */
export function DollhouseCamera() {
  const setup = useEditor((s) => s.setup!);
  const controls = useRef<CameraControls>(null!);
  const room = useMemo(() => roomBounds(setup), [setup]);
  const distance = room.getSize(new Vector3()).setY(0).length() * 1.4;

  useEffect(() => {
    controls.current.setBoundary(room.clone().expandByScalar(2));
    const { x, z } = room.getCenter(new Vector3());
    const offset = distance * Math.SQRT1_2;
    void controls.current.setLookAt(x, 0.5 + offset, z + offset, x, 0.5, z, true);
  }, [room, distance]);

  return (
    <CameraControls ref={controls} makeDefault minDistance={0.5} maxDistance={distance * 2} maxPolarAngle={Math.PI * 0.45} />
  );
}
