import { create } from 'zustand';
import type { Vec3 } from '@shared/types';
import type { SwapTarget } from '../scene/swapResize';

/** The Resize the Mover is doing (spec §10.5): what is being resized, and the box they are drawing. */
export interface ResizeSession {
  target: SwapTarget;
  /** [width, height, depth] in meters. The handles and the Inspector set the width and depth; the height stays the target's. */
  size: Vec3;
}

/**
 * The Resize in progress, or null: shared by the Inspector's Resize panel, which opens and closes
 * it, and the Resize box in the view.
 */
export const useResize = create<{ session: ResizeSession | null }>(() => ({ session: null }));

/** Sets the width (axis 0) or the depth (axis 2) of the Resize box, in meters. */
export function setResizeSide(axis: 0 | 2, meters: number) {
  const { session } = useResize.getState();
  if (!session) return;
  const size: Vec3 = [...session.size];
  size[axis] = meters;
  useResize.setState({ session: { ...session, size } });
}
