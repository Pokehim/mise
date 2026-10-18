import { Html, Hud } from '@react-three/drei';
import { useMemo } from 'react';
import type { RoomState } from '@shared/types';
import { checkFit } from '../state/core';
import { useEditor } from '../state/store';
import { ignoreRaycast } from './objects';
import { Outline } from './SelectionOutline';
import { targetBox } from './swapResize';
import './fit.css';

/** The red of the outline; the chips' is in fit.css. */
const RED = '#d93025';

/**
 * Fit rule warnings (spec §10.6), checked after every Edit and while a Piece is dragged: a red
 * outline and a message chip on each Piece, or moved Original, that breaks a Fit rule. They are
 * warnings only: the Edit has already happened, and nothing undoes it. Originals where they were
 * scanned are the real room, so they get no warnings of their own.
 */
export function FitHighlights() {
  const setup = useEditor((s) => s.setup!);
  const catalog = useEditor((s) => s.catalog!);
  const roomState = useEditor((s) => s.roomState!);
  const preview = useEditor((s) => s.preview);

  const warned = useMemo(() => {
    // The dragged Piece where it is shown, as PieceNode does.
    const dragged = preview && roomState.pieces[preview.pieceId];
    const shown: RoomState = dragged
      ? { ...roomState, pieces: { ...roomState.pieces, [preview.pieceId]: { ...dragged, placement: preview.placement } } }
      : roomState;
    const moved = Object.keys(shown.originals).filter((id) => shown.originals[id].moved);
    // Overlaps last: they name the other item by its Catalog title, which can be long.
    const violations = checkFit(setup, catalog, shown, [...Object.keys(shown.pieces), ...moved])
      .toSorted((a, b) => Number(a.rule === 'overlap') - Number(b.rule === 'overlap'));
    const messages = new Map<string, Set<string>>();
    for (const { subjectId, message } of violations) {
      if (!messages.has(subjectId)) messages.set(subjectId, new Set());
      messages.get(subjectId)!.add(message);
    }
    return [...messages].flatMap(([id, found]) => {
      const box = targetBox({ setup, catalog, roomState: shown }, { kind: id in shown.pieces ? 'piece' : 'original', id });
      return box ? [{ id, messages: [...found], ...box }] : [];
    });
  }, [setup, catalog, roomState, preview]);

  if (!warned.length) return null;
  return (
    <>
      {/* Like the selection outline: drawn over the scene, by a box that writes depth but no color,
          so only its outline shows. Priority 2 draws it after SelectionOutline's Hud (1), which draws the scene. */}
      <Hud renderPriority={2}>
        {warned.map(({ id, placement: { position: [x, y, z], rotationY }, size }) => (
          <mesh key={id} position={[x, y + size[1] / 2, z]} rotation-y={rotationY} renderOrder={1} raycast={ignoreRaycast}>
            <boxGeometry args={size} />
            <meshBasicMaterial colorWrite={false} />
            <Outline color={RED} angle={Math.PI} renderOrder={2} />
          </mesh>
        ))}
      </Hud>
      {warned.map(({ id, messages, placement: { position: [x, y, z] }, size }) => (
        <Html key={id} position={[x, y + size[1], z]} zIndexRange={[10, 0]} className="fit-chip">
          {messages.map((message) => <div key={message}>{message}</div>)}
        </Html>
      ))}
    </>
  );
}
