import { Hud, Outlines } from '@react-three/drei';
import type { Vec3 } from '@shared/types';
import { useEditor } from '../state/store';

/** The selection outline. Put it inside a mesh. */
export const Outline = ({ renderOrder }: { renderOrder?: number }) => (
  <Outlines color="#1a73e8" thickness={4} renderOrder={renderOrder} />
);

const ignoreRaycast = () => null;

/**
 * The Outline of a box, drawn over the scene. The box writes depth but no color, so the Outline
 * shows only around its silhouette. It is drawn over everything because Originals and Walls touch
 * the floor and walls, which would otherwise hide most of it.
 */
function OutlinedBox({ center, size, rotationY }: { center: Vec3; size: Vec3; rotationY: number }) {
  return (
    <Hud>
      <mesh position={center} rotation-y={rotationY} renderOrder={1} raycast={ignoreRaycast}>
        <boxGeometry args={size} />
        <meshBasicMaterial colorWrite={false} />
        <Outline renderOrder={2} />
      </mesh>
    </Hud>
  );
}

/**
 * Outlines the selected Original or Wall. Until splitScan (#8) gives them nodes of their own, they
 * are part of one Scan mesh, so the outline goes around their Room Setup box instead.
 */
export function SelectionOutline() {
  const selection = useEditor((s) => s.selection);
  const setup = useEditor((s) => s.setup!);

  if (selection?.kind === 'original') {
    const original = setup.originals.find(({ id }) => id === selection.id);
    if (!original) return null;
    const { position: [x, y, z], size: [width, height, depth], rotationY } = original.box;
    return <OutlinedBox center={[x, y + height / 2, z]} size={[width + 0.02, height + 0.02, depth + 0.02]} rotationY={rotationY} />;
  }
  if (selection?.kind === 'wall') {
    const wall = setup.walls.find(({ id }) => id === selection.id);
    if (!wall) return null;
    const [dx, dz] = [wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]];
    const center: Vec3 = [(wall.start[0] + wall.end[0]) / 2, wall.height / 2, (wall.start[1] + wall.end[1]) / 2];
    return <OutlinedBox center={center} size={[Math.hypot(dx, dz), wall.height, 0.02]} rotationY={Math.atan2(-dz, dx)} />;
  }
  return null;
}
