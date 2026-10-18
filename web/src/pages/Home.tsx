import { useEffect, useState } from 'react';
import { Link, useSearch } from 'wouter';
import type { Design, ScanManifest } from '@shared/types';
import { listDesigns, listScans, startFresh } from '../api';
import { moveInLayoutId } from '../plan/library';
import { count } from '../ui/format';
import { ArrowRight, Plus, RotateLeft, Sparkle } from '../ui/icons';
import { useServerConfig } from '../ui/useServerConfig';
import { Credits } from './Credits';
import { useStartDesign } from '../ui/useStartDesign';
import { ImportDialog } from './ImportDialog';
import { ScanPlan } from './ScanPlan';
import './home.css';

const edited = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** One Scan, with its Designs and a button to start another. */
function ScanSection({ scan, designs }: { scan: ScanManifest; designs: Design[] }) {
  const { start, starting, error } = useStartDesign();
  const demo = useServerConfig()?.demo;

  return (
    <section className="scan" aria-labelledby={`scan-${scan.id}`}>
      <ScanPlan scanId={scan.id} />
      <header>
        <div>
          <h2 id={`scan-${scan.id}`}>{scan.name}</h2>
          <p className="muted">
            {count(designs.length, 'Design')}
            {!demo && <> · <Link href={`/setup/${scan.id}`}>Room Setup</Link></>}
            {scan.floorPlan && <> · <span className="scan-tag">From a floor plan</span></>}
          </p>
        </div>
        <button className="primary" disabled={starting} onClick={() => start({ scanId: scan.id })}><Plus />{starting ? 'Starting…' : 'New Design'}</button>
      </header>
      {error && <p className="error" role="alert">{error}</p>}
      {designs.length ? (
        <ul className="designs">
          {designs.map((design) => (
            <li key={design.id}>
              <Link href={`/d/${design.id}`}>
                <span className="name">
                  {design.origin === 'claude' && <span className="by-claude" title="Made by AI from a Brief"><Sparkle /><span className="sr-only">Made by AI: </span></span>}
                  {design.name}
                </span>
                <span className="meta">
                  {count(design.edits.length, 'Edit')} · Edited {edited.format(new Date(design.updatedAt))}
                </span>
                <ArrowRight />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty"><b>No Designs yet.</b> Start one to try Catalog furniture and wall colors in this room.</p>
      )}
    </section>
  );
}

/** A Scan section in construction lines, its plan's square and rows, while the Scans load. */
const Loading = () => (
  <div className="scan loading" role="status" aria-busy="true" aria-label="Loading the Scans">
    <span className="bone plan" />
    <span className="bone title" />
    <span className="bone row" />
    <span className="bone row" />
  </div>
);

/**
 * `/scans`: the Mover's own Scans, and the Designs under each (spec §10.8), in one column under the
 * name that leads back to the landing page. `/scans?all=1` lists every Scan, the library's and the
 * test rooms too, for development.
 */
export function Home() {
  const all = new URLSearchParams(useSearch()).get('all') === '1';
  const [loaded, setLoaded] = useState<[ScanManifest[], Design[]]>();
  const [error, setError] = useState<string>();
  // Bumped by "Try again", to load the Scans once more.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setError(undefined);
    Promise.all([listScans(), listDesigns()]).then(setLoaded, (err: Error) => setError(err.message));
  }, [attempt]);

  const [scans, designs] = loaded ?? [[], []];
  const listed = all ? scans : scans.filter((scan) => scan.mine);
  // A library room's own Move-in layout is copied, never edited, so only its copies are the Mover's.
  const designsOf = (scan: ScanManifest) => designs.filter((design) =>
    design.scanId === scan.id && (all || !scan.library || design.id !== moveInLayoutId(scan.id)));
  return (
    <div className="home">
      <header className="home-top">
        <Link href="/" className="wordmark">Mise</Link>
      </header>
      <main className="home-scans">
        <div className="home-heading-row">
          <h1 className="home-heading">{all ? 'Every Scan' : 'Your Scans'}</h1>
          <ImportDialog scans={scans} />
        </div>
        {error && (
          <div className="home-error" role="alert">
            <p><b>Couldn't load your Scans.</b> {error}. Check that the API server is running, then try again.</p>
            <button type="button" onClick={() => setAttempt(attempt + 1)}>Try again</button>
          </div>
        )}
        {!loaded && !error && <Loading />}
        {loaded && !listed.length && (
          <p className="empty"><b>No Scans yet.</b> Use “Import” to find your dorm, or to bring the scan you made of your room.</p>
        )}
        {listed.map((scan) => <ScanSection key={scan.id} scan={scan} designs={designsOf(scan)} />)}
      </main>
      <Credits />
      <button
        type="button"
        className="start-fresh"
        onClick={startFresh}
        title="Forget the Designs and settings this browser keeps, so the Scans open as they were scanned. Designs saved for a Brief stay."
      >
        <RotateLeft />Start fresh
      </button>
    </div>
  );
}
