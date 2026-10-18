import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GenerateEvent, LoopReport } from '../../shared/generate';
import type { Design } from '../../shared/types';
import { app } from '../app';
import { fakeClaude, type Turn, use } from './fakeClaude';

// POST /api/generate in the fixture Scan, with Claude faked at the HTTP boundary (fakeClaude.ts).

let claude: ReturnType<typeof fakeClaude>;
vi.mock('./agent', async (importOriginal) => ({ ...(await importOriginal<typeof import('./agent')>()), anthropic: () => claude.client }));

let dataDir: string;
beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'mise-generate-'));
  await cp(new URL('../../data/scans/fixture', import.meta.url), join(dataDir, 'scans/fixture'), { recursive: true });
  await cp(new URL('../../data/catalog/catalog.json', import.meta.url), join(dataDir, 'catalog/catalog.json'));
  vi.stubEnv('DATA_DIR', dataDir);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(dataDir, { recursive: true, force: true });
});

const palette = { wall: '#f4efe6', accents: ['#9caf88'], materials: ['oak'] };
/** A short Design: an accent wall, then finish_design twice, as the first is sent back for being too short. */
const paintAndFinish = (name: string): Turn[] => [() => ({
  content: [
    use('toolu_paint', 'apply_finish', { target: { kind: 'wall', wall_id: 'wl_4' }, finish: { kind: 'paint', color: '#9caf88' } }),
    use('toolu_finish_1', 'finish_design', { name, rationale: 'Sage, as the Brief asks.', palette }),
    use('toolu_finish_2', 'finish_design', { name, rationale: 'Sage, as the Brief asks.', palette }),
  ],
})];

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  app.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
const generate = (body: unknown) => post('/api/generate', body);
const brief = { text: 'cozy Japandi, under $400, I need a reading corner', styles: ['Japandi', 'Cozy'], budgetUsd: 400 };

