import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyDraft, type FloorPlanDraft } from '../../shared/floor-plan';
import type { ScanManifest } from '../../shared/types';
import { app } from '../app';
import { cleanDraft, readFloorPlan } from './read';

// Claude faked at the HTTP boundary: a real SDK client whose fetch answers with one scripted message.
let replies: { text?: string; stop_reason?: string }[] = [];
let requests: Anthropic.Beta.MessageCreateParams[] = [];
const fakeClient = () => new Anthropic({
  apiKey: 'test-key', maxRetries: 0,
  fetch: async (_url: unknown, init?: RequestInit) => {
    requests.push(JSON.parse(init!.body as string));
    const { text = '{}', stop_reason = 'end_turn' } = replies.shift() ?? {};
    return Response.json({
      id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text }],
      stop_reason, stop_sequence: null, usage: { input_tokens: 1000, output_tokens: 500 },
    });
  },
});
vi.mock('../generate/agent', async (importOriginal) => ({ ...(await importOriginal<typeof import('../generate/agent')>()), anthropic: () => fakeClient() }));

/** A plan Claude reads as one 4 × 3 m room, at 100 px to the meter, with its width printed. */
const reading: FloorPlanDraft = {
  rooms: [{
    label: 'Bedroom',
    corners: [{ x: 100, y: 100 }, { x: 500, y: 100 }, { x: 500, y: 400 }, { x: 100, y: 400 }],
    openings: [{ kind: 'door', from: { x: 200, y: 400 }, to: { x: 290, y: 400 }, swing: 'in-right' }],
  }],
  scaleHints: [{ text: "13'-1 1/2\"", meters: 4, from: { x: 100, y: 60 }, to: { x: 500, y: 60 } }],
  ceilingHeight: null,
  notes: '',
};
const planPng = () => sharp({ create: { width: 600, height: 500, channels: 3, background: '#ffffff' } }).png().toBuffer();

describe('cleanDraft', () => {
  it('drops what is off the image, rooms of fewer than 3 corners, and an unlikely ceiling', () => {
    const offImage = { kind: 'window' as const, from: { x: 650, y: 100 }, to: { x: 700, y: 100 }, swing: null };
    const messy: FloorPlanDraft = {
      ...reading,
      rooms: [
        { ...reading.rooms[0], openings: [...reading.rooms[0].openings, offImage] },
        { label: 'Sliver', corners: [{ x: 1, y: 1 }, { x: 2, y: 2 }], openings: [] },
      ],
      scaleHints: [...reading.scaleHints, { text: 'x', meters: 1, from: { x: 0, y: 0 }, to: { x: 9000, y: 0 } }],
      ceilingHeight: 40,
    };
    const clean = cleanDraft(messy, { width: 600, height: 500 });
    expect(clean.rooms).toHaveLength(1);
    expect(clean.rooms[0].openings).toHaveLength(1);
    expect(clean.scaleHints).toHaveLength(1);
    expect(clean.ceilingHeight).toBeNull();
  });
});

describe('readFloorPlan', () => {
  beforeEach(() => {
    replies = [];
    requests = [];
  });

  it('asks Claude Opus 5.5 for the draft as structured output, with the image, and its size in the request', async () => {
    replies = [{ text: JSON.stringify(reading) }];
    const result = await readFloorPlan(fakeClient(), await planPng(), { width: 600, height: 500 });
    expect(result).toMatchObject({ read: 'ok', draft: reading });
    const [request] = requests as (Anthropic.Beta.MessageCreateParams & { fallbacks?: unknown; output_config?: { effort?: string; format?: { type: string } } })[];
    expect(request.model).toBe('claude-opus-5-5');
    expect(request.output_config).toMatchObject({ effort: 'high', format: { type: 'json_schema' } });
    expect(request.fallbacks).toBe('default');
    const [image, text] = request.messages[0].content as { type: string; text?: string }[];
    expect(image.type).toBe('image');
    expect(text.text).toContain('600 × 500 pixels');
  });

  it('fails softly, to an empty draft, when Claude declines or is cut off', async () => {
    replies = [{ text: '', stop_reason: 'refusal' }, { text: '{"rooms": [', stop_reason: 'max_tokens' }];
    for (const error of ['declined', 'cut off']) {
      const result = await readFloorPlan(fakeClient(), await planPng(), { width: 600, height: 500 });
      expect(result).toMatchObject({ read: 'failed', draft: emptyDraft() });
      expect(result.error).toContain(error);
    }
  });

  it("skips Claude with no client, so the Mover traces the plan", async () => {
    expect(await readFloorPlan(null, await planPng(), { width: 600, height: 500 })).toEqual({ draft: emptyDraft(), read: 'skipped', seconds: 0 });
    expect(requests).toEqual([]);
  });
});

