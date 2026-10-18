import { useMemo } from 'react';
import { BoxGeometry, EdgesGeometry } from 'three';
import { collisionBoxes, sizeBox } from '@shared/collision';
import type { CollisionBox, Placement, Vec3 } from '@shared/types';
import { useEditor } from '../state/store';
import { ignoreRaycast } from './objects';

/** ?boxes=1 draws every item's collision boxes (#129) over the models, for reviewing misfits. Not for the Mover. */
const SHOW = new URLSearchParams(location.search).get('boxes') === '1';

/** The edges of a 1 m cube, shared by every wireframe. */
const CUBE_EDGES = new EdgesGeometry(new BoxGeometry(1, 1, 1));

const BOX_COLOR = '#e5398b';
const SIZE_COLOR = '#2a7fd4';

/** One box's wireframe, drawn through the models so a box hidden inside one still shows. */
function Wire({ box: { min, max }, color }: { box: CollisionBox; color: string }) {
  const center = min.map((v, a) => (v + max[a]) / 2) as Vec3;
  const scale = min.map((v, a) => Math.max(max[a] - v, 0.001)) as Vec3;
  return (
    <lineSegments geometry={CUBE_EDGES} position={center} scale={scale} raycast={ignoreRaycast} renderOrder={10}>
      <lineBasicMaterial color={color} depthTest={false} transparent />
    </lineSegments>
  );
}

interface Shown { id: string; placement: Placement; size: Vec3; boxes: CollisionBox[] }

/**
 * Each Piece's and each visible Original's collision boxes, and its outer `size` box, as wireframes where it stands:
 * pink for the boxes, blue for the size box.
 */
export function CollisionBoxes() {
  const setup = useEditor((s) => s.setup!);
  const catalog = useEditor((s) => s.catalog!);
  const roomState = useEditor((s) => s.roomState!);
  const preview = useEditor((s) => s.preview);
  const shown = useMemo((): Shown[] => {
    if (!SHOW) return [];
    const at = (id: string, placement: Placement) => (preview?.pieceId === id ? preview.placement : placement);
    const pieces = Object.entries(roomState.pieces).flatMap(([id, piece]) => {
      const item = catalog.items.find(({ id: itemId }) => itemId === piece.catalogId);
      return item ? [{ id, placement: at(id, piece.placement), size: item.size, boxes: collisionBoxes(item) }] : [];
    });
    const originals = setup.originals.flatMap((original) => {
      const state = roomState.originals[original.id];
      if (!state?.visible) return [];
      return [{ id: original.id, placement: at(original.id, state.placement), size: original.box.size, boxes: collisionBoxes(original) }];
    });
    return [...pieces, ...originals];
  }, [setup, catalog, roomState, preview]);

  return shown.map(({ id, placement, size, boxes }) => (
    <group key={id} position={placement.position} rotation-y={placement.rotationY}>
      <Wire box={sizeBox(size)} color={SIZE_COLOR} />
      {boxes.map((box, i) => <Wire key={i} box={box} color={BOX_COLOR} />)}
    </group>
  ));
}
