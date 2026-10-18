import { createHash } from 'node:crypto';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { isCategory } from '../../scripts/catalog-build';
import type { CatalogItem, Vec3 } from '../../shared/types';
import { type GenerateRequest, generateObject, readGenerated, type Step } from './pipeline';

/** What GET /api/jobs/:id returns. */
export type Job =
  /** progress is 0–1, roughly: where the step starts in a usual run of about 30 s, most of it TRELLIS.2. */
  | { status: 'running'; step: Step; progress: number }
  | { status: 'done'; item: CatalogItem }
  | { status: 'failed'; error: string };

const PROGRESS: Record<Step, number> = { photo: 0, queued: 0.1, model: 0.15, fitting: 0.9 };

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

/** A query's id, in any case: its job's, its item's and its cache key, so each query is generated, and paid for, once. */
const idFor = (query: string) => `gen_${createHash('sha256').update(query.toLowerCase()).digest('hex').slice(0, 8)}`;

/**
 * POST /generate-object { query, category, targetSize? } → { jobId }, then GET /jobs/:id → Job (spec §13.3, Stretch).
 * Jobs live in this process; finished items also live in generated.json, so they survive a restart.
 */
export function generateObjectRoutes(dataDir: () => string) {
  const jobs = new Map<string, Job>();

  return new Hono()
    .post('/generate-object', async (c) => {
      const request = parseRequest(await c.req.json().catch(() => ({})));
      const id = idFor(request.query);
      // Read before checking jobs, so nothing can start the same query in between.
      const earlier = (await readGenerated(dataDir())).items.find((item) => item.id === id);
      const status = jobs.get(id)?.status;
      if (status === 'running' || status === 'done') return c.json({ jobId: id });
      if (earlier) {
        jobs.set(id, { status: 'done', item: earlier });
        return c.json({ jobId: id });
      }

      if (!process.env.FAL_KEY) fail(503, 'Text-to-3D needs FAL_KEY in .env');
      jobs.set(id, { status: 'running', step: 'photo', progress: 0 });
      generateObject(request, id, dataDir(), (step) => jobs.set(id, { status: 'running', step, progress: PROGRESS[step] })).then(
        (item) => jobs.set(id, { status: 'done', item }),
        (error: Error) => {
          console.error(`generate-object "${request.query}" failed:`, error);
          jobs.set(id, { status: 'failed', error: error.message });
        },
      );
      return c.json({ jobId: id });
    })
    .get('/jobs/:id', (c) => c.json(jobs.get(c.req.param('id')) ?? fail(404, `No job ${c.req.param('id')}`)));
}
