import { useEffect } from 'react';
import { Link } from 'wouter';
import { useShallow } from 'zustand/react/shallow';
import type { RoomSetup, ScanManifest } from '@shared/types';
import { fillsAligned } from './fills';
import { UNBAKED_FLOOR_COLOR } from './originals';
import { StepPanel } from './panels';
import { SetupCanvas } from './SetupCanvas';
import { hasUnsavedChanges, isLeveled, STEPS, type StepId, useSetup } from './store';
import './setup.css';

// Room Setup (spec §9.3): a stepper that turns a raw capture into a usable Scan.
export function RoomSetupPage({ params }: { params: { scanId: string } }) {
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

  if (status === 'loading') return <main className="rs-message">Loading the Scan…</main>;
  if (status === 'error') return <main className="rs-message">Could not open Room Setup: {message} <Link href="/">← Scans</Link></main>;
  return <SetupLayout />;
}

function SetupLayout() {
  const { name, step, status, message, preview, unsaved } = useSetup(useShallow((s) => ({
    name: s.manifest!.name, step: s.step, status: s.status, message: s.message, preview: s.preview, unsaved: hasUnsavedChanges(s),
  })));
  const done = useSetup(useShallow((s) => STEPS.map(({ id }) => isDone(id, s.manifest!, s.setup!))));
  const { setStep, save } = useSetup.getState();
  const stepIndex = STEPS.findIndex((s) => s.id === step);
  return (
    <div className="rs">
      <header className="rs-header">
        <Link href="/">← Scans</Link>
        <h1>Room Setup <span>· {name}</span></h1>
        <label className="rs-toggle">
          <input type="checkbox" checked={preview} onChange={(e) => useSetup.setState({ preview: e.target.checked })} />
          Preview split
        </label>
        <span className="rs-status">{status === 'saving' ? 'Saving…' : message ?? (unsaved ? 'Unsaved changes' : 'Saved')}</span>
        <button type="button" className="rs-primary" disabled={status === 'saving' || !unsaved} onClick={save}>Save</button>
      </header>
      <aside className="rs-sidebar">
        <ol className="rs-steps">
          {STEPS.map((s, i) => (
            <li key={s.id}>
              <button type="button" className={s.id === step ? 'rs-step rs-step-on' : 'rs-step'} onClick={() => setStep(s.id)}>
                <span className="rs-step-number">{done[i] ? '✓' : i + 1}</span>
                {s.title}
              </button>
            </li>
          ))}
        </ol>
        <section className="rs-panel">
          <h2>{stepIndex + 1}. {STEPS[stepIndex].title}</h2>
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
    case 'level': return isLeveled(manifest);
    case 'ceiling': return setup.walls.length > 0;
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
    <div className="rs-preview">
      <strong>Split preview</strong>
      <small>Each node has its own tint.{ms !== undefined && ` Split in ${Math.round(ms)} ms.`}</small>
      {originals.length === 0 && <small>No Originals yet.</small>}
      {originals.map((o) => (
        <label key={o.id} className="rs-check">
          <input type="checkbox" checked={!!hidden[o.id]}
            onChange={(e) => useSetup.setState({ hiddenOriginals: { ...hidden, [o.id]: e.target.checked } })} />
          Hide {o.label}
        </label>
      ))}
    </div>
  );
}
