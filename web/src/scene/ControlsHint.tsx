import { useState } from 'react';
import { create } from 'zustand';
import './controlsHint.css';

const KEY = 'mise.controlsHint';

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
      <span className="fine">Drag to move · Shift+drag to turn · Scroll to zoom</span>
      <span className="coarse">Drag to move · Two fingers to turn · Pinch to zoom</span>
    </p>
  );
}
