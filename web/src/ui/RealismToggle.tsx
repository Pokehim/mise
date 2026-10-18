import { type Realism, useRealism, useRealismStore } from '../state/realism';

const LEVELS: [level: Realism, name: string, title: string][] = [
  ['quick', 'Quick', 'Pieces in preset lighting, with soft shadows under them'],
  ['real', 'Real', "Pieces lit by the Scan's own light"],
  ['max', 'Max', 'Real, plus the shadows Pieces cast from the window'],
];

/** The TopBar's Realism toggle: Quick, Real or Max (spec §12). */
export function RealismToggle() {
  const level = useRealism();
  return (
    <div className="views" role="group" aria-label="Realism">
      {LEVELS.map(([id, name, title]) => (
        <button key={id} aria-pressed={level === id} title={title} onClick={() => useRealismStore.getState().choose(id)}>
          {name}
        </button>
      ))}
    </div>
  );
}
