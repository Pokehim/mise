import { randomBytes } from 'node:crypto';
import { existsSync, globSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { serveStatic } from '@hono/node-server/serve-static';
import { type Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { HTTPException } from 'hono/http-exception';
import { MergeInputError, mergeScan } from '../scripts/scan-merge';
import { generateObjectRoutes } from './generate-object/routes';
import { budgetInText } from '../shared/generate';
import { newId } from '../shared/ids';
import type { Brief, Catalog, Design, LibraryMaterial, RoomSetup, ScanManifest } from '../shared/types';
import { anthropic, generateDesigns } from './generate/agent';
import { shelfLevels } from './generate/shelves';

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

/**
 * Every file in the data folder that matches the glob pattern, parsed. Files named "_*" aren't records, so they are
 * skipped; so is a file that doesn't parse, with a warning, so one bad file can't break the whole list.
 */
async function readAll<T>(pattern: string): Promise<T[]> {
  const files = globSync(pattern, { cwd: dataDir() }).filter((file) => !basename(file).startsWith('_'));
  const parsed = await Promise.all(files.map(async (file): Promise<T[]> => {
    try {
      return [JSON.parse(await readFile(join(dataDir(), file), 'utf8'))];
    } catch (error) {
      console.warn(`Skipping ${join(dataDir(), file)}: ${(error as Error).message}`);
      return [];
    }
  }));
  return parsed.flat();
}

/** Writes a temp file next to the target, then renames it over the target, so no one ever sees a half-written file. */
async function writeFileAtomic(file: string, data: string | Uint8Array) {
  // pid and random bytes keep two writes of one file apart. Listings match only *.json, so they never read a .part file.
  const part = `${file}.${process.pid}-${randomBytes(4).toString('hex')}.part`;
  try {
    await writeFile(part, data);
    await rename(part, file);
  } catch (error) {
    await rm(part, { force: true });
    throw error;
  }
}

/** The last write queued for each file, by absolute path. */
const writeQueues = new Map<string, Promise<void>>();

/** Runs task after every earlier task with the same key (a file path) has settled, whether it succeeded or failed. */
function serialize<T>(key: string, task: () => Promise<T>): Promise<T> {
  const path = resolve(key);
  const result = (writeQueues.get(path) ?? Promise.resolve()).then(task);
  // The queue moves on even when the task fails; the caller still gets the failure through result.
  const settled: Promise<void> = result.catch(() => {}).then(() => {
    if (writeQueues.get(path) === settled) writeQueues.delete(path);
  });
  writeQueues.set(path, settled);
  return result;
}

/** Every write to the data folder goes through here: one at a time per file, and never half-written. */
const saveFile = (file: string, data: string | Uint8Array) => serialize(file, () => writeFileAtomic(file, data));

const writeJson = (path: string, value: unknown) => saveFile(path, `${JSON.stringify(value, null, 2)}\n`);

/** The request body, which must be a JSON object: null, an array or a bare value would be saved as a broken file. */
async function readBody<T>(c: Context): Promise<T> {
  const body: unknown = await c.req.json().catch(() => fail(400, 'The body must be JSON'));
  if (typeof body !== 'object' || body === null || Array.isArray(body)) fail(400, 'The body must be a JSON object');
  return body as T;
}

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

// Phase 2 (spec §11.2): Room Setup's Bake step saves each baked Patch image here. A 512×512 PNG is far under the cap.
const MAX_PNG_BYTES = 2 * 1024 * 1024;
// Dot-separated words, so "og_sofa.floor.png" and "og_sofa.wl_2.png" pass, but ".." and any "/" can't.
const PNG_NAME = /^[\w-]+(\.[\w-]+)*\.png$/;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

app.put(
  '/api/scans/:id/files/:name',
  bodyLimit({ maxSize: MAX_PNG_BYTES, onError: (c) => c.json({ error: 'A Patch image can be at most 2 MB' }, 413) }),
  async (c) => {
    const dir = requireScan(c.req.param('id'));
    const name = c.req.param('name');
    if (!PNG_NAME.test(name)) fail(400, `Not a PNG file name: ${name}`);
    const png = Buffer.from(await c.req.arrayBuffer());
    if (!png.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) fail(400, 'The body must be a PNG');
    await mkdir(join(dir, 'patches'), { recursive: true });
    await saveFile(join(dir, 'patches', name), png);
    return c.json({ path: `patches/${name}` });
  },
);

// Phase 2 (ADR-0007): Room Setup's Fill Captures step saves the manifest, then rebuilds room.glb here.
app.post('/api/scans/:id/merge', async (c) => {
  const dir = requireScan(c.req.param('id'));
  // A Scan that isn't ready to merge is the caller's to fix (400); anything else is a server fault (500).
  return c.json(await mergeScan(dir).catch((error: Error) => (error instanceof MergeInputError ? fail(400, error.message) : Promise.reject(error))));
});

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

// Phase 4: Brief → 3 Designs (spec §13). Each Design is saved as soon as Claude finishes it; the
// response has every Design that was finished, and why the others weren't.
app.post('/api/generate', async (c) => {
  const { scanId, brief, fast } = await readBody<{ scanId?: string; brief?: Partial<Brief>; fast?: boolean }>(c);
  const { text, styles } = brief ?? {};
  if (!scanId || typeof text !== 'string' || !text.trim()) fail(400, 'Send {scanId, brief: {text, styles?, budgetUsd?}}');
  // A budget the Brief only names in its words ("under $400") is still its budget.
  const budgetUsd = brief?.budgetUsd ?? budgetInText(text);
  if (budgetUsd !== undefined && !(typeof budgetUsd === 'number' && budgetUsd > 0)) fail(400, 'budgetUsd must be a positive number');
  const scanDir = requireScan(scanId);
  const [setup, catalog, posters, materials] = await Promise.all([
    readJson<RoomSetup>(join(scanDir, 'setup.json')),
    readJson<Catalog>(join(dataDir(), 'catalog/catalog.json')),
    readJson<Catalog>(join(dataDir(), 'catalog/posters.json')),   // built apart, by scripts/posters-build.ts (#85)
    readJson<LibraryMaterial[]>(join(dataDir(), 'materials/materials.json')),
    mkdir(join(dataDir(), 'designs'), { recursive: true }),
  ]);
  if (!setup) fail(400, `Scan ${scanId} has no Room Setup yet`);
  const items: Catalog = { version: 1, items: [...(catalog?.items ?? []), ...(posters?.items ?? [])] };
  const result = await generateDesigns({
    client: anthropic(),
    scanId,
    setup,
    catalog: items,
    materials: materials ?? [],
    shelfLevels: await shelfLevels(items, dataDir()),
    brief: { text: text.trim(), ...(styles?.length && { styles }), ...(budgetUsd !== undefined && { budgetUsd }) },
    // Fast mode (spec §13.3) for this request, or for every request with GENERATE_FAST_MODE=1 in .env.
    fast: fast ?? process.env.GENERATE_FAST_MODE === '1',
    save: (design) => writeJson(designPath(design.id), design),
  });
  if (!result.designs.length) {
    return c.json({ error: `Claude made no Designs: ${result.failures.map(({ error }) => error).join('; ')}`, ...result }, 502);
  }
  return c.json(result);
});

// Stretch: text-to-3D for categories the Catalog lacks (spec §13.3).
app.route('/api', generateObjectRoutes(dataDir));
