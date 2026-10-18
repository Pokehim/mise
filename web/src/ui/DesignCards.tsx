import type { CSSProperties } from 'react';
import { useLocation } from 'wouter';
import { useShallow } from 'zustand/react/shallow';
import type { Direction, GenerateResult } from '@shared/generate';
import type { Design } from '@shared/types';
import { replay } from '../state/core';
import { saveNow, shoppingList } from '../state/history';
import { useEditor } from '../state/store';
import { count, dollars, priceEstimate } from './format';
import { ArrowRight } from './icons';

/** What the cards call the three takes on a Brief (spec §13.1). */
export const DIRECTION_NAMES: Record<Direction, string> = { literal: 'Literal', bolder: 'Bolder', budget: 'Budget-conscious' };

/** Claude's Designs for a Brief as cards, side by side: clicking one opens it (spec §13.1, step 6). */
export function DesignCards({ result: { designs, failures, loops, seconds }, onOpen, onBack }: {
  result: GenerateResult; onOpen: () => void; onBack: () => void;
}) {
  const [, navigate] = useLocation();
  // Each loop reports the Design it made.
  const directionOf = new Map(loops.flatMap(({ direction, designId }) => (designId ? [[designId, direction] as const] : [])));

  async function open(design: Design) {
    await saveNow();   // the open Design's latest change goes first
    onOpen();
    navigate(`/d/${design.id}`);
  }

  return (
    <div className="cards-step">
      <ul className="design-cards">
        {designs.map((design, i) => (
          <li key={design.id} style={{ '--i': i } as CSSProperties}>
            <Card design={design} direction={directionOf.get(design.id)} onOpen={() => void open(design)} />
          </li>
        ))}
      </ul>
      {failures.map(({ direction, error }) => (
        <p key={direction} className="error" role="alert">The {DIRECTION_NAMES[direction].toLowerCase()} take didn't finish: {error}</p>
      ))}
      <footer>
        <span className="muted">Made in {seconds} s · prices are estimates</span>
        <button type="button" onClick={onBack}>Change the Brief</button>
      </footer>
    </div>
  );
}

function Card({ design, direction, onOpen }: { design: Design; direction?: Direction; onOpen: () => void }) {
  const { setup, catalog } = useEditor(useShallow(({ setup, catalog }) => ({ setup, catalog })));
  const { pieces, totalUsd } = shoppingList({ roomState: replay(setup!, catalog!, design.edits), setup, catalog });
  const budget = design.brief?.budgetUsd;
  const swatches = design.palette ? [design.palette.wall, ...design.palette.accents] : [];
  return (
    <button type="button" className="design-card" onClick={onOpen}>
      {direction && <span className="direction">{DIRECTION_NAMES[direction]}</span>}
      <h3>{design.name}</h3>
      <p className="rationale">{design.rationale}</p>
      {swatches.length > 0 && (
        <span className="swatches" aria-label={`Palette: ${swatches.join(', ')}`}>
          {swatches.map((color, i) => <span key={`${color}-${i}`} style={{ background: color }} />)}
        </span>
      )}
      <span className="card-foot">
        <span className="total">{priceEstimate(totalUsd)}{budget !== undefined && ` of ${dollars(budget)}`}</span>
        <span className="counts">{count(design.edits.length, 'Edit')} · {count(pieces.length, 'Piece')}</span>
      </span>
      <span className="open">Open <ArrowRight /></span>
    </button>
  );
}
