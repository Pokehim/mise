import { Grid, OrbitControls, OrthographicCamera, PerspectiveCamera } from '@react-three/drei';
import { Canvas, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Color, type Group, type Mesh, type MeshBasicMaterial, type Object3D, Plane, Raycaster, Vector2, Vector3 } from 'three';
import type { Vec3 } from '@shared/types';
import { disposeSplit, splitNodes, splitScan } from '../scene/splitScan';
import { CeilingPlane, CornersOverlay, OpeningsOverlay, OriginalsOverlay } from './overlays';
import { scanTriangles, type StepId, useSetup } from './store';

export function SetupCanvas() {
  const set = useSetup((s) => s.set);
  return (
    <Canvas onCreated={({ gl }) => set({ renderer: gl })} gl={{ antialias: true }}>
      <color attach="background" args={['#1d1f23']} />
      <StepView />
    </Canvas>
  );
}

function StepView() {
  const step = useSetup((s) => s.step);
  const ceilingHeight = useSetup((s) => s.setup!.ceilingHeight);
  const bounds = useRoomBounds();
  const scanRef = useRef<Group>(null);
  useCeilingClip(step === 'level' || step === 'ceiling' ? null : ceilingHeight - 0.05);
  return (
    <>
      <StepCamera step={step} bounds={bounds} />
      <group ref={scanRef}>
        <ScanView />
      </group>
      {step === 'level' && (
        <Grid infiniteGrid cellSize={0.25} sectionSize={1} cellColor="#6b7280" sectionColor="#e5b567" fadeDistance={40} position={[0, 0.001, 0]} />
      )}
      {step === 'ceiling' && <CeilingPlane bounds={bounds} />}
      {step === 'corners' && <CornersOverlay bounds={bounds} />}
      {step === 'openings' && <OpeningsOverlay />}
      {(step === 'originals' || step === 'bake') && <OriginalsOverlay scan={scanRef} editable={step === 'originals'} />}
    </>
  );
}

/** The room's extent on the floor: the floor polygon once it exists, otherwise the scan's bounds. */
export interface RoomBounds { minX: number; maxX: number; minZ: number; maxZ: number; maxY: number }

function useRoomBounds(): RoomBounds {
  const scene = useSetup((s) => s.scene!);
  const meshTransform = useSetup((s) => s.manifest!.meshTransform);
  const polygon = useSetup((s) => s.setup!.floor.polygon);
  return useMemo(() => {
    const { positions } = scanTriangles(scene, meshTransform);
    const b = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity, maxY: -Infinity };
    for (let i = 0; i < positions.length; i += 3) {
      b.minX = Math.min(b.minX, positions[i]);
      b.maxX = Math.max(b.maxX, positions[i]);
      b.maxY = Math.max(b.maxY, positions[i + 1]);
      b.minZ = Math.min(b.minZ, positions[i + 2]);
      b.maxZ = Math.max(b.maxZ, positions[i + 2]);
    }
    if (polygon.length >= 3) {
      b.minX = Math.min(...polygon.map(([x]) => x));
      b.maxX = Math.max(...polygon.map(([x]) => x));
      b.minZ = Math.min(...polygon.map(([, z]) => z));
      b.maxZ = Math.max(...polygon.map(([, z]) => z));
    }
    return b;
  }, [scene, meshTransform, polygon]);
}

/** Corners looks straight down with North (−Z) up; Openings faces the selected wall; the rest orbit from above. */
function StepCamera({ step, bounds }: { step: StepId; bounds: RoomBounds }) {
  const size = useThree((s) => s.size);
  const walls = useSetup((s) => s.setup!.walls);
  const selectedWallId = useSetup((s) => s.selectedWallId);
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cz = (bounds.minZ + bounds.maxZ) / 2;
  const span = Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ, 1);

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
    const back = Math.max(1.6, 0.9 * Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]));
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
  const set = useSetup((s) => s.set);
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
    set({ lastSplitMs: split.ms });
    return () => disposeSplit(split.result);
  }, [split, set]);
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

/**
 * Calls `onClick` with the point and object under a click (not a drag) on any of `targets`.
 * Raycasting a 300k-triangle scan on every pointer move, as R3F's own events do, would stutter, so
 * this raycasts only on click.
 */
export function useClickRaycast(targets: () => Object3D[], onClick: (point: Vec3, object: Object3D) => void) {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const latest = useRef({ targets, onClick, camera });
  latest.current = { targets, onClick, camera };
  useEffect(() => {
    const element = gl.domElement;
    let down: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => { down = e.button === 0 ? { x: e.clientX, y: e.clientY } : null; };
    const onUp = (e: PointerEvent) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4 || consumeHandleClick()) return;
      const rect = element.getBoundingClientRect();
      const ndc = new Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      const raycaster = new Raycaster();
      raycaster.setFromCamera(ndc, latest.current.camera);
      const hit = raycaster.intersectObjects(latest.current.targets(), true)
        .find((h) => isShown(h.object) && !isClipped(h.point, gl.clippingPlanes));
      if (hit) latest.current.onClick(hit.point.toArray(), hit.object);
    };
    element.addEventListener('pointerdown', onDown);
    element.addEventListener('pointerup', onUp);
    return () => {
      element.removeEventListener('pointerdown', onDown);
      element.removeEventListener('pointerup', onUp);
    };
  }, [gl]);
}

const isClipped = (point: Vector3, planes: Plane[]) => planes.some((plane) => plane.distanceToPoint(point) < 0);

function isShown(object: Object3D | null): boolean {
  for (; object; object = object.parent) if (!object.visible) return false;
  return true;
}

// A drag that starts on a box handle must not also count as a click on the scan behind it.
let handleClick = false;
export const markHandleClick = () => { handleClick = true; };
function consumeHandleClick() {
  const was = handleClick;
  handleClick = false;
  return was;
}
