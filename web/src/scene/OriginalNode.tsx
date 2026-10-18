import { Html, useCursor } from '@react-three/drei';
import { Suspense, useLayoutEffect, useState } from 'react';
import type { Object3D } from 'three';
import { useEditor } from '../state/store';
import { Lock } from '../ui/icons';
import { useDragOriginal } from './DragControls';
import { Z_KEPT } from './sketch/Label';
import { hideBox, StandIn } from './StandIn';

/**
 * An Original's node from the split Scan (spec §9.4), shown at its placement (spec §11.1). Dragging
 * it works exactly like a Piece's (DragControls): the store's preview moves it, and letting go makes
 * one move Edit. A moved or removed Original leaves its Patch behind (ScanMesh, Patch.tsx).
 *
 * A Kept Original shows a 🔒 and cannot be dragged, only selected.
 */
export function OriginalNode({ id, node }: { id: string; node: Object3D }) {
  const placement = useEditor((s) => (s.preview?.pieceId === id ? s.preview.placement : s.roomState!.originals[id]?.placement));
  const visible = useEditor((s) => s.roomState!.originals[id]?.visible !== false);
  const original = useEditor((s) => s.setup!.originals.find((it) => it.id === id));
  const onPointerDown = useDragOriginal(id);
  const [hovered, setHovered] = useState(false);
  useCursor(hovered && visible, original?.kept ? 'not-allowed' : 'grab');
  // An Original no Capture saw is drawn by its Stand-in (ADR-0011), when the Catalog has it.
  const standIn = useEditor((s) => (original?.standInId ? s.catalog?.items.find((item) => item.id === original.standInId) : undefined));
  useLayoutEffect(() => {
    hideBox(node, Boolean(standIn));
    return () => hideBox(node, false);
  }, [node, standIn]);
  if (!placement || !original) return <primitive object={node} visible={visible} />;

  return (
    <primitive
      object={node}
      visible={visible}
      position={placement.position}
      rotation-y={placement.rotationY}
      // A removed Original is invisible, but three.js still raycasts it: let the click through to what shows.
      onPointerDown={(event: Parameters<typeof onPointerDown>[0]) => visible && onPointerDown(event)}
      // Selecting happened on pointerdown; keep the click from reaching the Scan's own click handler.
      onClick={(event: { stopPropagation(): void }) => visible && event.stopPropagation()}
      onPointerOver={(event: { stopPropagation(): void }) => {
        if (!visible) return;
        event.stopPropagation();
        setHovered(true);
      }}
      onPointerOut={() => setHovered(false)}
    >
      {standIn && (
        <Suspense fallback={null}>
          <StandIn originalId={id} item={standIn} size={original.box.size} />
        </Suspense>
      )}
      {original.kept && (
        <Html position={[0, original.box.size[1], 0]} center zIndexRange={Z_KEPT} className="kept-lock">
          <span role="img" aria-label="Kept: it stays in the room"><Lock /></span>
        </Html>
      )}
    </primitive>
  );
}
