import { type FormEvent, useState } from 'react';
import type { RefineResult } from '../../../server/generate/refine';
import { reveal, useReveal } from '../scene/Reveal';
import { useGenerate } from '../state/generate';
import { saveNow } from '../state/history';
import { useEditor } from '../state/store';
import { RotateLeft, Sparkle } from './icons';
import { useServerConfig } from './useServerConfig';
import './refine.css';

/** What a Refine can look like, shown in the empty field. */
const EXAMPLE = 'Make it cozier';

/**
 * Under the 3D view of a Claude Design: the Refine box (spec §13.1, step 7), where the Mover asks Claude
 * to adjust this Design, and Replay, which reveals it again. Claude's new Edits play in as a reveal, and
 * show in History.
 */
export function RefineBox() {
  const claude = useEditor((s) => s.design!.origin === 'claude');
  const canRefine = useServerConfig()?.generate !== false;
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  if (!claude) return null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    const id = useEditor.getState().design!.id;
    setBusy(true);
    setError(undefined);
    try {
      // Claude refines the Design as saved, so the Mover's latest change goes first.
      await saveNow();
      const res = await fetch(`/api/designs/${id}/refine`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // At the speed the Mover picked for Briefs.
        body: JSON.stringify({ text: text.trim(), fast: useGenerate.getState().fast }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `The server answered ${res.status}`);
      const { design: refined, edits } = body as RefineResult;
      const current = useEditor.getState().design;
      if (current?.id !== id) return;   // another Design opened meanwhile
      // After any Edit the Mover made while Claude worked, so that none is lost.
      const from = current.edits.length;
      useEditor.setState({ design: { ...current, name: refined.name, rationale: refined.rationale, palette: refined.palette } });
      useEditor.getState().setEdits([...current.edits, ...edits]);
      reveal(from);
      setText('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="refine-bar">
      {canRefine && (
        <form className="refine-box" onSubmit={(event) => void submit(event)} aria-busy={busy}>
          <Sparkle />
          <label className="sr-only" htmlFor="refine-text">Refine this Design with AI</label>
          <input
            id="refine-text"
            name="refine"
            autoComplete="off"
            placeholder={`Refine with AI: ${EXAMPLE.toLowerCase()}`}
            value={text}
            onChange={(event) => setText(event.target.value)}
            disabled={busy}
          />
          <button type="submit" className="primary" disabled={busy || !text.trim()}>{busy ? 'Refining…' : 'Refine'}</button>
        </form>
      )}
      <ReplayButton />
      {error && <p className="error" role="alert">The AI couldn't refine it: {error}</p>}
    </div>
  );
}

/** Replay: the Design's reveal again, from an empty room. While a reveal plays, it shows how far along it is. */
function ReplayButton() {
  const progress = useReveal((s) => s.run && `${s.run.next} of ${s.run.edits.length}`);
  return (
    <button type="button" className="replay" onClick={() => reveal(0)} title="Watch the Design assemble itself again">
      <RotateLeft />
      Replay
      {progress && <span className="mono progress" aria-hidden="true">{progress}</span>}
    </button>
  );
}
