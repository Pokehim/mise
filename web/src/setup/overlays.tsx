// What each step draws over the scan, and its click handling.
import { Edges, Line } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import { memo, useMemo } from 'react';
import { DoubleSide } from 'three';
import type { Opening, Original, Vec2, Vec3, Wall } from '@shared/types';
import { BoxHandles } from './BoxHandles';
import { mm } from './geometry/mesh';
import { openingFromClicks } from './geometry/openings';
import { isNewCorner, type RoomBounds, wallAxis, withPolygon } from './geometry/walls';
import { Label } from './Label';
import { useSetup } from './store';
import { ACCENT, clickOnly } from './ui';

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
function snapCorner([x, z]: Vec2, polygon: Vec2[]): Vec2 {
  const tolerance = 0.08;
  const anchors = [polygon.at(-1), polygon[0]].filter((p): p is Vec2 => p !== undefined);
  const snap = (v: number, axis: 0 | 1) => anchors.map((p) => p[axis]).find((a) => Math.abs(a - v) < tolerance) ?? v;
  return [mm(snap(x, 0)), mm(snap(z, 1))];
}

/** Step 3: click the room's corners on the floor, seen from above. */
export function CornersOverlay({ bounds }: { bounds: RoomBounds }) {
  const { floor: { polygon }, walls, ceilingHeight } = useSetup((s) => s.setup!);
  const updateSetup = useSetup((s) => s.updateSetup);
  const y = ceilingHeight - 0.1;   // above the furniture, below the clipped-off ceiling
  const onClick = clickOnly((e) => {
    const corner = e.nativeEvent.altKey ? ([mm(e.point.x), mm(e.point.z)] as Vec2) : snapCorner([e.point.x, e.point.z], polygon);
    updateSetup((s) => (isNewCorner(s.floor.polygon, corner) ? withPolygon(s, [...s.floor.polygon, corner]) : s));
  });
  const outline = polygon.length >= 3 ? [...polygon, polygon[0]] : polygon;
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
  const { selectWall, updateSetup } = useSetup.getState();

  const onWallClick = (wall: Wall) => clickOnly((e) => {
    if (wall.id !== selectedWallId) {
      selectWall(wall.id);
      return;
    }
    const point = e.point.toArray() as Vec3;
    if (!draft.first) {
      useSetup.setState({ openingDraft: { ...draft, first: point } });
      return;
    }
    const rect = openingFromClicks(wall, draft.first, point, draft.kind);
    useSetup.setState({ openingDraft: { ...draft, first: undefined } });
    if (rect.width < 0.05 || rect.height < 0.05) return;
    updateSetup((s) => ({
      ...s,
      openings: [...s.openings, {
        id: nextId('op', s.openings), kind: draft.kind, wallId: wall.id, ...rect,
        ...(draft.kind === 'door' && { swing: draft.swing }),
      }],
    }));
  });

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

/** Steps 5 and 6: the Originals' boxes. In step 5 a box can be selected, and the selected one has handles. */
export function OriginalsOverlay({ editable }: { editable: boolean }) {
  const originals = useSetup((s) => s.setup!.originals);
  const selectedId = useSetup((s) => s.selectedOriginalId);
  return (
    <>
      {originals.map((original) => (
        <OriginalBox key={original.id} original={original} selected={editable && original.id === selectedId} editable={editable} />
      ))}
      {editable && selectedId && <BoxHandles originalId={selectedId} />}
    </>
  );
}

// Memoized, so dragging one box's handles doesn't rebuild every other box's lines.
const OriginalBox = memo(function OriginalBox({ original, selected, editable }: { original: Original; selected: boolean; editable: boolean }) {
  const { position, size: [w, h, d], rotationY } = original.box;
  const color = selected ? ACCENT : original.kept ? '#a78bfa' : '#34d399';
  const front = useMemo((): Vec3[] => [[-w / 2, 0.01, d / 2], [w / 2, 0.01, d / 2]], [w, d]);
  const select = clickOnly(() => useSetup.setState({ selectedOriginalId: original.id, notice: undefined }));
  return (
    <group position={position} rotation-y={rotationY}>
      <mesh position={[0, h / 2, 0]} onClick={editable ? select : undefined}>
        <boxGeometry args={[w, h, d]} />
        <meshBasicMaterial color={color} transparent opacity={selected ? 0.18 : 0.08} depthWrite={false} />
        <Edges color={color} />
      </mesh>
      {/* The front (+Z) edge on the floor. */}
      <Line points={front} color={color} lineWidth={4} />
      {/* Step 7: the simple Patch a replaced Original would leave, in its baked floorColor. */}
      {!editable && (
        <mesh position={[0, 0.004 - position[1], 0]} rotation-x={-Math.PI / 2}>
          <planeGeometry args={[w + 0.1, d + 0.1]} />
          <meshBasicMaterial color={original.floorColor} />
        </mesh>
      )}
      <Label position={[0, h + 0.1, 0]} text={`${original.label}${original.kept ? ' · Kept' : ''}`} selected={selected} />
    </group>
  );
});

/** The next free id with a prefix, such as op_3. */
function nextId(prefix: string, existing: { id: string }[]) {
  let n = 1;
  while (existing.some((e) => e.id === `${prefix}_${n}`)) n++;
  return `${prefix}_${n}`;
}

/** Step 6: the corners clicked so far, numbered in pairs, and the moved copies marked in the Fill Capture. */
export function FillsOverlay() {
  const fill = useSetup((s) => s.fill);
  const originals = useSetup((s) => s.setup!.originals);
  if (!fill?.scene) return null;
  const marker = (position: Vec3, text: string, key: string) => (
    <group key={key} position={position}>
      <mesh><sphereGeometry args={[0.07, 16, 12]} /><meshBasicMaterial color={ACCENT} /></mesh>
      <Label position={[0, 0.25, 0]} text={text} />
    </group>
  );
  return (
    <>
      {fill.roomCorners.map(([x, z], i) => marker([x, 0.02, z], `${i + 1}`, `room-${i}`))}
      <group position={fill.transform.position} rotation-y={fill.transform.rotationY}>
        {fill.fillCorners.map(([x, z], i) => marker([x, fill.floorHeight + 0.02, z], `${i + 1}`, `fill-${i}`))}
      </group>
      {Object.entries(fill.copies).map(([id, { box: { position, size: [w, h, d], rotationY } }]) => (
        <group key={id} position={position} rotation-y={rotationY}>
          <mesh position={[0, h / 2, 0]}>
            <boxGeometry args={[w, h, d]} />
            <meshBasicMaterial color="#60a5fa" transparent opacity={0.1} depthWrite={false} />
            <Edges color="#60a5fa" />
          </mesh>
          <Label position={[0, h + 0.1, 0]} text={`${originals.find((o) => o.id === id)?.label ?? id}, moved`} />
        </group>
      ))}
    </>
  );
}
