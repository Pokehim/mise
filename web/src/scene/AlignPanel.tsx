// The Align panel (spec §12, ADR-0005), debug mode only: click the same points on the splat and on
// the mesh, fit yaw, scale and translation, fine-tune with sliders, and save splatTransform.
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useState } from 'react';
import { type Object3D, Raycaster, Vector2, Vector3 } from 'three';
import { create } from 'zustand';
import type { ScanManifest, Vec3 } from '@shared/types';
import { saveManifest } from '../api';
import { useEditor } from '../state/store';
import { clickTolerancePx, isDrawn } from './objects';

export type SplatTransform = NonNullable<ScanManifest['splatTransform']>;

export interface PointPairFit {
  transform: SplatTransform;
  /** Root-mean-square distance, in meters, between each room point and its fitted splat point. */
  rms: number;
}

/**
 * Solves for the yaw, uniform scale and translation that best carry `splat` points onto the matching
 * `room` points, in the least-squares sense (a 2D Umeyama fit about +Y). The splat is already level
 * (#12), so there is no tilt.
 *
 * The transform composes like an Object3D's: room = position + rotateY(rotationY, scale · splat),
 * which is how splatTransform is applied to the SplatMesh.
 *
 * Throws unless there are at least 2 pairs, the same number on each side, and the splat points
 * aren't all the same point.
 */
export function fitPointPairs(splat: Vec3[], room: Vec3[]): PointPairFit {
  if (splat.length !== room.length) throw new Error('Click the same number of points on the splat and on the mesh');
  if (splat.length < 2) throw new Error('Click at least 2 matching points');

  const ps = centroid(splat);
  const pr = centroid(room);
  let cos = 0;
  let sin = 0;
  let spread = 0;
  for (let i = 0; i < splat.length; i++) {
    const [ax, ay, az] = sub(splat[i], ps);
    const [bx, , bz] = sub(room[i], pr);
    cos += ax * bx + az * bz;
    sin += az * bx - ax * bz;
    spread += ax * ax + ay * ay + az * az;
  }
  if (spread < 1e-12) throw new Error('The splat points are all the same point');

  const rotationY = Math.atan2(sin, cos);
  // Σ b · R(a) over all three axes, so height differences count toward the scale too.
  let along = 0;
  for (let i = 0; i < splat.length; i++) {
    const a = sub(splat[i], ps);
    const b = sub(room[i], pr);
    const ra = rotateY(a, rotationY);
    along += b[0] * ra[0] + b[1] * ra[1] + b[2] * ra[2];
  }
  const scale = along / spread;
  const rp = rotateY(ps, rotationY);
  const position: Vec3 = [pr[0] - scale * rp[0], pr[1] - scale * rp[1], pr[2] - scale * rp[2]];
  const transform = { position, rotationY, scale };

  let squared = 0;
  for (let i = 0; i < splat.length; i++) {
    const [dx, dy, dz] = sub(applySplatTransform(transform, splat[i]), room[i]);
    squared += dx * dx + dy * dy + dz * dz;
  }
  return { transform, rms: Math.sqrt(squared / splat.length) };
}

/** Carries a point from the splat frame to the room frame. */
export function applySplatTransform({ position, rotationY, scale }: SplatTransform, point: Vec3): Vec3 {
  const [x, y, z] = rotateY(point, rotationY);
  return [position[0] + scale * x, position[1] + scale * y, position[2] + scale * z];
}

