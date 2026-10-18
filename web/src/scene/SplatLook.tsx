// The splat look (spec §12, ADR-0005): the untouched room from the photoreal splat, and everything an
// Edit touched from the mesh. Drawn at the Real and Max levels when the Scan has a splat.
import { type ThreeElement, extend, useFrame, useThree } from '@react-three/fiber';
import { SparkRenderer, SplatEdit, SplatEditSdf, SplatEditSdfType, SplatMesh } from '@sparkjsdev/spark';
import { useEffect, useMemo, useRef } from 'react';
import type { Material, Mesh, Object3D } from 'three';
import type { Wall } from '@shared/types';
import { scanFileUrl } from '../api';
import { useEditor } from '../state/store';
import { AlignPicker, useAlign, useSplatTransform } from './AlignPanel';
import { type SdfBox, type SplatEditPlan, SLAB, splatEditPlan, wallSlab } from './splatEdits';
import type { SplitNodeData } from './splitScan';

extend({ SparkRenderer, SplatMesh, SplatEdit, SplatEditSdf });

declare module '@react-three/fiber' {
  interface ThreeElements {
    sparkRenderer: ThreeElement<typeof SparkRenderer>;
    splatMesh: ThreeElement<typeof SplatMesh>;
    splatEdit: ThreeElement<typeof SplatEdit>;
    splatEditSdf: ThreeElement<typeof SplatEditSdf>;
  }
}

/**
 * Splats drawn per frame. Spark builds a level of detail for the splat when it loads, and draws the
 * nearest detail within this budget. On the M3, lounge-v1's 1.18M splats ran at 13 fps in the Walk
 * view drawn whole, and 20 (Walk) to 27 (Dollhouse) at 250k, which looked the same up close.
 */
const LOD_BUDGET = 250_000;
/** How far out of the room a faded Wall's splats hide too, past the wall line. */
const FADE_OUTSIDE = 0.3;
const debug = new URLSearchParams(location.search).has('debug');

export function SplatLook() {
  const gl = useThree((s) => s.gl);
  const manifest = useEditor((s) => s.manifest!);
  const setup = useEditor((s) => s.setup!);
  const roomState = useEditor((s) => s.roomState!);
  const view = useEditor((s) => s.view);
  const meshOnly = useAlign((s) => s.picking === 'mesh');
  const { position, rotationY, scale } = useSplatTransform();

  // Stable args: new ones would make R3F build a new renderer, or load the splat again.
  const rendererArgs = useMemo(() => [{ renderer: gl, lodSplatCount: LOD_BUDGET }] as const, [gl]);
  const meshArgs = useMemo(() => [{ url: scanFileUrl(manifest.id, manifest.splat!), lod: true }] as const, [manifest.id, manifest.splat]);
  const plan = useMemo(() => splatEditPlan(setup, roomState), [setup, roomState]);

  return (
    <>
      <sparkRenderer args={rendererArgs}>
        <splatMesh name="splat" args={meshArgs} position={position} rotation-y={rotationY} scale={scale} visible={!meshOnly} />
      </sparkRenderer>
      {/* One SplatEdit: where boxes overlap, the box a splat is deepest inside wins, so an Opening's
          opacity-1 box keeps its splats inside a painted Wall's opacity-0 slab. */}
      <splatEdit name="touched">
        {plan.sdfs.map((box) => <Sdf key={box.id} box={box} />)}
      </splatEdit>
      <DollhouseCuts walls={setup.walls} ceiling={view === 'dollhouse' ? setup.ceilingHeight - 0.05 : null} />
      <MeshHider plan={plan} showAll={meshOnly} />
      {debug && <AlignPicker />}
    </>
  );
}

const sdfArgs = (opacity: number) => [{ type: SplatEditSdfType.BOX, opacity }] as const;

