import { useSyncExternalStore } from 'react';

/** Whether a media query matches, kept current as the window changes: for layout that CSS alone can't do. */
export function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (onChange) => {
      const list = matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    () => matchMedia(query).matches,
  );
}

/** The phone layout of editor.css: the room on top, then the panels as one scrolling page. */
export const PHONE = '(max-width: 760px)';
