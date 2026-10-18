import { Bvh } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import { use, useEffect, useLayoutEffect, useMemo } from 'react';
import { type Mesh, type Object3D, Plane, Vector3 } from 'three';
import { type GLTF, GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { RoomSetup } from '@shared/types';
import { scanFileUrl } from '../api';
import { type Selection, useEditor } from '../state/store';
import { withMeshopt } from './gltf';
import { MasterCopies } from './MasterCopies';
import { CLICK_TOLERANCE_PX, forEachMaterial } from './objects';
import { OriginalNode } from './OriginalNode';
import { hasNoCapture } from './room/buildRoom';
import { Patches } from './Patch';
import { setupRoomNodes } from './scanNodes';
import { type SplitNodeData, disposeSplit, splitNodes, splitScan } from './splitScan';
import { WallFader } from './WallFader';

const scanLoads = new Map<string, Promise<GLTF | null>>();
// three-mesh-bvh's CENTER split: builds the raycast tree for a 300k-triangle Scan several times
// faster than the default, and a drag only casts a few rays per move.
const CENTER = 0;

const NO_MESH: Promise<GLTF | null> = Promise.resolve(null);

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

/**
 * How far back the Empty Room mesh is pushed in depth when its Originals come from Master Copies, so the
 * splat lying on the same surface draws over it (lounge-v2 spec §3).
 */
const EMPTY_ROOM_OFFSET = { polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 4 } as const;

/** Whether a Scan's Originals are drawn from Master Copies, over an Empty Room mesh (ADR-0009). */
export const hasMasterCopies = (setup: RoomSetup) => setup.originals.some(({ model }) => model);

/**
 * The Scan: its mesh split into nodes, or a stand-in room from the Room Setup when it has no mesh yet.
 * When its Originals are drawn from Master Copies (lounge-v2), the mesh is the Empty Room: nothing is
 * cut out of it, it is always drawn, and the Master Copies stand in it.
 */
export function ScanMesh() {
  const manifest = useEditor((s) => s.manifest!);
  const fullSetup = useEditor((s) => s.setup!);
  const masterCopies = hasMasterCopies(fullSetup);
  // Only Originals without a Master Copy are cut out of the mesh.
  const setup = useMemo(
    () => (masterCopies ? { ...fullSetup, originals: fullSetup.originals.filter(({ model }) => !model) } : fullSetup),
    [fullSetup, masterCopies],
  );
  // Originals lifted or removed: their Patch, from a Fill Capture, shows (ADR-0007).
  const patched = useEditor((s) => s.roomState!.patches);
  const view = useEditor((s) => s.view);
  // A room with no Capture has no mesh file to fetch (ADR-0010, ADR-0011).
  const gltf = use(hasNoCapture(manifest, setup) ? NO_MESH : loadScanMesh(scanFileUrl(manifest.id, manifest.mesh)));

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
  useLayoutEffect(() => {
    if (!masterCopies) return;
    for (const node of splitNodes(nodes)) {
      node.traverse((mesh) => {
        // Before the splat, which draws without writing depth, even where WallFader makes a wall see-through.
        if ((mesh as Mesh).isMesh) mesh.renderOrder = -1;
      });
      forEachMaterial(node, (material) => {
        Object.assign(material, EMPTY_ROOM_OFFSET);
      });
    }
  }, [nodes, masterCopies]);

  const onClick = (event: ThreeEvent<MouseEvent>) => {
    if (event.delta > CLICK_TOLERANCE_PX) return;   // the end of a drag that moved the camera
    // R3F calls this once for each Scan surface under the pointer, nearest first. Only the nearest
    // counts, so a click on the Shell doesn't select the Wall behind it.
    if (event.intersections.find((hit) => hit.eventObject === event.eventObject)?.object !== event.object) return;
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
        {/* Keyed by node, so a new split replaces the old nodes rather than reusing their elements. */}
        {Object.values(nodes.walls).map((node) => <primitive key={node.uuid} object={node} />)}
        {Object.entries(nodes.originals).map(([id, node]) => <OriginalNode key={node.uuid} id={id} node={node} />)}
        {Object.entries(nodes.patches).map(([id, node]) => (
          <primitive key={node.uuid} object={node} visible={patched.includes(id)} />
        ))}
      </Bvh>
      {masterCopies && <MasterCopies />}
      <WallFader walls={setup.walls} nodes={nodes.walls} />
      <Patches captured={nodes.patches} />
    </group>
  );
}
