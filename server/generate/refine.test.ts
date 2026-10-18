import Anthropic from '@anthropic-ai/sdk';
import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { replay } from '../../shared/replay';
import { catalog, item, setup } from '../../shared/test-room';
import type { Design, Edit, Palette } from '../../shared/types';
import { app } from '../app';
import { use } from './fakeClaude';
import { refineDesign } from './refine';
import { reviewFlags } from './review';

// Claude is faked at the HTTP boundary, so the Tool Runner, the tools and replay run as they do for real.

type Body = Anthropic.Beta.MessageCreateParams;
type ToolResult = { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };
/** One scripted reply, given the request it answers. */
type Turn = (body: Body) => { content: unknown[]; stop_reason?: string };

/** A Claude that answers each request of a Refine from its script, one turn per reply, and the requests it got. */
function scriptedClaude(turns: Turn[]) {
  const requests: Body[] = [];
  const fetch = async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(init!.body as string) as Body;
    requests.push(body);
    const turn = turns[body.messages.filter(({ role }) => role === 'assistant').length];
    const { content, stop_reason = 'tool_use' } = turn?.(body) ?? { content: [{ type: 'text', text: 'Done.' }], stop_reason: 'end_turn' };
    return Response.json({
      id: `msg_${requests.length}`, type: 'message', role: 'assistant', model: body.model, content, stop_reason, stop_sequence: null,
      usage: { input_tokens: 1000, output_tokens: 100 },
    });
  };
  return { client: new Anthropic({ apiKey: 'test-key', fetch, maxRetries: 0 }), requests };
}
const results = (body: Body) => body.messages.at(-1)!.content as ToolResult[];

const print = item('print-fern', 'wall_art', 'Fern Print', [0.5, 0.6, 0.03], { mount: 'wall', priceEstimateUsd: 40 });
const poster = item('poster-city', 'wall_art', 'City Poster', [0.4, 0.5, 0.02], { mount: 'wall', priceEstimateUsd: 30 });
const pillow = item('pillow-navy', 'decor', 'Navy Pillow', [0.45, 0.45, 0.15], { priceEstimateUsd: 25 });
const throwBlanket = item('throw-oat', 'decor', 'Oat Throw', [0.5, 0.1, 0.4], { priceEstimateUsd: 35 });
const plant = item('plant-fig', 'plant', 'Small Fig', [0.2, 0.3, 0.2], { priceEstimateUsd: 30 });
const decorCatalog = { ...catalog, items: [...catalog.items, print, poster, pillow, throwBlanket, plant] };
const palette: Palette = { wall: '#f4efe6', accents: ['#9caf88', '#2f3e46'], materials: ['oak', 'linen'] };

const at = '2026-10-18T00:00:00.000Z';
/** A finished Claude Design of the test room: a sage wall, a gallery centered over the bed, a rug, a lamp and a plant. */
const design: Design = {
  version: 1, id: 'ds_sage', scanId: 'test-room', name: 'Sage Nook', createdAt: at, updatedAt: at, origin: 'claude',
  brief: { text: 'cozy Japandi', styles: ['Japandi'], budgetUsd: 600 }, rationale: 'Sage and oak, for a cozy Japandi room.', palette,
  edits: ([
    { type: 'finish', target: { kind: 'wall', wallId: 'wl_west' }, finish: { kind: 'paint', color: '#9caf88' } },
    { type: 'place', pieceId: 'pc_print', catalogId: 'print-fern', placement: { position: [-1.95, 1.15, -0.72], rotationY: Math.PI / 2, mount: 'wall', wallId: 'wl_west' } },
    { type: 'place', pieceId: 'pc_poster', catalogId: 'poster-city', placement: { position: [-1.95, 1.2, -0.2], rotationY: Math.PI / 2, mount: 'wall', wallId: 'wl_west' } },
    { type: 'place', pieceId: 'pc_rug', catalogId: 'rug-gray', placement: { position: [-1, 0, -0.5], rotationY: 0, mount: 'floor' } },
    { type: 'place', pieceId: 'pc_lamp', catalogId: 'lamp-brass', placement: { position: [1.7, 0.76, -0.8], rotationY: -Math.PI / 2, mount: 'surface' } },
    { type: 'place', pieceId: 'pc_plant', catalogId: 'plant-fig', placement: { position: [1.7, 0.76, -0.4], rotationY: 0, mount: 'surface' } },
  ] as const).map((edit, i) => ({ ...edit, id: `ed_${i}`, at, by: 'claude' }) as Edit),
};

const finish = (rationale = 'Sage and oak, now cozier with layered textiles.') =>
  use('toolu_finish', 'finish_design', { name: 'Sage Nook', rationale, palette });
