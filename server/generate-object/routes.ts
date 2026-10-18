import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { customAlphabet } from 'nanoid';
import { DEFAULT_PRICE_USD } from '../../scripts/catalog-build';
import type { CatalogItem, Category, Vec3 } from '../../shared/types';
import { type GenerateRequest, generateObject, readGenerated, type Step } from './pipeline';

/** What GET /api/jobs/:id returns. */
export interface Job {
  status: 'running' | 'done' | 'failed';
  /** While running: the step it's on. */
  step?: Step;
  /** 0–1, roughly: where each step starts in a usual run of about 30 s, most of it TRELLIS.2. */
  progress: number;
  /** Once done: the new Catalog item. */
  item?: CatalogItem;
  /** Once failed: why. */
  error?: string;
}

const PROGRESS: Record<Step, number> = { photo: 0, queued: 0.1, model: 0.15, fitting: 0.9 };

const suffix = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 8);

const fail = (status: 400 | 404 | 503, message: string): never => {
  throw new HTTPException(status, { message });
};

/** The request, checked: a query, a Category, and an optional [W, H, D] in meters. */
function parseRequest({ query, category, targetSize }: Record<string, unknown>): GenerateRequest {
  if (typeof query !== 'string' || !query.trim()) fail(400, 'Send a query, such as "aquarium"');
  if (typeof category !== 'string' || !Object.hasOwn(DEFAULT_PRICE_USD, category)) fail(400, `Not a Category: ${category}`);
  const isSize = Array.isArray(targetSize) && targetSize.length === 3 && targetSize.every((v) => typeof v === 'number' && v > 0);
  if (targetSize !== undefined && !isSize) fail(400, 'targetSize must be [width, height, depth] in meters');
  return { query: (query as string).trim().replace(/\s+/g, ' '), category: category as Category, targetSize: targetSize as Vec3 | undefined };
}

/**
 * POST /generate-object { query, category, targetSize? } → { jobId }, then GET /jobs/:id → Job (spec §13.3, Stretch).
 * Jobs live in this process only.
 */
export function generateObjectRoutes(dataDir: () => string) {
  const jobs = new Map<string, Job>();
  // The same query, in any case or spacing, reuses its job, running or done, so fal is paid once. A failed one is retried.
  const jobByQuery = new Map<string, string>();

  return new Hono()
    .post('/generate-object', async (c) => {
      const request = parseRequest(await c.req.json().catch(() => ({})));
      if (!process.env.FAL_KEY) fail(503, 'Text-to-3D needs FAL_KEY in .env');
      const query = request.query.toLowerCase();
      // Read before checking jobByQuery, so nothing can start the same query in between.
      const earlier = (await readGenerated(dataDir())).items.find((item) => item.title.toLowerCase() === query);
      const known = jobByQuery.get(query);
      if (known) return c.json({ jobId: known });
      if (earlier) {
        jobs.set(earlier.id, { status: 'done', progress: 1, item: earlier });
        jobByQuery.set(query, earlier.id);
        return c.json({ jobId: earlier.id });
      }

      const id = `gen_${suffix()}`;
      const setJob = (job: Job) => jobs.set(id, job);
      setJob({ status: 'running', step: 'photo', progress: 0 });
      jobByQuery.set(query, id);
      generateObject(request, id, dataDir(), (step) => setJob({ status: 'running', step, progress: PROGRESS[step] })).then(
        (item) => setJob({ status: 'done', progress: 1, item }),
        (error: Error) => {
          console.error(`generate-object "${request.query}" failed:`, error);
          setJob({ status: 'failed', progress: 0, error: error.message });
          jobByQuery.delete(query);
        },
      );
      return c.json({ jobId: id });
    })
    .get('/jobs/:id', (c) => c.json(jobs.get(c.req.param('id')) ?? fail(404, `No job ${c.req.param('id')}`)));
}
