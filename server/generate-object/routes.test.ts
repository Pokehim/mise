import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Document, getBounds } from '@gltf-transform/core';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { io } from '../../scripts/scan-import';
import { item } from '../../shared/test-room';
import type { CatalogItem } from '../../shared/types';
import { app } from '../app';
import type { Job } from './routes';

// fal is the only thing mocked: its answers point at data: URLs, so downloading and gltf-transform run for real.
const fal = vi.hoisted(() => ({ subscribe: vi.fn() }));
vi.mock('@fal-ai/client', () => ({ fal }));

let dataDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'mise-data-'));
  vi.stubEnv('DATA_DIR', dataDir);
  vi.stubEnv('FAL_KEY', 'test-key');
});

afterEach(async () => {
  vi.unstubAllEnvs();
  fal.subscribe.mockReset();
  await rm(dataDir, { recursive: true, force: true });
});

const dataUrl = (type: string, bytes: Uint8Array) => `data:${type};base64,${Buffer.from(bytes).toString('base64')}`;

/** A GLB of one box from `min` to `max`, standing anywhere, as TRELLIS.2's are. */
async function boxGlb(min: number[], max: number[]) {
  const doc = new Document();
  const corners = [0, 1, 2, 3, 4, 5, 6, 7].flatMap((i) => [i & 1 ? max[0] : min[0], i & 2 ? max[1] : min[1], i & 4 ? max[2] : min[2]]);
  const faces = [0, 1, 3, 0, 3, 2, 4, 6, 7, 4, 7, 5, 0, 4, 5, 0, 5, 1, 2, 3, 7, 2, 7, 6, 0, 2, 6, 0, 6, 4, 1, 5, 7, 1, 7, 3];
  const buffer = doc.createBuffer();
  const prim = doc.createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(corners)).setBuffer(buffer))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint16Array(faces)).setBuffer(buffer));
  doc.getRoot().setDefaultScene(doc.createScene().addChild(doc.createNode().setMesh(doc.createMesh().addPrimitive(prim))));
  return io.writeBinary(doc);
}

const photo = () => sharp({ create: { width: 64, height: 64, channels: 3, background: '#ffffff' } }).jpeg().toBuffer();

/** fal answering FLUX with a product photo and TRELLIS.2 with a 2 × 1 × 1 m box. */
async function falMakesABox() {
  const image = dataUrl('image/jpeg', await photo());
  const glb = dataUrl('model/gltf-binary', await boxGlb([3, 1, -1], [5, 2, 0]));
  fal.subscribe.mockImplementation(async (endpoint: string) => {
    if (endpoint === 'fal-ai/flux/schnell') return { data: { images: [{ url: image, width: 64, height: 64 }] }, requestId: 'flux' };
    if (endpoint === 'fal-ai/trellis-2') return { data: { model_glb: { url: glb } }, requestId: 'trellis' };
    throw new Error(`Unexpected endpoint ${endpoint}`);
  });
}