/** "Make it cozier": a pillow and a throw on the bed, and warmer bedding. */
const cozier: Turn[] = [() => ({
  content: [
    { type: 'text', text: 'Layering the bed with a pillow and a throw, and warming the bedding.' },
    use('toolu_bed', 'dress_bed', { bed_id: 'og_bed', catalog_ids: ['pillow-navy', 'throw-oat'] }),
    use('toolu_bedding', 'recolor', { target_id: 'og_bed', part_id: 'bedding', color: '#e8dcc8' }),
    finish(),
  ],
})];

const refine = (client: Anthropic, text = 'make it cozier') =>
  refineDesign({ client, design, text, setup, catalog: decorCatalog, materials: [] });

describe('refineDesign', () => {
  it("appends Claude's Edits after the Design's own, and takes the new rationale", async () => {
    const { client } = scriptedClaude(cozier);

    const { design: refined, edits } = await refine(client);

    expect(edits.map(({ type }) => type)).toEqual(['place', 'place', 'recolor']);
    expect(edits.every(({ by }) => by === 'claude')).toBe(true);
    expect(refined.edits).toEqual([...design.edits, ...edits]);
    expect(refined).toMatchObject({ id: 'ds_sage', name: 'Sage Nook', rationale: 'Sage and oak, now cozier with layered textiles.', origin: 'claude', brief: design.brief });
    expect(replay(setup, decorCatalog, refined.edits).skipped).toEqual([]);
  });

  it("tells Claude what the Mover asks and what the Design has, from the same system prompt as Generate", async () => {
    const { client, requests } = scriptedClaude(cozier);
    await refine(client);

    const [{ messages: [first], system, model }] = requests;
    expect(model).toBe('claude-sonnet-5-5');
    expect(JSON.stringify(system)).toContain("You are Mise's interior designer");
    expect(first.content).toContain('The Mover asks: "make it cozier"');
    expect(first.content).toContain('"id":"pc_rug"');
    expect(first.content).toContain('"wall_id":"wl_west"');
  });

  it('makes at most 4 Edits: a fifth fails back to Claude', async () => {
    const { client, requests } = scriptedClaude([
      () => ({
        content: [
          use('toolu_bed', 'dress_bed', { bed_id: 'og_bed', catalog_ids: ['pillow-navy', 'throw-oat'] }),
          use('toolu_a', 'recolor', { target_id: 'og_bed', part_id: 'bedding', color: '#e8dcc8' }),
          use('toolu_b', 'recolor', { target_id: 'og_desk', part_id: '*', color: '#c8a27a' }),
          use('toolu_c', 'apply_finish', { target: { kind: 'wall', wall_id: 'wl_east' }, finish: { kind: 'paint', color: '#f4efe6' } }),
        ],
      }),
      () => ({ content: [finish()] }),
    ]);

    const { edits } = await refine(client);

    expect(edits).toHaveLength(4);
    expect(results(requests[1]).find(({ tool_use_id }) => tool_use_id === 'toolu_c'))
      .toMatchObject({ is_error: true, content: expect.stringContaining('4 Edits, the most it may have') });
  });

  it('keeps the Edits and the name when Claude stops without finish_design, after asking once', async () => {
    const { client, requests } = scriptedClaude([() => ({
      content: [use('toolu_bedding', 'recolor', { target_id: 'og_bed', part_id: 'bedding', color: '#e8dcc8' })],
    })]);

    const { design: refined, edits } = await refine(client);

    expect(edits).toHaveLength(1);
    expect(refined).toMatchObject({ name: design.name, rationale: design.rationale });
    expect(requests.at(-1)!.messages.at(-1)!.content).toBe('Call finish_design now to finish this Refine.');
  });

  it("isn't sent back for what the Design already lacked, or the review already flagged", async () => {
    // No rug, no lamp, and its two frames 0.26 m off the bed's middle.
    const lacking: Design = {
      ...design,
      edits: design.edits.filter(({ type, ...edit }) => type !== 'place' || ['pc_print', 'pc_poster', 'pc_plant'].includes((edit as { pieceId: string }).pieceId))
        .map((edit) => (edit.type === 'place' && edit.pieceId === 'pc_print'
          ? { ...edit, placement: { ...edit.placement, position: [-1.95, 1.15, -0.98] as const } } : edit) as Edit)
        .map((edit) => (edit.type === 'place' && edit.pieceId === 'pc_poster'
          ? { ...edit, placement: { ...edit.placement, position: [-1.95, 1.2, -0.46] as const } } : edit) as Edit),
    };
    const { client, requests } = scriptedClaude(cozier);

    const { design: refined } = await refineDesign({ client, design: lacking, text: 'make it cozier', setup, catalog: decorCatalog, materials: [] });

    expect(reviewFlags(setup, decorCatalog, replay(setup, decorCatalog, lacking.edits))).toEqual([expect.stringContaining('0.26 m right of its middle')]);
    expect(requests).toHaveLength(1);
    expect(refined.rationale).toBe('Sage and oak, now cozier with layered textiles.');
  });

  it('fails when Claude makes no change', async () => {
    const { client } = scriptedClaude([]);
    await expect(refine(client)).rejects.toThrow('The AI made no changes');
  });

  it('holds a Refine to a budget its words name', async () => {
    const { client, requests } = scriptedClaude([
      () => ({ content: [use('toolu_bed', 'dress_bed', { bed_id: 'og_bed', catalog_ids: ['pillow-navy'] })] }),
      () => ({ content: [use('toolu_bedding', 'recolor', { target_id: 'og_bed', part_id: 'bedding', color: '#e8dcc8' }), finish()] }),
    ]);

    // The Design's Pieces come to $100 + $100 + $40 + $30 + $30 = $300.
    const { edits } = await refine(client, 'cozier, but keep it all under $310');

    expect(results(requests[1])[0].content).toContain('must stay under the $310 budget');
    expect(edits.map(({ type }) => type)).toEqual(['recolor']);
  });

  it("reads a price below what the Pieces cost as the price of what to add, not the budget", async () => {
    const { client } = scriptedClaude([
      () => ({ content: [use('toolu_bed', 'dress_bed', { bed_id: 'og_bed', catalog_ids: ['pillow-navy'] }), finish()] }),
    ]);

    // $30 is far under the $300 the Pieces cost: the Brief's $600 stands, and the $25 pillow fits.
    const { edits } = await refine(client, 'add a pillow, something under $30');

    expect(edits).toMatchObject([{ type: 'place', catalogId: 'pillow-navy' }]);
  });

  it("doesn't count the Pieces of the room a Generate began from against the budget", async () => {
    const { client, requests } = scriptedClaude([
      () => ({ content: [use('toolu_bed', 'dress_bed', { bed_id: 'og_bed', catalog_ids: ['pillow-navy'] }), finish()] }),
    ]);
    // Made from another Design with all 5 Pieces ($300), for a $50 Brief: it has spent nothing yet.
    const fromTheRoom: Design = { ...design, brief: { text: 'cozy', budgetUsd: 50 }, startedFrom: { designId: 'ds_room', edits: design.edits.length } };

    const { edits } = await refineDesign({ client, design: fromTheRoom, text: 'add a pillow', setup, catalog: decorCatalog, materials: [] });

    expect(edits).toMatchObject([{ type: 'place', catalogId: 'pillow-navy' }]);
    expect(requests[0].messages[0].content).toContain('$50 for all the Pieces this Design added to the room');
  });
});

