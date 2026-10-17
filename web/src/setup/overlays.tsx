// What each step draws over the scan, and its click handling.
import { Edges, Line } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import type { RefObject } from 'react';
import { DoubleSide, type Group, type Object3D } from 'three';
import type { Opening, Original, RoomSetup, Vec2, Vec3, Wall } from '@shared/types';
import { BoxHandles } from './BoxHandles';
import { autoBox } from './geometry/autoBox';
import { Label } from './Label';
import { openingFromClicks } from './geometry/openings';
import { wallAxis, wallsFromPolygon } from './geometry/walls';
import { handPlacedBox, newOriginal } from './originals';
import { type RoomBounds, useClickRaycast } from './SetupCanvas';
import { scanTriangles, useSetup } from './store';

const ACCENT = '#e5b567';

/** Step 2: the ceiling height as a translucent plane over the room. */
export function CeilingPlane({ bounds }: { bounds: RoomBounds }) {
  const height = useSetup((s) => s.setup!.ceilingHeight);
  return (
    <mesh position={[(bounds.minX + bounds.maxX) / 2, height, (bounds.minZ + bounds.maxZ) / 2]} rotation-x={-Math.PI / 2}>
      <planeGeometry args={[bounds.maxX - bounds.minX + 0.4, bounds.maxZ - bounds.minZ + 0.4]} />
      <meshBasicMaterial color={ACCENT} transparent opacity={0.35} side={DoubleSide} depthWrite={false} />
    </mesh>
  );
}

/** Corners within 8 cm of the previous or the first corner's x (or z) snap to it, so walls come out square. */
export function snapCorner([x, z]: Vec2, polygon: Vec2[]): Vec2 {
  const tolerance = 0.08;
  const anchors = [polygon.at(-1), polygon[0]].filter((p): p is Vec2 => p !== undefined);
  const snap = (v: number, axis: 0 | 1) => anchors.map((p) => p[axis]).find((a) => Math.abs(a - v) < tolerance) ?? v;
  return [mm(snap(x, 0)), mm(snap(z, 1))];
}

/**
 * The setup with a new floor polygon and its Walls. A Wall the Mover renamed keeps its name while
 * its edge is unchanged; every other Wall is named afresh, since a new corner can turn the room.
 */
export function withPolygon(setup: RoomSetup, polygon: Vec2[]): RoomSetup {
  const walls = polygon.length >= 3 ? wallsFromPolygon(polygon, setup.ceilingHeight) : [];
  const autoNames = new Map(wallsFromPolygon(setup.floor.polygon, setup.ceilingHeight).map((w) => [w.id, w.name]));
  const same = (a: Vec2, b: Vec2) => a[0] === b[0] && a[1] === b[1];
  const named = walls.map((wall) => {
    const old = setup.walls.find((w) => w.id === wall.id && same(w.start, wall.start) && same(w.end, wall.end));
    return old && old.name !== autoNames.get(old.id) ? { ...wall, name: old.name } : wall;
  });
  const ids = new Set(named.map((w) => w.id));
  return { ...setup, floor: { polygon }, walls: named, openings: setup.openings.filter((o) => ids.has(o.wallId)) };
}

/** Step 3: click the room's corners on the floor, seen from above. */
export function CornersOverlay({ bounds }: { bounds: RoomBounds }) {
  const { floor: { polygon }, walls, ceilingHeight } = useSetup((s) => s.setup!);
  const updateSetup = useSetup((s) => s.updateSetup);
  const y = ceilingHeight - 0.1;   // above the furniture, below the clipped-off ceiling
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 4) return;
    e.stopPropagation();
    const corner = e.nativeEvent.altKey ? ([mm(e.point.x), mm(e.point.z)] as Vec2) : snapCorner([e.point.x, e.point.z], polygon);
    updateSetup((s) => withPolygon(s, [...s.floor.polygon, corner]));
  };
  const outline = polygon.length >= 2 ? [...polygon, ...(polygon.length >= 3 ? [polygon[0]] : [])] : [];
  return (
    <>
      <mesh position={[(bounds.minX + bounds.maxX) / 2, 0, (bounds.minZ + bounds.maxZ) / 2]} rotation-x={-Math.PI / 2} onClick={onClick}>
        <planeGeometry args={[bounds.maxX - bounds.minX + 20, bounds.maxZ - bounds.minZ + 20]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      {outline.length >= 2 && (
        <Line points={outline.map(([x, z]) => [x, y, z] as Vec3)} color={ACCENT} lineWidth={3} depthTest={false} renderOrder={10} />
      )}
      {polygon.map(([x, z], i) => (
        <mesh key={i} position={[x, y, z]} renderOrder={11}>
          <sphereGeometry args={[0.05, 16, 8]} />
          <meshBasicMaterial color={i === 0 ? '#ffffff' : ACCENT} depthTest={false} />
        </mesh>
      ))}
      {walls.map((wall) => (
        <Label key={wall.id} text={wall.name}
          position={[(wall.start[0] + wall.end[0]) / 2 + wall.normal[0] * 0.25, y, (wall.start[1] + wall.end[1]) / 2 + wall.normal[1] * 0.25]} />
      ))}
    </>
  );
}