describe('POST /api/floor-plans', () => {
  let dataDir: string;
  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'mise-floor-plan-'));
    vi.stubEnv('DATA_DIR', dataDir);
    replies = [];
    requests = [];
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(dataDir, { recursive: true, force: true });
  });

  const upload = async (name: string, file?: Blob) => {
    const form = new FormData();
    form.set('name', name);
    form.set('file', file ?? new Blob([new Uint8Array(await planPng())], { type: 'image/png' }), 'plan.png');
    return app.request('/api/floor-plans', { method: 'POST', body: form });
  };

  it("makes a Floor Plan Scan from the plan and Claude's reading, scaled by its printed dimension", async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
    replies = [{ text: JSON.stringify(reading) }];
    const res = await upload('Maple Hall 412');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ scanId: 'maple-hall-412', read: 'ok', draft: reading });
    const dir = join(dataDir, 'scans/maple-hall-412');
    const manifest: ScanManifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
    expect(manifest.floorPlan).toEqual({ image: 'plan/floor-plan.png', draft: 'plan/draft.json', metersPerPixel: 0.01 });
    expect(JSON.parse(await readFile(join(dir, 'plan/draft.json'), 'utf8'))).toEqual(reading);
    expect(await sharp(join(dir, 'plan/floor-plan.png')).metadata()).toMatchObject({ format: 'png', width: 600, height: 500 });
  });

  it('starts from an empty draft with no API key, and gives a taken name a new id', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    await upload('Room');
    const res = await upload('Room');
    expect(await res.json()).toMatchObject({ scanId: 'room-2', read: 'skipped', draft: emptyDraft() });
    expect(requests).toEqual([]);
    const manifest: ScanManifest = JSON.parse(await readFile(join(dataDir, 'scans/room-2/manifest.json'), 'utf8'));
    expect(manifest.floorPlan!.metersPerPixel).toBe(0);
  });

  it('turns away a file that is not an image, a missing name, and the public demo', async () => {
    expect((await upload('Room', new Blob(['%PDF-1.7'], { type: 'application/pdf' }))).status).toBe(400);
    expect((await upload('  ')).status).toBe(400);
    vi.stubEnv('MISE_DEMO', '1');
    expect((await upload('Room')).status).toBe(403);
  });

  it("saves the Mover's corrected draft, and turns away one that isn't a draft", async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    await upload('Room');
    const put = (body: unknown) => app.request('/api/floor-plans/room/draft', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    expect((await put(reading)).status).toBe(200);
    expect(JSON.parse(await readFile(join(dataDir, 'scans/room/plan/draft.json'), 'utf8'))).toEqual(reading);
    expect((await put({ rooms: 'none' })).status).toBe(400);
  });

  it('reads the plan again, replacing its draft only when the reading works', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    await upload('Room');
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
    replies = [{ text: '', stop_reason: 'refusal' }, { text: JSON.stringify(reading) }];
    const again = async () => (await app.request('/api/floor-plans/room/read', { method: 'POST' })).json();
    expect(await again()).toMatchObject({ read: 'failed' });
    const draftFile = join(dataDir, 'scans/room/plan/draft.json');
    expect(JSON.parse(await readFile(draftFile, 'utf8'))).toEqual(emptyDraft());
    expect(await again()).toMatchObject({ read: 'ok' });
    expect(JSON.parse(await readFile(draftFile, 'utf8'))).toEqual(reading);
  });
});