describe('POST /api/generate', () => {
  it('returns the 3 Designs and saves each one, which the Designs list then shows', async () => {
    claude = fakeClaude({ literal: paintAndFinish('Sage Nook'), bolder: paintAndFinish('Bold Sage'), budget: paintAndFinish('Thrifty Sage') });

    const res = await generate({ scanId: 'fixture', brief });

    expect(res.status).toBe(200);
    const { designs, failures, loops } = await res.json();
    expect(designs.map(({ name }: Design) => name)).toEqual(['Sage Nook', 'Bold Sage', 'Thrifty Sage']);
    expect(failures).toEqual([]);
    // Each loop's report is filled in, with or without a stream to send it on.
    expect(loops.map(({ toolCalls }: LoopReport) => toolCalls)).toEqual([3, 3, 3]);
    const listed: Design[] = await (await app.request('/api/designs?scanId=fixture')).json();
    expect(listed.map(({ name, origin, brief: saved }) => ({ name, origin, brief: saved }))).toEqual(expect.arrayContaining([
      { name: 'Sage Nook', origin: 'claude', brief }, { name: 'Bold Sage', origin: 'claude', brief }, { name: 'Thrifty Sage', origin: 'claude', brief },
    ]));
  });

  it('returns the Designs that succeeded, and why the others failed', async () => {
    claude = fakeClaude({ literal: paintAndFinish('Sage Nook'), bolder: [() => 'error'], budget: paintAndFinish('Thrifty Sage') });

    const { designs, failures } = await (await generate({ scanId: 'fixture', brief })).json();

    expect(designs.map(({ name }: Design) => name)).toEqual(['Sage Nook', 'Thrifty Sage']);
    expect(failures).toEqual([{ direction: 'bolder', error: expect.stringContaining('Overloaded') }]);
  });

  it('answers 502 when no loop made a Design', async () => {
    claude = fakeClaude({ literal: [() => 'error'], bolder: [() => 'error'], budget: [() => 'error'] });

    const res = await generate({ scanId: 'fixture', brief });

    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/^The AI made no Designs: /);
  });

  it('takes the budget from the Brief text when it names one and budgetUsd is missing', async () => {
    claude = fakeClaude({ literal: paintAndFinish('Sage Nook') });

    const { designs } = await (await generate({ scanId: 'fixture', brief: { text: 'cozy, under $250' } })).json();

    expect(designs[0].brief).toEqual({ text: 'cozy, under $250', budgetUsd: 250 });
  });

  it('answers 400 without a Brief, or with a budget that is not a positive number, and 404 for an unknown Scan', async () => {
    expect((await generate({ scanId: 'fixture' })).status).toBe(400);
    expect((await generate({ scanId: 'fixture', brief: { text: '  ' } })).status).toBe(400);
    expect((await generate({ scanId: 'fixture', brief: { text: 'cozy', budgetUsd: -5 } })).status).toBe(400);
    expect((await generate({ scanId: 'nope', brief })).status).toBe(404);
  });

  it('streams each step as a line of JSON when asked for NDJSON: each Edit, each Design or failure, then the result', async () => {
    claude = fakeClaude({ literal: paintAndFinish('Sage Nook'), bolder: [() => 'error'], budget: paintAndFinish('Thrifty Sage') });

    const res = await post('/api/generate', { scanId: 'fixture', brief }, { Accept: 'application/x-ndjson' });

    expect(res.headers.get('Content-Type')).toBe('application/x-ndjson');
    const events: GenerateEvent[] = (await res.text()).trim().split('\n').map((line) => JSON.parse(line));
    const of = (direction: string) => events.filter((event) => 'direction' in event && event.direction === direction).map(({ type }) => type);
    expect(of('literal')).toEqual(['edit', 'design']);
    expect(of('bolder')).toEqual(['failure']);
    expect(of('budget')).toEqual(['edit', 'design']);
    const done = events.at(-1)!;
    expect(done.type === 'done' && done.result.designs.map(({ name }) => name)).toEqual(['Sage Nook', 'Thrifty Sage']);
  });

  /** Saves a Design of the Scan by PUT, as the editor's autosave does. */
  async function saveDesign(scanId: string, edits: Design['edits'] = []) {
    const at = '2026-10-18T12:00:00.000Z';
    const design: Design = { version: 1, id: `ds_${scanId}0001`, scanId, name: 'Move-in layout', createdAt: at, updatedAt: at, origin: 'mover', edits };
    await mkdir(join(dataDir, 'designs'), { recursive: true });
    const res = await app.request(`/api/designs/${design.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(design) });
    expect(res.ok).toBe(true);
    return design;
  }

  it('starts every take from the Design fromDesignId names: its Edits first, and the room it has in the first message', async () => {
    const current = await saveDesign('fixture', [{
      id: 'ed_mover', at: '2026-10-18T12:00:00.000Z', by: 'mover', type: 'finish',
      target: { kind: 'wall', wallId: 'wl_2' }, finish: { kind: 'paint', color: '#c46a3a' },
    }]);
    claude = fakeClaude({ literal: paintAndFinish('Sage Nook') });

    const { designs } = await (await generate({ scanId: 'fixture', brief, fromDesignId: current.id })).json();

    expect(designs[0].edits.slice(0, 1)).toEqual(current.edits);
    expect(designs[0].edits).toHaveLength(2);
    expect(designs[0].startedFrom).toEqual({ designId: current.id, edits: 1 });
    const first = claude.requests.find(({ direction }) => direction === 'literal')!.body.messages[0].content as string;
    expect(first).toContain(`Start from the Mover's current Design, "Move-in layout"`);
    expect(first).toContain('#c46a3a');
  });

  it('answers 404 for a fromDesignId with no Design, and 400 for a Design of another Scan', async () => {
    expect((await generate({ scanId: 'fixture', brief, fromDesignId: 'ds_nope' })).status).toBe(404);
    await cp(new URL('../../data/scans/fixture', import.meta.url), join(dataDir, 'scans/other'), { recursive: true });
    const other = await saveDesign('other');
    expect((await generate({ scanId: 'fixture', brief, fromDesignId: other.id })).status).toBe(400);
  });

  it('runs in fast mode, on Claude Opus 5.5, only when the request asks for it', async () => {
    claude = fakeClaude({ literal: paintAndFinish('Sage Nook') });
    await generate({ scanId: 'fixture', brief });
    await generate({ scanId: 'fixture', brief, fast: true });

    const models = claude.requests.filter(({ direction }) => direction === 'literal').map(({ body }) => [body.model, body.speed]);
    expect(models).toEqual([['claude-sonnet-5-5', undefined], ['claude-opus-5-5', 'fast']]);
  });
});

