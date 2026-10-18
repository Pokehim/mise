import { Html } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { useEffect, useState } from 'react';
import type { Object3D } from 'three';
import { useEditor } from '../state/store';
import { Lock } from '../ui/icons';
import { useDragOriginal } from './DragControls';
import { clickTolerancePx } from './objects';
import { Z_KEPT } from './sketch/Label';

/** ?empty=1 hides every Original, to show the Empty Room (lounge-v2 spec §3), for screenshots and the walk-through. */
const EMPTY_ROOM = new URLSearchParams(location.search).get('empty') === '1';

/**
 * An Original's node from the split Scan (spec §9.4), shown at its placement (spec §11.1). A click
 * selects it, and dragging it once selected works exactly like a Piece's (DragControls): the store's
 * preview moves it, and letting go makes one move Edit. A moved or removed Original leaves its Patch
 * behind (ScanMesh, Patch.tsx).
 *
 * A Kept Original shows a 🔒 and cannot be dragged, only selected.
 */
export function OriginalNode({ id, node }: { id: string; node: Object3D }) {
  const placement = useEditor((s) => (s.preview?.pieceId === id ? s.preview.placement : s.roomState!.originals[id]?.placement));
  const visible = useEditor((s) => s.roomState!.originals[id]?.visible !== false) && !EMPTY_ROOM;
  const original = useEditor((s) => s.setup!.originals.find((it) => it.id === id));
  const onPointerDown = useDragOriginal(id);
  const selected = useEditor((s) => s.selection?.kind === 'original' && s.selection.id === id);
  const [hovered, setHovered] = useState(false);
  // The item cursor (editor.css): a click selects it; once selected, a drag moves it, unless it is
  // Kept, when the drag moves the view and the view's cursor shows.
  const element = useThree((s) => (s.events.connected as HTMLElement | undefined) ?? s.gl.domElement);
  const cursor = !hovered || !visible ? undefined : !selected ? 'select' : original?.kept ? undefined : 'move';
  useEffect(() => {
    if (!cursor) return;
    element.dataset.item = cursor;
    return () => void delete element.dataset.item;
  }, [element, cursor]);
  if (!placement || !original) return <primitive object={node} visible={visible} />;

  return (
    <primitive
      object={node}
      visible={visible}
      position={placement.position}
      rotation-y={placement.rotationY}
      // A removed Original is invisible, but three.js still raycasts it: let the click through to what shows.
      onPointerDown={(event: Parameters<typeof onPointerDown>[0]) => visible && onPointerDown(event)}
      // A click selects it, not the end of a drag; either way, not the Scan's own click handler.
      onClick={(event: { stopPropagation(): void; delta: number }) => {
        if (!visible) return;
        event.stopPropagation();
        if (event.delta <= clickTolerancePx()) useEditor.getState().select({ kind: 'original', id });
      }}
      onPointerOver={(event: { stopPropagation(): void }) => {
        if (!visible) return;
        event.stopPropagation();
        setHovered(true);
      }}
      onPointerOut={() => setHovered(false)}
    >
      {original.kept && (
        <Html position={[0, original.box.size[1], 0]} center zIndexRange={Z_KEPT} className="kept-lock">
          <span role="img" aria-label="Kept: it stays in the room"><Lock /></span>
        </Html>
      )}
    </primitive>
  );
}
