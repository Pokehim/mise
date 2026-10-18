import { type DragEvent, type FormEvent, type RefObject, useEffect, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import type { ScanManifest } from '@shared/types';
import type { ImportStep } from '../../../server/app';
import { createDesign, importScanFiles, saveDesign, saveManifest } from '../api';
import { type LibraryScan, moveInLayoutId, planImageBase, searchLibrary } from '../plan/library';
import { ArrowRight, Close, Import } from '../ui/icons';
import { addScanFiles, missingFile, nameFromFile, type ScanFiles } from './importFiles';
import { ScanPlan } from './ScanPlan';

type Working = (working: boolean) => void;

/**
 * "Import" on Home, and its dialog, with the two ways a room becomes the Mover's: drop the scan they
 * made of it, or find it in the library of school dorm rooms.
 */
export function ImportDialog({ scans }: { scans: ScanManifest[] }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [working, setWorking] = useState(false);

  function open() {
    dialog.current!.showModal();
    // showModal focuses the first control, the Close button, and React's autoFocus ran long before.
    search.current!.focus();
  }
  const close = () => !working && dialog.current!.close();

  return (
    <>
      <button type="button" onClick={open}><Import />Import</button>
      <dialog
        ref={dialog}
        className="import-dialog"
        aria-labelledby="import-dialog-title"
        onCancel={(event) => working && event.preventDefault()}
        onClick={(event) => event.target === dialog.current && close()}
        // A file dropped beside the drop zone would otherwise open in the tab, leaving Mise.
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => event.preventDefault()}
      >
        <header>
          <h2 id="import-dialog-title">Import</h2>
          <button type="button" className="icon-button" aria-label="Close" disabled={working} onClick={close}><Close /></button>
        </header>
        <ScanDrop busy={working} onWorking={setWorking} />
        <fieldset disabled={working} className="import-part library-part">
          <LibrarySearch inputRef={search} scans={scans} query={query} onQuery={setQuery} onWorking={setWorking} />
        </fieldset>
      </dialog>
    </>
  );
}

