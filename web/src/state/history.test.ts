import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { replay } from '@shared/replay';
import { catalog, edit, onFloor, place, setup } from '@shared/test-room';
import type { Catalog, Design, Edit } from '@shared/types';
import { saveDesign } from '../api';
import { connectHistory, deleteEdit, historyRows, putBack, redo, saveNow, shoppingList, undo, useSaveStatus } from './history';
import { useEditor } from './store';

// Saving is the HTTP boundary: the tests stand in for the server.
vi.mock(import('../api'), async (importOriginal) => ({ ...(await importOriginal()), saveDesign: vi.fn() }));

let opened = 0;

/** Opens a new Design of the test room with these Edits, as load() does. */
function open(edits: Edit[], withCatalog: Catalog = catalog) {
  const design: Design = {
    version: 1, id: `ds_test${++opened}`, scanId: setup.scanId, name: 'Dorm', origin: 'mover',
    createdAt: '2026-10-17T21:00:00.000Z', updatedAt: '2026-10-17T21:00:00.000Z', edits,
  };
  useEditor.setState({
    status: 'ready', setup, catalog: withCatalog, design, roomState: replay(setup, withCatalog, edits), dirty: false, selection: null,
  });
}

const room = () => useEditor.getState().roomState;
const { applyEdit } = useEditor.getState();

beforeEach(() => open([place('pc_chair', 'chair-ergo', onFloor(0, 0))]));

describe('undo', () => {
  it('takes back the last Edit, so the room is as it was before it', () => {
    const before = room();
    applyEdit({ type: 'place', pieceId: 'pc_rug', catalogId: 'rug-gray', placement: onFloor(1, 1) });

    undo();

    expect(room()).toEqual(before);
  });

  it('twice takes back the last two Edits, so the room is as it was before them', () => {
    applyEdit({ type: 'recolor', targetId: 'pc_chair', partId: 'legs', color: '#1c1c1c' });
    const before = room();
    applyEdit({ type: 'place', pieceId: 'pc_rug', catalogId: 'rug-gray', placement: onFloor(1, 1) });
    applyEdit({ type: 'move', targetId: 'pc_chair', placement: onFloor(-0.5, 0.5) });

    undo();
    undo();

    expect(room()).toEqual(before);
  });
});

describe('redo', () => {
  it('puts back the Edits undo took, latest first', () => {
    applyEdit({ type: 'place', pieceId: 'pc_rug', catalogId: 'rug-gray', placement: onFloor(1, 1) });
    applyEdit({ type: 'move', targetId: 'pc_rug', placement: onFloor(1.5, 1) });
    const after = room();
    undo();
    undo();

    redo();
    expect(Object.keys(room()!.pieces)).toEqual(['pc_chair', 'pc_rug']);
    expect(room()!.pieces.pc_rug.placement).toEqual(onFloor(1, 1));
    redo();
    expect(room()).toEqual(after);
  });

  it('has nothing to put back after a new Edit', () => {
    applyEdit({ type: 'place', pieceId: 'pc_rug', catalogId: 'rug-gray', placement: onFloor(1, 1) });
    undo();
    applyEdit({ type: 'place', pieceId: 'pc_lamp', catalogId: 'lamp-brass', placement: onFloor(-1, 1) });
    const after = room();

    redo();

    expect(room()).toEqual(after);
    expect(Object.keys(room()!.pieces)).toEqual(['pc_chair', 'pc_lamp']);
  });

  it('has nothing to put back in another Design', () => {
    applyEdit({ type: 'place', pieceId: 'pc_rug', catalogId: 'rug-gray', placement: onFloor(1, 1) });
    undo();
    open([]);

    redo();

    expect(room()!.pieces).toEqual({});
  });
});

describe('deleting an Edit', () => {
  it('can take out any Edit, and the later Edits that needed it show as skipped, with the reason', () => {
    applyEdit({ type: 'recolor', targetId: 'pc_chair', partId: 'legs', color: '#1c1c1c' });
    applyEdit({ type: 'finish', target: { kind: 'wall', wallId: 'wl_north' }, finish: { kind: 'paint', color: '#9caf88' } });

    deleteEdit('ed_pc_chair');

    expect(room()!.pieces).toEqual({});
    expect(historyRows(useEditor.getState()).map(({ text, skipped }) => ({ text, skipped }))).toEqual([
      { text: 'Recolored legs · Black', skipped: 'What it changes is no longer in the room' },
      { text: 'Painted North wall · Sage', skipped: undefined },
    ]);
  });

  it('can be taken back: putBack puts the Edit where it was', () => {
    applyEdit({ type: 'recolor', targetId: 'pc_chair', partId: 'legs', color: '#1c1c1c' });
    const before = room();
    deleteEdit('ed_pc_chair');

    putBack();

    expect(room()).toEqual(before);
  });

  it('can no longer be put back once the Edit list changes again', () => {
    deleteEdit('ed_pc_chair');
    applyEdit({ type: 'place', pieceId: 'pc_rug', catalogId: 'rug-gray', placement: onFloor(1, 1) });

    putBack();

    expect(Object.keys(room()!.pieces)).toEqual(['pc_rug']);
  });
});

