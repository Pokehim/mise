import { Bvh } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import { use, useEffect, useLayoutEffect, useMemo } from 'react';
import { type Object3D, Plane, Vector3 } from 'three';
import { type GLTF, GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { scanFileUrl } from '../api';
import { type Selection, useEditor } from '../state/store';
import { withMeshopt } from './gltf';
import { CLICK_TOLERANCE_PX, forEachMaterial } from './objects';
import { setupRoomNodes } from './scanNodes';
import { type SplitNodeData, disposeSplit, splitNodes, splitScan } from './splitScan';
import { WallFader } from './WallFader';

const scanLoads = new Map<string, Promise<GLTF | null>>();
// three-mesh-bvh's CENTER split: builds the raycast tree for a 300k-triangle Scan several times
// faster than the default, and a drag only casts a few rays per move.
const CENTER = 0;

/** A Scan's mesh file, or null when it has none yet (404). Cached, so suspending on it resolves once. */
function loadScanMesh(url: string) {
  let load = scanLoads.get(url);
  if (!load) {
    const loader = new GLTFLoader();
    withMeshopt(loader);
    load = loader.loadAsync(url).catch((error: Error & { response?: Response }) => {
      if (error.response?.status === 404) return null;
      throw error;
    });
    scanLoads.set(url, load);
  }
  return load;
}

/** What a click on the Scan selects: the Original or Wall node it hit, by the id splitScan put in its userData. */
function selectionAt(object: Object3D): Selection | null {
  for (let o: Object3D | null = object; o; o = o.parent) {
    const { kind, id } = o.userData as Partial<SplitNodeData>;
    if (kind === 'original' || kind === 'wall') return { kind, id: id! };
    if (kind) return null;   // the Shell, Floor or Ceiling
  }
  return null;
}

/** The Scan: its mesh split into nodes, or a stand-in room from the Room Setup when it has no mesh yet. */
export function ScanMesh() {
  const manifest = useEditor((s) => s.manifest!);
  const setup = useEditor((s) => s.setup!);
  const originals = useEditor((s) => s.roomState!.originals);
  const view = useEditor((s) => s.view);
  const gltf = use(loadScanMesh(scanFileUrl(manifest.id, manifest.mesh)));

  // The split nodes are already in the room frame, so they go in the scene as they are.
  const nodes = useMemo(() => (gltf ? splitScan(gltf.scene, setup, manifest) : setupRoomNodes(setup)), [gltf, setup, manifest]);
  useEffect(() => () => disposeSplit(nodes), [nodes]);

  // The Dollhouse looks in from above, so it clips everything near the ceiling (spec §10.2).
  const ceilingClip = useMemo(() => new Plane(new Vector3(0, -1, 0)), []);
  useLayoutEffect(() => {
    for (const node of splitNodes(nodes)) {
      forEachMaterial(node, (material) => {
        material.clippingPlanes = [ceilingClip];
      });
    }
  }, [nodes, ceilingClip]);
  useLayoutEffect(() => {
    ceilingClip.constant = view === 'dollhouse' ? setup.ceilingHeight - 0.05 : 1e6;
  }, [ceilingClip, view, setup]);

  const onClick = (event: ThreeEvent<MouseEvent>) => {
    if (event.delta > CLICK_TOLERANCE_PX) return;   // the end of a drag that moved the camera
    const target = selectionAt(event.object);
    // A click on the floor goes on to the Walk view, which moves there.
    if (target) event.stopPropagation();
    useEditor.getState().select(target);
  };

  return (
    <group name="scan" onClick={onClick}>
      <Bvh strategy={CENTER}>
        <primitive object={nodes.shell} />
        <primitive object={nodes.floor} />
        <primitive object={nodes.ceiling} visible={view === 'walk'} />
        {Object.values(nodes.walls).map((node) => <primitive key={node.uuid} object={node} />)}
        {Object.entries(nodes.originals).map(([id, node]) => (
          <primitive key={node.uuid} object={node} visible={originals[id]?.visible !== false} />
        ))}
      </Bvh>
      <WallFader walls={setup.walls} nodes={nodes.walls} />
    </group>
  );
}
