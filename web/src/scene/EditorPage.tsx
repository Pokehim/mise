import { useEffect, useRef } from 'react';
import type { Camera } from 'three';
import { Link, useLocation } from 'wouter';
import { editableDesignId } from '../api';
import { redo, undo, useAutosave } from '../state/history';
import { useEditor } from '../state/store';
import { CatalogPanel } from '../ui/CatalogPanel';
import { HistoryPanel } from '../ui/HistoryPanel';
import { Inspector } from '../ui/Inspector';
import { RefineBox } from '../ui/RefineBox';
import { TopBar } from '../ui/TopBar';
import { addPiece, removeOriginal, removePiece, rotateOriginal, rotatePiece } from './pieceEdits';
import { SceneCanvas } from './SceneCanvas';
import { SHOT_NUMBER, shotView } from './shots';
import './editor.css';
import '../ui/designs.css';

/**
 * Editor shortcuts (spec §10.3): Esc deselects, ⌘Z / ⇧⌘Z undo and redo, R / Shift+R rotate the
 * selected Piece or Original, Delete removes it. A Kept Original ignores both.
 */
function useEditorKeys() {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable]')) return;
      const { selection, preview, select } = useEditor.getState();
      if (event.key === 'Escape') select(null);
      // A drag finishes before undo.
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z' && !preview) {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      }
      if (!selection || selection.kind === 'wall' || preview || event.metaKey || event.ctrlKey || event.altKey) return;
      const [rotate, remove] = selection.kind === 'piece' ? [rotatePiece, removePiece] : [rotateOriginal, removeOriginal];
      if (event.key.toLowerCase() === 'r') rotate(selection.id, event.shiftKey ? -1 : 1);
      // Backspace is the key labeled "delete" on a Mac.
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        remove(selection.id);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}

/** The editor at /d/:designId (spec §10.1). */
export function EditorPage({ params: { designId } }: { params: { designId: string } }) {
  const ready = useEditor((s) => s.status === 'ready' && s.design?.id === designId);
  const error = useEditor((s) => s.error);
  const camera = useRef<Camera>(null);
  useEditorKeys();
  useAutosave();

  const [, navigate] = useLocation();
  useEffect(() => {
    let stale = false;
    // In the public demo, a seed Design opens as the visitor's own copy (#42).
    const open = (id: string) => {
      if (stale) return;
      if (id === designId) void useEditor.getState().load(designId);
      else navigate(`/d/${id}${location.search}`, { replace: true });
    };
    editableDesignId(designId).then(open, () => open(designId));
    return () => {
      stale = true;
    };
  }, [designId]);
  // ?shot= opens in its shot's View (SceneCanvas puts the camera there).
  useEffect(() => {
    if (SHOT_NUMBER) useEditor.getState().setView(shotView(SHOT_NUMBER));
  }, []);

  if (error) {
    return (
      <main className="app-status">
        <h1>This Design didn't open</h1>
        <p>Could not open Design {designId}: {error}</p>
        <Link href="/">Back to your Scans</Link>
      </main>
    );
  }
  if (!ready) {
    return (
      <main className="app-status" aria-busy="true">
        <h1>Opening the Design…</h1>
        <p>Loading the Scan, its Room Setup and the Catalog.</p>
      </main>
    );
  }
  return (
    <div className="editor">
      <TopBar />
      <CatalogPanel onAdd={(item) => camera.current && addPiece(item, camera.current)} />
      <SceneCanvas
        cameraRef={camera}
        onDropItem={(itemId, at) => {
          const item = useEditor.getState().catalog!.items.find(({ id }) => id === itemId);
          if (item && camera.current) addPiece(item, camera.current, at);
        }}
      />
      <RefineBox />
      <Inspector />
      <HistoryPanel />
      <footer className="editor-footer">3D models: Amazon Berkeley Objects (CC BY 4.0), Amazon.com.</footer>
    </div>
  );
}
