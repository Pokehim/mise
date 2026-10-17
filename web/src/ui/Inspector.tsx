import type { Vec3 } from '@shared/types';
import { wallLength } from '../scene/floorPlan';
import { removePiece, rotatePiece } from '../scene/pieceEdits';
import { useEditor } from '../state/store';

// The Inspector shell (spec §10.4). #10 takes this file over; the disabled buttons are the
// slots where the Swap, Resize, Recolor, Paint and Replace controls of #9 and #10 go.

const inches = (meters: number) => (meters / 0.0254).toFixed(1);
const cm = (meters: number) => Math.round(meters * 100);

/** A real size as width × depth × height, in inches and in centimeters. */
function Size({ size: [width, height, depth] }: { size: Vec3 }) {
  return (
    <p>
      {inches(width)}″ W × {inches(depth)}″ D × {inches(height)}″ H
      <br />
      <span className="muted">{cm(width)} × {cm(depth)} × {cm(height)} cm</span>
    </p>
  );
}

const Slot = ({ name, issue }: { name: string; issue: string }) => (
  <button disabled title={`Coming in ${issue}`}>{name}</button>
);

function PieceInspector({ pieceId }: { pieceId: string }) {
  const item = useEditor((s) => {
    const piece = s.roomState!.pieces[pieceId];
    return piece && s.catalog!.items.find(({ id }) => id === piece.catalogId);
  });
  if (!item) return null;
  return (
    <>
      <h2>{item.title}</h2>
      <Size size={item.size} />
      <p>≈ ${item.priceEstimateUsd} (est.)</p>
      <p><a href={item.url} target="_blank" rel="noreferrer">View on Amazon</a></p>
      <div className="actions">
        <button title="R" onClick={() => rotatePiece(pieceId, 1)}>↺ 15°</button>
        <button title="Shift+R" onClick={() => rotatePiece(pieceId, -1)}>↻ 15°</button>
        <button title="Delete" onClick={() => removePiece(pieceId)}>Remove</button>
      </div>
      <div className="actions">
        <Slot name="Swap" issue="#10" />
        <Slot name="Resize" issue="#10" />
        <Slot name="Recolor" issue="#9" />
      </div>
    </>
  );
}

function OriginalInspector({ originalId }: { originalId: string }) {
  const original = useEditor((s) => s.setup!.originals.find(({ id }) => id === originalId));
  if (!original) return null;
  return (
    <>
      <h2>{original.label}</h2>
      {original.kept && <p className="badge" title="It stays in the room: it can be recolored, but not moved, replaced or removed.">Kept</p>}
      <Size size={original.box.size} />
      <div className="actions">
        {!original.kept && <Slot name="Replace" issue="#9" />}
        {!original.kept && <Slot name="Resize" issue="#10" />}
        <Slot name="Recolor" issue="#9" />
      </div>
    </>
  );
}

function WallInspector({ wallId }: { wallId: string }) {
  const wall = useEditor((s) => s.setup!.walls.find(({ id }) => id === wallId));
  if (!wall) return null;
  return (
    <>
      <h2>{wall.name}</h2>
      <p className="muted">{wallLength(wall).toFixed(2)} m long, {wall.height.toFixed(2)} m high</p>
      <div className="actions">
        <Slot name="Paint" issue="#9" />
      </div>
    </>
  );
}

/** What is selected, and what can be done with it. */
export function Inspector() {
  const selection = useEditor((s) => s.selection);
  return (
    <aside className="inspector">
      {!selection && <p className="muted">Select a Piece, an Original, or a Wall.</p>}
      {selection?.kind === 'piece' && <PieceInspector pieceId={selection.id} />}
      {selection?.kind === 'original' && <OriginalInspector originalId={selection.id} />}
      {selection?.kind === 'wall' && <WallInspector wallId={selection.id} />}
    </aside>
  );
}
