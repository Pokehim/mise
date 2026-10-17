/*
 * The editor store (zustand). The scene renders only what is here, and every change to the
 * Design is an Edit: nothing mutates the scene directly (spec §3, ADR-0001).
 *
 * Public API. #9, #10 and #11 hook into it, so keep it small and stable:
 *
 *   useEditor(selector)        React hook; useEditor.getState() and .subscribe() work outside React.
 *   status, error              'idle' | 'loading' | 'ready' | 'error' for the Design being opened.
 *   manifest, setup, catalog,  What load() fetched; null until status is 'ready'. The editor mounts only
 *   design                     when it is, so code under it reads them as useEditor((s) => s.setup!).
 *   roomState                  replay(setup, catalog, design.edits), recomputed after every change.
 *   dirty                      true once the Edit list changes; whoever saves the Design sets it back
 *                              with useEditor.setState({ dirty: false }) (autosave, #11).
 *   selection                  The selected Piece, Original or Wall, or null.
 *   view                       'dollhouse' | 'walk'.
 *   preview                    A Piece's placement while it is being dragged: shown instead of its
 *                              roomState placement, and committed as one move Edit when the drag ends.
 *
 *   load(designId)             Fetches the Design, its Scan's manifest and setup, and the Catalog.
 *   applyEdit(edit, by?)       Stamps the Edit's id, time and actor ('mover' by default), appends it,
 *                              recomputes roomState and sets dirty. Returns the stamped Edit.
 *   setEdits(edits)            Replaces the whole Edit list (undo, deleting from History). applyEdit uses it.
 *   select(selection), setView(view), setPreview(preview)
 */
import { create } from 'zustand';
import { newId } from '@shared/ids';
import type { Actor, Catalog, Design, Edit, Placement, RoomSetup, RoomState, ScanManifest } from '@shared/types';
import { listScans, loadCatalog, loadDesign, loadSetup } from '../api';
import { replay } from './core';

export type Selection = { kind: 'piece' | 'original' | 'wall'; id: string };
export type View = 'dollhouse' | 'walk';
export type Preview = { pieceId: string; placement: Placement };

type OmitEach<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;
/** An Edit before applyEdit stamps it. */
export type NewEdit = OmitEach<Edit, 'id' | 'at' | 'by'>;

interface EditorState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  manifest: ScanManifest | null;
  setup: RoomSetup | null;
  catalog: Catalog | null;
  design: Design | null;
  roomState: RoomState | null;
  dirty: boolean;
  selection: Selection | null;
  view: View;
  preview: Preview | null;
  load(designId: string): Promise<void>;
  applyEdit(edit: NewEdit, by?: Actor): Edit;
  setEdits(edits: Edit[]): void;
  select(selection: Selection | null): void;
  setView(view: View): void;
  setPreview(preview: Preview | null): void;
}

/** Whether a selection still points at something in the room. */
function inRoom(selection: Selection, roomState: RoomState) {
  if (selection.kind === 'piece') return selection.id in roomState.pieces;
  if (selection.kind === 'original') return roomState.originals[selection.id]?.visible === true;
  return true;
}

let latestLoad = 0;

export const useEditor = create<EditorState>()((set, get) => ({
  status: 'idle',
  error: null,
  manifest: null,
  setup: null,
  catalog: null,
  design: null,
  roomState: null,
  dirty: false,
  selection: null,
  view: 'dollhouse',
  preview: null,

  async load(designId) {
    const thisLoad = ++latestLoad;
    set({ status: 'loading', error: null, selection: null, preview: null });
    try {
      const design = await loadDesign(designId);
      const [scans, setup, catalog] = await Promise.all([listScans(), loadSetup(design.scanId), loadCatalog()]);
      const manifest = scans.find((scan) => scan.id === design.scanId);
      if (!manifest) throw new Error(`No Scan ${design.scanId}`);
      if (thisLoad !== latestLoad) return;   // a newer load() took over
      set({ status: 'ready', manifest, setup, catalog, design, roomState: replay(setup, catalog, design.edits), dirty: false });
    } catch (error) {
      if (thisLoad === latestLoad) set({ status: 'error', error: (error as Error).message });
    }
  },

  applyEdit(edit, by = 'mover') {
    const stamped = { ...edit, id: newId('ed'), at: new Date().toISOString(), by } satisfies Edit;
    get().setEdits([...get().design!.edits, stamped]);
    return stamped;
  },

  setEdits(edits) {
    const { setup, catalog, design, selection } = get();
    const roomState = replay(setup!, catalog!, edits);
    set({
      design: { ...design!, edits },
      roomState,
      dirty: true,
      selection: selection && inRoom(selection, roomState) ? selection : null,
    });
  },

  select: (selection) => set({ selection }),
  setView: (view) => set({ view }),
  setPreview: (preview) => set({ preview }),
}));
