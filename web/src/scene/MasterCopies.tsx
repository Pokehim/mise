import { Bvh } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { Suspense, use, useEffect, useLayoutEffect, useMemo } from 'react';
import { type Material, Mesh, type Object3D } from 'three';
import { type GLTF, GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { useShallow } from 'zustand/react/shallow';
import { scanFileUrl } from '../api';
import { useEditor } from '../state/store';
import { recolorParts } from './applyParts';
import { withMeshopt } from './gltf';
import { SHADOW_NODE, masterCopyParts, sharpen, useMasterCopyParts } from './masterCopy';
import { averageLuminance } from './materials/luminance';
import { useMaterialLibrary } from './materials/triplanar';
import { forEachMaterial, ignoreRaycast } from './objects';
import { OriginalNode } from './OriginalNode';
import { type SplitNodeData, unlit } from './splitScan';

const loads = new Map<string, Promise<GLTF | null>>();

/** A Master Copy file, loaded once however many Originals it is drawn for; null if it fails, so one bad file draws nothing. */
function loadMasterCopy(url: string) {
  let load = loads.get(url);
  if (!load) {
    const loader = new GLTFLoader();
    withMeshopt(loader);
    load = loader.loadAsync(url).catch((error: Error) => {
      console.warn(`Master Copy ${url} failed to load: ${error.message}`);
      return null;
    });
    loads.set(url, load);
  }
  return load;
}

/** A Master Copy made ready to place: unlit, its shadow drawn over the floor, and each Part's average luminance for recolor. */
interface Prepared { scene: Object3D; luminance: Record<string, number> }
const prepared = new WeakMap<GLTF, Prepared>();

function prepare(gltf: GLTF, anisotropy: number): Prepared {
  let ready = prepared.get(gltf);
  if (ready) return ready;
  const luminance: Record<string, number> = {};
  for (const node of gltf.scene.children) {
    const isShadow = node.name === SHADOW_NODE;
    const slices: Parameters<typeof averageLuminance>[0] = [];
    node.traverse((object) => {
      const mesh = object as Mesh;
      if (!mesh.isMesh) return;
      // Its images carry the room's real light, as the Empty Room's do (lounge-v2 spec §3).
      mesh.material = unlit(mesh.material as Material);
      sharpen(mesh.material, anisotropy);
      const { index, attributes } = mesh.geometry;
      slices.push({ material: mesh.material, uv: attributes.uv, index: index?.array ?? Array.from({ length: attributes.position.count }, (_, i) => i) });
      if (!isShadow) return;
      // The soft shadow lies on the floor or the wall behind: drawn over it and over the splat, and never clicked.
      // A constant offset only: one that grows with the depth slope (a factor) would lift a shadow seen at a low
      // angle in front of the chairs nearer the camera. The Empty Room is already pushed back by its own.
      Object.assign(mesh.material, { transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: 0, polygonOffsetUnits: -2 });
      mesh.renderOrder = 1;
    });
    if (!isShadow) luminance[node.name] = averageLuminance(slices);
  }
  ready = { scene: gltf.scene, luminance };
  prepared.set(gltf, ready);
  return ready;
}

/**
 * One Original's copy of its Master Copy: the geometry is shared, but each Part gets materials of its
 * own, so each Original recolors on its own. Its userData is a SplitNodeData, so a click selects it
 * and a drag can't rest it on itself, as with a split Original.
 */
function placeCopy({ scene, luminance }: Prepared, id: string): Object3D {
  const copy = scene.clone(true);
  for (const part of copy.children) {
    // clone() doesn't copy a mesh's own raycast.
    if (part.name === SHADOW_NODE) part.traverse((mesh) => (mesh as Mesh).isMesh && Object.assign(mesh, { raycast: ignoreRaycast }));
    if (part.name === SHADOW_NODE) continue;
    forEachMaterial(part, (material) => {
      const own = material.clone();
      Object.assign(own.userData, { partId: part.name, avgLuminance: luminance[part.name] });
      return own;
    });
  }
  const values = Object.values(luminance);
  copy.userData = { kind: 'original', id, avgLuminance: values.reduce((a, b) => a + b, 0) / (values.length || 1) } satisfies SplitNodeData;
  return copy;
}

function MasterCopyNode({ id, ready }: { id: string; ready: Prepared }) {
  const node = useMemo(() => placeCopy(ready, id), [ready, id]);
  // Shallow, as replay makes new objects for every Original on every Edit.
  const partColors = useEditor(useShallow((s) => s.roomState!.originals[id]?.partColors ?? {}));
  const partFinishes = useEditor(useShallow((s) => s.roomState!.originals[id]?.partFinishes ?? {}));
  const library = useMaterialLibrary();
  useLayoutEffect(() => recolorParts(node, partColors, { partFinishes, library }), [node, partColors, partFinishes, library]);
  useEffect(() => () => forEachMaterial(node, (material) => {
    if ((material.userData as { partId?: string }).partId !== undefined) material.dispose();
  }), [node]);
  return <OriginalNode id={id} node={node} />;
}

/** Every Original drawn from one Master Copy file. */
function MasterCopy({ model }: { model: string }) {
  const scanId = useEditor((s) => s.manifest!.id);
  const ids = useEditor(useShallow((s) => s.setup!.originals.filter((original) => original.model === model).map(({ id }) => id)));
  const gltf = use(loadMasterCopy(scanFileUrl(scanId, model)));
  const anisotropy = useThree((s) => s.gl.capabilities.getMaxAnisotropy());
  const ready = useMemo(() => gltf && prepare(gltf, anisotropy), [gltf, anisotropy]);
  useEffect(() => {
    if (gltf) useMasterCopyParts.setState({ [model]: masterCopyParts(gltf.scene) });
  }, [model, gltf]);
  if (!ready) return null;
  return (
    <Bvh>
      {ids.map((id) => <MasterCopyNode key={id} id={id} ready={ready} />)}
    </Bvh>
  );
}

/**
 * The Originals of a Scan drawn from Master Copies (ADR-0009, lounge-v2 spec §3): each file loaded
 * once and placed at every Original's box, with its own shadow. Nothing is cut out of the Scan for
 * them, so where one is moved or removed the Empty Room shows. Mount it inside the "scan" group.
 */
export function MasterCopies() {
  const models = useEditor(useShallow((s) => [...new Set(s.setup!.originals.flatMap(({ model }) => (model ? [model] : [])))]));
  return models.map((model) => (
    <Suspense key={model} fallback={null}>
      <MasterCopy model={model} />
    </Suspense>
  ));
}
