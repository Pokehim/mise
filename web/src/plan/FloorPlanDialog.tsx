import { type FormEvent, type RefObject, useEffect, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import type { ScanManifest } from '@shared/types';
import { createDesign, saveDesign, saveManifest, uploadFloorPlan } from '../api';
import { ScanPlan } from '../pages/ScanPlan';
import { ArrowRight, Close } from '../ui/icons';
import { type LibraryScan, moveInLayoutId, planImageBase, searchLibrary } from './library';
import './plan.css';

/** The image types the server reads. A PDF is a picture of the plan away (part 3 of #68 renders its first page). */
const ACCEPT = 'image/png,image/jpeg,image/webp';

/** "Mid-plan_Room 412.png" → "Mid plan Room 412". */
const nameFromFile = (file: File) => file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();

/**
 * "Import from floor plan" on Home, and its dialog. The Mover first searches the floor plan library
 * for their school or dorm, and opens its room furnished as it comes, or empty. A room that isn't
 * there they upload (ADR-0011): they pick the plan and name the room, Claude reads it, and Room
 * Setup opens over it for the Mover to check.
 */
export function FloorPlanDialog({ scans }: { scans: ScanManifest[] }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const [view, setView] = useState<'search' | 'upload'>('search');
  const [query, setQuery] = useState('');
  const [uploadName, setUploadName] = useState('');
  const [working, setWorking] = useState(false);

  function open() {
    setView('search');
    dialog.current!.showModal();
    // showModal focuses the first control, the Close button, and React's autoFocus ran long before.
    search.current!.focus();
  }
  const close = () => !working && dialog.current!.close();
  function upload(name: string) {
    setUploadName(name);
    setView('upload');
  }

  return (
    <>
      <button type="button" onClick={open}>Import from floor plan</button>
      <dialog
        ref={dialog}
        className="fp-dialog"
        aria-labelledby="fp-dialog-title"
        onCancel={(event) => working && event.preventDefault()}
        onClick={(event) => event.target === dialog.current && close()}
      >
        <header>
          <h2 id="fp-dialog-title">{view === 'search' ? 'Import from floor plan' : 'Upload a floor plan'}</h2>
          <button type="button" className="icon-button" aria-label="Close" disabled={working} onClick={close}><Close /></button>
        </header>
        {/* Kept mounted, so the search and its results are still there after Back. */}
        <div hidden={view !== 'search'}>
          <LibrarySearch inputRef={search} scans={scans} query={query} onQuery={setQuery} onWorking={setWorking} onUpload={upload} />
        </div>
        {view === 'upload' && (
          <UploadForm key={uploadName} initialName={uploadName} onWorking={setWorking} onBack={() => setView('search')} />
        )}
      </dialog>
    </>
  );
}

type Working = (working: boolean) => void;

/** The library search: a field, the rooms it finds, and what to do when it finds none. */
function LibrarySearch({ inputRef, scans, query, onQuery, onWorking, onUpload }: {
  inputRef: RefObject<HTMLInputElement | null>;
  scans: ScanManifest[];
  query: string;
  onQuery: (query: string) => void;
  onWorking: Working;
  onUpload: (name: string) => void;
}) {
  const [, navigate] = useLocation();
  const [opening, setOpening] = useState<{ scanId: string; furnished: boolean }>();
  const [error, setError] = useState<string>();
  const found = searchLibrary(scans, query);
  const typed = query.trim();

  /**
   * Makes the room the Mover's, then opens a Design of it: a copy of its "Move-in layout", so the
   * library's own never changes, or a new, empty one.
   */
  async function choose(scan: LibraryScan, furnished: boolean) {
    setOpening({ scanId: scan.id, furnished });
    setError(undefined);
    onWorking(true);
    try {
      if (!scan.mine) await saveManifest({ ...scan, mine: true });
      const design = furnished
        ? await createDesign({ duplicateOf: moveInLayoutId(scan.id) }).then((copy) => saveDesign({ ...copy, name: 'Move-in layout' }))
        : await createDesign({ scanId: scan.id });
      navigate(`/d/${design.id}`);
    } catch (err) {
      setError(`Could not open ${scan.library.hall} (${(err as Error).message}). Check that the API server is running, then try again.`);
      setOpening(undefined);
    } finally {
      onWorking(false);
    }
  }

  return (
    <div className="library">
      <p>Many schools publish their dorm rooms' floor plans. Find yours to open the room furnished as it comes, or empty.</p>
      <label className="fp-dialog-field">
        <span>Find your school or dorm</span>
        <input
          ref={inputRef}
          type="search"
          value={query}
          placeholder="Washington, Lander Hall…"
          autoComplete="off"
          disabled={!!opening}
          onChange={(event) => onQuery(event.target.value)}
        />
      </label>
      {error && <p className="error" role="alert">{error}</p>}
      {found.length ? (
        <ul className="library-results" aria-label="Rooms in the library">
          {found.map((scan) => {
            const busy = opening?.scanId === scan.id;
            return (
              <li key={scan.id}>
                <button type="button" className="library-pick" disabled={!!opening} onClick={() => choose(scan, true)}>
                  <PlanThumb scanId={scan.id} />
                  <span className="library-room">
                    <span className="school">{scan.library.school}</span>
                    <span className="muted">{scan.library.hall} · {scan.library.room}</span>
                    <span className="hint">{busy && opening.furnished ? 'Opening…' : 'Furnished as it comes'}</span>
                  </span>
                  <ArrowRight />
                </button>
                <button type="button" className="library-empty" disabled={!!opening} onClick={() => choose(scan, false)}>
                  {busy && !opening.furnished ? 'Opening…' : 'Start empty'}
                </button>
              </li>
            );
          })}
        </ul>
      ) : typed && (
        <div className="empty library-none" role="status">
          <p><b>We don't have {typed} yet.</b> Upload its floor plan, and AI reads the room from it.</p>
          <button type="button" className="primary" onClick={() => onUpload(typed)}>Upload its floor plan</button>
        </div>
      )}
      {!!found.length && (
        <p className="library-other muted">
          Not your room? <button type="button" className="link" onClick={() => onUpload(typed)}>Upload its floor plan</button>
        </p>
      )}
    </div>
  );
}

/** The plan image from the room's university, which is a JPEG or a PNG; the room drawn from its Room Setup when there's none. */
function PlanThumb({ scanId }: { scanId: string }) {
  const [tries, setTries] = useState(0);
  const types = ['jpg', 'png'];
  if (tries >= types.length) return <span className="library-thumb"><ScanPlan scanId={scanId} /></span>;
  return (
    <span className="library-thumb">
      <img src={`${planImageBase(scanId)}.${types[tries]}`} alt="" loading="lazy" onError={() => setTries(tries + 1)} />
    </span>
  );
}

/** The upload: the plan and the room's name, then Claude's reading of it, and Room Setup. */
function UploadForm({ initialName, onWorking, onBack }: { initialName: string; onWorking: Working; onBack: () => void }) {
  const [, navigate] = useLocation();
  const [file, setFile] = useState<File>();
  const [name, setName] = useState(initialName);
  const [since, setSince] = useState<number>();
  const [error, setError] = useState<string>();
  const working = since !== undefined;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!file || !name.trim()) return;
    setError(undefined);
    setSince(Date.now());
    onWorking(true);
    try {
      const { scanId } = await uploadFloorPlan(file, name.trim());
      onWorking(false);
      navigate(`/setup/${scanId}`);
    } catch (err) {
      setError((err as Error).message);
      setSince(undefined);
      onWorking(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <p>
        Upload your room's floor plan, from your housing office or the building's website. AI reads its walls, doors
        and windows, you check them over the plan, and your room is built in 3D, empty and ready to furnish.
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
            <button type="button" onClick={onBack}>Back to the library</button>
            <button type="submit" className="primary" disabled={!file || !name.trim()}>Read the plan</button>
          </>
        )}
      </footer>
    </form>
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
