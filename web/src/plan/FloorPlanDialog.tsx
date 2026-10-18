import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { uploadFloorPlan } from '../api';
import { Close } from '../ui/icons';
import './plan.css';

/** The image types the server reads. A PDF is a picture of the plan away (part 3 of #68 renders its first page). */
const ACCEPT = 'image/png,image/jpeg,image/webp';

/** "Mid-plan_Room 412.png" → "Mid plan Room 412". */
const nameFromFile = (file: File) => file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();

/**
 * "New Scan from a floor plan" on Home, and its dialog (ADR-0011): the Mover picks the plan and names
 * the room, Claude reads it, and Room Setup opens over it for the Mover to check.
 */
export function FloorPlanDialog() {
  const [, navigate] = useLocation();
  const dialog = useRef<HTMLDialogElement>(null);
  const [file, setFile] = useState<File>();
  const [name, setName] = useState('');
  const [since, setSince] = useState<number>();
  const [error, setError] = useState<string>();
  const working = since !== undefined;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!file || !name.trim()) return;
    setError(undefined);
    setSince(Date.now());
    try {
      const { scanId } = await uploadFloorPlan(file, name.trim());
      navigate(`/setup/${scanId}`);
    } catch (err) {
      setError((err as Error).message);
      setSince(undefined);
    }
  }

  return (
    <>
      <button type="button" onClick={() => dialog.current!.showModal()}>New Scan from a floor plan</button>
      <dialog
        ref={dialog}
        className="fp-dialog"
        aria-labelledby="fp-dialog-title"
        onCancel={(event) => working && event.preventDefault()}
        onClick={(event) => event.target === dialog.current && !working && dialog.current.close()}
      >
        <header>
          <h2 id="fp-dialog-title">New Scan from a floor plan</h2>
          <button type="button" className="icon-button" aria-label="Close" disabled={working} onClick={() => dialog.current!.close()}><Close /></button>
        </header>
        <form onSubmit={submit}>
          <p>
            Haven't moved in yet? Upload your room's floor plan, from your housing office or the building's website. Claude
            reads its walls, doors and windows, you check them over the plan, and your room is built in 3D, empty and ready
            to furnish.
          </p>
          <label className="fp-dialog-field">
            <span>The plan</span>
            <input
              type="file"
              accept={ACCEPT}
              disabled={working}
              onChange={(event) => {
                const picked = event.target.files?.[0];
                setFile(picked);
                if (picked && !name) setName(nameFromFile(picked));
              }}
            />
            <span className="muted">A PNG, JPEG or WebP image. For a PDF, take a screenshot of the plan.</span>
          </label>
          <label className="fp-dialog-field">
            <span>The room</span>
            <input value={name} placeholder="Maple Hall 412" disabled={working} onChange={(event) => setName(event.target.value)} />
          </label>
          {error && <p className="error" role="alert">Could not read the plan: {error}</p>}
          <footer>
            {working ? <Reading since={since} /> : (
              <>
                <button type="button" onClick={() => dialog.current!.close()}>Cancel</button>
                <button type="submit" className="primary" disabled={!file || !name.trim()}>Read the plan</button>
              </>
            )}
          </footer>
        </form>
      </dialog>
    </>
  );
}

/** While Claude reads: what's happening, and the seconds so far. */
function Reading({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <p className="fp-reading" role="status">
      Reading the floor plan… usually under a minute <span className="muted">· {Math.round((now - since) / 1000)} s</span>
    </p>
  );
}