/** Step 4: pick a wall, then click two opposite corners of a door or window on it. */
export function OpeningsOverlay() {
  const { walls, openings } = useSetup((s) => s.setup!);
  const selectedWallId = useSetup((s) => s.selectedWallId);
  const draft = useSetup((s) => s.openingDraft);
  const { set, updateSetup } = useSetup.getState();

  const onWallClick = (wall: Wall) => (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 4) return;
    e.stopPropagation();
    if (wall.id !== selectedWallId) {
      set({ selectedWallId: wall.id, openingDraft: { ...draft, first: undefined } });
      return;
    }
    const point = e.point.toArray() as Vec3;
    if (!draft.first) {
      set({ openingDraft: { ...draft, first: point } });
      return;
    }
    const rect = openingFromClicks(wall, draft.first, point, draft.kind);
    set({ openingDraft: { ...draft, first: undefined } });
    if (rect.width < 0.05 || rect.height < 0.05) return;
    updateSetup((s) => ({
      ...s,
      openings: [...s.openings, {
        id: nextId('op', s.openings), kind: draft.kind, wallId: wall.id, ...rect,
        ...(draft.kind === 'door' && { swing: draft.swing }),
      }],
    }));
  };

  return (
    <>
      {walls.map((wall) => <WallPlane key={wall.id} wall={wall} selected={wall.id === selectedWallId} onClick={onWallClick(wall)} />)}
      {openings.map((opening) => {
        const wall = walls.find((w) => w.id === opening.wallId);
        return wall && <OpeningOutline key={opening.id} wall={wall} opening={opening} />;
      })}
      {draft.first && (
        <mesh position={draft.first}>
          <sphereGeometry args={[0.03, 16, 8]} />
          <meshBasicMaterial color={ACCENT} depthTest={false} />
        </mesh>
      )}
    </>
  );
}

function WallPlane({ wall, selected, onClick }: { wall: Wall; selected: boolean; onClick: (e: ThreeEvent<MouseEvent>) => void }) {
  const { length } = wallAxis(wall);
  const [nx, nz] = wall.normal;
  return (
    <mesh
      position={[(wall.start[0] + wall.end[0]) / 2 + nx * 0.002, wall.height / 2, (wall.start[1] + wall.end[1]) / 2 + nz * 0.002]}
      rotation-y={Math.atan2(nx, nz)}
      onClick={onClick}
    >
      <planeGeometry args={[length, wall.height]} />
      <meshBasicMaterial color="#60a5fa" transparent opacity={selected ? 0.12 : 0} depthWrite={false} />
    </mesh>
  );
}

/** An Opening's rectangle on its wall, and for a door, its swing on the floor. */
function OpeningOutline({ wall, opening }: { wall: Wall; opening: Opening }) {
  const { dx, dz } = wallAxis(wall);
  const [nx, nz] = wall.normal;
  const at = (along: number, y: number, out = 0.01): Vec3 =>
    [wall.start[0] + dx * along + nx * out, y, wall.start[1] + dz * along + nz * out];
  const { offset, width, bottom, height } = opening;
  const color = opening.kind === 'door' ? '#fb923c' : '#22d3ee';
  const rect = [at(offset, bottom), at(offset + width, bottom), at(offset + width, bottom + height), at(offset, bottom + height), at(offset, bottom)];
  let swing: Vec3[] | null = null;
  if (opening.kind === 'door' && opening.swing && opening.swing !== 'none') {
    // Seen from inside the room (facing −normal), "left" is the direction (−nz, nx).
    const leftIsAlong = -nz * dx + nx * dz > 0;
    const hinge = (opening.swing === 'in-left') === leftIsAlong ? offset + width : offset;
    const toLatch = hinge === offset ? 1 : -1;
    const [hx, , hz] = at(hinge, 0.01, 0);
    // From the hinge to the closed door's latch edge, then a quarter circle into the room.
    swing = [[hx, 0.01, hz], ...Array.from({ length: 17 }, (_, i): Vec3 => {
      const a = (i / 16) * (Math.PI / 2);
      return [hx + width * (Math.cos(a) * toLatch * dx + Math.sin(a) * nx), 0.01, hz + width * (Math.cos(a) * toLatch * dz + Math.sin(a) * nz)];
    })];
  }
  return (
    <>
      <Line points={rect} color={color} lineWidth={3} />
      {swing && <Line points={swing} color={color} lineWidth={2} dashed dashSize={0.05} gapSize={0.04} />}
      <Label position={at(offset + width / 2, bottom + height + 0.08)} text={opening.kind === 'door' ? 'Door' : 'Window'} />
    </>
  );
}

