import { Link } from 'wouter';
import { useEditor, type View } from '../state/store';
import { BriefDialog } from './BriefDialog';
import { DesignsMenu } from './DesignsMenu';
import { ArrowLeft } from './icons';
import { RealismToggle } from './RealismToggle';
import { ShoppingList } from './ShoppingList';

const VIEWS: [View, string][] = [['dollhouse', 'Dollhouse'], ['walk', 'Walk']];

export function TopBar() {
  const scanName = useEditor((s) => s.manifest!.name);
  const view = useEditor((s) => s.view);
  return (
    <header className="topbar">
      <Link href="/" className="back" aria-label="Scans"><ArrowLeft /><span className="label">Scans</span></Link>
      <span className="muted scan-name">{scanName}</span>
      <DesignsMenu />
      <BriefDialog />
      <span className="spacer" />
      <RealismToggle />
      <div className="views" role="group" aria-label="View">
        {VIEWS.map(([id, name]) => (
          <button key={id} aria-pressed={view === id} onClick={() => useEditor.getState().setView(id)}>{name}</button>
        ))}
      </div>
      <ShoppingList />
    </header>
  );
}
