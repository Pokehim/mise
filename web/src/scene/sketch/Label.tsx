import { Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { type ComponentProps, useState } from 'react';

// Stacking bands of the labels over the 3D view (drei's zIndexRange: front to back, by distance),
// apart so that labels of one kind never interleave with another's.

/** Dimension labels: the lowest band, under everything they might cross. */
export const Z_DIMENSIONS: [number, number] = [3, 0];
/** Fit notes and loops: over dimensions, so a warning is never hidden by a measure. */
export const Z_FIT: [number, number] = [7, 4];
/** The Kept lock (OriginalNode): over warnings and measures. */
export const Z_KEPT: [number, number] = [11, 8];
/** The selection's callout: on top, as the one label the Mover is reading. */
export const Z_CALLOUT: [number, number] = [20, 12];

/**
 * drei's Html, mounted on the first frame after its own. Html makes a React root for its content; in
 * StrictMode that root is made twice, and when it mounts inside the Canvas's first render (as a Fit
 * warning can), the first root's unmount is put off until after the second has rendered into the
 * same element, and empties it. A frame later, nothing else is rendering. (The Kept lock, OriginalNode,
 * uses Html as it is: it mounts with the Scan, after its Suspense, never in the first render.)
 */
export function Label(props: ComponentProps<typeof Html>) {
  const [ready, setReady] = useState(false);
  useFrame(() => {
    if (!ready) setReady(true);
  });
  return ready ? <Html {...props} /> : null;
}
