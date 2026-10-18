import { type FormEvent, useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { RefineResult } from '../../../server/generate/refine';
import { forgetTake, saveTake, savedTake } from '../api';
import { reveal, useReveal } from '../scene/Reveal';
import { useGenerate } from '../state/generate';
import { saveNow } from '../state/history';
import { useEditor } from '../state/store';
import { Bookmark, Close, RotateLeft, Sparkle } from './icons';
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
      <SaveTakeButton />
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

/** The key that saving a take needs, remembered in this browser once it worked; Start fresh forgets it. */
const SAVE_KEY = 'mise.saveKey';

function storedKey() {
  try {
    return localStorage.getItem(SAVE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

function storeKey(key: string | undefined) {
  try {
    if (key) localStorage.setItem(SAVE_KEY, key);
    else localStorage.removeItem(SAVE_KEY);
  } catch {
    // Private windows can refuse storage; the key is then asked for each time.
  }
}

/**
 * Save for this Brief: the Design is kept on the server as its take on the Brief that made it, so that
 * Generate gives it again, Edit by Edit, when the same Brief comes back, instead of a new take from Claude.
 * It changes what everyone's Brief gives, so it asks for the key, once per browser.
 */
function SaveTakeButton() {
  const { id, hasBrief } = useEditor(useShallow((s) => ({ id: s.design!.id, hasBrief: !!s.design!.brief })));
  // undefined until the server says whether it is saved.
  const [saved, setSaved] = useState<boolean>();
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [key, setKey] = useState('');
  const [error, setError] = useState<string>();

  useEffect(() => {
    setSaved(undefined);
    setAsking(false);
    setError(undefined);
    if (!hasBrief) return;
    let current = true;
    savedTake(id).then(({ direction }) => current && setSaved(!!direction), () => current && setSaved(false));
    return () => { current = false; };
  }, [id, hasBrief]);
  if (!hasBrief) return null;

  async function toggle(withKey = storedKey()) {
    if (!withKey) return setAsking(true);
    setBusy(true);
    setError(undefined);
    try {
      if (saved) {
        await forgetTake(id, withKey);
      } else {
        // The take given again is the Design as saved, so its latest change goes first.
        await saveNow();
        await saveTake(id, withKey);
      }
      storeKey(withKey);
      setSaved(!saved);
      setAsking(false);
      setKey('');
    } catch (err) {
      const wrongKey = / 403 /.test((err as Error).message);
      if (wrongKey) {
        storeKey(undefined);
        setAsking(true);
      }
      setError(wrongKey ? 'That key is not right.' : `Couldn't ${saved ? 'stop saving' : 'save'} this Design for its Brief: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  const label = saved ? 'Saved for this Brief' : 'Save for this Brief';
  return (
    <>
      {asking ? (
        <form
          className="save-take-key"
          onSubmit={(event) => {
            event.preventDefault();
            void toggle(key.trim());
          }}
        >
          <Bookmark />
          <label className="sr-only" htmlFor="save-take-key">Key</label>
          <input
            id="save-take-key"
            type="password"
            autoComplete="off"
            placeholder="Key"
            value={key}
            onChange={(event) => setKey(event.target.value)}
            onKeyDown={(event) => event.key === 'Escape' && setAsking(false)}
            disabled={busy}
            autoFocus
          />
          <button type="submit" className="primary" disabled={busy || !key.trim()}>{saved ? 'Stop saving' : 'Save'}</button>
          <button type="button" className="icon-button" aria-label="Cancel" onClick={() => { setAsking(false); setError(undefined); }}><Close /></button>
        </form>
      ) : (
        <button
          type="button"
          className="save-take"
          aria-pressed={!!saved}
          disabled={saved === undefined || busy}
          onClick={() => void toggle()}
          title={saved ? 'Generate gives this Design again for the same Brief. Click to stop.' : 'Generate gives this Design again, instead of a new take, when the same Brief is sent'}
        >
          <Bookmark />
          {label}
        </button>
      )}
      {error && <p className="error" role="alert">{error}</p>}
    </>
  );
}
