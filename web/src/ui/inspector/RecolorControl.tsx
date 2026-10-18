import { useState } from 'react';
import { partsFor } from '@shared/parts';
import type { Category } from '@shared/types';
import { useEditor } from '../../state/store';
import { ColorChoice } from './ColorChoice';

/** All Parts, as a recolor Edit's partId. */
const ALL = '*';

/**
 * Recolor a Piece or an Original (spec §10.4): pick a Part, or All, then a color. Each choice is a
 * recolor Edit; the shader keeps the light and shadow of the Part's texture.
 */
export function RecolorControl({ targetId, category }: { targetId: string; category: Category }) {
  const parts = partsFor(category);
  const [partId, setPartId] = useState(ALL);
  const partColors = useEditor((s) => (s.roomState!.pieces[targetId] ?? s.roomState!.originals[targetId])?.partColors);
  if (!partColors) return null;
  const colors = partId === ALL ? parts.map(({ id }) => partColors[id]) : [partColors[partId]];
  // All shows a color only when every Part has it.
  const value = colors.every((color) => color === colors[0]) ? colors[0] ?? null : null;

  return (
    <section className="color-control">
      <h3>Recolor</h3>
      {parts.length > 1 && (
        <div className="parts" role="group" aria-label="Part">
          {[{ id: ALL, name: 'All' }, ...parts].map(({ id, name }) => (
            <button key={id} aria-pressed={partId === id} onClick={() => setPartId(id)}>{name}</button>
          ))}
        </div>
      )}
      <ColorChoice
        value={value}
        resettable={colors.some(Boolean)}
        resetLabel="Reset color"
        onChoose={(color) => useEditor.getState().applyEdit({ type: 'recolor', targetId, partId, color })}
      />
    </section>
  );
}