describe('Saved takes', () => {
  const KEY = { 'X-Mise-Key': 'mise' };
  const put = (id: string) => app.request(`/api/designs/${id}/saved-take`, { method: 'PUT', headers: KEY });
  const savedTake = async (id: string) => (await (await app.request(`/api/designs/${id}/saved-take`)).json()).direction;
  const designsOf = async (body: unknown): Promise<Design[]> => (await (await generate(body)).json()).designs;

  it('gives a saved Design again as its take when the same Brief comes back, and asks Claude only for the others', async () => {
    claude = fakeClaude({ literal: paintAndFinish('Sage Nook'), bolder: paintAndFinish('Bold Sage'), budget: paintAndFinish('Thrifty Sage') });
    const [liked] = await designsOf({ scanId: 'fixture', brief });
    expect(await (await put(liked.id)).json()).toEqual({ direction: 'literal' });
    expect(await savedTake(liked.id)).toBe('literal');
    claude = fakeClaude({ bolder: paintAndFinish('Bold Sage'), budget: paintAndFinish('Thrifty Sage') });

    // The same Brief in other case and spacing.
    const again = await designsOf({ scanId: 'fixture', brief: { ...brief, text: `  ${brief.text.toUpperCase()} `, styles: ['Cozy', 'Japandi'] } });

    expect(again.map(({ name }) => name)).toEqual(['Sage Nook', 'Bold Sage', 'Thrifty Sage']);
    expect(again[0].id).not.toBe(liked.id);
    expect(again[0].edits.map(({ type }) => type)).toEqual(liked.edits.map(({ type }) => type));
    expect(again[0]).toMatchObject({ origin: 'claude', direction: 'literal', rationale: liked.rationale });
    expect(claude.requests.filter(({ direction }) => direction === 'literal')).toEqual([]);
  });

  it('asks Claude nothing when every take is saved, and nothing is saved for another Brief', async () => {
    claude = fakeClaude({ literal: paintAndFinish('Sage Nook'), bolder: paintAndFinish('Bold Sage'), budget: paintAndFinish('Thrifty Sage') });
    for (const { id } of await designsOf({ scanId: 'fixture', brief })) await put(id);
    claude = fakeClaude({});

    expect((await designsOf({ scanId: 'fixture', brief })).map(({ name }) => name)).toEqual(['Sage Nook', 'Bold Sage', 'Thrifty Sage']);
    expect(claude.requests).toEqual([]);

    await designsOf({ scanId: 'fixture', brief: { ...brief, text: 'bright and minimal' } });
    expect(claude.requests.some(({ direction }) => direction === 'literal')).toBe(true);
  });

  it('saves and forgets only with the key', async () => {
    claude = fakeClaude({ literal: paintAndFinish('Sage Nook') });
    const [liked] = await designsOf({ scanId: 'fixture', brief });
    const send = (method: string, key?: string) =>
      app.request(`/api/designs/${liked.id}/saved-take`, { method, headers: key ? { 'X-Mise-Key': key } : {} });

    expect((await send('PUT')).status).toBe(403);
    expect((await send('PUT', 'wrong')).status).toBe(403);
    expect(await savedTake(liked.id)).toBeNull();
    expect((await send('PUT', 'mise')).status).toBe(200);
    expect((await send('DELETE', 'wrong')).status).toBe(403);
    expect(await savedTake(liked.id)).toBe('literal');
  });

  it('forgets a take on DELETE, and saves only Designs the AI made from a Brief', async () => {
    claude = fakeClaude({ literal: paintAndFinish('Sage Nook') });
    const [liked] = await designsOf({ scanId: 'fixture', brief });
    await put(liked.id);

    expect(await (await app.request(`/api/designs/${liked.id}/saved-take`, { method: 'DELETE', headers: KEY })).json()).toEqual({ direction: null });
    expect(await savedTake(liked.id)).toBeNull();
    const mover = (await (await post('/api/designs', { scanId: 'fixture' })).json()) as Design;
    expect((await put(mover.id)).status).toBe(400);
    expect((await put('ds_nope')).status).toBe(404);
  });
});

describe('POST /api/generate/warm', () => {
  it("writes the Scan's shared prefix to the prompt cache without generating, and says how many tokens it holds", async () => {
    claude = fakeClaude({});

    const res = await post('/api/generate/warm', { scanId: 'fixture' });

    expect(await res.json()).toEqual({ cachedTokens: 500 });
    expect(claude.requests.map(({ body }) => body.max_tokens)).toEqual([0]);
  });

  it('answers 400 without a Scan, and 404 for an unknown one', async () => {
    claude = fakeClaude({});

    expect((await post('/api/generate/warm', {})).status).toBe(400);
    expect((await post('/api/generate/warm', { scanId: 'nope' })).status).toBe(404);
  });
});
