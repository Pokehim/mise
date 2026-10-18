// What each step draws over the scan, and its click handling. The marks follow the sketch style
// (docs/design/sketch-style.md): linework in ink, what is chosen in the wash, openings and guides in
// graphite, dashed where they are construction lines. Nothing tints the Scan itself.
import type { ThreeEvent } from '@react-three/fiber';
import { type Dispatch, memo, type SetStateAction, useMemo, useState } from 'react';
import { DoubleSide } from 'three';
import type { Opening, Original, Vec2, Vec3, Wall } from '@shared/types';
import { DASH, InkLine } from '../scene/sketch/InkLine';
import { boxEdges, sketchBox, visibleSegments } from '../scene/sketch/lines';
import { BoxHandles } from './BoxHandles';
import { Dot } from './Dot';
import { SPLIT } from './geometry/classify';
import { mm } from './geometry/mesh';
import { openingFromClicks } from './geometry/openings';
import { isNewCorner, type RoomBounds, wallAxis, withPolygon } from './geometry/walls';
import { Label } from './Label';
import { useSetup } from './store';
import { clickOnly, tone } from './ui';

/** Line segments (pairs of points) along a path of points. */
const path = (points: Vec3[]) => points.slice(1).flatMap((point, i): Vec3[] => [points[i], point]);

