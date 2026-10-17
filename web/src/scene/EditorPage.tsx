import { useEffect, useRef } from 'react';
import type { Camera } from 'three';
import { Link } from 'wouter';
import { useEditor } from '../state/store';
import { CatalogPanel } from '../ui/CatalogPanel';
import { TopBar } from '../ui/TopBar';
import { addPiece } from './pieceEdits';
import { SceneCanvas } from './SceneCanvas';
import './editor.css';

/** Editor shortcuts (spec §10.3). Keys typed into a field are left alone. */
function useEditorKeys() {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable]')) return;
      if (event.key === 'Escape') useEditor.getState().select(null);
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

  useEffect(() => {
    void useEditor.getState().load(designId);
  }, [designId]);

  if (error) return <main>Could not open Design {designId}: {error} <Link href="/">← Scans</Link></main>;
  if (!ready) return <main>Loading…</main>;
  return (
    <div className="editor">
      <TopBar />
      <CatalogPanel onAdd={(item) => camera.current && addPiece(item, camera.current)} />
      <SceneCanvas cameraRef={camera} />
      <footer className="editor-footer">3D models: Amazon Berkeley Objects (CC BY 4.0), Amazon.com.</footer>
    </div>
  );
}
