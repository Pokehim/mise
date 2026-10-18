import { useState } from 'react';
import { partsFor } from '@shared/parts';
import type { Category, PartDef } from '@shared/types';
import { useMasterCopyParts } from '../../scene/masterCopy';
import { useEditor } from '../../state/store';
import { ColorChoice } from './ColorChoice';

/** All Parts, as a recolor Edit's partId. */
const ALL = '*';

const NO_PARTS: PartDef[] = [];

/**
 * The Parts of a Piece or an Original: its category's, or, for an Original drawn from a Master Copy, the
 * file's named pieces (ADR-0009), once the file has loaded. Also the Master Copy file, if it has one.
 */
export function useParts(targetId: string, category: Category): { parts: PartDef[]; model?: string } {
  const model = useEditor((s) => s.setup!.originals.find(({ id }) => id === targetId)?.model);
  const modelParts = useMasterCopyParts((s) => (model ? s[model] ?? NO_PARTS : undefined));
  return { parts: modelParts ?? partsFor(category), model };
}

/**
 * Recolor a Piece or an Original (spec §10.4): pick a Part, or All, then a color. Each choice is a
 * recolor Edit; the shader keeps the light and shadow of the Part's texture. An Original drawn from a
 * Master Copy also has All matching: the same Recolor on every Original of that Master Copy, as one Edit.
 */
export function RecolorControl({ targetId, category }: { targetId: string; category: Category }) {
  const { parts, model } = useParts(targetId, category);
  const [partId, setPartId] = useState(ALL);
  const [allMatching, setAllMatching] = useState(false);
  const matching = useEditor((s) => (model ? s.setup!.originals.filter((original) => original.model === model).length : 0));
  const partColors = useEditor((s) => (s.roomState!.pieces[targetId] ?? s.roomState!.originals[targetId])?.partColors);
  if (!partColors) return null;
  // A Master Copy's Original may have a color for the whole item, under its Parts' own.
  const colorOf = (id: string) => partColors[id] ?? partColors[ALL];
  const colors = partId === ALL ? parts.map(({ id }) => colorOf(id)) : [colorOf(partId)];
  // All shows a color only when every Part has it.
  const value = colors.every((color) => color === colors[0]) ? colors[0] ?? null : null;
  // A Part's Reset clears its own color; one it shows from the whole item's goes with All.
  const resettable = partId === ALL ? colors.some(Boolean) || ALL in partColors : partId in partColors;

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
      {matching > 1 && (
        <div className="parts" role="group" aria-label="Which Originals">
          <button aria-pressed={allMatching} title={`Recolor all ${matching} of them at once`} onClick={() => setAllMatching(!allMatching)}>
            All matching ({matching})
          </button>
        </div>
      )}
      <ColorChoice
        value={value}
        resettable={resettable}
        resetLabel="Reset color"
        onChoose={(color) => useEditor.getState().applyEdit({
          type: 'recolor', targetId, partId, color, ...(allMatching && matching > 1 && { sameModel: true as const }),
        })}
      />
    </section>
  );
}