/** Step 2: the ceiling height, as a sheet of the wash with a dashed edge, over the room. */
export function CeilingPlane({ bounds }: { bounds: RoomBounds }) {
  const height = useSetup((s) => s.setup!.ceilingHeight);
  const [x0, x1, z0, z1] = [bounds.minX - 0.2, bounds.maxX + 0.2, bounds.minZ - 0.2, bounds.maxZ + 0.2];
  const edge = useMemo(() => path([[x0, height, z0], [x1, height, z0], [x1, height, z1], [x0, height, z1], [x0, height, z0]]), [x0, x1, z0, z1, height]);
  return (
    <>
      <mesh position={[(x0 + x1) / 2, height, (z0 + z1) / 2]} rotation-x={-Math.PI / 2}>
        <planeGeometry args={[x1 - x0, z1 - z0]} />
        <meshBasicMaterial color={tone('--wash')} transparent opacity={0.18} side={DoubleSide} depthWrite={false} toneMapped={false} />
      </mesh>
      <InkLine segments={edge} color="--wash" width={1.5} dash={DASH} />
    </>
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
  const outline = useMemo(() => {
    const closed = polygon.length >= 3 ? [...polygon, polygon[0]] : polygon;
    return path(closed.map(([x, z]): Vec3 => [x, y, z]));
  }, [polygon, y]);
  return (
    <>
      <mesh position={[(bounds.minX + bounds.maxX) / 2, 0, (bounds.minZ + bounds.maxZ) / 2]} rotation-x={-Math.PI / 2} onClick={onClick}>
        <planeGeometry args={[bounds.maxX - bounds.minX + 20, bounds.maxZ - bounds.minZ + 20]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <InkLine segments={outline} width={2} />
      {/* The first corner is open, where the outline closes; the others are ink. */}
      {polygon.map(([x, z], i) => (i === 0
        ? <Dot key={i} position={[x, y, z]} size={13} fill="--paper-raised" />
        : <Dot key={i} position={[x, y, z]} />))}
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
      {draft.first && <Dot position={draft.first} size={11} fill="--wash" ring="--paper-raised" />}
    </>
  );
}

/** A Wall, as a plane to click (unseen), and when it is the chosen one, its outline in the wash. */
function WallPlane({ wall, selected, onClick }: { wall: Wall; selected: boolean; onClick: (e: ThreeEvent<MouseEvent>) => void }) {
  const { length } = wallAxis(wall);
  const [nx, nz] = wall.normal;
  const outline = useMemo(() => {
    // The top stays under the ceiling clip, so it shows.
    const top = wall.height - SPLIT.ceilingBand - 0.03;
    const at = ([x, z]: Vec2, y: number): Vec3 => [x + nx * 0.01, y, z + nz * 0.01];
    return path([at(wall.start, 0.01), at(wall.end, 0.01), at(wall.end, top), at(wall.start, top), at(wall.start, 0.01)]);
  }, [wall, nx, nz]);
  return (
    <>
      <mesh
        position={[(wall.start[0] + wall.end[0]) / 2 + nx * 0.002, wall.height / 2, (wall.start[1] + wall.end[1]) / 2 + nz * 0.002]}
        rotation-y={Math.atan2(nx, nz)}
        onClick={onClick}
      >
        <planeGeometry args={[length, wall.height]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      {selected && <InkLine segments={outline} color="--wash" width={2.5} />}
    </>
  );
}

/** An Opening's rectangle on its wall in graphite, and for a door, its swing on the floor, dashed. */
function OpeningOutline({ wall, opening }: { wall: Wall; opening: Opening }) {
  const { dx, dz } = wallAxis(wall);
  const [nx, nz] = wall.normal;
  const at = (along: number, y: number, out = 0.01): Vec3 =>
    [wall.start[0] + dx * along + nx * out, y, wall.start[1] + dz * along + nz * out];
  const { offset, width, bottom, height } = opening;
  const rect = path([at(offset, bottom), at(offset + width, bottom), at(offset + width, bottom + height), at(offset, bottom + height), at(offset, bottom)]);
  let swing: Vec3[] = [];
  if (opening.kind === 'door' && opening.swing && opening.swing !== 'none') {
    // Seen from inside the room (facing −normal), "left" is the direction (−nz, nx).
    const leftIsAlong = -nz * dx + nx * dz > 0;
    const hinge = (opening.swing === 'in-left') === leftIsAlong ? offset + width : offset;
    const toLatch = hinge === offset ? 1 : -1;
    const [hx, , hz] = at(hinge, 0.01, 0);
    // From the hinge to the closed door's latch edge, then a quarter circle into the room.
    swing = path([[hx, 0.01, hz], ...Array.from({ length: 17 }, (_, i): Vec3 => {
      const a = (i / 16) * (Math.PI / 2);
      return [hx + width * (Math.cos(a) * toLatch * dx + Math.sin(a) * nx), 0.01, hz + width * (Math.cos(a) * toLatch * dz + Math.sin(a) * nz)];
    })]);
  }
  return (
    <>
      <InkLine segments={rect} color="--graphite" width={2} />
      <InkLine segments={swing} color="--graphite" width={1.5} dash={DASH} />
      {/* In the middle of the opening: above it, the ceiling clip would cut the label. */}
      <Label position={at(offset + width / 2, bottom + height / 2)} priority={1} text={opening.kind === 'door' ? 'Door' : 'Window'} />
    </>
  );
}

/**
 * Steps 5 and 7: the Originals' boxes. In step 5 a box can be selected, and the selected one has
 * handles; while one is, the others' names are left out, unless hovered, so none covers a handle.
 */
export function OriginalsOverlay({ editable }: { editable: boolean }) {
  const originals = useSetup((s) => s.setup!.originals);
  const selectedId = useSetup((s) => (editable ? s.selectedOriginalId : undefined));
  const [hoveredId, setHoveredId] = useState<string>();
  return (
    <>
      {originals.map((original) => (
        <OriginalBox key={original.id} original={original} selected={original.id === selectedId} editable={editable}
          named={!selectedId || original.id === selectedId || original.id === hoveredId} hovered={original.id === hoveredId} onHover={setHoveredId} />
      ))}
      {selectedId && <BoxHandles originalId={selectedId} />}
    </>
  );
}

interface OriginalBoxProps {
  original: Original;
  selected: boolean;
  editable: boolean;
  /** Whether its name shows. */
  named: boolean;
  hovered: boolean;
  onHover: Dispatch<SetStateAction<string | undefined>>;
}

// Memoized, so dragging one box's handles doesn't rebuild every other box's lines.
const OriginalBox = memo(function OriginalBox({ original, selected, editable, named, hovered, onHover }: OriginalBoxProps) {
  const { position, size, rotationY } = original.box;
  const [w, h, d] = size;
  // Ruled in ink, dashed when Kept (it stays where it is); the selected one sketched in the wash.
  const edges = useMemo(() => (selected ? visibleSegments(sketchBox([w, h, d], original.id), 0b111111) : { segments: boxEdges([w, h, d]), length: 0 }),
    [selected, w, h, d, original.id]);
  const front = useMemo((): Vec3[] => [[-w / 2, 0.01, d / 2], [w / 2, 0.01, d / 2]], [w, d]);
  const color = selected ? '--wash' : '--ink';
  const select = clickOnly(() => useSetup.setState({ selectedOriginalId: original.id, notice: undefined }));
  return (
    <group position={position} rotation-y={rotationY}>
      <mesh position={[0, h / 2, 0]} onClick={editable ? select : undefined}
        onPointerOver={(e) => { e.stopPropagation(); onHover(original.id); }} onPointerOut={() => onHover((id) => (id === original.id ? undefined : id))}>
        <boxGeometry args={[w, h, d]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      {selected
        ? <InkLine key={`selected:${original.id}`} segments={edges.segments} color="--wash" width={1.5} drawOn={edges.length} />
        : <InkLine segments={edges.segments} width={hovered ? 1.5 : 1} dash={original.kept ? DASH : undefined} />}
      {/* The front (+Z) edge on the floor. */}
      <InkLine segments={front} color={color} width={3.5} />
      {/* Step 7: the simple Patch a replaced Original would leave, in its baked floorColor. */}
      {!editable && (
        <mesh position={[0, 0.004 - position[1], 0]} rotation-x={-Math.PI / 2}>
          <planeGeometry args={[w + 0.1, d + 0.1]} />
          <meshBasicMaterial color={original.floorColor} />
        </mesh>
      )}
      {named && (
        <Label position={[0, h, 0]} lift={selected ? 16 : 4} priority={hovered ? 2 : 0} selected={selected}
          text={`${original.label}${original.kept ? ' · Kept' : ''}`} />
      )}
    </group>
  );
});

/** The next free id with a prefix, such as op_3. */
function nextId(prefix: string, existing: { id: string }[]) {
  let n = 1;
  while (existing.some((e) => e.id === `${prefix}_${n}`)) n++;
  return `${prefix}_${n}`;
}

/** Step 6: the corners clicked so far, numbered in pairs, and the moved copies marked in the Fill Capture, dashed. */
export function FillsOverlay() {
  const fill = useSetup((s) => s.fill);
  const originals = useSetup((s) => s.setup!.originals);
  if (!fill?.scene) return null;
  const marker = (position: Vec3, text: string, key: string) => (
    <group key={key} position={position}>
      <Dot position={[0, 0, 0]} size={10} />
      <Label position={[0, 0, 0]} lift={8} priority={1} text={text} mono />
    </group>
  );
  return (
    <>
      {fill.roomCorners.map(([x, z], i) => marker([x, 0.02, z], `${i + 1}`, `room-${i}`))}
      <group position={fill.transform.position} rotation-y={fill.transform.rotationY}>
        {fill.fillCorners.map(([x, z], i) => marker([x, fill.floorHeight + 0.02, z], `${i + 1}`, `fill-${i}`))}
      </group>
      {Object.entries(fill.copies).map(([id, { box: { position, size, rotationY } }]) => (
        <group key={id} position={position} rotation-y={rotationY}>
          <InkLine segments={boxEdges(size)} color="--graphite" width={1.5} dash={DASH} />
          <Label position={[0, size[1], 0]} lift={4} text={`${originals.find((o) => o.id === id)?.label ?? id}, moved`} />
        </group>
      ))}
    </>
  );
}
