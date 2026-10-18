import { useState } from 'react';
import { Link } from 'wouter';
import { useShallow } from 'zustand/react/shallow';
import type { Design } from '@shared/types';
import { listDesigns } from '../api';
import { useSaveStatus } from '../state/history';
import { useEditor } from '../state/store';
import { count } from './format';
import { Check, ChevronDown } from './icons';
import { Popover } from './Popover';
import { useStartDesign } from './useStartDesign';

const SAVE_TEXT = { saved: 'Saved', saving: 'Saving…', failed: 'Not saved' } as const;

/** The autosave indicator next to the Design's name. */
function SaveStatus() {
  const status = useSaveStatus((s) => s.status);
  return (
    <span
      className={`save-status ${status}`}
      role="status"
      title={status === 'failed' ? 'The last save failed. Your next change saves the whole Design again.' : undefined}
    >
      {status === 'saved' && <Check />}
      {SAVE_TEXT[status]}
    </span>
  );
}

/** The Design's name as a text field, in place (inline Rename). Enter or leaving the field keeps it; Esc doesn't. */
function RenameField({ name, onDone }: { name: string; onDone: (name?: string) => void }) {
  return (
    <input
      className="rename"
      name="designName"
      aria-label="Design name"
      autoComplete="off"
      defaultValue={name}
      maxLength={80}
      autoFocus
      onFocus={(event) => event.currentTarget.select()}
      onBlur={(event) => onDone(event.currentTarget.value.trim() || undefined)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
        if (event.key === 'Escape') {
          event.currentTarget.value = '';
          event.currentTarget.blur();
        }
      }}
    />
  );
}

/** A rename is a change to the Design, so autosave saves it like an Edit. */
function rename(name: string) {
  const { design } = useEditor.getState();
  if (name !== design!.name) useEditor.setState({ design: { ...design!, name }, dirty: true });
}

/** Design ▾ in the TopBar: the Scan's Designs, then New, Duplicate and Rename (spec §10.8). */
export function DesignsMenu() {
  const open = useEditor(useShallow(({ design }) => ({ id: design!.id, name: design!.name, scanId: design!.scanId, edits: design!.edits.length })));
  const [designs, setDesigns] = useState<Design[]>();
  const [renaming, setRenaming] = useState(false);
  const [listError, setListError] = useState<string>();
  const { start, error } = useStartDesign();
  // The open Design as the editor has it, since its saved copy can be up to one autosave behind.
  const rows = designs?.map((d) => (d.id === open.id ? open : { id: d.id, name: d.name, edits: d.edits.length })) ?? [open];

  return (
    <div className="designs-menu">
      {renaming ? (
        <RenameField
          name={open.name}
          onDone={(name) => {
            setRenaming(false);
            if (name) rename(name);
          }}
        />
      ) : (
        <Popover
          label="Designs"
          button={<><strong>{open.name}</strong><ChevronDown /></>}
          onOpen={() => listDesigns(open.scanId).then(setDesigns, (err: Error) => setListError(err.message))}
        >
          {(close) => (
            <>
              <p className="menu-heading">Designs of this Scan</p>
              <ul className="menu-designs">
                {rows.map(({ id, name, edits }) => (
                  <li key={id}>
                    <Link href={`/d/${id}`} aria-current={id === open.id ? 'page' : undefined} onClick={close}>
                      <span className="tick">{id === open.id && <Check />}</span>
                      <span className="name">{name}</span>
                      <span className="muted">{count(edits, 'Edit')}</span>
                    </Link>
                  </li>
                ))}
              </ul>
              <div className="menu-actions">
                <button onClick={() => { close(); void start({ scanId: open.scanId }); }}>New</button>
                <button onClick={() => { close(); void start({ duplicateOf: open.id }); }}>Duplicate</button>
                <button onClick={() => { close(); setRenaming(true); }}>Rename</button>
              </div>
            </>
          )}
        </Popover>
      )}
      <SaveStatus />
      {(error ?? listError) && <span className="topbar-error" role="alert">{error ?? `Could not list the Designs (${listError}).`}</span>}
    </div>
  );
}
