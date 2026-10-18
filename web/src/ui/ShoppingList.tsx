import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { shoppingList } from '../state/history';
import { useEditor } from '../state/store';
import { approxDollars, count, dollars, productName } from './format';
import { Cart } from './icons';
import { Popover } from './Popover';

/** The list under 🛒: each item with how many, its estimate and link, the total, and the Originals the Mover keeps. */
function List({ list: { pieces, totalUsd, alreadyInRoom } }: { list: ReturnType<typeof shoppingList> }) {
  // One row per product, like a furniture schedule: two of the same chair are "×2", not two rows.
  const byItem = new Map<string, { item: (typeof pieces)[number]['item']; quantity: number }>();
  for (const { item } of pieces) byItem.set(item.id, { item, quantity: (byItem.get(item.id)?.quantity ?? 0) + 1 });
  const rows = [...byItem.values()];
  return (
    <>
      <header className="cart-head">
        <h2>Shopping list</h2>
        <span className="muted">{rows.length === pieces.length ? count(pieces.length, 'Piece') : `${count(rows.length, 'item')} · ${count(pieces.length, 'Piece')}`}</span>
      </header>
      {pieces.length ? (
        <ul className="cart-pieces">
          {rows.map(({ item, quantity }) => (
            <li key={item.id}>
              <img src={item.thumbnail} alt="" width={48} height={48} loading="lazy" />
              <div className="cart-piece">
                <span className="title" title={item.title}>{productName(item)}</span>
                {item.url ? <a href={item.url} target="_blank" rel="noreferrer">View on Amazon</a> : <span className="muted">Generated, so no product link</span>}
              </div>
              {/* A price is always an estimate (spec §8.3): the ≈ here, "estimated" on the total. */}
              <span className="price">
                {quantity > 1 && <span className="quantity">×{quantity} </span>}
                {approxDollars(item.priceEstimateUsd * quantity)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty"><b>Nothing to buy yet.</b> Pieces you add from the Catalog show up here with their prices.</p>
      )}
      <p className="cart-total">
        <span>Total</span>
        <strong>≈ {dollars(totalUsd)} estimated</strong>
      </p>
      <section className="cart-in-room" aria-labelledby="cart-in-room">
        <h3 id="cart-in-room">Already in your room</h3>
        {alreadyInRoom.length ? (
          <ul>
            {alreadyInRoom.map(({ id, label, kept }) => (
              <li key={id}>
                {label}
                {kept && <span className="badge" title="It stays in the room: it can be recolored, but not moved, replaced or removed.">Kept</span>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">None of your own furniture is left in this Design.</p>
        )}
      </section>
    </>
  );
}

/** 🛒 in the TopBar: the running total, and the Design's shopping list under it (spec §10.7). */
export function ShoppingList() {
  const { roomState, setup, catalog } = useEditor(useShallow(({ roomState, setup, catalog }) => ({ roomState, setup, catalog })));
  const list = useMemo(() => shoppingList({ roomState, setup, catalog }), [roomState, setup, catalog]);
  return (
    <Popover
      className="cart"
      label="Shopping list"
      align="end"
      button={<><Cart /><span className="sr-only">Shopping list, </span>≈ {dollars(list.totalUsd)}<span className="est"> (est.)</span></>}
    >
      {() => <List list={list} />}
    </Popover>
  );
}
