import { describe, expect, it, vi } from 'vitest';
import { replay } from '@shared/replay';
import { catalog, edit, onFloor, place, setup } from '@shared/test-room';
import type { Design } from '@shared/types';
import { useEditor } from '../state/store';
import { useReveal } from './Reveal';

// The editor reads ?shot= from the page's address when it loads.
vi.hoisted(() => { globalThis.location ??= { search: '' } as Location; });

/** A Claude Design that places a chair, then moves it, then places a rug: opened, as load() opens it. */
function openClaudeDesign() {
  const edits = [
    place('pc_chair', 'chair-ergo', onFloor(0, 0)),
    edit('ed_move', { type: 'move', targetId: 'pc_chair', placement: onFloor(1, 1) }),
    place('pc_rug', 'rug-gray', onFloor(-1, 0)),
  ];
  const design = {
    version: 1, id: 'ds_claude', scanId: setup.scanId, name: 'Sage Nook', origin: 'claude',
    createdAt: '2026-10-18T00:00:00.000Z', updatedAt: '2026-10-18T00:00:00.000Z', edits,
  } as Design;
  useEditor.setState({ status: 'loading' });
  useEditor.setState({ status: 'ready', setup, catalog, design, roomState: replay(setup, catalog, edits), dirty: false, selection: null });
  return design;
}

describe('the reveal', () => {
  it('starts from the empty room when a Claude Design opens', () => {
    openClaudeDesign();

    expect(useReveal.getState().run).toMatchObject({ next: 0 });
    expect(useEditor.getState().roomState!.pieces).toEqual({});
  });

  it('ends when the Mover selects something, so the room is the whole Design to make Edits from', () => {
    const design = openClaudeDesign();
    // As if the first step had shown the chair where it was first placed.
    useEditor.setState({ roomState: replay(setup, catalog, design.edits.slice(0, 1)) });

    useEditor.getState().select({ kind: 'piece', id: 'pc_chair' });

    expect(useReveal.getState().run).toBeNull();
    expect(useEditor.getState().roomState).toEqual(replay(setup, catalog, design.edits));
    expect(useEditor.getState().selection).toEqual({ kind: 'piece', id: 'pc_chair' });
  });
});
