import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'wouter';
import { useShallow } from 'zustand/react/shallow';
import type { RoomSetup, ScanManifest } from '@shared/types';
import { loadManifest } from '../api';
import { FloorPlanSetup } from '../plan/FloorPlanSetup';
import { ArrowLeft, Check } from '../ui/icons';
import { fillsAligned } from './fills';
import { UNBAKED_FLOOR_COLOR } from './originals';
import { StepPanel } from './panels';
import { SetupCanvas } from './SetupCanvas';
import { DEFAULT_CEILING_HEIGHT, hasUnsavedChanges, isLeveled, STEPS, type StepId, useSetup } from './store';
import './setup.css';

/** While a Scan loads, in the editor's words and look. */
const Loading = () => (
  <main className="app-status" aria-busy="true">
    <h1>Opening Room Setup…</h1>
    <p>Loading the Scan.</p>
  </main>
);

/**
 * Room Setup: for a Floor Plan Scan (ADR-0011), correcting Claude's reading of the plan
 * (FloorPlanSetup); for Captures, the stepper below.
 */
export function RoomSetupPage({ params }: { params: { scanId: string } }) {
  const [manifest, setManifest] = useState<ScanManifest | null>();
  useEffect(() => {
    setManifest(undefined);
    loadManifest(params.scanId).then(setManifest, () => setManifest(null));
  }, [params.scanId]);
  if (manifest === undefined) return <Loading />;
  if (manifest?.floorPlan) return <FloorPlanSetup key={manifest.id} manifest={manifest} />;
  return <CaptureSetup params={params} />;
}

// Room Setup (spec §9.3): a stepper that turns a raw capture into a usable Scan.
function CaptureSetup({ params }: { params: { scanId: string } }) {
  const status = useSetup((s) => s.status);
  const message = useSetup((s) => s.message);
  const load = useSetup((s) => s.load);
  const unsaved = useSetup(hasUnsavedChanges);

  useEffect(() => {
    load(params.scanId);
  }, [load, params.scanId]);

  useEffect(() => {
    if (!unsaved) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [unsaved]);

  if (status === 'loading') return <Loading />;
  if (status === 'error') {
    return (
      <main className="app-status">
        <h1>Room Setup didn't open</h1>
        <p>Could not open Room Setup: {message}</p>
        <Link href="/scans">Back to your Scans</Link>
      </main>
    );
  }
  return <SetupLayout />;
}

/**
 * The page: a header, the steps and the current step's panel on a sheet at the left, and the room.
 * On a phone, one scrolling column: the header, the room, then the steps and the panel.
 */
function SetupLayout() {
  const { name, step, status, message, preview, unsaved } = useSetup(useShallow((s) => ({
    name: s.manifest!.name, step: s.step, status: s.status, message: s.message, preview: s.preview, unsaved: hasUnsavedChanges(s),
  })));
  const done = useSetup(useShallow((s) => STEPS.map(({ id }) => isDone(id, s.manifest!, s.setup!))));
  const { setStep, save } = useSetup.getState();
  const stepIndex = STEPS.findIndex((s) => s.id === step);
  const steps = useRef<HTMLOListElement>(null);

  // On a phone the steps are one scrolling row: keep the current one in it. The row scrolls, never the page.
  useLayoutEffect(() => {
    const list = steps.current;
    const current = list?.querySelector<HTMLElement>('[aria-current="step"]');
    if (!list || !current || list.scrollWidth <= list.clientWidth) return;
    list.scrollLeft = current.offsetLeft - (list.clientWidth - current.offsetWidth) / 2;
  }, [step]);

  return (
    <div className="rs">
      <header className="rs-header">
        <Link href="/scans" className="rs-back" aria-label="Scans"><ArrowLeft /><span className="rs-back-label">Scans</span></Link>
        <h1>
          <span className="rs-title">Room Setup</span>
          <span className="rs-scan-name">{name}</span>
        </h1>
        <label className="rs-toggle">
          <input type="checkbox" checked={preview} onChange={(e) => useSetup.setState({ preview: e.target.checked })} />
          Preview split
        </label>
        {/* A message here is a load or save error: red pencil. */}
        <span className={message && status !== 'saving' ? 'rs-status rs-warn' : 'rs-status'} role="status">
          {status === 'saving' ? 'Saving…' : message ?? (unsaved ? 'Unsaved changes' : 'Saved')}
        </span>
        <button type="button" className="primary" disabled={status === 'saving' || !unsaved} onClick={save}>Save</button>
      </header>
      <aside className="rs-sidebar">
        <nav aria-label="Steps">
          <ol className="rs-steps" ref={steps}>
            {STEPS.map((s, i) => (
              <li key={s.id}>
                <button type="button" aria-current={s.id === step ? 'step' : undefined} onClick={() => setStep(s.id)}>
                  <span className={done[i] ? 'rs-step-number rs-step-done' : 'rs-step-number'} aria-hidden={done[i]}>
                    {done[i] ? <Check /> : i + 1}
                  </span>
                  <span className="rs-step-title">{s.title}</span>
                  {done[i] && <span className="sr-only">(done)</span>}
                </button>
              </li>
            ))}
          </ol>
        </nav>
        <section className="rs-panel" aria-labelledby="rs-panel-title">
          <p className="rs-kicker">Step {stepIndex + 1} of {STEPS.length}</p>
          <h2 id="rs-panel-title">{STEPS[stepIndex].title}</h2>
          <StepPanel step={step} />
        </section>
      </aside>
      <div className="rs-view">
        <SetupCanvas />
        {preview && <PreviewPanel />}
      </div>
    </div>
  );
}

function isDone(step: StepId, manifest: ScanManifest, setup: RoomSetup): boolean {
  switch (step) {
    // Some Scans are imported already in the room frame: their identity meshTransform is right once they have Walls.
    case 'level': return isLeveled(manifest) || setup.walls.length > 0;
    case 'ceiling': return setup.ceilingHeight !== DEFAULT_CEILING_HEIGHT || setup.walls.length > 0;
    case 'corners': return setup.walls.length >= 3;
    case 'openings': return setup.openings.length > 0;
    case 'originals': return setup.originals.length > 0;
    case 'fills': return fillsAligned(manifest);
    case 'bake': return setup.originals.length > 0 && setup.originals.every((o) => o.floorColor !== UNBAKED_FLOOR_COLOR);
  }
}

/** With "Preview split" on: the split's time, and a switch to hide each Original. */
function PreviewPanel() {
  const originals = useSetup((s) => s.setup!.originals);
  const hidden = useSetup((s) => s.hiddenOriginals);
  const ms = useSetup((s) => s.lastSplitMs);
  return (
    <section className="rs-preview" aria-labelledby="rs-preview-title">
      <h2 id="rs-preview-title">Split preview</h2>
      <small>Each node has its own tint.{ms !== undefined && <> Split in <span className="mono">{Math.round(ms)} ms</span>.</>}</small>
      {originals.length === 0 && <small>No Originals yet.</small>}
      <div className="rs-preview-list">
        {originals.map((o) => (
          <label key={o.id} className="rs-check">
            <input type="checkbox" checked={!!hidden[o.id]}
              onChange={(e) => useSetup.setState({ hiddenOriginals: { ...hidden, [o.id]: e.target.checked } })} />
            Hide {o.label}
          </label>
        ))}
      </div>
    </section>
  );
}
