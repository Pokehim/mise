import { Grid, OrbitControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { useEffect, useState } from 'react';
import { BackSide } from 'three';
import { Link, Route, Switch } from 'wouter';
import type { Design, ScanManifest } from '@shared/types';
import { listDesigns, listScans } from './api';

export function App() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/setup/:scanId">{({ scanId }) => <RoomSetupPlaceholder scanId={scanId} />}</Route>
      <Route path="/d/:designId">{({ designId }) => <EditorPlaceholder designId={designId} />}</Route>
      <Route>
        <main style={{ padding: 24 }}>Page not found. <Link href="/">Back to Scans</Link></main>
      </Route>
    </Switch>
  );
}

// The pages below are placeholders. #11 replaces Home, #8 the Room Setup tool, and #7 the editor.

function Home() {
  const [scans, setScans] = useState<ScanManifest[]>();
  const [designs, setDesigns] = useState<Design[]>([]);
  const [error, setError] = useState<string>();

  useEffect(() => {
    Promise.all([listScans(), listDesigns()])
      .then(([scans, designs]) => {
        setScans(scans);
        setDesigns(designs);
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  if (error) return <main style={{ padding: 24 }}>Could not load the Scans: {error}</main>;
  if (!scans) return <main style={{ padding: 24 }}>Loading…</main>;
  return (
    <main style={{ padding: 24 }}>
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

function RoomSetupPlaceholder({ scanId }: { scanId: string }) {
  return (
    <main style={{ padding: 24 }}>
      <h1>Room Setup: {scanId}</h1>
      <p>The Room Setup tool isn't built yet.</p>
      <Link href="/">← Scans</Link>
    </main>
  );
}

function EditorPlaceholder({ designId }: { designId: string }) {
  return (
    <>
      <Canvas camera={{ position: [4, 4, 5], fov: 50 }}>
        <color attach="background" args={['#f4f1ea']} />
        <ambientLight intensity={0.6} />
        <directionalLight position={[3, 5, 2]} intensity={1.5} />
        <Grid
          infiniteGrid cellSize={0.5} sectionSize={1} cellColor="#d9d2c5" sectionColor="#b3a892" position={[0, -0.001, 0]}
        />
        {/* A 4 × 3 m room, 2.6 m high, with its floor at y = 0. BackSide shows the inside, like a dollhouse. */}
        <mesh position={[0, 1.3, 0]}>
          <boxGeometry args={[4, 2.6, 3]} />
          <meshStandardMaterial color="#e8e2d6" side={BackSide} />
        </mesh>
        <OrbitControls target={[0, 1, 0]} />
      </Canvas>
      <nav style={{ position: 'absolute', top: 12, left: 12 }}>
        <Link href="/">← Scans</Link> · Design {designId}
      </nav>
    </>
  );
}
