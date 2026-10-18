import { useEffect } from 'react';
import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import type { CatalogItem, Design, Edit, Original, RoomState, SkipReason } from '@shared/types';
import { saveDesign } from '../api';
import { describe } from './core';
import { inRoom, type Selection, useEditor } from './store';

/** The parts of the editor store a Design's History and shopping list come from. */
type OpenDesign = Pick<ReturnType<typeof useEditor.getState>, 'design' | 'roomState' | 'setup' | 'catalog'>;

/* ───────────── Undo, redo, delete (spec §6) ───────────── */

interface UndoState {
  /** The Edits undo took, latest last. Client-side only: never saved. */
  redo: Edit[];
  /** The Edit History last deleted, and where it was, for putBack. */
  deleted: { edit: Edit; index: number } | null;
  /** The Edit list the last undo, redo or delete left. */
  after: Edit[] | null;
}

// Read only through undoable(): redo and deleted count only while the Edit list is still `after`.
const useUndoState = create<UndoState>()(() => ({ redo: [], deleted: null, after: null }));

/** What undo and delete left to take back: nothing once the Edit list changed some other way, such as a new Edit. */
const undoable = ({ redo, deleted, after }: UndoState, edits: Edit[] | undefined) =>
  (after === edits ? { redo, deleted } : { redo: [], deleted: null });
const undoableNow = () => undoable(useUndoState.getState(), useEditor.getState().design?.edits);

/** Whether redo has an Edit to put back, as a React hook. */
export function useCanRedo() {
  const edits = useEditor((s) => s.design?.edits);
  return useUndoState((h) => undoable(h, edits).redo.length > 0);
}

/** The History text of the Edit putBack would restore, as a React hook. */
export function useDeletedText() {
  const { edits, setup, catalog } = useEditor(useShallow((s) => ({ edits: s.design?.edits, setup: s.setup, catalog: s.catalog })));
  const edit = useUndoState((h) => undoable(h, edits).deleted?.edit);
  return edit && describe(edit, setup!, catalog!);
}

/** Replaces the Edit list, and keeps what can be taken back from it. */
function setEditsKeeping(edits: Edit[], keep: Omit<UndoState, 'after'>) {
  useEditor.getState().setEdits(edits);
  useUndoState.setState({ ...keep, after: useEditor.getState().design!.edits });
}

/** Takes back the last Edit (⌘Z). */
export function undo() {
  const edits = useEditor.getState().design?.edits;
  if (!edits?.length) return;
  setEditsKeeping(edits.slice(0, -1), { redo: [...undoableNow().redo, edits.at(-1)!], deleted: null });
}

/** Puts back the last Edit undo took (⇧⌘Z). */
export function redo() {
  const { redo: stack } = undoableNow();
  if (!stack.length) return;
  setEditsKeeping([...useEditor.getState().design!.edits, stack.at(-1)!], { redo: stack.slice(0, -1), deleted: null });
}

/** Takes any Edit out of the Design. Replay shows what follows: later Edits that needed it are skipped. */
export function deleteEdit(editId: string) {
  const edits = useEditor.getState().design!.edits;
  const index = edits.findIndex(({ id }) => id === editId);
  if (index < 0) return;
  setEditsKeeping(edits.toSpliced(index, 1), { redo: [], deleted: { edit: edits[index], index } });
}

/** Puts the Edit History last deleted back where it was, until the Edit list changes again. */
export function putBack() {
  const { deleted } = undoableNow();
  if (!deleted) return;
  const edits = useEditor.getState().design!.edits;
  setEditsKeeping(edits.toSpliced(deleted.index, 0, deleted.edit), { redo: [], deleted: null });
}

/* ───────────── What History and the shopping list show ───────────── */

/** Why replay skipped an Edit, as History shows it. */
const SKIP_REASONS: Record<SkipReason, string> = {
  'missing-target': 'What it changes is no longer in the room',
  kept: 'Kept: it stays in the room as it is',
  'unknown-catalog': 'Its item is no longer in the Catalog',
  'unknown-part': 'That Part does not exist',
  'duplicate-id': 'That Piece is already in the room',
};

interface HistoryRow {
  edit: Edit;
  /** describe() text, such as "Painted North wall · Sage". */
  text: string;
  /** Why the Edit didn't apply, when replay skipped it. */
  skipped?: string;
  /** The item the Edit changed, while it is in the room, for History to highlight. */
  target?: Selection;
}

/** One row per Edit of the open Design, in order. */
export function historyRows({ design, roomState, setup, catalog }: OpenDesign): HistoryRow[] {
  const skipped = new Map(roomState!.skipped.map(({ editId, reason }) => [editId, SKIP_REASONS[reason]]));
  return design!.edits.map((edit) => ({
    edit, text: describe(edit, setup!, catalog!), skipped: skipped.get(edit.id), target: changedItem(edit, roomState!),
  }));
}