describe('autosave', () => {
  let saved: Design[];
  let disconnect: () => void;

  beforeEach(() => {
    vi.useFakeTimers();
    saved = [];
    vi.mocked(saveDesign).mockImplementation(async (design) => {
      saved.push(design);
      return design;
    });
    disconnect = connectHistory();
  });

  afterEach(() => {
    disconnect();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('saves the Design once, 500 ms after the last change', async () => {
    applyEdit({ type: 'place', pieceId: 'pc_rug', catalogId: 'rug-gray', placement: onFloor(1, 1) });
    await vi.advanceTimersByTimeAsync(300);
    applyEdit({ type: 'move', targetId: 'pc_rug', placement: onFloor(1.5, 1) });
    expect(useSaveStatus.getState().status).toBe('saving');

    await vi.advanceTimersByTimeAsync(499);
    expect(saved).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);

    expect(saved).toHaveLength(1);
    expect(saved[0].edits.map(({ type }) => type)).toEqual(['place', 'place', 'move']);
    expect(useEditor.getState().dirty).toBe(false);
    expect(useSaveStatus.getState().status).toBe('saved');
  });

  it('saves a waiting change at once when asked, as Duplicate does before it copies the saved Design', async () => {
    applyEdit({ type: 'place', pieceId: 'pc_rug', catalogId: 'rug-gray', placement: onFloor(1, 1) });

    await saveNow();

    expect(saved.map(({ edits }) => edits.length)).toEqual([2]);
    await vi.advanceTimersByTimeAsync(500);
    expect(saved).toHaveLength(1);
  });

  it('saves a waiting change when the editor closes', async () => {
    applyEdit({ type: 'place', pieceId: 'pc_rug', catalogId: 'rug-gray', placement: onFloor(1, 1) });

    disconnect();
    await vi.runAllTimersAsync();

    expect(saved.map(({ edits }) => edits.length)).toEqual([2]);
  });

  it('shows a failed save, and saves everything with the next change', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let online = false;
    vi.mocked(saveDesign).mockImplementation(async (design) => {
      if (!online) throw new Error('offline');
      saved.push(design);
      return design;
    });
    applyEdit({ type: 'place', pieceId: 'pc_rug', catalogId: 'rug-gray', placement: onFloor(1, 1) });
    await vi.advanceTimersByTimeAsync(500);

    expect(useSaveStatus.getState().status).toBe('failed');
    expect(useEditor.getState().dirty).toBe(true);

    online = true;
    applyEdit({ type: 'move', targetId: 'pc_rug', placement: onFloor(1.5, 1) });
    await vi.advanceTimersByTimeAsync(500);

    expect(saved.map(({ edits }) => edits.length)).toEqual([3]);
    expect(useSaveStatus.getState().status).toBe('saved');
  });

  it('keeps a failed save waiting: saveNow tries it again, and rejects while it still fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let online = false;
    vi.mocked(saveDesign).mockImplementation(async (design) => {
      if (!online) throw new Error('offline');
      saved.push(design);
      return design;
    });
    applyEdit({ type: 'place', pieceId: 'pc_rug', catalogId: 'rug-gray', placement: onFloor(1, 1) });
    await vi.advanceTimersByTimeAsync(500);

    await expect(saveNow()).rejects.toThrow('offline');
    online = true;
    await saveNow();

    expect(saved.map(({ edits }) => edits.length)).toEqual([2]);
    expect(useSaveStatus.getState().status).toBe('saved');
    expect(useEditor.getState().dirty).toBe(false);
  });

  it('keeps a change to one Design whose save fails while another Design is waiting, and saves it on retry', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const a = useEditor.getState().design!.id;
    let online = false;
    vi.mocked(saveDesign).mockImplementation(async (design) => {
      if (!online && design.id === a) throw new Error('offline');
      saved.push(design);
      return design;
    });
    applyEdit({ type: 'place', pieceId: 'pc_rug', catalogId: 'rug-gray', placement: onFloor(1, 1) });

    // Opening B, as Designs ▾ does with no saveNow, sends A's change at once; it fails while B's change waits.
    open([]);
    const b = useEditor.getState().design!.id;
    applyEdit({ type: 'place', pieceId: 'pc_lamp', catalogId: 'lamp-brass', placement: onFloor(-1, 1) });
    await vi.advanceTimersByTimeAsync(500);

    expect(saved.map(({ id }) => id)).toEqual([b]);
    expect(useSaveStatus.getState().status).toBe('failed');

    online = true;
    await vi.advanceTimersByTimeAsync(4499);
    expect(saved).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);

    expect(saved.map(({ id, edits }) => [id, edits.length])).toEqual([[b, 1], [a, 2]]);
    expect(useSaveStatus.getState().status).toBe('saved');
  });

  it('waits the full 5 s before retrying a failed Design, however often the store changes', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const a = useEditor.getState().design!.id;
    let online = false;
    let triesOfA = 0;
    vi.mocked(saveDesign).mockImplementation(async (design) => {
      if (design.id === a) triesOfA++;
      if (!online && design.id === a) throw new Error('offline');
      saved.push(design);
      return design;
    });
    applyEdit({ type: 'place', pieceId: 'pc_rug', catalogId: 'rug-gray', placement: onFloor(1, 1) });
    open([place('pc_chair', 'chair-ergo', onFloor(0, 0))]);

    // Hovering History rows, every 100 ms for 4 s.
    for (let i = 0; i < 40; i++) {
      useEditor.getState().setHighlight(i % 2 ? null : { kind: 'piece', id: 'pc_chair' });
      await vi.advanceTimersByTimeAsync(100);
    }
    expect(triesOfA).toBe(1);

    online = true;
    await vi.advanceTimersByTimeAsync(1000);

    expect(triesOfA).toBe(2);
    expect(useSaveStatus.getState().status).toBe('saved');
  });

  it("sends the previous Design's change at once when another Design opens, and only then", async () => {
    const a = useEditor.getState().design!.id;
    applyEdit({ type: 'place', pieceId: 'pc_rug', catalogId: 'rug-gray', placement: onFloor(1, 1) });
    const { select, setHighlight, setPreview } = useEditor.getState();
    select({ kind: 'piece', id: 'pc_rug' });
    setHighlight({ kind: 'piece', id: 'pc_chair' });
    setPreview({ pieceId: 'pc_rug', placement: onFloor(1.2, 1) });
    setPreview(null);
    await vi.advanceTimersByTimeAsync(300);
    expect(saved).toEqual([]);

    open([]);
    await vi.advanceTimersByTimeAsync(0);

    expect(saved.map(({ id, edits }) => [id, edits.length])).toEqual([[a, 2]]);
    await vi.advanceTimersByTimeAsync(500);
    expect(saved).toHaveLength(1);
  });
});

