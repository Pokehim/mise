import { Grid, OrbitControls, OrthographicCamera, PerspectiveCamera } from '@react-three/drei';
import { Canvas, type RootState, type RootStore, events, useThree } from '@react-three/fiber';
import { memo, useEffect, useMemo, useState } from 'react';
import { Box3, Color, type Intersection, type Mesh, type MeshBasicMaterial, type Object3D, Plane, Vector3 } from 'three';
import type { Vec3 } from '@shared/types';
import { disposeSplit, splitNodes, splitScan } from '../scene/splitScan';
import { SPLIT } from './geometry/classify';
import { type RoomBounds, polygonBounds, wallAxis } from './geometry/walls';
import { tagOriginalAt } from './originals';
import { CeilingPlane, CornersOverlay, OpeningsOverlay, OriginalsOverlay } from './overlays';
import { scanTriangles, type StepId, useSetup } from './store';
import { ACCENT, clickOnly } from './ui';

// Memoized: the page re-renders on every store change, and the scene subscribes to what it needs.
export const SetupCanvas = memo(function SetupCanvas() {
  return (
    <Canvas onCreated={({ gl }) => useSetup.setState({ renderer: gl })} events={visibleHitsOnly} gl={{ antialias: true }}>
      <color attach="background" args={['#1d1f23']} />
      <StepView />
    </Canvas>
  );
});

/**
 * R3F's pointer events, minus hits nobody can see: above the ceiling clip, or on a hidden Original
 * (three's raycaster tests both). A click then reaches the furniture, not the clipped-off ceiling.
 */
function visibleHitsOnly(store: RootStore) {
  return {
    ...events(store),
    filter: (hits: Intersection[], state: RootState) => hits.filter(({ object, point }) =>
      isShown(object) && !state.gl.clippingPlanes.some((plane) => plane.distanceToPoint(point) < 0)),
  };
}

function isShown(object: Object3D | null): boolean {
  for (; object; object = object.parent) if (!object.visible) return false;
  return true;
}

function StepView() {
  const step = useSetup((s) => s.step);
  const ceilingHeight = useSetup((s) => s.setup!.ceilingHeight);
  // While corners are being clicked, frame the whole scan, not the polygon so far.
  const bounds = useRoomBounds(step !== 'corners');
  useCeilingClip(step === 'level' || step === 'ceiling' ? null : ceilingHeight - SPLIT.ceilingBand);
  const tagOnClick = clickOnly((e) => tagOriginalAt(e.point.toArray()));
  return (
    <>
      <StepCamera step={step} bounds={bounds} />
      <group onClick={step === 'originals' ? tagOnClick : undefined}>
        <ScanView />
      </group>
      {step === 'level' && (
        <Grid infiniteGrid cellSize={0.25} sectionSize={1} cellColor="#6b7280" sectionColor={ACCENT} fadeDistance={40} position={[0, 0.001, 0]} />
      )}
      {step === 'ceiling' && <CeilingPlane bounds={bounds} />}
      {step === 'corners' && <CornersOverlay bounds={bounds} />}
      {step === 'openings' && <OpeningsOverlay />}
      {(step === 'originals' || step === 'bake') && <OriginalsOverlay editable={step === 'originals'} />}
    </>
  );
}

/** The room's extent on the floor: the floor polygon once it exists (and `usePolygon`), otherwise the scan's bounds. */
function useRoomBounds(usePolygon: boolean): RoomBounds {
  const scene = useSetup((s) => s.scene!);
  const meshTransform = useSetup((s) => s.manifest!.meshTransform);
  const polygon = useSetup((s) => s.setup!.floor.polygon);
  const scanBounds = useMemo(() => {
    const { min, max } = new Box3().setFromArray(scanTriangles(scene, meshTransform).positions);
    return { minX: min.x, maxX: max.x, minZ: min.z, maxZ: max.z };
  }, [scene, meshTransform]);
  return useMemo(() => (usePolygon && polygon.length >= 3 ? polygonBounds(polygon) : scanBounds), [scanBounds, polygon, usePolygon]);
}

