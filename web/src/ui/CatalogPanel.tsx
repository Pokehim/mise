import { useMemo, useState } from 'react';
import type { CatalogItem, Category } from '@shared/types';
import { search } from '../state/core';
import { useEditor } from '../state/store';
import { priceEstimate } from './format';
import { GenerateItem } from './GenerateItem';
import { Plus } from './icons';

const CATEGORY_NAMES: Record<Category, string> = {
  chair: 'Chairs', desk: 'Desks', table: 'Tables', nightstand: 'Nightstands', bed: 'Beds', sofa: 'Sofas',
  dresser: 'Dressers', wardrobe: 'Wardrobes', shelf: 'Shelves', storage: 'Storage',
  rug: 'Rugs', lamp: 'Lamps', wall_art: 'Wall art', mirror: 'Mirrors', plant: 'Plants', decor: 'Decor',
};

/** The drag-and-drop type of a Catalog card dragged into the view; its data is the item id. */
export const CATALOG_ITEM_TYPE = 'application/x-mise-catalog-item';

/** Browse the Catalog by category and text, and Add an item to the Design as a Piece (spec §10.1). */
export function CatalogPanel({ onAdd }: { onAdd: (item: CatalogItem) => void }) {
  const catalog = useEditor((s) => s.catalog!);
  const [category, setCategory] = useState<Category | null>(null);
  const [text, setText] = useState('');
  const categories = useMemo(() => [...new Set(catalog.items.map((item) => item.category))], [catalog]);

  // Every match, in Catalog order, found the way Claude's search_catalog finds items (spec §8.2).
  const shown = search(catalog, { category: category ?? undefined, text, limit: Infinity }).map(({ item }) => item);

  return (
    <aside className="catalog" aria-labelledby="catalog-title">
      <h2 id="catalog-title">Catalog</h2>
      <div className="tabs" role="group" aria-label="Category">
        <button aria-pressed={!category} onClick={() => setCategory(null)}>All</button>
        {categories.map((c) => (
          <button key={c} aria-pressed={c === category} onClick={() => setCategory(c)}>{CATEGORY_NAMES[c]}</button>
        ))}
      </div>
      <input
        type="search"
        name="catalogSearch"
        aria-label="Search the Catalog"
        autoComplete="off"
        placeholder="Search by name or style…"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <ul className="cards">
        {shown.map((item) => (
          <li
            key={item.id}
            className="card"
            draggable
            onDragStart={(event) => {
              event.dataTransfer.setData(CATALOG_ITEM_TYPE, item.id);
              event.dataTransfer.effectAllowed = 'copy';
            }}
          >
            <img src={item.thumbnail} alt="" width={56} height={56} loading="lazy" />
            <div>
              <div className="title" title={item.title}>{item.title}</div>
              <div className="muted price">{priceEstimate(item.priceEstimateUsd)}</div>
            </div>
            <button aria-label={`Add ${item.title}`} onClick={() => onAdd(item)}><Plus />Add</button>
          </li>
        ))}
      </ul>
      {shown.length === 0 && <p className="muted empty"><b>Nothing matches.</b> Try another word, or another category.</p>}
      {shown.length === 0 && <GenerateItem key={`${category}:${text}`} query={text} category={category} />}
    </aside>
  );
}
