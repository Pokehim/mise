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
 *   dirty                      true once the Design changes (its Edits, or its name on Rename); whoever saves
 *                              the Design sets it back with useEditor.setState({ dirty: false }) (autosave, #11).
 *   selection                  The selected Piece, Original or Wall, or null.
 *   highlight                  The item a hovered History row changed (#11): outlined like the selection.
 *   view                       'dollhouse' | 'walk'.
 *   preview                    A Piece's or Original's placement while it is being dragged (pieceId holds the
 *                              Original's id too, as ids are unique across both): shown instead of its
 *                              roomState placement, and committed as one move Edit when the drag ends.
 *
 *   load(designId)             Fetches the Design, its Scan's manifest and setup, and the Catalog.
 *   applyEdit(edit)            Stamps the Edit's id, time and actor (the Mover), appends it, recomputes
 *                              roomState and sets dirty.
 *   setEdits(edits)            Replaces the whole Edit list (undo, deleting from History). applyEdit uses it.
 *   select(selection), setView(view), setPreview(preview), setHighlight(highlight)
 *
 *   pieceItem(state, pieceId)  The Catalog item a Piece shows, for selectors: useEditor((s) => pieceItem(s, id)).
 *   inRoom(selection, roomState)  Whether a selection still points at something in the room.
 */
import { create } from 'zustand';
import { newId } from '@shared/ids';
import type { Catalog, CatalogItem, Design, Edit, Placement, RoomSetup, RoomState, ScanManifest } from '@shared/types';
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
  highlight: Selection | null;
  view: View;
  preview: Preview | null;
  load(designId: string): Promise<void>;
  applyEdit(edit: NewEdit): void;
  setEdits(edits: Edit[]): void;
  select(selection: Selection | null): void;
  setView(view: View): void;
  setPreview(preview: Preview | null): void;
  setHighlight(highlight: Selection | null): void;
}

export function pieceItem(state: EditorState, pieceId: string): CatalogItem | undefined {
  const piece = state.roomState?.pieces[pieceId];
  return piece && state.catalog?.items.find(({ id }) => id === piece.catalogId);
}

/** Whether a selection still points at something in the room. */
export function inRoom(selection: Selection, roomState: RoomState) {
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
  highlight: null,
  view: 'dollhouse',
  preview: null,

  async load(designId) {
    const thisLoad = ++latestLoad;
    set({ status: 'loading', error: null, selection: null, preview: null });
    try {
      const [design, scans, catalog] = await Promise.all([loadDesign(designId), listScans(), loadCatalog()]);
      const setup = await loadSetup(design.scanId);
      const manifest = scans.find((scan) => scan.id === design.scanId);
      if (!manifest) throw new Error(`No Scan ${design.scanId}`);
      if (thisLoad !== latestLoad) return;   // a newer load() took over
      set({ status: 'ready', manifest, setup, catalog, design, roomState: replay(setup, catalog, design.edits), dirty: false });
    } catch (error) {
      if (thisLoad === latestLoad) set({ status: 'error', error: (error as Error).message });
    }
  },

  applyEdit(edit) {
    const stamped = { ...edit, id: newId('ed'), at: new Date().toISOString(), by: 'mover' } satisfies Edit;
    get().setEdits([...get().design!.edits, stamped]);
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
  setHighlight: (highlight) => set({ highlight }),
}));
