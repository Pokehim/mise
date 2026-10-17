import { existsSync, globSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { serveStatic } from '@hono/node-server/serve-static';
import { type Context, Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { newId } from '../shared/ids';
import type { Design, ScanManifest } from '../shared/types';

// Read per request, so tests can point DATA_DIR at a temporary folder.
const dataDir = () => process.env.DATA_DIR ?? './data';

/** Ends the request with an error status; app.onError sends it as { error }. */
function fail(status: 400 | 404, message: string): never {
  throw new HTTPException(status, { message });
}

/** Parsed JSON, or undefined when the file doesn't exist. */
async function readJson<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

/** Every file in the data folder that matches the glob pattern, parsed. */
const readAll = <T>(pattern: string): Promise<T[]> =>
  Promise.all(globSync(pattern, { cwd: dataDir() }).map(async (file) => JSON.parse(await readFile(join(dataDir(), file), 'utf8'))));

async function writeJson(path: string, value: unknown) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

const readBody = <T>(c: Context) => c.req.json<T>().catch(() => fail(400, 'The body must be JSON'));

// Ids become file and folder names, so they may only use letters, digits, "_" and "-".
const checkId = (id: string) => (/^[\w-]+$/.test(id) ? id : fail(400, `Not a valid id: ${id}`));

/** The folder of a Scan, which must exist. */
function requireScan(id: string) {
  const dir = join(dataDir(), 'scans', checkId(id));
  return existsSync(dir) ? dir : fail(404, `No Scan ${id}`);
}

const designPath = (id: string) => join(dataDir(), 'designs', `${checkId(id)}.json`);
const readDesign = async (id: string) => (await readJson<Design>(designPath(id))) ?? fail(404, `No Design ${id}`);

export const app = new Hono();

app.onError((err, c) => {
  if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
  console.error(err);
  return c.json({ error: 'Internal server error' }, 500);
});

app.use(
  '/data/*',
  // Saves change these files, so browsers must check back instead of reusing a cached copy.
  async (c, next) => {
    c.header('Cache-Control', 'no-cache');
    await next();
  },
  serveStatic({ rewriteRequestPath: (path) => join(dataDir(), path.slice('/data'.length)) }),
);

app.get('/api/scans', async (c) => c.json(await readAll<ScanManifest>('scans/*/manifest.json')));

/** Saves the request body as one JSON file in an existing Scan's folder. */
const saveScanFile = (file: string) => async (c: Context) => {
  const body = await readBody(c);
  await writeJson(join(requireScan(c.req.param('id')!), file), body);
  return c.json(body);
};

app.put('/api/scans/:id/setup', saveScanFile('setup.json'));
app.put('/api/scans/:id/manifest', saveScanFile('manifest.json'));

app.get('/api/designs', async (c) => {
  const scanId = c.req.query('scanId');
  const designs = await readAll<Design>('designs/*.json');
  return c.json(designs
    .filter((design) => !scanId || design.scanId === scanId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
});

app.get('/api/designs/:id', async (c) => c.json(await readDesign(c.req.param('id'))));

// New and Duplicate are the Mover's: a duplicate copies only the Edits (spec §10.8).
app.post('/api/designs', async (c) => {
  const { scanId, duplicateOf } = await readBody<{ scanId?: string; duplicateOf?: string }>(c);
  let start: Pick<Design, 'scanId' | 'name' | 'edits'>;
  if (duplicateOf) {
    const source = await readDesign(duplicateOf);
    start = { scanId: source.scanId, name: `${source.name} (copy)`, edits: source.edits };
  } else if (scanId) {
    requireScan(scanId);
    start = { scanId, name: 'New Design', edits: [] };
  } else {
    fail(400, 'Send {scanId} or {duplicateOf}');
  }
  const now = new Date().toISOString();
  const design: Design = { version: 1, id: newId('ds'), ...start, createdAt: now, updatedAt: now, origin: 'mover' };
  await writeJson(designPath(design.id), design);
  return c.json(design, 201);
});

app.put('/api/designs/:id', async (c) => {
  const id = c.req.param('id');
  const design = await readBody<Design>(c);
  if (design.id !== id) fail(400, `The body is Design ${design.id}, not ${id}`);
  const saved = { ...design, updatedAt: new Date().toISOString() };
  await writeJson(designPath(id), saved);
  return c.json(saved);
});

// Phase 4: Brief → 3 Designs (spec §13).
app.post('/api/generate', (c) => c.json({ error: 'Generate is not built yet (Phase 4)' }, 501));
