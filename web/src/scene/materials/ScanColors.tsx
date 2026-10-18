import { useThree } from '@react-three/fiber';
import { useLayoutEffect } from 'react';
import { useEditor } from '../../state/store';
import { recolorParts } from '../applyParts';
import { forEachMaterial } from '../objects';
import type { SplitNodeData } from '../splitScan';
import { recolor } from './recolor';

/**
 * Paints the Walls and recolors the Originals' Parts of the split Scan, as the Design says
 * (spec §10.4, §10.6), keeping the room's real lighting. It finds splitScan's nodes under the "scan"
 * group by their SplitNodeData, so mount it right after ScanMesh, in the same Suspense boundary:
 * its layout effect then runs once the nodes are added, and after WallFader gives each wall its
 * own materials. A Scan without a mesh file draws a stand-in room, which has no such nodes.
 */
export function ScanColors() {
  const scene = useThree((s) => s.scene);
  // ScanMesh splits the Scan again when these change, and the new nodes need their colors.
  const setup = useEditor((s) => s.setup);
  const manifest = useEditor((s) => s.manifest);
  const walls = useEditor((s) => s.roomState!.surfaces.walls);
  const originals = useEditor((s) => s.roomState!.originals);

  useLayoutEffect(() => {
    scene.getObjectByName('scan')?.traverse((node) => {
      const { kind, id, avgLuminance } = node.userData as Partial<SplitNodeData>;
      if (kind === 'wall' && id) {
        const finish = walls[id];
        forEachMaterial(node, (material) => recolor(material, finish?.kind === 'paint' ? finish.color : null, avgLuminance!));
      }
      if (kind === 'original' && id) recolorParts(node, originals[id]?.partColors ?? {});
    });
  }, [scene, setup, manifest, walls, originals]);

  return null;
}
