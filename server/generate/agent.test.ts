import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { checkFit } from '../../shared/fit';
import { replay } from '../../shared/replay';
import { catalog, item, setup } from '../../shared/test-room';
import type { Brief, Design } from '../../shared/types';
import type { GenerateEvent } from '../../shared/generate';
import { generateDesigns, warmCache } from './agent';
import { type FakeRequest, fakeClaude, results, type Turn, use } from './fakeClaude';

// Claude is faked at the HTTP boundary (fakeClaude.ts), so the Tool Runner, the tools, the Fit rules
// and saving all run as they do for real.

const print = item('print-fern', 'wall_art', 'Fern Print', [0.5, 0.6, 0.03], { mount: 'wall', priceEstimateUsd: 40 });
const poster = item('poster-city', 'wall_art', 'City Poster', [0.4, 0.5, 0.02], { mount: 'wall', priceEstimateUsd: 30 });
const pillow = item('pillow-navy', 'decor', 'Navy Pillow', [0.45, 0.45, 0.15], { priceEstimateUsd: 25 });
const plant = item('plant-fig', 'plant', 'Small Fig', [0.2, 0.3, 0.2], { priceEstimateUsd: 30 });
const sofa = item('sofa-gray', 'sofa', 'Gray Sofa', [2, 0.85, 0.9], { priceEstimateUsd: 150 });
const decorCatalog = { ...catalog, items: [...catalog.items, print, poster, pillow, plant, sofa] };
const brief: Brief = { text: 'cozy Japandi, under $400, I need a reading corner', styles: ['Japandi'], budgetUsd: 400 };
const palette = { wall: '#f4efe6', accents: ['#9caf88', '#2f3e46'], materials: ['oak', 'linen'] };

const finish = (name: string, id = `toolu_finish_${name}`) =>
  use(id, 'finish_design', { name, rationale: `${name}, for a cozy Japandi reading corner.`, palette });
const pieceIdOf = (request: FakeRequest, toolUseId: string) => JSON.parse(results(request).find(({ tool_use_id }) => tool_use_id === toolUseId)!.content).piece_id;

/** A fully decorated Design in two turns, with one Fit violation along the way. */
const decorate: Turn[] = [
  () => ({
    content: [
      // The bed takes 2.03 m of the 3 m West wall: a 2 m sofa against it can only overlap the bed.
      use('toolu_sofa', 'place_piece', { catalog_id: 'sofa-gray', anchor: { kind: 'against_wall', wall_id: 'wl_west', along: 'center' } }),
      use('toolu_paint', 'apply_finish', { target: { kind: 'wall', wall_id: 'wl_west' }, finish: { kind: 'paint', color: '#9caf88' } }),
      use('toolu_print', 'place_piece', { catalog_id: 'print-fern', anchor: { kind: 'on_wall_over', target_id: 'og_bed', wall_id: 'wl_west' } }),
      use('toolu_rug', 'place_piece', { catalog_id: 'rug-gray', anchor: { kind: 'open_floor' } }),
      use('toolu_lamp', 'place_piece', { catalog_id: 'lamp-brass', anchor: { kind: 'on_top_of', target_id: 'og_desk' } }),
      use('toolu_pillow', 'place_piece', { catalog_id: 'pillow-navy', anchor: { kind: 'on_top_of', target_id: 'og_bed' } }),
      use('toolu_plant', 'place_piece', { catalog_id: 'plant-fig', anchor: { kind: 'on_top_of', target_id: 'og_desk' } }),
      use('toolu_bedding', 'recolor', { target_id: 'og_bed', part_id: 'bedding', color: '#f4efe6' }),
    ],
  }),
  (request) => ({
    content: [
      use('toolu_poster', 'place_piece', { catalog_id: 'poster-city', anchor: { kind: 'on_wall_beside', target_id: pieceIdOf(request, 'toolu_print'), side: 'right' } }),
      finish({ literal: 'Sage Nook', bolder: 'Quiet Corner', budget: 'Thrifty Corner' }[request.direction!]),
    ],
  }),
];

/** A budget the moves' Designs fit in: the test Catalog's own items are $100 each. */
const roomy: Brief = { ...brief, budgetUsd: 600 };

/** A whole Design in one reply of decorating moves, as the system prompt asks, named `name` or for its direction. */
const inOneReply = (name?: string): Turn[] => [
  (request) => ({
    content: [
      use('toolu_paint', 'apply_finish', { target: { kind: 'wall', wall_id: 'wl_west' }, finish: { kind: 'paint', color: '#9caf88' } }),
      use('toolu_gallery', 'hang_gallery', { over_id: 'og_bed', wall_id: 'wl_west', catalog_ids: ['print-fern', 'poster-city'] }),
      use('toolu_rug', 'lay_rug', { catalog_id: 'rug-gray', under_id: 'og_bed' }),
      use('toolu_corner', 'make_corner', { chair_id: 'chair-ergo', lamp_id: 'lamp-brass', side_id: '', near_id: 'op_window' }),
      use('toolu_bed', 'dress_bed', { bed_id: 'og_bed', catalog_ids: ['pillow-navy'] }),
      use('toolu_tops', 'style_tops', { items: [{ catalog_id: 'plant-fig', on_id: 'og_desk' }] }),
      use('toolu_bedding', 'recolor', { target_id: 'og_bed', part_id: 'bedding', color: '#f4efe6' }),
      finish(name ?? { literal: 'Sage Nook', bolder: 'Bold Nook', budget: 'Thrifty Nook' }[request.direction!]),
    ],
  }),
  // Sent back for a name another take has: it renames.
  () => ({ content: [finish('Oat Corner', 'toolu_rename')] }),
];

