import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import {
  type BufferGeometry, type Group, type Material, Mesh, NotEqualStencilFunc, type Object3D, ReplaceStencilOp, ShadowMaterial,
} from 'three';
import { useEditor } from '../state/store';
import { ignoreRaycast } from './objects';
import type { SplitNodeData } from './splitScan';
import { windowLight } from './windowLight';

/** How dark a full shadow is on the room: a little darker than a blob shadow's 35% (spec §10.6). */
const SHADOW_OPACITY = 0.45;

interface Receiver {
  overlay: Mesh<BufferGeometry, ShadowMaterial>;
  /** The mesh it copies, whose fade it follows. */
  source: Mesh;
  /** The node that mesh is in. WallFader hides a Wall's, and ScanMesh hides a Patch's until it shows. */
  node: Object3D;
}

/**
 * A see-through copy of every Shell, Floor and Wall mesh, and every captured Patch's (the floor and
 * wall a Fill Capture saw), that draws only the shadows cast on it. Each shares its mesh's geometry
 * and ceiling clip; polygonOffset draws it over the mesh. Where copies overlap, as a Patch does the
 * Floor under it, the stencil lets only the first one drawn show, so a shadow isn't darkened twice.
 */
function shadowReceivers(scan: Object3D): Receiver[] {
  const receivers: Receiver[] = [];
  scan.traverse((node) => {
    const { kind } = node.userData as Partial<SplitNodeData>;
    if (kind !== 'shell' && kind !== 'floor' && kind !== 'wall' && kind !== 'patch') return;
    node.traverse((mesh) => {
      if (!(mesh instanceof Mesh)) return;
      const { side, clippingPlanes } = mesh.material as Material;
      const material = new ShadowMaterial({
        opacity: SHADOW_OPACITY, side, clippingPlanes, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
        stencilWrite: true, stencilRef: 1, stencilFunc: NotEqualStencilFunc, stencilZPass: ReplaceStencilOp,
      });
      const overlay = new Mesh(mesh.geometry as BufferGeometry, material);
      mesh.updateWorldMatrix(true, false);
      overlay.matrixAutoUpdate = false;
      overlay.matrix.copy(mesh.matrixWorld);
      overlay.receiveShadow = true;
      overlay.raycast = ignoreRaycast;
      // After the Patches and the walls, which are see-through too.
      overlay.renderOrder = 1;
      receivers.push({ overlay, source: mesh, node });
    });
  });
  return receivers;
}

/**
 * The Max level's shadows (spec §12): the window light, and the Shell, Floor, Wall and Patch nodes
 * made to show the shadows Pieces cast on them. Only Pieces cast; the Originals' shadows are already
 * in the Scan. Mount it after ScanMesh, in the same Suspense boundary, so the Scan nodes are there.
 */
export function CastShadows() {
  const scene = useThree((s) => s.scene);
  // ScanMesh splits the Scan again when these change, and the new nodes need their own overlays.
  const setup = useEditor((s) => s.setup!);
  const manifest = useEditor((s) => s.manifest!);
  const light = useMemo(() => windowLight(setup), [setup]);
  useEffect(() => () => light.dispose(), [light]);

  const group = useRef<Group>(null!);
  const receivers = useRef<Receiver[]>([]);
  useLayoutEffect(() => {
    const scan = scene.getObjectByName('scan');
    const found = scan ? shadowReceivers(scan) : [];
    const parent = group.current;
    for (const { overlay } of found) parent.add(overlay);
    receivers.current = found;
    return () => {
      for (const { overlay } of found) {
        parent.remove(overlay);
        overlay.material.dispose();
      }
    };
  }, [scene, setup, manifest]);

  // Each overlay hides and fades with its wall, as WallFader hides and fades it.
  useFrame(() => {
    for (const { overlay, source, node } of receivers.current) {
      overlay.visible = node.visible;
      overlay.material.opacity = SHADOW_OPACITY * (source.material as Material).opacity;
    }
  });

  return (
    <group name="cast-shadows" ref={group}>
      <primitive object={light} />
      <primitive object={light.target} />
    </group>
  );
}
