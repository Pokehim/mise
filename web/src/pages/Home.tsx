import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import type { Design, ScanManifest } from '@shared/types';
import { listDesigns, listScans } from '../api';
import { count } from '../ui/format';
import { ArrowRight } from '../ui/icons';
import { useStartDesign } from '../ui/useStartDesign';
import './home.css';

const edited = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** One Scan, with its Designs and a button to start another. */
function ScanSection({ scan, designs }: { scan: ScanManifest; designs: Design[] }) {
  const { start, starting, error } = useStartDesign();

  return (
    <section className="scan" aria-labelledby={`scan-${scan.id}`}>
      <header>
        <div>
          <h3 id={`scan-${scan.id}`}>{scan.name}</h3>
          <p className="muted">
            {count(designs.length, 'Design')} · <Link href={`/setup/${scan.id}`}>Room Setup</Link>
          </p>
        </div>
        <button className="primary" disabled={starting} onClick={() => start({ scanId: scan.id })}>{starting ? 'Starting…' : 'New Design'}</button>
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
        <p className="empty">No Designs yet. Start one to try Catalog furniture and wall colors in this room.</p>
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

/** `/`: each Scan, and the Designs under it (spec §10.8). */
export function Home() {
  const [loaded, setLoaded] = useState<[ScanManifest[], Design[]]>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    Promise.all([listScans(), listDesigns()]).then(setLoaded, (err: Error) => setError(err.message));
  }, []);

  const [scans, designs] = loaded ?? [[], []];
  return (
    <div className="home">
      <header className="home-intro">
        <h1>Mise</h1>
        <p>Redesign your real room before you buy a thing. Try Catalog furniture at true size in your Scan, then shop the Design.</p>
      </header>
      <main className="home-scans">
        <h2 className="home-heading">Your Scans</h2>
        {error && (
          <p className="error" role="alert">Could not load the Scans ({error}). Check that the API server is running, then reload.</p>
        )}
        {!loaded && !error && <Loading />}
        {loaded && !scans.length && (
          <p className="empty">No Scans yet. Import one with <code>scripts/scan-import.ts</code>, then mark it up in Room Setup.</p>
        )}
        {scans.map((scan) => (
          <ScanSection key={scan.id} scan={scan} designs={designs.filter((design) => design.scanId === scan.id)} />
        ))}
      </main>
    </div>
  );
}
