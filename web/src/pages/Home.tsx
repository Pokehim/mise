import { useEffect, useState } from 'react';
import { Link, useSearch } from 'wouter';
import type { Design, ScanManifest } from '@shared/types';
import { listDesigns, listScans } from '../api';
import { FloorPlanDialog } from '../plan/FloorPlanDialog';
import { moveInLayoutId } from '../plan/library';
import { count } from '../ui/format';
import { ArrowRight, Plus } from '../ui/icons';
import { useServerConfig } from '../ui/useServerConfig';
import { useStartDesign } from '../ui/useStartDesign';
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
          <h3 id={`scan-${scan.id}`}>{scan.name}</h3>
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
                <span className="name">{design.name}</span>
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

/** Placeholder rows the size of a Scan section, while the Scans load. */
const Loading = () => (
  <div className="scan loading" aria-busy="true" aria-label="Loading the Scans">
    <span className="bone title" />
    <span className="bone row" />
    <span className="bone row" />
  </div>
);

/**
 * `/`: the Mover's own Scans, and the Designs under each (spec §10.8). `/?all=1` lists every Scan,
 * the library's and the test rooms too, for development.
 */
export function Home() {
  const all = new URLSearchParams(useSearch()).get('all') === '1';
  const [loaded, setLoaded] = useState<[ScanManifest[], Design[]]>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    Promise.all([listScans(), listDesigns()]).then(setLoaded, (err: Error) => setError(err.message));
  }, []);

  const [scans, designs] = loaded ?? [[], []];
  const listed = all ? scans : scans.filter((scan) => scan.mine);
  // A library room's own Move-in layout is copied, never edited, so only its copies are the Mover's.
  const designsOf = (scan: ScanManifest) => designs.filter((design) =>
    design.scanId === scan.id && (all || !scan.library || design.id !== moveInLayoutId(scan.id)));
  return (
    <div className="home">
      <header className="home-intro">
        <hgroup>
          <h1>Mise</h1>
          <p className="tagline">A sketchbook for your real room.</p>
        </hgroup>
        <p>Redesign your real room before you buy a thing. Try Catalog furniture at true size in your Scan, then shop the Design.</p>
      </header>
      <main className="home-scans">
        <div className="home-heading-row">
          <h2 className="home-heading">{all ? 'Every Scan' : 'Your Scans'}</h2>
          <FloorPlanDialog scans={scans} />
        </div>
        {error && (
          <p className="error" role="alert">Could not load the Scans ({error}). Check that the API server is running, then reload.</p>
        )}
        {!loaded && !error && <Loading />}
        {loaded && !listed.length && (
          <p className="empty"><b>No Scans yet.</b> Find your dorm with “Import from floor plan”, or import a Scan with <code>scripts/scan-import.ts</code>, then mark it up in Room Setup.</p>
        )}
        {listed.map((scan) => <ScanSection key={scan.id} scan={scan} designs={designsOf(scan)} />)}
      </main>
    </div>
  );
}