/** The library search: a field, the rooms it finds, and what to do when it finds none. */
function LibrarySearch({ inputRef, scans, query, onQuery, onWorking }: {
  inputRef: RefObject<HTMLInputElement | null>;
  scans: ScanManifest[];
  query: string;
  onQuery: (query: string) => void;
  onWorking: Working;
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
      <label className="import-field">
        <span>Or find your school or dorm</span>
        <input
          ref={inputRef}
          type="search"
          value={query}
          placeholder="Washington, Lander Hall…"
          autoComplete="off"
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
                <button type="button" className="library-pick" onClick={() => choose(scan, true)}>
                  <PlanThumb scanId={scan.id} />
                  <span className="library-room">
                    <span className="school">{scan.library.school}</span>
                    <span className="muted">{scan.library.hall} · {scan.library.room}</span>
                    <span className="hint">{busy && opening.furnished ? 'Opening…' : 'Furnished as it comes'}</span>
                  </span>
                  <ArrowRight />
                </button>
                <button type="button" className="library-empty" onClick={() => choose(scan, false)}>
                  {busy && !opening.furnished ? 'Opening…' : 'Start empty'}
                </button>
              </li>
            );
          })}
        </ul>
      ) : typed && (
        <p className="empty library-none" role="status"><b>We don't have {typed} yet.</b> Drop your room's scan above.</p>
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

const STEP_LABELS: Record<'upload' | ImportStep, string> = {
  upload: 'Uploading',
  mesh: 'Optimizing the mesh',
  points: 'Turning the point cloud into a splat',
  splat: 'Building the splat',
};

/** Where an import has got to: how much is uploaded, and the steps the server has started. */
interface Progress {
  uploaded: number;
  started: ImportStep[];
  since: number;
}

const megabytes = (file: File) => `${(file.size / 1e6).toFixed(file.size < 1e7 ? 1 : 0)} MB`;

/**
 * The drop zone, which also opens a file picker: the room's GLB becomes a new Scan, and a PLY dropped
 * with it the Scan's splat. Then Room Setup opens on it.
 */
function ScanDrop({ busy, onWorking }: { busy: boolean; onWorking: Working }) {
  const [, navigate] = useLocation();
  const picker = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<ScanFiles>({});
  const [refused, setRefused] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [over, setOver] = useState(false);
  const [progress, setProgress] = useState<Progress>();
  const [error, setError] = useState<string>();
  const working = !!progress;
  // While the library opens a room, or this imports one.
  const locked = busy || working;
  const missing = missingFile(files);

  function add(dropped: File[]) {
    if (locked || !dropped.length) return;
    const next = addScanFiles(files, dropped);
    setFiles(next.files);
    setRefused(next.refused);
    setError(undefined);
    // The room is named after its GLB until the Mover names it.
    if (next.files.mesh !== files.mesh && (!name || (files.mesh && name === nameFromFile(files.mesh)))) setName(nameFromFile(next.files.mesh!));
  }
  function remove(field: keyof ScanFiles) {
    setFiles(({ [field]: _, ...rest }) => rest);
    setRefused([]);
  }
  function drop(event: DragEvent) {
    event.preventDefault();
    setOver(false);
    add([...event.dataTransfer.files]);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (missing || !files.mesh || !name.trim()) return;
    setError(undefined);
    setProgress({ uploaded: 0, started: [], since: Date.now() });
    onWorking(true);
    try {
      const scanId = await importScanFiles({ mesh: files.mesh, splat: files.splat, name: name.trim() }, (event) => setProgress((p) => p && {
        ...p,
        ...(event.type === 'upload' && { uploaded: event.fraction }),
        ...(event.type === 'step' && { started: [...p.started, event.step], since: Date.now() }),
      }));
      onWorking(false);
      navigate(`/setup/${scanId}`);
    } catch (err) {
      setError((err as Error).message);
      setProgress(undefined);
      onWorking(false);
    }
  }

  return (
    <form className="import-part scan-drop" onSubmit={submit}>
      <button
        type="button"
        className={`drop-zone${over ? ' over' : ''}`}
        // Not `disabled`, which would stop the drop events too, so a file dropped on it would open in the tab.
        aria-disabled={locked}
        onClick={() => !locked && picker.current!.click()}
        onDragOver={(event) => {
          event.preventDefault();
          if (!locked) setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={drop}
      >
        <span className="drop-title">Drop your room's scan: a GLB, and its PLY if you have one.</span>
        <span className="muted">Or click to choose the files. Room Setup opens on it next.</span>
      </button>
      <input
        ref={picker}
        type="file"
        accept=".glb,.ply"
        multiple
        hidden
        onChange={(event) => {
          add([...(event.target.files ?? [])]);
          event.target.value = ''; // so picking the same file again still adds it
        }}
      />
      {refused.map((reason) => <p key={reason} className="error" role="alert">{reason}</p>)}
      {(files.mesh || files.splat) && (
        <ul className="drop-files" aria-label="Your scan's files">
          {(['mesh', 'splat'] as const).map((field) => files[field] && (
            <li key={field}>
              <span className="drop-kind">{field === 'mesh' ? 'GLB' : 'PLY'}</span>
              <span className="drop-name">{files[field].name}</span>
              <span className="muted">{megabytes(files[field])}</span>
              <button type="button" className="icon-button" aria-label={`Remove ${files[field].name}`} disabled={locked} onClick={() => remove(field)}><Close /></button>
            </li>
          ))}
        </ul>
      )}
      {files.splat && missing && <p className="error" role="alert">{missing}</p>}
      {files.mesh && (
        <label className="import-field">
          <span>The room</span>
          <input value={name} placeholder="Maple Hall 412" disabled={locked} onChange={(event) => setName(event.target.value)} />
        </label>
      )}
      {error && <p className="error" role="alert">Could not import the scan: {error}</p>}
      {progress ? <Steps progress={progress} splat={!!files.splat} /> : files.mesh && (
        <footer>
          <button type="submit" className="primary" disabled={locked || !!missing || !name.trim()}>Import the scan</button>
        </footer>
      )}
    </form>
  );
}

/** Each step of the import, done, running or still to come; the running one with how far it has got. */
function Steps({ progress: { uploaded, started, since }, splat }: { progress: Progress; splat: boolean }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  // A point cloud's extra step shows once the server finds the PLY is one.
  const steps: ('upload' | ImportStep)[] = ['upload', 'mesh', ...(splat ? [...(started.includes('points') ? ['points' as const] : []), 'splat' as const] : [])];
  const running = started.length ? started.at(-1)! : 'upload';
  const at = steps.indexOf(running);
  return (
    <ol className="import-steps" role="status" aria-label="Importing the scan">
      {steps.map((step, i) => (
        <li key={step} className={i < at ? 'done' : i === at ? 'running' : 'todo'}>
          <span className="step-label">
            {STEP_LABELS[step]}
            {i === at && step === 'upload' && <span className="muted"> · {Math.round(uploaded * 100)}%</span>}
            {i === at && step !== 'upload' && <span className="muted"> · {Math.max(0, Math.round((now - since) / 1000))} s</span>}
          </span>
        </li>
      ))}
      {splat && <li className="note muted">A large PLY can take a few minutes.</li>}
    </ol>
  );
}
