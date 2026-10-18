import { useState } from 'react';
import { search } from '@shared/catalog-search';
import type { CatalogItem, Original } from '@shared/types';
import { useEditor } from '../../state/store';

const cm = (meters: number) => Math.round(meters * 100);

interface OriginalReplaceProps {
  original: Original;
  /** Puts the item in the Original's box, keeping its back-center (spec §10.4). */
  onPick: (item: CatalogItem) => void;
}

/**
 * Replace (spec §10.4): a Catalog picker for an Original, listing items of its category first, and
 * only items that hang where it does. The Original is then hidden, and a Patch covers its spot.
 */
export function OriginalReplace({ original, onPick }: OriginalReplaceProps) {
  const catalog = useEditor((s) => s.catalog!);
  const onWall = useEditor((s) => s.roomState!.originals[original.id]?.placement.mount === 'wall');
  const [text, setText] = useState('');

  const shown = search(catalog, { text, limit: Infinity })
    .map(({ item }) => item)
    .filter((item) => (item.mount === 'wall') === onWall)
    .toSorted((a, b) => Number(b.category === original.category) - Number(a.category === original.category));

  return (
    <div className="tool">
      <input type="search" placeholder="Search the Catalog" value={text} onChange={(e) => setText(e.target.value)} />
      {shown.length ? (
        <ul className="picks">
          {shown.map((item) => (
            <li key={item.id}>
              <button className="pick" onClick={() => onPick(item)}>
                <img src={item.thumbnail} alt="" />
                <span>
                  <span className="title" title={item.title}>{item.title}</span>
                  <span className="muted">{cm(item.size[0])} × {cm(item.size[2])} × {cm(item.size[1])} cm · ≈ ${item.priceEstimateUsd} (est.)</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : <p className="muted">Nothing in the Catalog matches.</p>}
    </div>
  );
}
