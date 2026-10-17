import { useEffect } from 'react';
import { Link } from 'wouter';
import { useEditor } from '../state/store';
import { TopBar } from '../ui/TopBar';
import { SceneCanvas } from './SceneCanvas';
import './editor.css';

/** The editor at /d/:designId (spec §10.1). */
export function EditorPage({ params: { designId } }: { params: { designId: string } }) {
  const ready = useEditor((s) => s.status === 'ready' && s.design?.id === designId);
  const error = useEditor((s) => s.error);

  useEffect(() => {
    void useEditor.getState().load(designId);
  }, [designId]);

  if (error) return <main>Could not open Design {designId}: {error} <Link href="/">← Scans</Link></main>;
  if (!ready) return <main>Loading…</main>;
  return (
    <div className="editor">
      <TopBar />
      <SceneCanvas />
      <footer className="editor-footer">3D models: Amazon Berkeley Objects (CC BY 4.0), Amazon.com.</footer>
    </div>
  );
}
