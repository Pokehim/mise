// Small pieces the Room Setup scene's components share.
import type { ThreeEvent } from '@react-three/fiber';

const tokens = new Map<string, string>();

/**
 * A color token of styles/tokens.css, for the scene: the overlays use no color of their own
 * (docs/design/sketch-style.md). Like scene/sketch/tokens.ts, but for any token, such as the pencils.
 */
export function tone(name: `--${string}`) {
  let value = tokens.get(name);
  if (!value) {
    value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    tokens.set(name, value);
  }
  return value;
}

/** An onClick handler that ignores the end of an orbit drag, and stops the click at the first object it hits. */
export const clickOnly = (handle: (e: ThreeEvent<MouseEvent>) => void) => (e: ThreeEvent<MouseEvent>) => {
  if (e.delta > 4) return;
  e.stopPropagation();
  handle(e);
};

/** Raycasts nothing: for the lines and rings drawn over a handle, so only its hit area takes the pointer. */
export const ignoreRaycast = () => {};
