// Small pieces the Room Setup scene's components share.
import type { ThreeEvent } from '@react-three/fiber';

export const ACCENT = '#e5b567';

/** An onClick handler that ignores the end of an orbit drag, and stops the click at the first object it hits. */
export const clickOnly = (handle: (e: ThreeEvent<MouseEvent>) => void) => (e: ThreeEvent<MouseEvent>) => {
  if (e.delta > 4) return;
  e.stopPropagation();
  handle(e);
};
