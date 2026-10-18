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
      // Off the bed's middle by half the poster that hangs beside it next turn, so the two are centered over the bed.
      use('toolu_print', 'place_piece', { catalog_id: 'print-fern', anchor: { kind: 'on_wall_over', target_id: 'og_bed', wall_id: 'wl_west', offset_m: -0.23 } }),
      use('toolu_rug', 'place_piece', { catalog_id: 'rug-gray', anchor: { kind: 'centered_under', target_id: 'og_bed' } }),
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

/** The requests of the takes, without the warm-ups (max_tokens 0) that write their shared prefix to the cache. */
const takes = (requests: FakeRequest[]) => requests.filter(({ direction }) => direction);

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

const generate = (client: Anthropic, options: { loopTimeoutMs?: number; fast?: boolean; current?: Design; onEvent?: (event: GenerateEvent) => void; brief?: Brief; signal?: AbortSignal } = {}) => {
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

  it('asks Claude Sonnet 5.5 at low effort, with strict tools (but stock_shelves and place_piece), auto tool choice and the default refusal fallback', async () => {
    const { client, requests } = fakeClaude({ literal: decorate });
    await generate(client).result;

    const [{ body, headers }] = takes(requests);
    expect(body).toMatchObject({ model: 'claude-sonnet-5-5', output_config: { effort: 'low' }, tool_choice: { type: 'auto' }, fallbacks: 'default' });
    expect(body.tools!.filter((tool) => !('strict' in tool && tool.strict)).map((tool) => 'name' in tool && tool.name)).toEqual(['stock_shelves', 'place_piece']);
    expect(headers.get('anthropic-beta')).toContain('server-side-fallback-2026-07-01');
  });

  it('runs on Claude Opus 5.5 in fast mode when asked: speed fast, with its beta', async () => {
    const { client, requests } = fakeClaude({ literal: decorate });
    await generate(client, { fast: true }).result;

    const [{ body, headers }] = takes(requests);
    expect(body).toMatchObject({ model: 'claude-opus-5-5', speed: 'fast' });
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

    expect(takes(requests)).toHaveLength(3);
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

  it("streams Claude's plan for a take as it writes it, before the Edits it plans: its notes, which come as thinking blocks", async () => {
    // On Claude Opus 5.5, notes before a tool call come back as thinking blocks, with their text under display "updates".
    const notes = ['Concept: sage accent wall behind the bed, oat and oak.', 'Layout: the reading chair by the window, the way in clear.'];
    const planned: Turn[] = [(request) => {
      const reply = inOneReply()[0](request) as { content: unknown[] };
      return { content: [...notes.map((thinking) => ({ type: 'thinking', thinking, signature: 'sig' })), ...reply.content] };
    }];
    const { client, requests } = fakeClaude({ literal: planned });
    const events: GenerateEvent[] = [];

    await generate(client, { brief: roomy, onEvent: (event) => events.push(event) }).result;

    const [first] = takes(requests);
    expect(first.body.thinking).toEqual({ type: 'adaptive', display: 'updates' });
    expect(first.headers.get('anthropic-beta')).toContain('thinking-display-updates-2026-08-18');
    const literal = events.filter((event) => 'direction' in event && event.direction === 'literal');
    const plan = literal.filter((event) => event.type === 'plan').map((event) => event.type === 'plan' && event.text).join('');
    expect(plan.trim()).toBe(notes.join('\n'));
    expect(literal.filter(({ type }) => type !== 'plan').map(({ type }) => type)).toEqual([...Array(9).fill('edit'), 'design']);
  });

  it('opens every request with the same tools, system prompt and cached room context: only the Brief message differs', async () => {
    const { client, requests } = fakeClaude({ literal: inOneReply(), bolder: inOneReply(), budget: inOneReply() });
    await generate(client).result;
    await warmCache({ client, setup, catalog: decorCatalog, materials: [] });

    const [literal, bolder, budget] = takes(requests);
    const warm = requests.at(-1)!;
    for (const other of [bolder, budget, warm]) {
      expect(JSON.stringify(other.body.tools)).toBe(JSON.stringify(literal.body.tools));
      expect(other.body.system).toEqual(literal.body.system);
    }
    expect(literal.body.system).toEqual([
      { type: 'text', text: expect.stringContaining('Plan, then build, in ONE reply') },
      { type: 'text', text: expect.stringContaining('Room Summary'), cache_control: { type: 'ephemeral' } },
    ]);
    expect(literal.body.messages[0].content).toMatch(/^Brief: "cozy Japandi/);
    expect(literal.body.messages[0].content).not.toContain('Room Summary');
    expect(warm.body).toMatchObject({ max_tokens: 0, output_config: { effort: 'low' } });
    expect(warm.body.stream).toBeUndefined();
  });

  it('writes the shared prefix to the cache once, before the takes start, unless it was written or read in the last 4 minutes', async () => {
    const { client, requests } = fakeClaude({ literal: inOneReply(), bolder: inOneReply(), budget: inOneReply() });
    const sent = () => requests.map(({ direction, body }) => direction ?? (body.max_tokens === 0 ? 'warm-up' : '?'));

    await generate(client, { brief: roomy }).result;
    expect(sent()).toEqual(['warm-up', 'literal', 'bolder', 'budget']);
    // The takes read it, so it is still there for the next Brief.
    await generate(client, { brief: roomy }).result;
    expect(sent().filter((each) => each === 'warm-up')).toHaveLength(1);

    // A warm-up from the Brief dialog still under way is waited for, not sent again.
    const { client: other, requests: otherRequests } = fakeClaude({ literal: inOneReply() });
    void warmCache({ client: other, setup, catalog: decorCatalog, materials: [] });
    await generate(other, { brief: roomy }).result;
    expect(otherRequests.filter(({ body }) => body.max_tokens === 0)).toHaveLength(1);
    expect(otherRequests[0].body.max_tokens).toBe(0);
  });

  it('warms a prefix for each model and speed: a fast Brief after a standard one writes its own', async () => {
    const { client, requests } = fakeClaude({ literal: inOneReply() });

    await generate(client, { brief: roomy }).result;
    await generate(client, { brief: roomy, fast: true }).result;
    await generate(client, { brief: roomy, fast: true }).result;

    expect(requests.filter(({ body }) => body.max_tokens === 0).map(({ body }) => [body.model, body.speed])).toEqual([
      ['claude-sonnet-5-5', undefined], ['claude-opus-5-5', 'fast'],
    ]);
  });

  it("caches each take's conversation as it grows, past the shared prefix: automatic caching on its requests, not on the warm-up", async () => {
    const { client, requests } = fakeClaude({ literal: decorate });
    await generate(client).result;
    await warmCache({ client, setup, catalog: decorCatalog, materials: [] });

    const literal = requests.filter(({ direction }) => direction === 'literal');
    expect(literal.length).toBeGreaterThan(1);
    expect(literal.map(({ body }) => body.cache_control)).toEqual(literal.map(() => ({ type: 'ephemeral' })));
    expect(requests.at(-1)!.body).toMatchObject({ max_tokens: 0 });
    expect(requests.at(-1)!.body.cache_control).toBeUndefined();
  });

  it('goes on at standard speed when fast mode is rate limited or fails before the Design has begun', async () => {
    // Refused in fast mode, each take's first reply comes at standard speed.
    const refusedFast = (refusal: 'rate-limited' | 'error'): Turn[] => [(request) => (request.body.speed === 'fast' ? refusal : inOneReply()[0](request))];
    const { client, requests } = fakeClaude({ literal: refusedFast('rate-limited'), budget: refusedFast('error') });

    const { designs } = await generate(client, { brief: roomy, fast: true }).result;

    expect(designs.map(({ name }) => name)).toEqual(['Sage Nook', 'Thrifty Nook']);
    for (const take of ['literal', 'budget']) {
      // On the same model: Claude reads back only its own model's thinking.
      expect(requests.filter(({ direction }) => direction === take).map(({ body }) => [body.model, body.speed])).toEqual([
        ['claude-opus-5-5', 'fast'], ['claude-opus-5-5', undefined],
      ]);
    }
  });

  it('goes on at standard speed from where it was when fast mode refuses a later request, without waiting on retries', async () => {
    // The first reply decorates but doesn't finish; fast mode refuses the next request, which goes on at standard speed.
    const [first] = inOneReply();
    const unfinished: Turn = (request) => {
      const { content } = first(request) as { content: { name?: string }[] };
      return { content: content.filter(({ name }) => name !== 'finish_design') };
    };
    const finishing: Turn = (request) => (request.body.speed === 'fast' ? 'rate-limited' : { content: [finish('Sage Nook')] });
    const { client, requests } = fakeClaude({ literal: [unfinished, finishing] });

    const { designs } = await generate(client, { brief: roomy, fast: true }).result;

    expect(designs.map(({ name, edits }) => [name, edits.length])).toEqual([['Sage Nook', 9]]);
    expect(requests.filter(({ direction }) => direction === 'literal').map(({ body }) => body.speed)).toEqual(['fast', 'fast', undefined]);
  });

  it('asks once to finish, though fast mode refuses the request that asks', async () => {
    const stops: Turn = () => ({ content: [{ type: 'text', text: 'Done.' }], stop_reason: 'end_turn' });
    const paint = use('toolu_paint', 'apply_finish', { target: { kind: 'wall', wall_id: 'wl_west' }, finish: { kind: 'paint', color: '#9caf88' } });
    const finishing: Turn = (request) => (request.body.speed === 'fast' ? 'rate-limited' : { content: [paint, finish('Sage Nook', 'toolu_f1'), finish('Sage Nook', 'toolu_f2')] });
    const { client, requests } = fakeClaude({ literal: [stops, finishing] });

    const { designs } = await generate(client, { fast: true }).result;

    expect(designs.map(({ name }) => name)).toEqual(['Sage Nook']);
    const standard = requests.find(({ direction, body }) => direction === 'literal' && !body.speed)!;
    expect(standard.body.messages.filter(({ content }) => content === 'Call finish_design now to finish this Design.')).toHaveLength(1);
  });

  it('returns the Designs that succeeded when a loop fails', async () => {
    const { client } = fakeClaude({ literal: decorate, bolder: [() => 'error'], budget: decorate });
    const { result, saved } = generate(client);

    const { designs, failures } = await result;

    expect(designs.map(({ name }) => name)).toEqual(['Sage Nook', 'Thrifty Corner']);
    expect(saved).toHaveLength(2);
    expect(failures).toEqual([{ direction: 'bolder', error: expect.stringContaining('Overloaded') }]);
  });

  it('fails a take that Claude finishes without making a change', async () => {
    const empty: Turn = () => ({ content: [finish('Bare Room', 'toolu_f1'), finish('Bare Room', 'toolu_f2')] });
    const { client } = fakeClaude({ literal: decorate, bolder: decorate, budget: [empty] });
    const { result, saved } = generate(client);

    const { designs, failures } = await result;

    expect(designs).toHaveLength(2);
    expect(saved).toHaveLength(2);
    expect(failures).toEqual([{ direction: 'budget', error: 'The AI made no changes' }]);
  });

  it('saves nothing of the takes once the Mover has left', async () => {
    const left = new AbortController();
    const { client } = fakeClaude({ literal: [() => 'hang'], bolder: [() => 'hang'], budget: [() => 'hang'] });
    const { result, saved } = generate(client, { signal: left.signal });
    setTimeout(() => left.abort(), 50);

    const { designs, failures } = await result;

    expect(designs).toEqual([]);
    expect(saved).toEqual([]);
    expect(failures.map(({ error }) => error)).toEqual(Array(3).fill('The Mover left before the Design was done'));
  });

  it('fails a loop that runs out of time before its first Edit', async () => {
    const { client } = fakeClaude({ literal: decorate, bolder: decorate, budget: [() => 'hang'] });

    const { designs, failures } = await generate(client, { loopTimeoutMs: 200 }).result;

    expect(designs).toHaveLength(2);
    expect(failures).toEqual([{ direction: 'budget', error: 'The AI took longer than 0.2 s' }]);
  });

  it('saves what a loop made when it runs out of time: a Design of its Edits so far, which says it was cut short', async () => {
    // The first reply decorates; the request after it never answers.
    const { client } = fakeClaude({ literal: decorate, bolder: decorate, budget: [decorate[0], () => 'hang'] });
    const { result, saved } = generate(client, { loopTimeoutMs: 300 });

    const { designs, failures } = await result;

    expect(failures).toEqual([]);
    const cut = designs.find(({ name }) => name === 'Unfinished budget take')!;
    expect(cut).toMatchObject({ origin: 'claude', brief, rationale: 'Out of time after 0.3 s: these are the 7 Edits the AI made until then.' });
    // The first reply's Edits: every call but the sofa's.
    expect(cut.edits.map(({ type }) => type)).toEqual(['finish', ...Array(5).fill('place'), 'recolor']);
    expect(saved).toContainEqual(cut);
  });

  it("counts only a take's own Edits when it is cut short: one that starts from the current Design and makes none fails", async () => {
    const current: Design = {
      version: 1, id: 'ds_current', scanId: 'test-room', name: 'Move-in', createdAt: '', updatedAt: '', origin: 'mover',
      edits: [{ id: 'ed_mover', at: '2026-10-18T12:00:00.000Z', by: 'mover', type: 'finish', target: { kind: 'wall', wallId: 'wl_east' }, finish: { kind: 'paint', color: '#c46a3a' } }],
    };
    // The literal take decorates, then hangs; the others stop at once, having made nothing.
    const { client } = fakeClaude({ literal: [decorate[0], () => 'hang'] });

    const { designs, failures } = await generate(client, { loopTimeoutMs: 300, current }).result;

    expect(designs.map(({ name, rationale, edits }) => [name, rationale, edits.length])).toEqual([
      ['Unfinished literal take', 'Out of time after 0.3 s: these are the 7 Edits the AI made until then.', 8],
    ]);
    expect(failures).toEqual([
      { direction: 'bolder', error: 'The AI stopped without finishing the Design' },
      { direction: 'budget', error: 'The AI stopped without finishing the Design' },
    ]);
  });

  it('saves what a loop made when Claude stops without finishing, or an error cuts it short', async () => {
    const stops: Turn = () => ({ content: [{ type: 'text', text: 'All set!' }], stop_reason: 'end_turn' });
    const { client } = fakeClaude({ literal: [decorate[0], stops, stops], bolder: [decorate[0], () => 'error'] });
    const events: GenerateEvent[] = [];

    const { designs, failures } = await generate(client, { onEvent: (event) => events.push(event) }).result;

    expect(designs.map(({ name, rationale, edits }) => [name, rationale, edits.length])).toEqual([
      ['Unfinished literal take', 'Stopped before finishing: these are the 7 Edits the AI made until then.', 7],
      ['Unfinished bolder take', 'Cut short by an error: these are the 7 Edits the AI made until then.', 7],
    ]);
    expect(failures.map(({ direction }) => direction)).toEqual(['budget']);
    expect(events.filter(({ type }) => type === 'design').map((event) => 'direction' in event && event.direction).toSorted()).toEqual(['bolder', 'literal']);
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
