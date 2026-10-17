import { Link } from 'wouter';
import { useEditor } from '../state/store';

export function TopBar() {
  const scanName = useEditor((s) => s.manifest!.name);
  const designName = useEditor((s) => s.design!.name);
  return (
    <header className="topbar">
      <Link href="/">← Scans</Link>
      <span className="muted">{scanName}</span>
      <strong>{designName}</strong>
      {/* #11: the Designs menu (New · Duplicate · Rename) goes here. */}
      <span className="spacer" />
      {/* #11: the shopping list (🛒 ≈ $X) goes here. */}
    </header>
  );
}
