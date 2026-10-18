import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GenerateEvent, LoopReport } from '@shared/generate';
import type { Design, Edit } from '@shared/types';
import { chooseSpeed, generate, useGenerate, warm } from './generate';

const paint: Edit = { id: 'ed_1', at: '2026-10-18T09:00:00Z', by: 'claude', type: 'finish', target: { kind: 'wall', wallId: 'wl_1' }, finish: { kind: 'paint', color: '#9caf88' } };
const rug: Edit = { id: 'ed_2', at: '2026-10-18T09:00:01Z', by: 'claude', type: 'place', pieceId: 'pc_1', catalogId: 'rug-jute', placement: { position: [0, 0, 0], rotationY: 0, mount: 'floor' } };
const report = (direction: LoopReport['direction']): LoopReport => ({
  direction, seconds: 3, requests: 1, toolCalls: 8, usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
});
const design: Design = {
  version: 1, id: 'ds_sage', scanId: 'fixture', name: 'Sage Nook', createdAt: '', updatedAt: '', origin: 'claude', edits: [paint, rug],
};
const brief = { text: 'cozy Japandi' };

/** A response streaming these events as NDJSON, cut into chunks that end mid-line, as a network delivers them. */
function streamed(events: GenerateEvent[]) {
  const text = events.map((event) => `${JSON.stringify(event)}\n`).join('');
  const chunks = text.match(/[\s\S]{1,37}/g)!;
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
      controller.close();
    },
  }), { headers: { 'Content-Type': 'application/x-ndjson' } });
}

let fetch: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  useGenerate.setState(useGenerate.getInitialState());
});
afterEach(() => vi.unstubAllGlobals());

describe('generate', () => {
  it('draws each take Edit by Edit as the server streams it, and has its Design as soon as it is finished', async () => {
    fetch.mockResolvedValue(streamed([
      { type: 'edit', direction: 'literal', edit: paint },
      { type: 'edit', direction: 'literal', edit: rug },
      { type: 'design', direction: 'literal', design, report: report('literal') },
      { type: 'failure', direction: 'bolder', error: 'Overloaded', report: report('bolder') },
      { type: 'done', result: { designs: [design], failures: [{ direction: 'bolder', error: 'Overloaded' }], loops: [], seconds: 7.3 } },
    ]));
    const seen: number[] = [];
    const unsubscribe = useGenerate.subscribe(({ takes }) => seen.push(takes.literal.edits.length));

    await generate('fixture', brief);
    unsubscribe();

    expect(fetch).toHaveBeenCalledWith('/api/generate', expect.objectContaining({ headers: expect.objectContaining({ Accept: 'application/x-ndjson' }) }));
    expect(seen).toEqual(expect.arrayContaining([1, 2]));
    const { status, takes, seconds } = useGenerate.getState();
    expect(status).toBe('done');
    expect(seconds).toBe(7.3);
    expect(takes.literal).toMatchObject({ design: { name: 'Sage Nook' }, edits: [paint, rug] });
    expect(takes.bolder).toMatchObject({ error: 'Overloaded', edits: [] });
  });

  it("keeps Claude's plan for each take as it streams in", async () => {
    fetch.mockResolvedValue(streamed([
      { type: 'plan', direction: 'literal', text: 'Sage accent wall; ' },
      { type: 'plan', direction: 'literal', text: 'prints over the bed.' },
      { type: 'edit', direction: 'literal', edit: paint },
    ]));

    await generate('fixture', brief);

    expect(useGenerate.getState().takes.literal).toMatchObject({ plan: 'Sage accent wall; prints over the bed.', edits: [paint] });
  });

  it('goes back to the Brief with what the server said when it refuses the Brief', async () => {
    fetch.mockResolvedValue(Response.json({ error: 'Scan fixture has no Room Setup yet' }, { status: 400 }));

    await generate('fixture', brief);

    expect(useGenerate.getState()).toMatchObject({ status: 'brief', error: 'Scan fixture has no Room Setup yet', brief });
  });

  it('keeps the finished takes when the stream breaks off, and says the others did not finish', async () => {
    fetch.mockResolvedValue(streamed([
      { type: 'edit', direction: 'budget', edit: paint },
      { type: 'design', direction: 'literal', design, report: report('literal') },
    ]));

    await generate('fixture', brief);

    const { status, takes } = useGenerate.getState();
    expect(status).toBe('done');
    expect(takes.literal.design?.name).toBe('Sage Nook');
    expect(takes.budget).toMatchObject({ edits: [paint], error: expect.stringContaining('stopped') });
    expect(takes.bolder.error).toEqual(expect.stringContaining('stopped'));
  });
});

describe('warm', () => {
  it("asks the server to cache a Scan's room once, however often the Mover starts a Brief", async () => {
    fetch.mockResolvedValue(Response.json({ cachedTokens: 12000 }));

    warm('dorm-v1');
    warm('dorm-v1');
    warm('lounge-v1');

    expect(fetch.mock.calls.map(([url, init]) => [url, JSON.parse(init.body)])).toEqual([
      ['/api/generate/warm', { scanId: 'dorm-v1', fast: false }], ['/api/generate/warm', { scanId: 'lounge-v1', fast: false }],
    ]);
  });

  it("doesn't warm a Scan whose Brief was just sent: its takes keep the cache warm", async () => {
    fetch.mockResolvedValue(streamed([{ type: 'done', result: { designs: [], failures: [], loops: [], seconds: 1 } }]));
    await generate('synthetic', brief);
    fetch.mockClear();

    warm('synthetic');

    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('the speed', () => {
  const done = () => streamed([{ type: 'done', result: { designs: [], failures: [], loops: [], seconds: 1 } }]);
  const bodies = () => fetch.mock.calls.map(([, init]) => JSON.parse(init.body));

  it('goes with the Brief: standard unless the Mover picks fast mode', async () => {
    fetch.mockImplementation(async () => done());

    await generate('fixture', brief);
    chooseSpeed(true);
    await generate('fixture', brief);

    expect(bodies().map(({ fast }) => fast)).toEqual([false, true]);
  });

  it("warms the cache again for the other speed: each has a cache of its own", () => {
    fetch.mockResolvedValue(Response.json({ cachedTokens: 20000 }));

    warm('mit-v1');
    chooseSpeed(true);
    warm('mit-v1');
    warm('mit-v1');

    expect(bodies()).toEqual([{ scanId: 'mit-v1', fast: false }, { scanId: 'mit-v1', fast: true }]);
  });

  it('is remembered in this browser', () => {
    const stored = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value) });

    chooseSpeed(true);

    expect(stored.get('mise.generate.speed')).toBe('fast');
    expect(useGenerate.getState().fast).toBe(true);
  });
});
