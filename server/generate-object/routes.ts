import { createHash } from 'node:crypto';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { isCategory } from '../../scripts/catalog-build';
import type { CatalogItem, Vec3 } from '../../shared/types';
import { type GenerateRequest, generateObject, readGenerated, type Step } from './pipeline';

/** What GET /api/jobs/:id returns. progress is 0–1; a failed job keeps how far it got. */
export type Job =
  | { status: 'running'; step: Step; progress: number }
  | { status: 'done'; progress: 1; item: CatalogItem }
  | { status: 'failed'; progress: number; error: string };

/** A job as kept here: a running one keeps when its step began, for its progress. */
type Entry = { status: 'running'; step: Step; since: number } | Exclude<Job, { status: 'running' }>;

/** Each step's span of the progress bar, and its usual length: TRELLIS.2 is most of a run of about 30 s. */
const STEPS: Record<Step, { from: number; to: number; seconds: number }> = {
  photo: { from: 0, to: 0.05, seconds: 2 },
  queued: { from: 0.05, to: 0.15, seconds: 5 },
  model: { from: 0.15, to: 0.9, seconds: 25 },
  fitting: { from: 0.9, to: 1, seconds: 3 },
};

/** A job as GET returns it. A step's progress closes in on the next step's at its usual pace, so the bar keeps moving. */
function view(entry: Entry): Job {
  if (entry.status !== 'running') return entry;
  const { from, to, seconds } = STEPS[entry.step];
  const progress = from + (to - from) * (1 - Math.exp(-(Date.now() - entry.since) / (seconds * 1000)));
  return { status: 'running', step: entry.step, progress: Math.round(progress * 100) / 100 };
}

function fail(status: 400 | 404 | 503, message: string): never {
  throw new HTTPException(status, { message });
}

/** The request, checked: a query, a Category, and an optional [W, H, D] in meters. */
function parseRequest({ query, category, targetSize }: Record<string, unknown>): GenerateRequest {
  if (typeof query !== 'string' || !query.trim()) fail(400, 'Send a query, such as "aquarium"');
  if (typeof category !== 'string' || !isCategory(category)) fail(400, `Not a Category: ${category}`);
  const isSize = Array.isArray(targetSize) && targetSize.length === 3 && targetSize.every((v) => typeof v === 'number' && v > 0);
  if (targetSize !== undefined && !isSize) fail(400, 'targetSize must be [width, height, depth] in meters');
  return { query: query.trim().replace(/\s+/g, ' '), category, targetSize: targetSize as Vec3 | undefined };
}

/**
 * The id of a query, in any case, in a category, which sets its size: its job's, its item's and its cache key, so each is
 * generated, and paid for, once.
 */
const idFor = ({ query, category }: GenerateRequest) =>
  `gen_${createHash('sha256').update(`${category}:${query.toLowerCase()}`).digest('hex').slice(0, 8)}`;

/**
 * POST /generate-object { query, category, targetSize? } → { jobId }, then GET /jobs/:id → Job (spec §13.3, Stretch).
 * Jobs live in this process; finished items also live in generated.json, so they survive a restart.
 */
export function generateObjectRoutes(dataDir: () => string) {
  const jobs = new Map<string, Entry>();
  const setStep = (id: string, step: Step) => jobs.set(id, { status: 'running', step, since: Date.now() });

  return new Hono()
    .post('/generate-object', async (c) => {
      const request = parseRequest(await c.req.json().catch(() => ({})));
      const id = idFor(request);
      // Read before checking jobs, so nothing can start the same request in between.
      const saved = (await readGenerated(dataDir())).items.find((item) => item.id === id);
      const status = jobs.get(id)?.status;
      if (status === 'running' || status === 'done') return c.json({ jobId: id });
      if (saved) {
        jobs.set(id, { status: 'done', progress: 1, item: saved });
        return c.json({ jobId: id });
      }

      if (!process.env.FAL_KEY) fail(503, 'Text-to-3D needs FAL_KEY in .env');
      setStep(id, 'photo');
      generateObject(request, id, dataDir(), (step) => setStep(id, step)).then(
        (item) => jobs.set(id, { status: 'done', progress: 1, item }),
        (error: Error) => {
          console.error(`generate-object "${request.query}" failed:`, error);
          jobs.set(id, { status: 'failed', progress: view(jobs.get(id)!).progress, error: error.message });
        },
      );
      return c.json({ jobId: id });
    })
    .get('/jobs/:id', (c) => {
      const entry = jobs.get(c.req.param('id')) ?? fail(404, `No job ${c.req.param('id')}`);
      return c.json(view(entry));
    })
    // The editor merges these into the Catalog when it loads (web/src/api.ts).
    .get('/catalog/generated', async (c) => c.json(await readGenerated(dataDir())));
}
