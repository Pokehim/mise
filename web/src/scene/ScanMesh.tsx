import { Bvh } from '@react-three/drei';
import { use, useLayoutEffect, useMemo } from 'react';
import { type Material, type Mesh, MeshBasicMaterial, type MeshStandardMaterial, type Object3D, Plane, Vector3 } from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { scanFileUrl } from '../api';
import { useEditor } from '../state/store';
import { GLTFLoader, withMeshopt } from './gltf';
import { type ScanNodes, setupRoomNodes, splitScanStub } from './scanNodes';

const scanLoads = new Map<string, Promise<GLTF | null>>();

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

function forEachMaterial(root: Object3D, visit: (material: Material, mesh: Mesh, index: number) => void) {
  root.traverse((object) => {
    const mesh = object as Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    materials.forEach((material, index) => visit(material, mesh, index));
  });
}

/** Scan textures already hold the room's real lighting, so they render unlit and untouched (spec §10.6). */
function makeUnlit(root: Object3D) {
  forEachMaterial(root, (material, mesh, index) => {
    if ((material as MeshBasicMaterial).isMeshBasicMaterial) {
      material.toneMapped = false;
      return;
    }
    const { map, color, vertexColors, side, transparent, alphaTest } = material as MeshStandardMaterial;
    const unlit = new MeshBasicMaterial({ map, color, vertexColors, side, transparent, alphaTest, toneMapped: false });
    if (Array.isArray(mesh.material)) mesh.material[index] = unlit;
    else mesh.material = unlit;
  });
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
    for (const node of nodesOf(nodes)) forEachMaterial(node, (material) => (material.clippingPlanes = [ceilingClip]));
  }, [nodes, ceilingClip]);
  useLayoutEffect(() => {
    ceilingClip.constant = view === 'dollhouse' ? setup.ceilingHeight - 0.05 : 1e6;
  }, [ceilingClip, view, setup]);

  return (
    <group name="scan">
      <Bvh>
        <primitive object={nodes.shell} />
        <primitive object={nodes.floor} />
        <primitive object={nodes.ceiling} visible={view === 'walk'} />
        {Object.entries(nodes.walls).map(([id, node]) => <primitive key={id} object={node} />)}
        {Object.entries(nodes.originals).map(([id, node]) => (
          <primitive key={id} object={node} visible={originals[id]?.visible !== false} />
        ))}
      </Bvh>
    </group>
  );
}