/** Corners looks straight down with North (−Z) up; Openings faces the selected wall; the rest orbit from above. */
function StepCamera({ step, bounds }: { step: StepId; bounds: RoomBounds }) {
  const size = useThree((s) => s.size);
  const walls = useSetup((s) => s.setup!.walls);
  const selectedWallId = useSetup((s) => s.selectedWallId);
  // Framing rounded to 10 cm, so small edits (a Level slider tick) don't reset the camera.
  const round = (v: number) => Math.round(v * 10) / 10;
  const cx = round((bounds.minX + bounds.maxX) / 2);
  const cz = round((bounds.minZ + bounds.maxZ) / 2);
  const span = Math.max(round(bounds.maxX - bounds.minX), round(bounds.maxZ - bounds.minZ), 1);

  if (step === 'corners') {
    const zoom = 0.85 * Math.min(size.width / (bounds.maxX - bounds.minX + 0.5), size.height / (bounds.maxZ - bounds.minZ + 0.5));
    return (
      <>
        <OrthographicCamera makeDefault key={`top-${cx}-${cz}`} position={[cx, 30, cz]} up={[0, 0, -1]} zoom={zoom} near={0.1} far={100}
          onUpdate={(c) => c.lookAt(cx, 0, cz)} />
        <OrbitControls makeDefault key={`top-controls-${cx}-${cz}`} target={[cx, 0, cz]} enableRotate={false} screenSpacePanning />
      </>
    );
  }
  const wall = step === 'openings' ? walls.find((w) => w.id === selectedWallId) : undefined;
  let position: Vec3 = [cx + span * 0.55, span * 1.15 + 1, cz + span * 0.85];
  let target: Vec3 = [cx, 0.8, cz];
  if (wall) {
    const mid = [(wall.start[0] + wall.end[0]) / 2, (wall.start[1] + wall.end[1]) / 2];
    const back = Math.max(1.6, 0.9 * wallAxis(wall).length);
    target = [mid[0], wall.height / 2, mid[1]];
    position = [mid[0] + wall.normal[0] * back, wall.height / 2, mid[1] + wall.normal[1] * back];
  }
  const key = `${step}-${wall?.id ?? ''}-${position.join()}`;
  return (
    <>
      <PerspectiveCamera makeDefault key={`cam-${key}`} position={position} fov={55} near={0.02} far={200} />
      <OrbitControls makeDefault key={`controls-${key}`} target={target} />
    </>
  );
}

/** Hides what is above `height`, as the editor's Dollhouse hides the ceiling. Null clips nothing. */
function useCeilingClip(height: number | null) {
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    gl.clippingPlanes = height === null ? [] : [new Plane(new Vector3(0, -1, 0), height)];
    return () => { gl.clippingPlanes = []; };
  }, [gl, height]);
}

/** The raw scan under its meshTransform, or with "Preview split" on, splitScan's nodes. */
function ScanView() {
  const preview = useSetup((s) => s.preview);
  return preview ? <SplitPreview /> : <RawScan />;
}

function RawScan() {
  const scene = useSetup((s) => s.scene!);
  const { position, rotationY } = useSetup((s) => s.manifest!.meshTransform);
  return (
    <group position={position} rotation-y={rotationY}>
      <primitive object={scene} />
    </group>
  );
}

// Tints for the split preview: Shell, Floor and Ceiling, then one hue per Wall and Original.
const FIXED_TINTS = ['#9ca3af', '#4ade80', '#93c5fd'];
const tint = (i: number) => (i < 3 ? FIXED_TINTS[i] : `hsl(${((i - 3) * 137.5 + 20) % 360}, 85%, 62%)`);

function SplitPreview() {
  const scene = useSetup((s) => s.scene!);
  const setup = useDebounced(useSetup((s) => s.setup!), 250);
  const manifest = useDebounced(useSetup((s) => s.manifest!), 250);
  const hidden = useSetup((s) => s.hiddenOriginals);
  const split = useMemo(() => {
    const started = performance.now();
    const result = splitScan(scene, setup, manifest);
    const ms = performance.now() - started;
    splitNodes(result).forEach((node, i) => node.traverse((child) => {
      if ((child as Mesh).isMesh) ((child as Mesh).material as MeshBasicMaterial).color.multiply(new Color(tint(i)));
    }));
    return { result, ms };
  }, [scene, setup, manifest]);
  useEffect(() => {
    useSetup.setState({ lastSplitMs: split.ms });
    return () => disposeSplit(split.result);
  }, [split]);
  return (
    <>
      {splitNodes(split.result).map((node) => (
        <primitive key={node.uuid} object={node}
          visible={!(node.userData.kind === 'original' && hidden[node.userData.id as string])} />
      ))}
    </>
  );
}

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}
