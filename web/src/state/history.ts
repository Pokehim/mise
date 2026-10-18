import { useEffect } from 'react';
import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import type { CatalogItem, Design, Edit, Original, RoomState, SkipReason } from '@shared/types';
import { saveDesign } from '../api';
import { productName } from '../ui/format';
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
  return edit && describe(edit, setup!, catalog!, { name: productName });
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

/** One row per Edit of the open Design, in order. Items go by their short names, as in the panels. */
export function historyRows({ design, roomState, setup, catalog }: OpenDesign): HistoryRow[] {
  const skipped = new Map(roomState!.skipped.map(({ editId, reason }) => [editId, SKIP_REASONS[reason]]));
  // Each Piece's item so far, so "Moved a Piece" can say which one.
  const pieces = new Map<string, string>();
  return design!.edits.map((edit) => {
    const text = describe(edit, setup!, catalog!, { name: productName, pieces });
    if (edit.type === 'place' || edit.type === 'swap') pieces.set(edit.pieceId, edit.catalogId);
    return { edit, text, skipped: skipped.get(edit.id), target: changedItem(edit, roomState!) };
  });
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

/** The "Saved" indicator: 'failed' while any Design's latest save failed, else 'saving' from a change until it is saved. */
export const useSaveStatus = create<{ status: 'saved' | 'saving' | 'failed' }>()(() => ({ status: 'saved' }));

/** How long autosave waits after the last change before it saves. */
const AUTOSAVE_MS = 500;
/** How long it waits to try a failed save again. */
const RETRY_MS = 5000;

/** Each Design's latest change autosave hasn't sent yet, and the timer that sends it. */
const pending = new Map<string, { design: Design; timer: ReturnType<typeof setTimeout> }>();
/** Each Design's latest change, from when it is made until it lands: pending, or on its way. */
const unsaved = new Map<string, Design>();
/** The Designs whose latest save failed. */
const failed = new Set<string>();
/** Saves run one at a time, so an older one can't land after a newer one. */
let saving = Promise.resolve();

/** Sets the Saved indicator from what has failed and what hasn't landed yet. */
function showStatus() {
  useSaveStatus.setState({ status: failed.size ? 'failed' : unsaved.size ? 'saving' : 'saved' });
}

/** Makes this the Design's pending change, sent in `ms` unless a newer change of the Design replaces it. */
function wait(design: Design, ms: number) {
  clearTimeout(pending.get(design.id)?.timer);
  pending.set(design.id, { design, timer: setTimeout(() => autosave(design.id), ms) });
}

/** A Design's pending change, taken off its timer. */
function take(id: string) {
  const { design, timer } = pending.get(id)!;
  clearTimeout(timer);
  pending.delete(id);
  return design;
}

/** Sends a Design's pending change, after the saves before it. It rejects if the save failed. */
function send(id: string): Promise<void> {
  const design = take(id);
  const done: Promise<void> = saving
    .then(() => saveDesign(design))
    .then(
      () => {
        // A change made while the save was on its way stays dirty, for the next save.
        if (useEditor.getState().design === design) useEditor.setState({ dirty: false });
        if (unsaved.get(id) === design) unsaved.delete(id);
        failed.delete(id);
        showStatus();
      },
      (error: Error) => {
        console.error(`Could not save Design ${id}: ${error.message}`);
        failed.add(id);
        // It is tried again, unless a newer change of the Design is pending or on its way.
        if (unsaved.get(id) === design) wait(design, RETRY_MS);
        showStatus();
        throw error;
      },
    );
  // The next save waits for this one, whether it landed or not.
  saving = done.catch(() => {});
  return done;
}

/** send for autosave, whose failures show in the Saved indicator. */
const autosave = (id: string) => void send(id).catch(() => {});

/**
 * Saves every pending change now instead of when its timer is up. It resolves once every save has
 * landed, and rejects if one of them failed: that change then stays pending, and is tried again.
 */
export async function saveNow(): Promise<void> {
  const sent = await Promise.allSettled([...pending.keys()].map(send));
  await saving;
  const failure = sent.find((result): result is PromiseRejectedResult => result.status === 'rejected');
  if (failure) throw failure.reason;
}

/**
 * Autosaves the open Design: every change to it (an Edit, undo, a rename) PUTs the whole Design
 * once nothing has changed for 500 ms. It returns the function that stops it, which saves every
 * pending change first.
 */
export function connectHistory() {
  const unsubscribe = useEditor.subscribe(({ design, dirty }, prev) => {
    // Another Design opened: the last one's change goes now.
    if (prev.design && prev.design.id !== design?.id && pending.has(prev.design.id)) autosave(prev.design.id);
    if (!dirty || design === prev.design) return;
    unsaved.set(design!.id, design!);
    wait(design!, AUTOSAVE_MS);
    showStatus();
  });
  return () => {
    unsubscribe();
    void saveNow().catch(() => {});
  };
}

/** Changes still pending as the page closes go at once, not after the saves before them, as requests that outlive the page. */
function saveAsPageCloses() {
  for (const id of [...pending.keys()]) void saveDesign(take(id), { keepalive: true });
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
