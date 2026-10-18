import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
    use('toolu_review', 'review_design', {}),
    use('toolu_finish_1', 'finish_design', { name, rationale: 'Sage, as the Brief asks.', palette }),
    use('toolu_finish_2', 'finish_design', { name, rationale: 'Sage, as the Brief asks.', palette }),
  ],
})];

const generate = (body: unknown) => app.request('/api/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const brief = { text: 'cozy Japandi, under $400, I need a reading corner', styles: ['Japandi', 'Cozy'], budgetUsd: 400 };

describe('POST /api/generate', () => {
  it('returns the 3 Designs and saves each one, which the Designs list then shows', async () => {
    claude = fakeClaude({ literal: paintAndFinish('Sage Nook'), bolder: paintAndFinish('Bold Sage'), budget: paintAndFinish('Thrifty Sage') });

    const res = await generate({ scanId: 'fixture', brief });

    expect(res.status).toBe(200);
    const { designs, failures, loops } = await res.json();
    expect(designs.map(({ name }: Design) => name)).toEqual(['Sage Nook', 'Bold Sage', 'Thrifty Sage']);
    expect(failures).toEqual([]);
    expect(loops).toHaveLength(3);
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
    expect((await res.json()).error).toMatch(/^Claude made no Designs: /);
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
});
