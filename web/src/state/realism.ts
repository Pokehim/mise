/*
 * The Realism level (spec §12, #17): how real the 3D view looks. It isn't part of the Design, so
 * it has its own store.
 *
 *   quick  The mesh look, with Pieces lit by drei's apartment Environment, and blob shadows.
 *   real   Pieces lit by the Scan's own light, with blob shadows. The splat look too, when the
 *          Scan has a splat (ADR-0005): #16 draws it at Real and Max.
 *   max    Real, plus shadows cast from the largest window instead of blob shadows.
 *
 * All three levels show even when the Scan has no splat: the splat may never ship (#16 is time-boxed).
 */
import { create } from 'zustand';
import { useEditor } from './store';

export type Realism = 'quick' | 'real' | 'max';

interface RealismState {
  /** The level the Mover picked, or null until they pick one. */
  chosen: Realism | null;
  choose(level: Realism): void;
}

export const useRealismStore = create<RealismState>()((set) => ({
  chosen: null,
  choose: (chosen) => set({ chosen }),
}));

/** The level the editor draws at: the one the Mover picked, else Real when the Scan has a splat and Quick when it doesn't (spec §12). */
export function useRealism(): Realism {
  const chosen = useRealismStore((s) => s.chosen);
  const hasSplat = useEditor((s) => Boolean(s.manifest?.splat));
  return chosen ?? (hasSplat ? 'real' : 'quick');
}
