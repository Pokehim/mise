import { randomBytes } from 'node:crypto';
import { existsSync, globSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { serveStatic } from '@hono/node-server/serve-static';
import { type Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { HTTPException } from 'hono/http-exception';
import { stream } from 'hono/streaming';
import { MergeInputError, mergeScan } from '../scripts/scan-merge';
import { generateObjectRoutes } from './generate-object/routes';
import { budgetInText, type GenerateEvent } from '../shared/generate';
import { newId } from '../shared/ids';
import type { Brief, Catalog, Design, LibraryMaterial, RoomSetup, ScanManifest } from '../shared/types';
import { anthropic, generateDesigns, warmCache } from './generate/agent';
import { readFloorPlan } from './floor-plan/read';
import { draftScale, FloorPlanDraftSchema } from '../shared/floor-plan';
import sharp from 'sharp';
import { shelfLevels } from './generate/shelves';

// Read per request, so tests can point DATA_DIR at a temporary folder.
const dataDir = () => process.env.DATA_DIR ?? './data';
// The public demo (#42) keeps Designs apart from the deployed data, on storage that outlives a redeploy.
const designsDir = () => process.env.DESIGNS_DIR ?? join(dataDir(), 'designs');
const inDemo = () => process.env.MISE_DEMO === '1';

/** Ends the request with an error status; app.onError sends it as { error }. */
function fail(status: 400 | 403 | 404 | 429, message: string): never {
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
async function readAll<T>(pattern: string, dir = dataDir()): Promise<T[]> {
  const files = globSync(pattern, { cwd: dir }).filter((file) => !basename(file).startsWith('_'));
  const parsed = await Promise.all(files.map(async (file): Promise<T[]> => {
    try {
      return [JSON.parse(await readFile(join(dir, file), 'utf8'))];
    } catch (error) {
      console.warn(`Skipping ${join(dir, file)}: ${(error as Error).message}`);
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

const designPath = (id: string) => join(designsDir(), `${checkId(id)}.json`);

/** The demo's seed Designs, listed in _seed.json (#42). They are read-only there, so each visitor edits a copy. */
const seedIds = async () => (inDemo() ? (await readJson<string[]>(join(designsDir(), '_seed.json'))) ?? [] : []);
const readDesign = async (id: string) => (await readJson<Design>(designPath(id))) ?? fail(404, `No Design ${id}`);

export const app = new Hono();

app.onError((err, c) => {
  if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
  console.error(err);
  return c.json({ error: 'Internal server error' }, 500);
});

app.use(
  '/data/*',
  // Saves change these files, so browsers must check back instead of reusing a cached copy. The demo
  // saves none of them, so there they keep for an hour.
  async (c, next) => {
    c.header('Cache-Control', inDemo() ? 'public, max-age=3600' : 'no-cache');
    await next();
  },
  serveStatic({ rewriteRequestPath: (path) => join(dataDir(), path.slice('/data'.length)) }),
);

/** What this server offers, so the web app can hide what it can't do (#42). */
app.get('/api/config', async (c) => c.json({
  demo: inDemo(),
  seeds: await seedIds(),
  generate: !!process.env.ANTHROPIC_API_KEY,
  textTo3d: !!process.env.FAL_KEY,
}));

app.get('/api/scans', async (c) => c.json(await readAll<ScanManifest>('scans/*/manifest.json')));

// Room Setup changes a Scan for every visitor, so the public demo doesn't allow it.
app.use('/api/scans/*', async (c, next) => {
  if (inDemo() && c.req.method !== 'GET') fail(403, 'Room Setup is turned off in the demo');
  await next();
});

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
  const designs = await readAll<Design>('*.json', designsDir());
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
    // A visitor's copy of a demo seed stands in for the seed, so it keeps the seed's name.
    const name = (await seedIds()).includes(duplicateOf) ? source.name : `${source.name} (copy)`;
    start = { scanId: source.scanId, name, edits: source.edits };
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
  if ((await seedIds()).includes(id)) fail(403, 'This Design is read-only in the demo; edit a copy');
  const saved = { ...design, updatedAt: new Date().toISOString() };
  await writeJson(designPath(id), saved);
  return c.json(saved);
});

// Generate spends API credit, so the public demo allows 5 a minute from one visitor and 200 a day in all (#42).
const GENERATE_PER_MINUTE = 5;
const GENERATE_PER_DAY = 200;
const generateTimes = new Map<string, number[]>();
let generateDay = { day: '', count: 0 };

/** The visitor's IP, from Azure's X-Forwarded-For ("203.0.113.5:54321" or "[2001:db8::1]:54321"). */
function visitor(c: Context) {
  const first = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? '';
  if (first.startsWith('[')) return first.slice(1, first.indexOf(']'));
  return first.split(':').length === 2 ? first.split(':')[0] : first || 'local';
}

/** Counts one Generate request in the demo, or refuses it when the visitor or the day is over its limit. */
function limitGenerate(c: Context) {
  if (!inDemo()) return;
  const now = Date.now();
  const day = new Date(now).toISOString().slice(0, 10);
  if (generateDay.day !== day) generateDay = { day, count: 0 };
  if (generateDay.count >= GENERATE_PER_DAY) fail(429, 'Generate has reached its limit for today. Try again tomorrow');
  const ip = visitor(c);
  const recent = (generateTimes.get(ip) ?? []).filter((time) => now - time < 60_000);
  if (recent.length >= GENERATE_PER_MINUTE) fail(429, 'Too many Briefs at once. Wait a minute and try again');
  generateTimes.set(ip, [...recent, now]);
  generateDay.count++;
}

/** What generating Designs for a Scan reads: its Room Setup, the Catalog, the Material Library and the shelf levels. */
async function generateInputs(scanId: string, fast: boolean | undefined) {
  const scanDir = requireScan(scanId);
  const [setup, catalog, posters, materials] = await Promise.all([
    readJson<RoomSetup>(join(scanDir, 'setup.json')),
    readJson<Catalog>(join(dataDir(), 'catalog/catalog.json')),
    readJson<Catalog>(join(dataDir(), 'catalog/posters.json')),   // built apart, by scripts/posters-build.ts (#85)
    readJson<LibraryMaterial[]>(join(dataDir(), 'materials/materials.json')),
    mkdir(designsDir(), { recursive: true }),
  ]);
  if (!setup) fail(400, `Scan ${scanId} has no Room Setup yet`);
  const items: Catalog = { version: 1, items: [...(catalog?.items ?? []), ...(posters?.items ?? [])] };
  return {
    client: anthropic(),
    setup,
    catalog: items,
    materials: materials ?? [],
    shelfLevels: await shelfLevels(items, dataDir()),
    // Fast mode (spec §13.3) unless GENERATE_FAST_MODE=0 in .env: with Designs made in one reply, it costs about
    // what the earlier multi-turn Designs did at standard speed, and takes a third of the time.
    fast: fast ?? process.env.GENERATE_FAST_MODE !== '0',
  };
}

// Phase 4: Brief → 3 Designs (spec §13). Each Design is saved as soon as Claude finishes it. Asked for
// application/x-ndjson, it streams each step as one JSON line (GenerateEvent): every Edit as Claude makes
// it, every Design as it is finished or fails, then the result. Otherwise it answers once, with the result.
app.post('/api/generate', async (c) => {
  limitGenerate(c);
  const { scanId, brief, fast } = await readBody<{ scanId?: string; brief?: Partial<Brief>; fast?: boolean }>(c);
  const { text, styles } = brief ?? {};
  if (!scanId || typeof text !== 'string' || !text.trim()) fail(400, 'Send {scanId, brief: {text, styles?, budgetUsd?}}');
  // A budget the Brief only names in its words ("under $400") is still its budget.
  const budgetUsd = brief?.budgetUsd ?? budgetInText(text);
  if (budgetUsd !== undefined && !(typeof budgetUsd === 'number' && budgetUsd > 0)) fail(400, 'budgetUsd must be a positive number');
  const request = {
    ...(await generateInputs(scanId, fast)),
    scanId,
    brief: { text: text.trim(), ...(styles?.length && { styles }), ...(budgetUsd !== undefined && { budgetUsd }) },
    save: (design: Design) => writeJson(designPath(design.id), design),
  };
  if (c.req.header('Accept')?.includes('application/x-ndjson')) {
    c.header('Content-Type', 'application/x-ndjson');
    return stream(c, async (out) => {
      const send = (event: GenerateEvent) => out.write(`${JSON.stringify(event)}\n`);
      const result = await generateDesigns({ ...request, onEvent: (event) => void send(event) });
      await send({ type: 'done', result });
    });
  }
  const result = await generateDesigns(request);
  if (!result.designs.length) {
    return c.json({ error: `Claude made no Designs: ${result.failures.map(({ error }) => error).join('; ')}`, ...result }, 502);
  }
  return c.json(result);
});

// Writes what generating Designs for this Scan reads first to Claude's prompt cache, so that they start
// sooner. The Brief dialog asks for it when the Mover starts writing a Brief.
app.post('/api/generate/warm', async (c) => {
  const { scanId, fast } = await readBody<{ scanId?: string; fast?: boolean }>(c);
  if (!scanId) fail(400, 'Send {scanId}');
  const usage = await warmCache(await generateInputs(scanId, fast));
  return c.json({ cachedTokens: (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) });
});

// ADR-0011: a Floor Plan becomes a new Scan. The plan is stored as a PNG at most MAX_PLAN_SIDE
// across, the most Claude reads at full detail, so the draft's pixels are this image's, and Claude
// reads it. With no API key, the draft is empty and the Mover traces the plan in Room Setup.
const MAX_PLAN_BYTES = 20 * 1024 * 1024;
const MAX_PLAN_SIDE = 2576;
const PLAN_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
/** Floor Plans create Scans and call Claude, which the public demo doesn't allow (#42). */
const refuseInDemo = () => process.env.MISE_DEMO === '1' && fail(403, 'Floor Plans are turned off in the demo');
/** Claude reads plans when the server has an API key; otherwise Room Setup starts from an empty draft. */
const planReader = () => (process.env.ANTHROPIC_API_KEY ? anthropic() : null);

/** A Scan id from a name, "Maple Hall 412" → "maple-hall-412", with "-2", "-3"… if it's taken. */
function newScanId(name: string) {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'floor-plan';
  let id = base;
  for (let n = 2; existsSync(join(dataDir(), 'scans', id)); n++) id = `${base}-${n}`;
  return id;
}

app.post(
  '/api/floor-plans',
  bodyLimit({ maxSize: MAX_PLAN_BYTES, onError: (c) => c.json({ error: 'A floor plan can be at most 20 MB' }, 413) }),
  async (c) => {
    refuseInDemo();
    const body = await c.req.parseBody().catch(() => fail(400, 'Send the plan as a form: file and name'));
    const { file } = body;
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!(file instanceof File) || !PLAN_TYPES.includes(file.type)) fail(400, 'Send the plan as a PNG, JPEG or WebP image in "file"');
    if (!name) fail(400, 'Name the room in "name"');
    const { data: png, info } = await sharp(Buffer.from(await file.arrayBuffer()))
      .rotate()
      .resize({ width: MAX_PLAN_SIDE, height: MAX_PLAN_SIDE, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .png()
      .toBuffer({ resolveWithObject: true })
      .catch(() => fail(400, "That file isn't an image we can read"));
    const id = newScanId(name);
    const dir = join(dataDir(), 'scans', id);
    await mkdir(join(dir, 'plan'), { recursive: true });
    await saveFile(join(dir, 'plan/floor-plan.png'), png);
    const reading = await readFloorPlan(planReader(), png, info);
    await writeJson(join(dir, 'plan/draft.json'), reading.draft);
    const manifest: ScanManifest = {
      version: 1, id, name, mesh: 'room.glb', meshTransform: { position: [0, 0, 0], rotationY: 0 }, mine: true,
      // 0 until a printed dimension, or the Mover, gives the plan its scale.
      floorPlan: { image: 'plan/floor-plan.png', draft: 'plan/draft.json', metersPerPixel: draftScale(reading.draft, reading.draft.rooms[0]) ?? 0 },
    };
    await writeJson(join(dir, 'manifest.json'), manifest);
    return c.json({ scanId: id, ...reading });
  },
);

// Reads a Floor Plan Scan's plan again ("Read again" in Room Setup), replacing its draft when the reading works.
app.post('/api/floor-plans/:id/read', async (c) => {
  refuseInDemo();
  const dir = requireScan(c.req.param('id'));
  const manifest = await readJson<ScanManifest>(join(dir, 'manifest.json'));
  if (!manifest?.floorPlan) fail(400, `Scan ${manifest?.id ?? c.req.param('id')} isn't from a floor plan`);
  const png = await readFile(join(dir, manifest.floorPlan.image));
  const { width = 0, height = 0 } = await sharp(png).metadata();
  const reading = await readFloorPlan(planReader(), png, { width, height });
  if (reading.read === 'ok') {
    await writeJson(join(dir, manifest.floorPlan.draft), reading.draft);
    const metersPerPixel = draftScale(reading.draft, reading.draft.rooms[0]) ?? manifest.floorPlan.metersPerPixel;
    await writeJson(join(dir, 'manifest.json'), { ...manifest, floorPlan: { ...manifest.floorPlan, metersPerPixel } });
  }
  return c.json({ scanId: manifest.id, ...reading });
});

// Room Setup saves the Mover's corrections to a Floor Plan's draft, so the plan reopens as they left it.
app.put('/api/floor-plans/:id/draft', async (c) => {
  refuseInDemo();
  const dir = requireScan(c.req.param('id'));
  const manifest = await readJson<ScanManifest>(join(dir, 'manifest.json'));
  if (!manifest?.floorPlan) fail(400, `Scan ${c.req.param('id')} isn't from a floor plan`);
  const checked = FloorPlanDraftSchema.safeParse(await readBody(c));
  if (!checked.success) fail(400, `Not a floor plan draft: ${checked.error.issues[0]?.message}`);
  await writeJson(join(dir, manifest.floorPlan.draft), checked.data);
  return c.json(checked.data);
});

// Stretch: text-to-3D for categories the Catalog lacks (spec §13.3).
app.route('/api', generateObjectRoutes(dataDir));