describe('POST /api/designs/:id/refine', () => {
  let dataDir: string;
  let claude: ReturnType<typeof scriptedClaude>;
  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'mise-refine-'));
    await cp(new URL('../../data/scans/fixture', import.meta.url), join(dataDir, 'scans/fixture'), { recursive: true });
    await cp(new URL('../../data/catalog/catalog.json', import.meta.url), join(dataDir, 'catalog/catalog.json'));
    await mkdir(join(dataDir, 'designs'));
    vi.stubEnv('DATA_DIR', dataDir);
    const { anthropic } = await import('./agent');
    vi.mocked(anthropic).mockImplementation(() => claude.client);
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(dataDir, { recursive: true, force: true });
  });

  const post = (id: string, body: unknown) =>
    app.request(`/api/designs/${id}/refine`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const create = async () => (await (await app.request('/api/designs', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scanId: 'fixture' }),
  })).json()) as Design;

  it('saves the Design with the new Edits, and returns them', async () => {
    const { id } = await create();
    claude = scriptedClaude([() => ({
      content: [
        use('toolu_paint', 'apply_finish', { target: { kind: 'wall', wall_id: 'wl_4' }, finish: { kind: 'paint', color: '#9caf88' } }),
        use('toolu_finish', 'finish_design', { name: 'Sage Wall', rationale: 'A sage wall.', palette }),
      ],
    })]);

    const res = await post(id, { text: 'paint a wall sage' });

    expect(res.status).toBe(200);
    const { design: refined, edits } = await res.json();
    expect(edits).toMatchObject([{ type: 'finish', by: 'claude' }]);
    expect(refined).toMatchObject({ id, name: 'Sage Wall' });
    expect(await (await app.request(`/api/designs/${id}`)).json()).toEqual(refined);
  });

  it('answers 400 without text, 404 for no such Design, and 502 when Claude makes no change', async () => {
    claude = scriptedClaude([]);
    const { id } = await create();
    expect((await post(id, {})).status).toBe(400);
    expect((await post('ds_nope', { text: 'cozier' })).status).toBe(404);
    const res = await post(id, { text: 'cozier' });
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe('The AI made no changes');
  });
});

vi.mock('./agent', async (importOriginal) => ({ ...(await importOriginal<typeof import('./agent')>()), anthropic: vi.fn() }));