/** A SplatEditSdf BOX for an SdfBox. Spark reads a box's scale as its half-extents. */
function Sdf({ box: { center, size, rotationY, opacity }, sdfRef }: { box: SdfBox; sdfRef?: (sdf: SplatEditSdf | null) => void }) {
  const args = useMemo(() => sdfArgs(opacity), [opacity]);
  return (
    <splatEditSdf
      ref={sdfRef}
      args={args}
      opacity={opacity}
      position={center}
      rotation-y={rotationY}
      scale={[size[0] / 2, size[1] / 2, size[2] / 2]}
    />
  );
}

/**
 * A second SplatEdit, multiplied over the first, for the Dollhouse view: each Wall's splats fade with
 * its mesh node (WallFader), and everything above the ceiling cut hides. A separate edit, so a Wall
 * that isn't faded (opacity 1) can't win back splats the first edit hides.
 */
function DollhouseCuts({ walls, ceiling }: { walls: Wall[]; ceiling: number | null }) {
  const scene = useThree((s) => s.scene);
  const sdfs = useRef(new Map<string, SplatEditSdf>());
  const slabs = useMemo(() => walls.map((wall) => wallSlab(wall, SLAB, FADE_OUTSIDE)), [walls]);

  useFrame(() => {
    const scan = scene.getObjectByName('scan');
    if (!scan) return;
    scan.traverse((node) => {
      const data = node.userData as Partial<SplitNodeData> & { opacity?: number };
      if (data.kind !== 'wall' || !data.id) return;
      const sdf = sdfs.current.get(data.id);
      const fade = node.visible ? data.opacity ?? 1 : 0;
      if (sdf && sdf.opacity !== fade) sdf.opacity = fade;
    });
  });

  return (
    <splatEdit name="dollhouse">
      {slabs.map((slab) => (
        <Sdf key={slab.id} box={{ ...slab, opacity: 1 }} sdfRef={(sdf) => {
          if (sdf) sdfs.current.set(slab.id, sdf);
          else sdfs.current.delete(slab.id);
        }} />
      ))}
      {ceiling !== null && <Sdf box={{ id: 'ceiling', center: [0, ceiling + 50, 0], size: [200, 100, 200], rotationY: 0, opacity: 0 }} />}
    </splatEdit>
  );
}

/** What a material's flags were before MeshHider turned it off, to put back. */
const original = new WeakMap<Material, { colorWrite: boolean; depthWrite: boolean }>();

/**
 * Hides every untouched mesh node by not drawing it, rather than making it invisible: it still
 * takes clicks, so selecting an Original or Wall through the splat works as before. Every frame,
 * since other components swap and fade the nodes' materials.
 */
function MeshHider({ plan, showAll }: { plan: SplatEditPlan; showAll: boolean }) {
  const scene = useThree((s) => s.scene);
  const touched = useMemo(() => new Set([...plan.mesh.walls, ...plan.mesh.originals]), [plan]);

  const apply = (shows: (data: Partial<SplitNodeData>) => boolean) => {
    const scan = scene.getObjectByName('scan');
    if (!scan) return;
    const visit = (node: Object3D, show: boolean | null) => {
      const data = node.userData as Partial<SplitNodeData>;
      const here = data.kind ? shows(data) : show;
      const mesh = node as Mesh;
      if (mesh.isMesh && here !== null) {
        for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) setDrawn(material, here);
      }
      for (const child of node.children) visit(child, here);
    };
    visit(scan, null);
  };

  useFrame(() => apply((data) => showAll || isShown(data, touched, plan.mesh.floor)));
  // Back to the mesh look when the splat look goes.
  useEffect(() => () => apply(() => true), [scene]);
  return null;
}

function isShown({ kind, id }: Partial<SplitNodeData>, touched: Set<string>, floor: boolean): boolean {
  switch (kind) {
    case 'patch': return true;
    case 'floor': return floor;
    case 'wall':
    case 'original': return touched.has(id!);
    default: return false;   // the Shell and Ceiling: the splat has them
  }
}

function setDrawn(material: Material, drawn: boolean) {
  if (!original.has(material)) original.set(material, { colorWrite: material.colorWrite, depthWrite: material.depthWrite });
  const flags = original.get(material)!;
  material.colorWrite = drawn && flags.colorWrite;
  material.depthWrite = drawn && flags.depthWrite;
}