function changedItem(edit: Edit, roomState: RoomState): Selection | undefined {
  let target: Selection | undefined;
  switch (edit.type) {
    case 'place':
    case 'swap':
    case 'replace':
      target = { kind: 'piece', id: edit.pieceId };
      break;
    case 'move':
    case 'remove':
    case 'recolor':
      target = { kind: Object.hasOwn(roomState.pieces, edit.targetId) ? 'piece' : 'original', id: edit.targetId };
      break;
    case 'finish':
      if (edit.target.kind === 'wall') target = { kind: 'wall', id: edit.target.wallId };
      if (edit.target.kind === 'original') target = { kind: 'original', id: edit.target.originalId };
  }
  return target && inRoom(target, roomState) ? target : undefined;
}

interface ShoppingList {
  pieces: { pieceId: string; item: CatalogItem }[];
  totalUsd: number;
  /** The Originals still in the room (spec §10.7). */
  alreadyInRoom: Original[];
}

/** The open Design's shopping list (🛒): what to buy, and what the Mover already has. */
export function shoppingList({ roomState, setup, catalog }: Omit<OpenDesign, 'design'>): ShoppingList {
  const items = new Map(catalog!.items.map((item) => [item.id, item]));
  // replay only lets a Piece have a catalogId that is in the Catalog.
  const pieces = Object.entries(roomState!.pieces).map(([pieceId, { catalogId }]) => ({ pieceId, item: items.get(catalogId)! }));
  return {
    pieces,
    totalUsd: pieces.reduce((total, { item }) => total + item.priceEstimateUsd, 0),
    alreadyInRoom: setup!.originals.filter(({ id }) => roomState!.originals[id].visible),
  };
}

/* ───────────── Autosave (spec §10.3) ───────────── */

/** The "Saved" indicator: 'saving' from a change until the Design is saved. */
export const useSaveStatus = create<{ status: 'saved' | 'saving' | 'failed' }>()(() => ({ status: 'saved' }));

/** How long autosave waits after the last change before it saves. */
const AUTOSAVE_MS = 500;
/** How long it waits to try a failed save again. */
const RETRY_MS = 5000;

/** The latest change autosave hasn't sent yet, and the timer that sends it. */
let waiting: { design: Design; timer: ReturnType<typeof setTimeout> } | null = null;
/** Saves run one at a time, so an older one can't land after a newer one. */
let saving = Promise.resolve();

/** The waiting change, taken off its timer. */
function takeWaiting() {
  if (!waiting) return undefined;
  clearTimeout(waiting.timer);
  const { design } = waiting;
  waiting = null;
  return design;
}

/**
 * Saves the waiting change now instead of when its 500 ms are up. It resolves once every save has
 * landed, and rejects if this one failed: the change then stays waiting, and is tried again.
 */
export function saveNow(): Promise<void> {
  const design = takeWaiting();
  if (!design) return saving;
  const done: Promise<void> = saving
    .then(() => saveDesign(design))
    .then(
      () => {
        // A change made while the save was on its way stays dirty, for the next save.
        if (useEditor.getState().design === design) useEditor.setState({ dirty: false });
        if (!waiting && saving === quiet) useSaveStatus.setState({ status: 'saved' });
      },
      (error: Error) => {
        console.error(`Could not save Design ${design.id}: ${error.message}`);
        if (!waiting) {
          waiting = { design, timer: setTimeout(autosave, RETRY_MS) };
          useSaveStatus.setState({ status: 'failed' });
        }
        throw error;
      },
    );
  // The next save waits for this one, whether it landed or not.
  const quiet = done.catch(() => {});
  saving = quiet;
  return done;
}

/** saveNow for autosave, whose failures show in the Saved indicator. */
const autosave = () => void saveNow().catch(() => {});

/**
 * Autosaves the open Design: every change to it (an Edit, undo, a rename) PUTs the whole Design
 * once nothing has changed for 500 ms. It returns the function that stops it, which saves a
 * waiting change first.
 */
export function connectHistory() {
  const unsubscribe = useEditor.subscribe((state, prev) => {
    // Another Design opened: the last one's change goes now.
    if (waiting && state.design?.id !== waiting.design.id) autosave();
    if (!state.dirty || state.design === prev.design) return;
    if (waiting) clearTimeout(waiting.timer);
    waiting = { design: state.design!, timer: setTimeout(autosave, AUTOSAVE_MS) };
    useSaveStatus.setState({ status: 'saving' });
  });
  return () => {
    unsubscribe();
    autosave();
  };
}

/** A change still waiting as the page closes goes at once, not after the saves before it, as a request that outlives the page. */
function saveAsPageCloses() {
  const design = takeWaiting();
  if (design) void saveDesign(design, { keepalive: true });
}

/** Autosaves the open Design while the editor is mounted. */
export function useAutosave() {
  useEffect(() => {
    const disconnect = connectHistory();
    window.addEventListener('pagehide', saveAsPageCloses);
    return () => {
      window.removeEventListener('pagehide', saveAsPageCloses);
      disconnect();
    };
  }, []);
}