describe('shoppingList', () => {
  const prices: Record<string, number> = { 'chair-ergo': 129, 'desk-walnut': 189, 'rug-gray': 79, 'lamp-brass': 45 };
  const priced: Catalog = { ...catalog, items: catalog.items.map((item) => ({ ...item, priceEstimateUsd: prices[item.id] })) };

  it('lists the Pieces with a total of their estimates, and the Originals still in the room', () => {
    open([
      place('pc_chair', 'chair-ergo', onFloor(0, 0)),
      place('pc_rug', 'rug-gray', onFloor(0, 1)),
      edit('ed_desk', { type: 'replace', originalId: 'og_desk', pieceId: 'pc_desk', catalogId: 'desk-walnut', placement: onFloor(1.7, -0.6), via: 'replace' }),
      place('pc_lamp', 'lamp-brass', onFloor(-1, 1)),
      edit('ed_no_lamp', { type: 'remove', targetId: 'pc_lamp' }),
    ], priced);

    const list = shoppingList(useEditor.getState());

    expect(list.pieces.map(({ item }) => item.title)).toEqual(['Ergo Mesh Chair', 'Mainstays 5×7 Rug', '30″ Walnut Desk']);
    expect(list.totalUsd).toBe(397);
    expect(list.alreadyInRoom.map(({ label }) => label)).toEqual(['Bed']);
  });
});