/** Steps 5 and 6: the Originals' boxes. In step 5, clicking furniture boxes it, and the selected box has handles. */
export function OriginalsOverlay({ scan, editable }: { scan: RefObject<Group | null>; editable: boolean }) {
  const originals = useSetup((s) => s.setup!.originals);
  const selectedId = useSetup((s) => s.selectedOriginalId);
  const step = useSetup((s) => s.step);
  const boxes = new Map<string, Object3D>();

  useClickRaycast(
    () => (editable && scan.current ? [scan.current, ...boxes.values()] : []),
    (point, object) => {
      const { setup, manifest, scene, tagCategory, set, updateSetup } = useSetup.getState();
      const hitBox = [...boxes].find(([, mesh]) => mesh === object)?.[0];
      if (hitBox) {
        set({ selectedOriginalId: hitBox, notice: undefined });
        return;
      }
      // Rugs are too flat for auto-box, and wall art too close to its wall: place those by hand.
      const byHand = tagCategory === 'rug' || tagCategory === 'wall_art' || tagCategory === 'mirror';
      // A bed's front is its foot; anything else faces away from the nearest wall.
      const facing = tagCategory === 'bed' ? 'length' : 'away-from-wall';
      const found = byHand ? null : autoBox(scanTriangles(scene!, manifest!.meshTransform), point, setup!, facing);
      const box = found ?? handPlacedBox(tagCategory, point, setup!.walls);
      const original = newOriginal(tagCategory, box, setup!.originals);
      updateSetup((s) => ({ ...s, originals: [...s.originals, original] }));
      set({
        selectedOriginalId: original.id,
        notice: found || byHand ? undefined : 'Auto-box found no furniture there, so this box has a default size. Drag its handles to fit.',
      });
    },
  );

  return (
    <>
      {originals.map((original) => (
        <OriginalBox key={original.id} original={original} selected={editable && original.id === selectedId}
          showPatch={step === 'bake'} register={(mesh) => { if (mesh) boxes.set(original.id, mesh); }} />
      ))}
      {editable && selectedId && <BoxHandles originalId={selectedId} />}
    </>
  );
}

function OriginalBox({ original, selected, showPatch, register }: {
  original: Original; selected: boolean; showPatch: boolean; register: (mesh: Object3D | null) => void;
}) {
  const { position, size: [w, h, d], rotationY } = original.box;
  const color = selected ? ACCENT : original.kept ? '#a78bfa' : '#34d399';
  return (
    <group position={position} rotation-y={rotationY}>
      <mesh ref={register} position={[0, h / 2, 0]}>
        <boxGeometry args={[w, h, d]} />
        <meshBasicMaterial color={color} transparent opacity={selected ? 0.18 : 0.08} depthWrite={false} />
        <Edges color={color} />
      </mesh>
      {/* The front (+Z) edge on the floor. */}
      <Line points={[[-w / 2, 0.01, d / 2], [w / 2, 0.01, d / 2]]} color={color} lineWidth={4} />
      {showPatch && (
        <mesh position={[0, 0.004 - position[1], 0]} rotation-x={-Math.PI / 2}>
          <planeGeometry args={[w + 0.1, d + 0.1]} />
          <meshBasicMaterial color={original.floorColor} />
        </mesh>
      )}
      <Label position={[0, h + 0.1, 0]} text={`${original.label}${original.kept ? ' · Kept' : ''}`} selected={selected} />
    </group>
  );
}

/** The next free id with a prefix, such as op_3. */
export function nextId(prefix: string, existing: { id: string }[]) {
  let n = 1;
  while (existing.some((e) => e.id === `${prefix}_${n}`)) n++;
  return `${prefix}_${n}`;
}

const mm = (v: number) => Math.round(v * 1000) / 1000;
