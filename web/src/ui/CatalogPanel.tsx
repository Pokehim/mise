import { useMemo, useState } from 'react';
import type { CatalogItem, Category } from '@shared/types';
import { useEditor } from '../state/store';

const CATEGORY_NAMES: Record<Category, string> = {
  chair: 'Chairs', desk: 'Desks', table: 'Tables', nightstand: 'Nightstands', bed: 'Beds', sofa: 'Sofas',
  dresser: 'Dressers', wardrobe: 'Wardrobes', shelf: 'Shelves', storage: 'Storage',
  rug: 'Rugs', lamp: 'Lamps', wall_art: 'Wall art', mirror: 'Mirrors', plant: 'Plants', decor: 'Decor',
};

/** Browse the Catalog by category and text, and Add an item to the Design as a Piece (spec §10.1). */
export function CatalogPanel({ onAdd }: { onAdd: (item: CatalogItem) => void }) {
  const items = useEditor((s) => s.catalog!.items);
  const [category, setCategory] = useState<Category | null>(null);
  const [text, setText] = useState('');
  const categories = useMemo(() => [...new Set(items.map((item) => item.category))], [items]);

  const query = text.trim().toLowerCase();
  const shown = items.filter((item) =>
    (!category || item.category === category) &&
    (!query || [item.title, ...item.styleTags].some((words) => words.toLowerCase().includes(query))));

  return (
    <aside className="catalog">
      <div className="tabs">
        <button aria-pressed={!category} onClick={() => setCategory(null)}>All</button>
        {categories.map((c) => (
          <button key={c} aria-pressed={c === category} onClick={() => setCategory(c)}>{CATEGORY_NAMES[c]}</button>
        ))}
      </div>
      <input type="search" placeholder="Search by name or style" value={text} onChange={(e) => setText(e.target.value)} />
      <ul className="cards">
        {shown.map((item) => (
          <li key={item.id} className="card">
            <img src={item.thumbnail} alt="" />
            <div>
              <div>{item.title}</div>
              <div className="muted">≈ ${item.priceEstimateUsd} (est.)</div>
            </div>
            <button onClick={() => onAdd(item)}>Add</button>
          </li>
        ))}
      </ul>
      {shown.length === 0 && <p className="muted">Nothing in the Catalog matches.</p>}
    </aside>
  );
}
