import { Hud, Outlines } from '@react-three/drei';
import { wallPoint } from '@shared/geometry';
import type { RoomSetup, RoomState, Vec3 } from '@shared/types';
import { type Selection, useEditor } from '../state/store';
import { wallLength, wallRotationY } from './floorPlan';
import { ignoreRaycast } from './objects';

/**
 * The selection outline, or another color's (the Fit warnings' red). Put it inside a mesh. With
 * angle 0 it reuses the mesh's own normals instead of copying the geometry on every selection;
 * hard-edged boxes pass π to close the corners.
 */
export const Outline = ({ renderOrder, angle = 0, color = '#1a73e8' }: { renderOrder?: number; angle?: number; color?: string }) => (
  <Outlines color={color} thickness={4} angle={angle} renderOrder={renderOrder} />
);

type OutlineBox = { center: Vec3; size: Vec3; rotationY: number };

/** The box to outline for the selected Original (its Room Setup box, where it is now) or Wall. */
function selectedBox(selection: Selection | null, setup: RoomSetup, roomState: RoomState): OutlineBox | null {
  if (selection?.kind === 'original') {
    const original = setup.originals.find(({ id }) => id === selection.id);
    const placement = roomState.originals[selection.id]?.placement;
    if (!original || !placement) return null;
    const { position: [x, y, z], rotationY } = placement;
    const [width, height, depth] = original.box.size;
    return { center: [x, y + height / 2, z], size: [width + 0.02, height + 0.02, depth + 0.02], rotationY };
  }
  if (selection?.kind === 'wall') {
    const wall = setup.walls.find(({ id }) => id === selection.id);
    if (!wall) return null;
    const [x, z] = wallPoint(wall, wallLength(wall) / 2, 0);
    return { center: [x, wall.height / 2, z], size: [wallLength(wall), wall.height, 0.02], rotationY: wallRotationY(wall) };
  }
  return null;
}

/**
 * Outlines the selected Original or Wall, around its Room Setup box. It is drawn over the
 * scene (a Hud, always mounted so rendering never changes), because Originals and Walls touch the
 * floor and the other walls, which would otherwise hide most of it. The box writes depth but no
 * color, so the Outline shows only around its silhouette.
 */
export function SelectionOutline() {
  const selection = useEditor((s) => s.selection);
  const setup = useEditor((s) => s.setup!);
  const roomState = useEditor((s) => s.roomState!);
  const box = selectedBox(selection, setup, roomState);
  return (
    <Hud>
      {box && (
        <mesh position={box.center} rotation-y={box.rotationY} renderOrder={1} raycast={ignoreRaycast}>
          <boxGeometry args={box.size} />
          <meshBasicMaterial colorWrite={false} />
          <Outline renderOrder={2} angle={Math.PI} />
        </mesh>
      )}
    </Hud>
  );
}