const post = (body: unknown, server = app) =>
  server.request('/api/generate-object', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

const getJson = async (path: string, server = app) => (await server.request(path)).json();

/** Starts a job and returns its id. */
const start = async (body: unknown) => (await (await post(body)).json()).jobId as string;

/** Polls a job until it stops running. */
async function finished(jobId: string): Promise<Job> {
  for (;;) {
    const job: Job = await getJson(`/api/jobs/${jobId}`);
    if (job.status !== 'running') return job;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** The item a finished job made. */
function itemOf(job: Job): CatalogItem {
  if (job.status !== 'done') throw new Error(`The job didn't finish: ${JSON.stringify(job)}`);
  return job.item;
}

// Jobs live as long as the server process, so each test asks for something different.
describe('POST /api/generate-object', () => {
  it('generates a Catalog item, scaled into the target box with its pivot at the bottom center', async () => {
    await falMakesABox();

    const res = await post({ query: 'aquarium', category: 'decor', targetSize: [1, 1, 1] });
    expect(res.status).toBe(200);
    const generated = itemOf(await finished((await res.json()).jobId));

    expect(generated).toMatchObject({
      source: 'generated', title: 'Aquarium', category: 'decor', mount: 'floor', size: [1, 0.5, 0.5], priceEstimateUsd: 25, url: '',
    });
    const model = await app.request(generated.model);
    expect(model.status).toBe(200);
    const { min, max } = getBounds((await io.readBinary(new Uint8Array(await model.arrayBuffer()))).getRoot().listScenes()[0]);
    [...min, ...max].forEach((value, i) => expect(value).toBeCloseTo([-0.5, 0, -0.25, 0.5, 0.5, 0.25][i], 2));
    expect((await app.request(generated.thumbnail)).status).toBe(200);
    expect((await getJson('/data/catalog/generated.json')).items).toEqual([generated]);
  }, 30_000);

  it("scales into the category's typical size from catalog.json when the Mover gave no size", async () => {
    await falMakesABox();
    await mkdir(join(dataDir, 'catalog'));
    await writeFile(join(dataDir, 'catalog/catalog.json'), JSON.stringify({ version: 1, items: [item('t', 'table', 'T', [1.2, 0.5, 0.6])] }));

    const generated = itemOf(await finished(await start({ query: 'coffee table with a fish tank', category: 'table' })));

    expect(generated.size).toEqual([1, 0.5, 0.5]);   // the 2 × 1 × 1 box, fit by its height
  }, 30_000);

  it('reports the step it is on while TRELLIS.2 runs', async () => {
    await falMakesABox();
    const makeBox = fal.subscribe.getMockImplementation()!;
    let finishModel = () => {};
    const modelDone = new Promise<void>((resolve) => { finishModel = resolve; });
    fal.subscribe.mockImplementation(async (endpoint: string, options: { onQueueUpdate?: (status: object) => void }) => {
      if (endpoint !== 'fal-ai/trellis-2') return makeBox(endpoint, options);
      options.onQueueUpdate?.({ status: 'IN_PROGRESS', logs: [] });
      await modelDone;
      return makeBox(endpoint, options);
    });
    const jobId = await start({ query: 'globe', category: 'decor', targetSize: [0.3, 0.4, 0.3] });

    await vi.waitFor(async () => expect(await getJson(`/api/jobs/${jobId}`)).toEqual({ status: 'running', step: 'model', progress: 0.15 }));
    finishModel();
    expect((await finished(jobId)).status).toBe('done');
  }, 30_000);

  it("fails the job, with fal's reason, when a fal call fails", async () => {
    fal.subscribe.mockRejectedValue(new Error('Unprocessable Entity'));

    const job = await finished(await start({ query: 'lava lamp', category: 'lamp' }));

    expect(job).toEqual({ status: 'failed', error: 'Unprocessable Entity' });
  });

  it('refuses a category that is not a Category', async () => {
    const res = await post({ query: 'aquarium', category: 'aquarium' });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Not a Category: aquarium' });
  });

  it('refuses before calling fal when FAL_KEY is not set', async () => {
    vi.stubEnv('FAL_KEY', '');

    const res = await post({ query: 'sea chest', category: 'storage' });

    expect(res.status).toBe(503);
    expect(fal.subscribe).not.toHaveBeenCalled();
  });
});

describe('the cache, by query', () => {
  it('joins the running job when the same query comes again, so fal is paid once', async () => {
    await falMakesABox();

    const first = await start({ query: 'Fish tank', category: 'decor', targetSize: [1, 1, 1] });
    const again = await start({ query: ' fish  tank', category: 'decor', targetSize: [1, 1, 1] });

    expect(again).toBe(first);
    expect((await finished(first)).status).toBe('done');
    expect(fal.subscribe).toHaveBeenCalledTimes(2);   // one photo, one model
  }, 30_000);

  it('reuses an item generated before the server restarted, without calling fal', async () => {
    await falMakesABox();
    const before = itemOf(await finished(await start({ query: 'bubble chair', category: 'chair', targetSize: [1, 1, 1] })));
    fal.subscribe.mockClear();
    vi.resetModules();
    const { app: restarted } = await import('../app');

    const { jobId } = await (await post({ query: 'Bubble chair', category: 'chair' }, restarted)).json();

    expect(await getJson(`/api/jobs/${jobId}`, restarted)).toEqual({ status: 'done', item: before });
    expect(fal.subscribe).not.toHaveBeenCalled();
  }, 30_000);
});