const generate = (client: Anthropic, options: { loopTimeoutMs?: number; fast?: boolean; onEvent?: (event: GenerateEvent) => void; brief?: Brief } = {}) => {
  const saved: Design[] = [];
  const result = generateDesigns({
    client, scanId: 'test-room', setup, catalog: decorCatalog, materials: [], brief, save: async (design) => { saved.push(design); }, ...options,
  });
  return { result, saved };
};

describe('generateDesigns', () => {
  it('runs one loop per direction and saves each Design by Claude, with the Brief, a rationale and a Palette', async () => {
    const { client } = fakeClaude({ literal: decorate, bolder: decorate, budget: decorate });
    const { result, saved } = generate(client);

    const { designs, failures } = await result;

    expect(failures).toEqual([]);
    expect(designs.map(({ name }) => name)).toEqual(['Sage Nook', 'Quiet Corner', 'Thrifty Corner']);
    expect(saved.toSorted((a, b) => a.id.localeCompare(b.id))).toEqual(designs.toSorted((a, b) => a.id.localeCompare(b.id)));
    expect(designs[0]).toMatchObject({
      version: 1, id: expect.stringMatching(/^ds_/), scanId: 'test-room', origin: 'claude', brief,
      rationale: 'Sage Nook, for a cozy Japandi reading corner.', palette,
    });
    // 8 Edits: every call but the sofa's and finish_design.
    expect(designs[0].edits).toHaveLength(8);
    expect(designs[0].edits.every(({ by }) => by === 'claude')).toBe(true);
    const state = replay(setup, decorCatalog, designs[0].edits);
    expect(state.skipped).toEqual([]);
    expect(checkFit(setup, decorCatalog, state, Object.keys(state.pieces), { walkway: true })).toEqual([]);
  });

  it('sends a failed tool call back to Claude as an is_error result that lists the Fit violations', async () => {
    const { client, requests } = fakeClaude({ literal: decorate });
    await generate(client).result;

    const second = requests.find(({ direction, body }) => direction === 'literal' && body.messages.length === 3)!;
    expect(results(second).find(({ tool_use_id }) => tool_use_id === 'toolu_sofa')).toEqual({
      type: 'tool_result', tool_use_id: 'toolu_sofa', is_error: true,
      content: "Gray Sofa doesn't fit there, even slid up to 1 m either way. Fit violations: Overlaps your bed (overlap, og_bed)",
    });
  });

  it('asks Claude Opus 5.5 at low effort, with strict tools (but place_piece), auto tool choice and the default refusal fallback', async () => {
    const { client, requests } = fakeClaude({ literal: decorate });
    await generate(client).result;

    const [{ body, headers }] = requests;
    expect(body).toMatchObject({ model: 'claude-opus-5-5', output_config: { effort: 'low' }, tool_choice: { type: 'auto' }, fallbacks: 'default' });
    expect(body.tools!.filter((tool) => !('strict' in tool && tool.strict)).map((tool) => 'name' in tool && tool.name)).toEqual(['place_piece']);
    expect(headers.get('anthropic-beta')).toContain('server-side-fallback-2026-07-01');
  });

  it('turns on fast mode when asked: speed fast, with its beta', async () => {
    const { client, requests } = fakeClaude({ literal: decorate });
    await generateDesigns({ client, scanId: 'test-room', setup, catalog: decorCatalog, materials: [], brief, save: async () => {}, fast: true });

    const [{ body, headers }] = requests;
    expect(body).toMatchObject({ speed: 'fast' });
    expect(headers.get('anthropic-beta')).toContain('fast-mode-2026-02-01');
  });

  it('gives each take a name of its own: a take that finishes with a name another has is sent back to rename', async () => {
    const { client } = fakeClaude({ literal: inOneReply('Quiet Oat Nook'), budget: inOneReply('Quiet Oat Nook') });

    const { designs, loops } = await generate(client, { brief: roomy }).result;

    expect(designs.map(({ name }) => name).toSorted()).toEqual(['Oat Corner', 'Quiet Oat Nook']);
    expect(loops.filter(({ direction }) => direction !== 'bolder').map(({ requests }) => requests).toSorted()).toEqual([1, 2]);
  });

  it('makes a whole Design in one request when Claude decorates in one reply of moves', async () => {
    const { client, requests } = fakeClaude({ literal: inOneReply(), bolder: inOneReply(), budget: inOneReply() });

    const { designs, loops } = await generate(client, { brief: roomy }).result;

    expect(requests).toHaveLength(3);
    expect(loops.map(({ requests: count }) => count)).toEqual([1, 1, 1]);
    // Paint; 2 frames, the rug, the chair and its lamp, a pillow and a plant; the bedding.
    expect(designs[0].edits.map(({ type }) => type)).toEqual(['finish', ...Array(7).fill('place'), 'recolor']);
    const state = replay(setup, decorCatalog, designs[0].edits);
    expect(checkFit(setup, decorCatalog, state, Object.keys(state.pieces), { walkway: true })).toEqual([]);
  });

  it('streams every Edit as it is made, then each Design as it is finished', async () => {
    const { client } = fakeClaude({ literal: inOneReply() });
    const events: GenerateEvent[] = [];

    const { designs } = await generate(client, { brief: roomy, onEvent: (event) => events.push(event) }).result;

    const literal = events.filter((event) => 'direction' in event && event.direction === 'literal');
    expect(literal.map(({ type }) => type)).toEqual([...Array(9).fill('edit'), 'design']);
    expect(literal.slice(0, 9).map((event) => event.type === 'edit' && event.edit)).toEqual(designs[0].edits);
    expect(literal.at(-1)).toMatchObject({ type: 'design', report: { firstEditSeconds: expect.any(Number), firstTokenSeconds: expect.any(Number) } });
    expect(events.filter(({ type }) => type === 'failure').map((event) => 'direction' in event && event.direction)).toEqual(['bolder', 'budget']);
  });

  it('opens every request with the same tools, system prompt and cached room context: only the Brief message differs', async () => {
    const { client, requests } = fakeClaude({ literal: inOneReply(), bolder: inOneReply(), budget: inOneReply() });
    await generate(client).result;
    await warmCache({ client, setup, catalog: decorCatalog, materials: [] });

    const [literal, bolder, budget, warm] = requests;
    for (const other of [bolder, budget, warm]) {
      expect(JSON.stringify(other.body.tools)).toBe(JSON.stringify(literal.body.tools));
      expect(other.body.system).toEqual(literal.body.system);
    }
    expect(literal.body.system).toEqual([
      { type: 'text', text: expect.stringContaining('Design the whole room in ONE reply') },
      { type: 'text', text: expect.stringContaining('Room Summary'), cache_control: { type: 'ephemeral' } },
    ]);
    expect(literal.body.messages[0].content).toMatch(/^Brief: "cozy Japandi/);
    expect(literal.body.messages[0].content).not.toContain('Room Summary');
    expect(warm.body).toMatchObject({ max_tokens: 0, output_config: { effort: 'low' } });
    expect(warm.body.stream).toBeUndefined();
  });

  it('goes on at standard speed when fast mode is rate limited or fails before the Design has begun', async () => {
    // Refused in fast mode, each take's first reply comes at standard speed.
    const refusedFast = (refusal: 'rate-limited' | 'error'): Turn[] => [(request) => (request.body.speed === 'fast' ? refusal : inOneReply()[0](request))];
    const { client, requests } = fakeClaude({ literal: refusedFast('rate-limited'), budget: refusedFast('error') });

    const { designs } = await generate(client, { brief: roomy, fast: true }).result;

    expect(designs.map(({ name }) => name)).toEqual(['Sage Nook', 'Thrifty Nook']);
    for (const take of ['literal', 'budget']) {
      expect(requests.filter(({ direction }) => direction === take).map(({ body }) => body.speed)).toEqual(['fast', undefined]);
    }
  });

  it('returns the Designs that succeeded when a loop fails', async () => {
    const { client } = fakeClaude({ literal: decorate, bolder: [() => 'error'], budget: decorate });
    const { result, saved } = generate(client);

    const { designs, failures } = await result;

    expect(designs.map(({ name }) => name)).toEqual(['Sage Nook', 'Thrifty Corner']);
    expect(saved).toHaveLength(2);
    expect(failures).toEqual([{ direction: 'bolder', error: expect.stringContaining('Overloaded') }]);
  });

  it('fails a loop that runs out of time', async () => {
    const { client } = fakeClaude({ literal: decorate, bolder: decorate, budget: [() => 'hang'] });

    const { designs, failures } = await generate(client, { loopTimeoutMs: 200 }).result;

    expect(designs).toHaveLength(2);
    expect(failures).toEqual([{ direction: 'budget', error: 'Claude took longer than 0.2 s' }]);
  });

  it('asks once more when Claude stops without calling finish_design', async () => {
    const stops = () => ({ content: [{ type: 'text', text: 'All set!' }], stop_reason: 'end_turn' });
    // With one frame, the first finish_design is sent back for a second; the next one finishes anyway.
    const finishes = () => ({ content: [finish('Late Nook', 'toolu_1'), finish('Late Nook', 'toolu_2')] });
    const { client, requests } = fakeClaude({ literal: [decorate[0], stops, finishes] });

    const { designs } = await generate(client).result;

    expect(designs.map(({ name }) => name)).toEqual(['Late Nook']);
    expect(requests.filter(({ direction }) => direction === 'literal').at(-1)!.body.messages.at(-1)).toEqual({
      role: 'user', content: 'Call finish_design now to finish this Design.',
    });
  });
});
