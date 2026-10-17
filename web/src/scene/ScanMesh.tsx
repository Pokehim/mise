import { Bvh } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import { use, useLayoutEffect, useMemo } from 'react';
import { MeshBasicMaterial, type MeshStandardMaterial, type Object3D, Plane, Vector3 } from 'three';
import { type GLTF, GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { RoomSetup, RoomState } from '@shared/types';
import { scanFileUrl } from '../api';
import { type Selection, useEditor } from '../state/store';
import { wallCoordinates } from './floorPlan';
import { withMeshopt } from './gltf';
import { CLICK_TOLERANCE_PX, forEachMaterial } from './objects';
import { type ScanNodes, setupRoomNodes, splitScanStub } from './scanNodes';
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

const nodesOf = (nodes: ScanNodes) => [nodes.shell, nodes.floor, nodes.ceiling, ...Object.values(nodes.walls), ...Object.values(nodes.originals)];

/** Scan textures already hold the room's real lighting, so they render unlit and untouched (spec §10.6). */
function makeUnlit(root: Object3D) {
  forEachMaterial(root, (material) => {
    if ((material as MeshBasicMaterial).isMeshBasicMaterial) {
      material.toneMapped = false;
      return;
    }
    const { map, color, vertexColors, side, transparent, alphaTest } = material as MeshStandardMaterial;
    return new MeshBasicMaterial({ map, color, vertexColors, side, transparent, alphaTest, toneMapped: false });
  });
}

// splitScan's margins (spec §9.4): an Original's box grows by 2 cm, and a Wall reaches 4 cm out.
const ORIGINAL_MARGIN = 0.02;
const WALL_REACH = 0.04;

/**
 * What a click on the Scan selects: the Original whose box holds the point, else the Wall it lies
 * on, else nothing. The same tests that sort triangles in splitScan (spec §9.4, rules 1 and 4),
 * so they work on one unsplit mesh too.
 */
function scanTargetAt({ x, y, z }: Vector3, setup: RoomSetup, originals: RoomState['originals']): Selection | null {
  for (const { id, box: { size: [width, height, depth] } } of setup.originals) {
    const original = originals[id];
    if (!original?.visible) continue;
    const { position: [bx, by, bz], rotationY } = original.placement;
    const [cos, sin] = [Math.cos(rotationY), Math.sin(rotationY)];
    const across = (x - bx) * cos - (z - bz) * sin;
    const deep = (x - bx) * sin + (z - bz) * cos;
    const inside = Math.abs(across) <= width / 2 + ORIGINAL_MARGIN && Math.abs(deep) <= depth / 2 + ORIGINAL_MARGIN;
    if (inside && y - by > ORIGINAL_MARGIN && y - by <= height + ORIGINAL_MARGIN) return { kind: 'original', id };
  }
  for (const wall of setup.walls) {
    const { along, into, length } = wallCoordinates([x, z], wall);
    if (Math.abs(into) < WALL_REACH && along >= 0 && along <= length && y <= wall.height) return { kind: 'wall', id: wall.id };
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

  const nodes = useMemo(() => {
    if (!gltf) return setupRoomNodes(setup);
    makeUnlit(gltf.scene);
    // #8: splitScan(gltf.scene, setup, manifest) from './splitScan'.
    return splitScanStub(gltf.scene, setup, manifest);
  }, [gltf, setup, manifest]);

  // The Dollhouse looks in from above, so it clips everything near the ceiling (spec §10.2).
  const ceilingClip = useMemo(() => new Plane(new Vector3(0, -1, 0)), []);
  useLayoutEffect(() => {
    for (const node of nodesOf(nodes)) {
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
    const target = scanTargetAt(event.point, setup, originals);
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
        {Object.entries(nodes.walls).map(([id, node]) => <primitive key={id} object={node} />)}
        {Object.entries(nodes.originals).map(([id, node]) => (
          <primitive key={id} object={node} visible={originals[id]?.visible !== false} />
        ))}
      </Bvh>
      <WallFader walls={setup.walls} nodes={nodes.walls} />
    </group>
  );
}
