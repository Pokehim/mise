import { useEffect, useMemo, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { Actor } from '@shared/types';
import { deleteEdit, historyRows, putBack, redo, undo, useCanRedo, useDeletedText } from '../state/history';
import { useEditor } from '../state/store';
import { count } from './format';
import { Close, Redo, Undo } from './icons';

const ACTORS: Record<Actor, string> = { mover: 'You', claude: 'AI' };

/**
 * The Design's Edits, oldest first (spec §6). Any of them can be deleted, and skipped ones are
 * greyed out. Hovering or focusing a row outlines what its Edit changed; clicking it selects that.
 */
export function HistoryPanel() {
  const opened = useEditor(useShallow(({ design, roomState, setup, catalog }) => ({ design, roomState, setup, catalog })));
  const rows = useMemo(() => historyRows(opened), [opened]);
  const canRedo = useCanRedo();
  const deleted = useDeletedText();
  const { select, setHighlight } = useEditor.getState();
  const list = useRef<HTMLOListElement>(null);

  // Keep the newest Edit in view as Edits are added. The list scrolls, never the page: on a phone the
  // panels stack under the room, and the page jumping down to History would hide it.
  useEffect(() => {
    if (list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [rows.length]);
  useEffect(() => () => setHighlight(null), [setHighlight]);

  return (
    <section className="history" aria-labelledby="history-title">
      <header>
        <h2 id="history-title">History</h2>
        <span className="muted">{count(rows.length, 'Edit')}</span>
        <span className="spacer" />
        <button className="icon-button" aria-label="Undo" title="Undo (⌘Z)" disabled={!rows.length} onClick={undo}>
          <Undo />
        </button>
        <button className="icon-button" aria-label="Redo" title="Redo (⇧⌘Z)" disabled={!canRedo} onClick={redo}>
          <Redo />
        </button>
      </header>
      {deleted && (
        <p className="deleted" role="status">
          <span className="text">Deleted “{deleted}”</span>
          <button onClick={putBack}>Put Back</button>
        </p>
      )}
      {rows.length ? (
        <ol ref={list}>
          {rows.map(({ edit, text, skipped, target }, index) => (
            <li
              key={edit.id}
              className={skipped ? 'skipped' : undefined}
              onPointerEnter={() => setHighlight(target ?? null)}
              onPointerLeave={() => setHighlight(null)}
              onFocus={() => setHighlight(target ?? null)}
              onBlur={() => setHighlight(null)}
            >
              <span className="step">{index + 1}</span>
              <div className="what">
                {target ? (
                  <button className="text" title={text} onClick={() => select(target)}>{text}</button>
                ) : (
                  <span className="text" title={text}>{text}</span>
                )}
                {skipped && <span className="reason">Skipped: {skipped}</span>}
              </div>
              <span className={`by ${edit.by}`}>{ACTORS[edit.by]}</span>
              <button
                className="icon-button delete"
                aria-label={`Delete “${text}”`}
                title="Delete this Edit"
                onClick={() => {
                  setHighlight(null);
                  deleteEdit(edit.id);
                }}
              >
                <Close />
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <p className="empty">
          <b>No Edits yet.</b> Add a Piece from the Catalog, or select something in the room to change it. Each change shows up here.
        </p>
      )}
    </section>
  );
}
