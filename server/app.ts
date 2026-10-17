import { existsSync } from 'node:fs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { serveStatic } from '@hono/node-server/serve-static';
import { type Context, Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { newId } from '../shared/ids';
import type { Design, ScanManifest } from '../shared/types';

// Read per request, so tests can point DATA_DIR at a temporary folder.
const dataDir = () => process.env.DATA_DIR ?? './data';

/** Parsed JSON, or undefined when the file doesn't exist. */
async function readJson<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

async function writeJson(path: string, value: unknown) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

/** Names of the entries in a data subfolder, or [] when it doesn't exist yet. */
async function list(dir: string, keep: (entry: { name: string; isDirectory(): boolean }) => boolean) {
  const entries = await readdir(join(dataDir(), dir), { withFileTypes: true }).catch(() => []);
  return entries.filter(keep).map((entry) => entry.name);
}

// Ids become file and folder names, so they may only use letters, digits, "_" and "-".
function checkId(id: string) {
  if (!/^[\w-]+$/.test(id)) throw new HTTPException(400, { message: `Not a valid id: ${id}` });
  return id;
}
const scanDir = (id: string) => join(dataDir(), 'scans', checkId(id));
const designPath = (id: string) => join(dataDir(), 'designs', `${checkId(id)}.json`);

async function listDesigns() {
  const files = await list('designs', (entry) => entry.name.endsWith('.json'));
  const designs = await Promise.all(files.map((file) => readJson<Design>(join(dataDir(), 'designs', file))));
  return designs
    .filter((design) => design !== undefined)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export const app = new Hono();

app.use('/data/*', (c, next) =>
  serveStatic({ root: dataDir(), rewriteRequestPath: (path) => path.slice('/data'.length) })(c, next),
);

app.get('/api/scans', async (c) => {
  const ids = await list('scans', (entry) => entry.isDirectory());
  const manifests = await Promise.all(ids.map((id) => readJson<ScanManifest>(join(dataDir(), 'scans', id, 'manifest.json'))));
  return c.json(manifests.filter((manifest) => manifest !== undefined));
});

/** Saves the request body as one JSON file in an existing Scan's folder. */
const saveScanFile = (file: string) => async (c: Context) => {
  const dir = scanDir(c.req.param('id')!);
  if (!existsSync(dir)) return c.json({ error: 'No such Scan' }, 404);
  const body = await c.req.json();
  await writeJson(join(dir, file), body);
  return c.json(body);
};

app.put('/api/scans/:id/setup', saveScanFile('setup.json'));
app.put('/api/scans/:id/manifest', saveScanFile('manifest.json'));

app.get('/api/designs', async (c) => {
  const scanId = c.req.query('scanId');
  const designs = await listDesigns();
  return c.json(scanId ? designs.filter((design) => design.scanId === scanId) : designs);
});

app.get('/api/designs/:id', async (c) => {
  const design = await readJson<Design>(designPath(c.req.param('id')));
  return design ? c.json(design) : c.json({ error: 'No such Design' }, 404);
});

app.post('/api/designs', async (c) => {
  const { scanId, duplicateOf } = await c.req.json<{ scanId?: string; duplicateOf?: string }>();
  const now = new Date().toISOString();
  let design: Design;
  if (duplicateOf) {
    const source = await readJson<Design>(designPath(duplicateOf));
    if (!source) return c.json({ error: 'No such Design' }, 404);
    design = { ...source, id: newId('ds'), name: `${source.name} (copy)`, createdAt: now, updatedAt: now };
  } else if (scanId) {
    if (!existsSync(scanDir(scanId))) return c.json({ error: 'No such Scan' }, 404);
    design = {
      version: 1, id: newId('ds'), scanId, name: 'New Design', createdAt: now, updatedAt: now, origin: 'mover', edits: [],
    };
  } else {
    return c.json({ error: 'Send {scanId} or {duplicateOf}' }, 400);
  }
  await writeJson(designPath(design.id), design);
  return c.json(design, 201);
});

app.put('/api/designs/:id', async (c) => {
  const id = c.req.param('id');
  const design = await c.req.json<Design>();
  if (design.id !== id) return c.json({ error: `The body is Design ${design.id}, not ${id}` }, 400);
  const saved = { ...design, updatedAt: new Date().toISOString() };
  await writeJson(designPath(id), saved);
  return c.json(saved);
});

// Phase 4: Brief → 3 Designs (spec §13).
app.post('/api/generate', (c) => c.json({ error: 'Generate is not built yet (Phase 4)' }, 501));
