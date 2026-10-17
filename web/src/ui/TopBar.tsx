import { Link } from 'wouter';
import { useEditor, type View } from '../state/store';

const VIEWS: [View, string][] = [['dollhouse', 'Dollhouse'], ['walk', 'Walk']];

export function TopBar() {
  const scanName = useEditor((s) => s.manifest!.name);
  const designName = useEditor((s) => s.design!.name);
  const view = useEditor((s) => s.view);
  return (
    <header className="topbar">
      <Link href="/">← Scans</Link>
      <span className="muted">{scanName}</span>
      <strong>{designName}</strong>
      {/* #11: the Designs menu (New · Duplicate · Rename) goes here. */}
      <span className="spacer" />
      <div className="views" role="group" aria-label="View">
        {VIEWS.map(([id, name]) => (
          <button key={id} aria-pressed={view === id} onClick={() => useEditor.getState().setView(id)}>{name}</button>
        ))}
      </div>
      {/* #11: the shopping list (🛒 ≈ $X) goes here. */}
    </header>
  );
}
