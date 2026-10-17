import { Link } from 'wouter';

// Placeholder until #8 builds the Room Setup tool.
export function RoomSetupPage({ params }: { params: { scanId: string } }) {
  return (
    <main>
      <h1>Room Setup: {params.scanId}</h1>
      <p>The Room Setup tool isn't built yet.</p>
      <Link href="/">← Scans</Link>
    </main>
  );
}
