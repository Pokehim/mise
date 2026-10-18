import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { shoppingList } from '../state/history';
import { useEditor } from '../state/store';
import { count, dollars, priceEstimate } from './format';
import { Cart } from './icons';
import { Popover } from './Popover';
import { ProductLink } from './ProductLink';

/** The list under 🛒: each Piece with its estimate and link, the total, and the Originals the Mover keeps. */
function List({ list: { pieces, totalUsd, alreadyInRoom } }: { list: ReturnType<typeof shoppingList> }) {
  return (
    <>
      <header className="cart-head">
        <h2>Shopping list</h2>
        <span className="muted">{count(pieces.length, 'Piece')}</span>
      </header>
      {pieces.length ? (
        <ul className="cart-pieces">
          {pieces.map(({ pieceId, item }) => (
            <li key={pieceId}>
              <img src={item.thumbnail} alt="" width={48} height={48} loading="lazy" />
              <div className="cart-piece">
                <span className="title" title={item.title}>{item.title}</span>
                <ProductLink item={item} />
              </div>
              {/* A price is always an estimate (spec §8.3). */}
              <span className="price">{priceEstimate(item.priceEstimateUsd)}</span>
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
      button={<><Cart /><span className="sr-only">Shopping list, </span>≈ {dollars(list.totalUsd)} (est.)</>}
    >
      {() => <List list={list} />}
    </Popover>
  );
}
