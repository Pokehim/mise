import { useState } from 'react';
import { partsFor } from '@shared/parts';
import type { Category, Finish, LibraryMaterial, RoomState } from '@shared/types';
import { materialThumbnail, useMaterialLibrary } from '../../scene/materials/triplanar';
import { useEditor } from '../../state/store';
import { ColorChoice } from './ColorChoice';

/** What a Finish goes on: a Wall, the Floor, or a Part of an Original (spec §11.1). */
export type FinishPickerTarget =
  | { kind: 'wall'; wallId: string }
  | { kind: 'floor' }
  | { kind: 'original'; originalId: string; category: Category };

/** All Parts, as a finish Edit's partId. */
const ALL = '*';

type Kind = LibraryMaterial['kind'];

const KIND_NAMES: Record<Kind, string> = {
  wood: 'Wood', stone: 'Stone', fabric: 'Fabric', metal: 'Metal', carpet: 'Carpet', wallpaper: 'Wallpaper', tile: 'Tile',
};

/** The kinds in the order a target lists them: the ones it is usually given first, then the rest. */
const KIND_ORDER: Record<FinishPickerTarget['kind'], Kind[]> = {
  wall: ['wallpaper', 'tile', 'wood', 'stone', 'fabric', 'metal', 'carpet'],
  floor: ['carpet', 'wood', 'tile', 'stone', 'fabric', 'metal', 'wallpaper'],
  original: ['wood', 'stone', 'fabric', 'metal', 'tile', 'carpet', 'wallpaper'],
};

/** The Finish on every one of `parts` (or on the Wall or Floor), or null when they differ or have none. */
function appliedFinish(roomState: RoomState, target: FinishPickerTarget, parts: string[]): Finish | null {
  const finishes: (Finish | undefined)[] = target.kind === 'wall'
    ? [roomState.surfaces.walls[target.wallId]]
    : target.kind === 'floor'
      ? [roomState.surfaces.floor]
      : parts.map((partId) => roomState.originals[target.originalId]?.partFinishes[partId]);
  const [first] = finishes;
  return first && finishes.every((finish) => JSON.stringify(finish) === JSON.stringify(first)) ? first : null;
}

/**
 * Finish a Wall, the Floor or an Original's Parts (spec §10.4, §11.1): a material of the Material
 * Library, grouped by kind, or, for a Wall or the Floor, a paint color, or back to the scanned look.
 * An Original's Parts are painted with Recolor, so they take materials only. Each choice is a finish
 * Edit; the shader keeps the room's real light and shadow.
 */
export function FinishPicker({ target }: { target: FinishPickerTarget }) {
  const library = useMaterialLibrary();
  const [partId, setPartId] = useState(ALL);
  const parts = target.kind === 'original' ? partsFor(target.category) : [];
  const chosenParts = partId === ALL ? parts.map(({ id }) => id) : [partId];
  const applied = useEditor((s) => appliedFinish(s.roomState!, target, chosenParts));
  // appliedFinish builds nothing new: it hands back a Finish that is in the room state, so the
  // selector's result is stable until an Edit changes it.

  const choose = (finish: Finish) => useEditor.getState().applyEdit({
    type: 'finish',
    target: target.kind === 'original' ? { kind: 'original', originalId: target.originalId, partId } : target,
    finish,
  });

  const materials = [...(library?.values() ?? [])];
  const ofKind = (kind: Kind) => materials.filter((material) => material.kind === kind);
  const kinds = KIND_ORDER[target.kind].filter((kind) => ofKind(kind).length > 0);

  return (
    <section className="color-control">
      <h3>Finish</h3>
      {parts.length > 1 && (
        <div className="parts" role="group" aria-label="Part">
          {[{ id: ALL, name: 'All' }, ...parts].map(({ id, name }) => (
            <button key={id} aria-pressed={partId === id} onClick={() => setPartId(id)}>{name}</button>
          ))}
        </div>
      )}
      {library === null && <p className="muted">Loading materials…</p>}
      {kinds.map((kind) => (
        <div className="tool" key={kind}>
          <p className="muted">{KIND_NAMES[kind]}</p>
          <div className="swatches">
            {ofKind(kind).map((material) => (
              <button
                key={material.id}
                className="swatch"
                title={material.name}
                aria-label={material.name}
                aria-pressed={applied?.kind === 'material' && applied.materialId === material.id}
                style={{ backgroundImage: `url(${materialThumbnail(material)})`, backgroundSize: 'cover' }}
                onClick={() => choose({ kind: 'material', materialId: material.id })}
              />
            ))}
          </div>
        </div>
      ))}
      {target.kind === 'original' ? (
        <div className="actions">
          <button disabled={!applied} onClick={() => choose({ kind: 'none' })}>Reset finish</button>
        </div>
      ) : (
        <>
          <p className="muted">Paint</p>
          <ColorChoice
            value={applied?.kind === 'paint' ? applied.color : null}
            resettable={applied !== null}
            resetLabel="Reset to scanned"
            onChoose={(color) => choose(color ? { kind: 'paint', color } : { kind: 'none' })}
          />
        </>
      )}
    </section>
  );
}