// Same convention as three's Matrix4.makeRotationY.
function rotateY([x, y, z]: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [c * x + s * z, y, -s * x + c * z];
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

function centroid(points: Vec3[]): Vec3 {
  const sum: Vec3 = [0, 0, 0];
  for (const [x, y, z] of points) { sum[0] += x; sum[1] += y; sum[2] += z; }
  return [sum[0] / points.length, sum[1] / points.length, sum[2] / points.length];
}

export const IDENTITY: SplatTransform = { position: [0, 0, 0], rotationY: 0, scale: 1 };

interface AlignState {
  /** The transform being tuned, shown live; null shows the manifest's. */
  draft: SplatTransform | null;
  /** Which look the clicks pick points on. While picking on the mesh, the splat hides and every mesh node shows. */
  picking: 'splat' | 'mesh' | null;
  splatPoints: Vec3[];   // in the splat's own frame
  roomPoints: Vec3[];    // in the room frame
  rms: number | null;
}

export const useAlign = create<AlignState>()(() => ({ draft: null, picking: null, splatPoints: [], roomPoints: [], rms: null }));

/** The splatTransform SplatLook draws with: the draft while aligning, else the manifest's. */
export function useSplatTransform(): SplatTransform {
  const draft = useAlign((s) => s.draft);
  const saved = useEditor((s) => s.manifest?.splatTransform);
  return draft ?? saved ?? IDENTITY;
}

/** Inside the Canvas: turns clicks into points while picking, and marks the points picked so far. */
export function AlignPicker() {
  const picking = useAlign((s) => s.picking);
  const { splatPoints, roomPoints } = useAlign();
  const { gl, camera, scene } = useThree();
  const [splat, setSplat] = useState<Object3D | null>(null);
  useFrame(() => {
    const found = scene.getObjectByName('splat') ?? null;
    if (found !== splat) setSplat(found);
  });

  useEffect(() => {
    if (!picking) return;
    const canvas = gl.domElement;
    let down: { x: number; y: number } | null = null;
    const onDown = (event: PointerEvent) => { down = { x: event.clientX, y: event.clientY }; };
    // Captured on the canvas, so the click picks a point instead of selecting or walking.
    const onClick = (event: MouseEvent) => {
      event.stopPropagation();
      if (!down || Math.hypot(event.clientX - down.x, event.clientY - down.y) > clickTolerancePx()) return;
      const { left, top, width, height } = canvas.getBoundingClientRect();
      const raycaster = new Raycaster();
      raycaster.setFromCamera(new Vector2(((event.clientX - left) / width) * 2 - 1, -((event.clientY - top) / height) * 2 + 1), camera);
      const target = scene.getObjectByName(picking === 'splat' ? 'splat' : 'scan');
      if (!target) return;
      const hit = raycaster.intersectObject(target, true).find((h) => picking === 'splat' || isDrawn(h));
      if (!hit) return;
      const point = picking === 'splat' ? target.worldToLocal(hit.point.clone()) : hit.point;
      const key = picking === 'splat' ? 'splatPoints' : 'roomPoints';
      useAlign.setState((s) => ({ [key]: [...s[key], point.toArray() as Vec3] }));
    };
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('click', onClick, true);
    return () => {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('click', onClick, true);
    };
  }, [picking, gl, camera, scene]);

  const toWorld = (p: Vec3) => (splat ? splat.localToWorld(new Vector3(...p)).toArray() as Vec3 : p);
  return (
    <group name="align-points">
      {splatPoints.map((p, i) => <Marker key={`s${i}`} at={toWorld(p)} color="#e8743b" />)}
      {roomPoints.map((p, i) => <Marker key={`r${i}`} at={p} color="#1f7a6d" />)}
    </group>
  );
}

function Marker({ at, color }: { at: Vec3; color: string }) {
  return (
    <mesh position={at} renderOrder={10}>
      <sphereGeometry args={[0.04, 16, 8]} />
      <meshBasicMaterial color={color} depthTest={false} />
    </mesh>
  );
}

const DEG = 180 / Math.PI;
const panel = {
  position: 'absolute', top: 8, right: 8, width: 260, padding: 10, display: 'flex', flexDirection: 'column', gap: 6,
  background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 8, fontSize: 13,
} as const;

/** Over the 3D view: the point-pair fit, the fine-tune sliders, and Save. */
export function AlignPanel() {
  const manifest = useEditor((s) => s.manifest!);
  const { picking, splatPoints, roomPoints, rms, draft } = useAlign();
  const transform = useSplatTransform();
  const [status, setStatus] = useState<string | null>(null);
  // The sliders range around this, set by Fit and Revert, so they don't move while dragged.
  const [anchor, setAnchor] = useState(transform);
  const pairs = Math.min(splatPoints.length, roomPoints.length);
  const tune = (change: Partial<SplatTransform>) => useAlign.setState({ draft: { ...transform, ...change } });

  const fit = () => {
    try {
      const result = fitPointPairs(splatPoints, roomPoints);
      useAlign.setState({ draft: result.transform, rms: result.rms });
      setAnchor(result.transform);
      setStatus(null);
    } catch (error) {
      setStatus((error as Error).message);
    }
  };
  const save = async () => {
    try {
      const saved = await saveManifest({ ...manifest, splatTransform: transform });
      useEditor.setState({ manifest: saved });
      useAlign.setState({ draft: null });
      setStatus('Saved to the manifest');
    } catch (error) {
      setStatus((error as Error).message);
    }
  };
  const pick = (side: 'splat' | 'mesh') => useAlign.setState({ picking: picking === side ? null : side });
  const undo = () => useAlign.setState((s) => (picking === 'mesh' ? { roomPoints: s.roomPoints.slice(0, -1) } : { splatPoints: s.splatPoints.slice(0, -1) }));

  const slider = (label: string, value: number, min: number, max: number, step: number, set: (v: number) => void, shown = value.toFixed(3)) => (
    <label style={{ display: 'grid', gridTemplateColumns: '44px 1fr 56px', alignItems: 'center', gap: 6 }}>
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => set(Number(e.target.value))} />
      <span className="muted">{shown}</span>
    </label>
  );
  const [x, y, z] = transform.position;
  const [ax, ay, az] = anchor.position;
  return (
    <div style={panel}>
      <strong>Align the splat</strong>
      <span className="muted">Click the same floor-level room corners, in the same order, on each look.</span>
      <div style={{ display: 'flex', gap: 6 }}>
        <button type="button" aria-pressed={picking === 'splat'} onClick={() => pick('splat')}>Splat ({splatPoints.length})</button>
        <button type="button" aria-pressed={picking === 'mesh'} onClick={() => pick('mesh')}>Mesh ({roomPoints.length})</button>
        <button type="button" disabled={!picking} onClick={undo}>Undo</button>
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <button type="button" disabled={pairs < 3 || splatPoints.length !== roomPoints.length} onClick={fit}>Fit</button>
        <button type="button" onClick={() => useAlign.setState({ splatPoints: [], roomPoints: [], rms: null })}>Clear points</button>
      </div>
      {rms !== null && <span className="muted">Fit error: {(rms * 100).toFixed(1)} cm RMS</span>}
      {slider('x', x, ax - 1, ax + 1, 0.005, (v) => tune({ position: [v, y, z] }))}
      {slider('y', y, ay - 1, ay + 1, 0.005, (v) => tune({ position: [x, v, z] }))}
      {slider('z', z, az - 1, az + 1, 0.005, (v) => tune({ position: [x, y, v] }))}
      {slider('yaw', transform.rotationY * DEG, -180, 180, 0.1, (v) => tune({ rotationY: v / DEG }), `${(transform.rotationY * DEG).toFixed(1)}°`)}
      {slider('scale', transform.scale, anchor.scale * 0.8, anchor.scale * 1.25, 0.001, (v) => tune({ scale: v }))}
      <div style={{ display: 'flex', gap: 6 }}>
        <button type="button" onClick={save}>Save</button>
        <button type="button" disabled={!draft} onClick={() => {
          useAlign.setState({ draft: null });
          setAnchor(manifest.splatTransform ?? IDENTITY);
        }}>Revert</button>
      </div>
      {status && <span className="muted">{status}</span>}
    </div>
  );
}
