import { create } from 'zustand';
import { Pencil } from '../../ui/icons';

const KEY = 'mise.sketchLines';

function stored() {
  try {
    return localStorage.getItem(KEY) === 'on';
  } catch {
    return false;
  }
}

/**
 * "Sketch lines": ink edges on the Pieces, for a drawing-like view of what was added. Off by
 * default, to keep the room photoreal; the Mover's choice is remembered in this browser.
 */
export const useSketchLines = create<{ on: boolean }>(() => ({ on: stored() }));

function toggle() {
  const on = !useSketchLines.getState().on;
  useSketchLines.setState({ on });
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    // Private windows can refuse storage; the toggle still works for this visit.
  }
}

/** The view's Sketch lines switch, in its corner. */
export function SketchLinesToggle() {
  const on = useSketchLines((s) => s.on);
  return (
    <button className="sketch-toggle" aria-pressed={on} title="Draw ink edges on the Pieces" onClick={toggle}>
      <Pencil />
      Sketch lines
    </button>
  );
}
