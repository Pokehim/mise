import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';

declare global {
  interface Window {
    /** True once the 3D view has drawn the Scan, for scripts/shoot.ts to wait on. */
    __miseSceneReady?: boolean;
  }
}

/**
 * Sets window.__miseSceneReady, and calls onReady, once the first frame it renders in is drawn.
 * Mount it in the Scan's Suspense, so that frame has the Scan in it.
 */
export function ReadyFlag({ onReady }: { onReady: () => void }) {
  const ready = useRef(false);
  useFrame(() => {
    if (ready.current) return;
    ready.current = true;
    // useFrame runs just before the frame is drawn; a microtask runs once it has been.
    queueMicrotask(() => {
      window.__miseSceneReady = true;
      onReady();
    });
  });
  return null;
}
