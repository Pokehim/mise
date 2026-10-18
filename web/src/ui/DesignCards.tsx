import { type CSSProperties, useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { useShallow } from 'zustand/react/shallow';
import { DIRECTIONS, type Direction } from '@shared/generate';
import type { Catalog, Design, RoomSetup } from '@shared/types';
import { describe, replay } from '../state/core';
import { type Take, useGenerate } from '../state/generate';
import { saveNow, shoppingList } from '../state/history';
import { useEditor } from '../state/store';
import { count, dollars, priceEstimate, productName } from './format';
import { ArrowRight } from './icons';
import { PlanSketch } from './PlanSketch';

/** What the cards call the three takes on a Brief (spec §13.1). */
const DIRECTION_NAMES: Record<Direction, string> = { literal: 'Literal', bolder: 'Bolder', budget: 'Budget-conscious' };

/**
 * Claude's three takes on a Brief as cards, side by side (spec §13.1, step 6). Each draws its plan
 * Edit by Edit while Claude makes it, and opens its Design once it is finished, while the others
 * are still being drawn.
 */
export function DesignCards({ onOpen, onBack }: { onOpen: () => void; onBack: () => void }) {
  const [, navigate] = useLocation();
  const { status, takes, seconds } = useGenerate(useShallow(({ status, takes, seconds }) => ({ status, takes, seconds })));

  async function open(design: Design) {
    await saveNow();   // the open Design's latest change goes first
    onOpen();
    navigate(`/d/${design.id}`);
  }

  return (
    <div className="cards-step">
      <ul className="design-cards">
        {DIRECTIONS.map((direction, i) => (
          <li key={direction} style={{ '--i': i } as CSSProperties}>
            <TakeCard direction={direction} take={takes[direction]} onOpen={(design) => void open(design)} />
          </li>
        ))}
      </ul>
      <footer>
        {status === 'done'
          ? <span className="muted">{seconds !== undefined && <>Made in <span className="seconds">{seconds} s</span> · </>}prices are estimates</span>
          : <Elapsed />}
        <button type="button" disabled={status !== 'done'} onClick={onBack}>Change the Brief</button>
      </footer>
    </div>
  );
}

/**
 * One take: its plan from above as Claude draws it, with Claude's plan in words and the step it is on;
 * then its Design, or why it didn't finish.
 * It is one button throughout, off until its Design is finished, so that the plan stays as it is drawn.
 */
function TakeCard({ direction, take: { plan, edits, design, report, error }, onOpen }: { direction: Direction; take: Take; onOpen: (design: Design) => void }) {
  const { setup, catalog, openId } = useEditor(useShallow(({ setup, catalog, design }) => ({ setup: setup!, catalog: catalog!, openId: design?.id })));
  // A take that starts from a Design draws on top of it; a finished one's Edits already hold it.
  const from = useGenerate((s) => s.from?.edits);
  const last = edits.at(-1);
  const isOpen = design !== undefined && design.id === openId;
  return (
    <button
      type="button"
      className={`design-card${design ? '' : error ? ' failed' : ' drawing'}`}
      disabled={!design}
      aria-busy={!design && !error}
      aria-current={isOpen}
      onClick={() => design && onOpen(design)}
    >
      <span className="direction">{DIRECTION_NAMES[direction]}</span>
      {/* While the take is drawn, the plan outlines the Piece the latest Edit put in the room. */}
      <PlanSketch setup={setup} catalog={catalog} edits={design || !from ? edits : [...from, ...edits]} latest={!design && last && 'pieceId' in last ? last.pieceId : undefined} />
      {design ? <Summary setup={setup} catalog={catalog} design={design} seconds={report?.seconds} isOpen={isOpen} />
        : error ? <span className="error">This take didn't finish: {error}</span>
        : (
          <>
            {plan && <span className="plan">{plan.trim().split('\n').filter(Boolean).map((line, i) => <span key={i}>{line}</span>)}</span>}
            <span className="step" aria-live="polite">{last ? describe(last, setup, catalog, { name: productName }) : plan ? 'Planning…' : 'Reading the room…'}</span>
          </>
        )}
      {!design && <span className="counts">{count(edits.length, 'Edit')}</span>}
    </button>
  );
}

/** A finished take: its name, rationale and Palette, what it costs, and how long it took. */
function Summary({ setup, catalog, design, seconds, isOpen }: { setup: RoomSetup; catalog: Catalog; design: Design; seconds?: number; isOpen: boolean }) {
  // What this take adds: a take that starts from a Design counts neither its Edits nor its Pieces.
  const start = design.startedFrom?.edits ?? 0;
  const before = new Set(Object.keys(replay(setup, catalog, design.edits.slice(0, start)).pieces));
  const all = shoppingList({ roomState: replay(setup, catalog, design.edits), setup, catalog }).pieces;
  const pieces = all.filter(({ pieceId }) => !before.has(pieceId));
  const totalUsd = pieces.reduce((total, { item }) => total + item.priceEstimateUsd, 0);
  const budget = design.brief?.budgetUsd;
  const swatches = design.palette ? [design.palette.wall, ...design.palette.accents] : [];
  return (
    <>
      <h3>{design.name}</h3>
      <span className="rationale">{design.rationale}</span>
      {swatches.length > 0 && (
        <span className="swatches" aria-label={`Palette: ${swatches.join(', ')}`}>
          {swatches.map((color, i) => <span key={`${color}-${i}`} style={{ background: color }} />)}
        </span>
      )}
      <span className="card-foot">
        <span className="total">{priceEstimate(totalUsd)}{budget !== undefined && ` of ${dollars(budget)}`}</span>
        <span className="counts">{count(design.edits.length - start, start ? 'new Edit' : 'Edit')} · {count(pieces.length, start ? 'new Piece' : 'Piece')}{seconds !== undefined && ` · ${seconds} s`}</span>
      </span>
      <span className="open">{isOpen ? 'In the editor' : <>Open <ArrowRight /></>}</span>
    </>
  );
}

/** The seconds since the Brief was sent, while Claude designs. */
function Elapsed() {
  const since = useGenerate((s) => s.since ?? Date.now());
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(timer);
  }, []);
  return (
    // The seconds tick ten times a second: a screen reader hears the status once, not each tick.
    <span className="muted" role="status">
      AI is designing three takes<span aria-hidden="true"> · <span className="seconds">{((now - since) / 1000).toFixed(1)} s</span></span>
    </span>
  );
}
