import { useState } from 'react';
import { create } from 'zustand';
import './controlsHint.css';

/** v2 since drag turns and Shift+drag moves (#121): who saw the old hint sees the new one once. */
const KEY = 'mise.controlsHint.v2';

function stored() {
  try {
    return localStorage.getItem(KEY) === 'seen';
  } catch {
    return false;
  }
}

/** Whether the Mover has moved the Dollhouse view yet, remembered in this browser. */
const useHintSeen = create<{ seen: boolean }>(() => ({ seen: stored() }));

/** Hides the hint for good: the Mover has found the controls. */
export function hideControlsHint() {
  if (useHintSeen.getState().seen) return;
  useHintSeen.setState({ seen: true });
  try {
    localStorage.setItem(KEY, 'seen');
  } catch {
    // Private windows can refuse storage; the hint still hides for this visit.
  }
}

/**
 * How to move the Dollhouse view, in one line in its corner, until the Mover's first drag. A touch
 * screen has no Shift or wheel, so it gets its own line.
 */
export function ControlsHint() {
  // Seen on an earlier visit: not even a fade.
  const [seenAtStart] = useState(() => useHintSeen.getState().seen);
  const seen = useHintSeen((s) => s.seen);
  if (seenAtStart) return null;
  return (
    <p className="controls-hint" data-seen={seen || undefined} aria-hidden={seen || undefined}>
      <span className="fine">Drag to turn · Shift+drag to move · Scroll to zoom</span>
      <span className="coarse">Drag to turn · Two fingers to move · Pinch to zoom</span>
    </p>
  );
}
