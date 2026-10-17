import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import type { Design, ScanManifest } from '@shared/types';
import { listDesigns, listScans } from '../api';

// Placeholder until #11 builds the Home page: each Scan with its Designs.
export function Home() {
  const [loaded, setLoaded] = useState<[ScanManifest[], Design[]]>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    Promise.all([listScans(), listDesigns()]).then(setLoaded, (err: Error) => setError(err.message));
  }, []);

  if (error) return <main>Could not load the Scans: {error}</main>;
  if (!loaded) return <main>Loading…</main>;
  const [scans, designs] = loaded;
  return (
    <main>
      <h1>Mise</h1>
      <h2>Scans</h2>
      <ul>
        {scans.map((scan) => (
          <li key={scan.id}>
            <strong>{scan.name}</strong> · <Link href={`/setup/${scan.id}`}>Room Setup</Link>
            <ul>
              {designs.filter((design) => design.scanId === scan.id).map((design) => (
                <li key={design.id}><Link href={`/d/${design.id}`}>{design.name}</Link></li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </main>
  );
}
