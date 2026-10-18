import { Hud } from '@react-three/drei';
import { useMemo } from 'react';
import type { RoomState, Vec3 } from '@shared/types';
import { checkFit } from '../state/core';
import { useEditor } from '../state/store';
import { doorClearance } from './sketch/door';
import { FitMark } from './sketch/FitMark';
import { DASH, InkLine } from './sketch/InkLine';
import { targetBox } from './swapResize';
import './fit.css';

/** Just above the floor, for a door's clear zone. */
const LIFT = 0.006;

/**
 * Fit rule warnings (spec §10.6), checked after every Edit and while a Piece is dragged: a red-pencil
 * loop and a note on each Piece, or moved Original, that breaks a Fit rule, and the floor a door
 * needs clear when one blocks it. They are warnings only: the Edit has already happened, and nothing
 * undoes it. Originals where they were scanned are the real room, so they get no warnings of their own.
 */
export function FitHighlights() {
  const setup = useEditor((s) => s.setup!);
  const catalog = useEditor((s) => s.catalog!);
  const roomState = useEditor((s) => s.roomState!);
  const preview = useEditor((s) => s.preview);

  const { warned, doors } = useMemo(() => {
    // The dragged Piece or Original where it is shown, as PieceNode and OriginalNode do.
    const draggedPiece = preview && roomState.pieces[preview.pieceId];
    const draggedOriginal = preview && roomState.originals[preview.pieceId];
    const shown: RoomState = draggedPiece
      ? { ...roomState, pieces: { ...roomState.pieces, [preview.pieceId]: { ...draggedPiece, placement: preview.placement } } }
      : draggedOriginal
        ? { ...roomState, originals: { ...roomState.originals, [preview.pieceId]: { ...draggedOriginal, placement: preview.placement, moved: true } } }
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
    // The floor each blocked door needs clear, as line segments: its swing, or the doorway's depth.
    const blocked = new Set(violations.flatMap(({ rule, otherId }) => (rule === 'door-swing' && otherId ? [otherId] : [])));
    const doors = setup.openings.flatMap((opening) => {
      const wall = blocked.has(opening.id) && setup.walls.find(({ id }) => id === opening.wallId);
      if (!wall) return [];
      const outline = doorClearance(opening, wall).map(([x, z]): Vec3 => [x, LIFT, z]);
      return [{ id: opening.id, segments: outline.slice(1).flatMap((point, i) => [outline[i], point]) }];
    });
    return {
      warned: [...messages].flatMap(([id, found]) => {
        const box = targetBox({ setup, catalog, roomState: shown }, { kind: id in shown.pieces ? 'piece' : 'original', id });
        return box ? [{ id, messages: [...found], ...box }] : [];
      }),
      doors,
    };
  }, [setup, catalog, roomState, preview]);

  if (!warned.length) return null;
  return (
    <>
      {/* Drawn over the scene, after the selection's Hud (1), which draws the scene itself. */}
      {doors.length > 0 && (
        <Hud renderPriority={2}>
          {doors.map(({ id, segments }) => <InkLine key={id} segments={segments} color="--red-pencil" width={1.5} dash={DASH} />)}
        </Hud>
      )}
      {warned.map(({ id, messages, placement, size }) => <FitMark key={id} id={id} placement={placement} size={size} messages={messages} />)}
    </>
  );
}
