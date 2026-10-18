import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, globSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, relative, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { serveStatic } from '@hono/node-server/serve-static';
import { type Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { HTTPException } from 'hono/http-exception';
import { stream } from 'hono/streaming';
import { importScan, scanManifest } from '../scripts/scan-import';
import { MergeInputError, mergeScan } from '../scripts/scan-merge';
import { generateObjectRoutes } from './generate-object/routes';
import { budgetInText, type GenerateEvent } from '../shared/generate';
import { newId } from '../shared/ids';
import type { Brief, Catalog, Design, LibraryMaterial, RoomSetup, ScanManifest } from '../shared/types';
import { anthropic, generateDesigns, warmCache } from './generate/agent';
import { readFloorPlan } from './floor-plan/read';
import { draftScale, FloorPlanDraftSchema } from '../shared/floor-plan';
import sharp from 'sharp';
import { refineDesign } from './generate/refine';
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
  let start: Omit<Design, 'version' | 'id' | 'createdAt' | 'updatedAt'>;
  if (duplicateOf) {
    const { version, id, createdAt, updatedAt, ...source } = await readDesign(duplicateOf);
    // A visitor's copy of a demo seed stands in for the seed: all of it, so a Claude Design's copy still reveals and Refines.
    start = (await seedIds()).includes(duplicateOf)
      ? source
      : { scanId: source.scanId, name: `${source.name} (copy)`, edits: source.edits, origin: 'mover' };
  } else if (scanId) {
    requireScan(scanId);
    start = { scanId, name: 'New Design', edits: [], origin: 'mover' };
  } else {
    fail(400, 'Send {scanId} or {duplicateOf}');
  }
  const now = new Date().toISOString();
  const design: Design = { version: 1, id: newId('ds'), ...start, createdAt: now, updatedAt: now };
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
async function generateInputs(scanId: string, fast: unknown) {
  const scanDir = requireScan(scanId);
  // The posters, textiles and modeled objects are built apart, by scripts/posters-build.ts, textiles-build.ts and objects-build.ts.
  const [setup, materials, catalogs] = await Promise.all([
    readJson<RoomSetup>(join(scanDir, 'setup.json')),
    readJson<LibraryMaterial[]>(join(dataDir(), 'materials/materials.json')),
    Promise.all(['catalog', 'posters', 'textiles', 'objects'].map((part) => readJson<Catalog>(join(dataDir(), `catalog/${part}.json`)))),
    mkdir(designsDir(), { recursive: true }),
  ]);
  if (!setup) fail(400, `Scan ${scanId} has no Room Setup yet`);
  const items: Catalog = { version: 1, items: catalogs.flatMap((part) => part?.items ?? []) };
  return {
    client: anthropic(),
    setup,
    catalog: items,
    materials: materials ?? [],
    shelfLevels: await shelfLevels(items, dataDir()),
    // The Mover's pick in the Brief dialog: fast mode is quicker, and costs several times the standard.
    fast: fast === true,
  };
}

// Phase 4: Brief → 3 Designs (spec §13). Each Design is saved as soon as Claude finishes it. Asked for
// application/x-ndjson, it streams each step as one JSON line (GenerateEvent): every Edit as Claude makes
// it, every Design as it is finished or fails, then the result. Otherwise it answers once, with the result.
app.post('/api/generate', async (c) => {
  limitGenerate(c);
  const { scanId, brief, fromDesignId, fast } = await readBody<{ scanId?: string; brief?: Partial<Brief>; fromDesignId?: string; fast?: boolean }>(c);
  const { text, styles } = brief ?? {};
  if (!scanId || typeof text !== 'string' || !text.trim()) fail(400, 'Send {scanId, brief: {text, styles?, budgetUsd?}, fromDesignId?}');
  // A budget the Brief only names in its words ("under $400") is still its budget.
  const budgetUsd = brief?.budgetUsd ?? budgetInText(text);
  if (budgetUsd !== undefined && !(typeof budgetUsd === 'number' && budgetUsd > 0)) fail(400, 'budgetUsd must be a positive number');
  // The takes start from this Design, the one open in the editor, instead of the Scan as it is.
  const current = fromDesignId === undefined ? undefined : await readDesign(String(fromDesignId));
  if (current && current.scanId !== scanId) fail(400, `Design ${current.id} is of another Scan`);
  const request = {
    ...(await generateInputs(scanId, fast)),
    scanId,
    current,
    brief: { text: text.trim(), ...(styles?.length && { styles }), ...(budgetUsd !== undefined && { budgetUsd }) },
    save: (design: Design) => writeJson(designPath(design.id), design),
  };
  if (c.req.header('Accept')?.includes('application/x-ndjson')) {
    c.header('Content-Type', 'application/x-ndjson');
    return stream(c, async (out) => {
      // A Mover who leaves stops the takes, which would otherwise go on calling Claude for no one.
      const left = new AbortController();
      out.onAbort(() => left.abort());
      const send = (event: GenerateEvent) => out.write(`${JSON.stringify(event)}\n`);
      const result = await generateDesigns({ ...request, signal: left.signal, onEvent: (event) => void send(event) });
      await send({ type: 'done', result });
    });
  }
  const result = await generateDesigns(request);
  if (!result.designs.length) {
    return c.json({ error: `The AI made no Designs: ${result.failures.map(({ error }) => error).join('; ')}`, ...result }, 502);
  }
  return c.json(result);
});

// Phase 4: Refine (spec §13.1, step 7). One agent loop adjusts the Design to the Mover's words, appending
// Claude's Edits, and saves it. It answers with the Design and just the new Edits, which the editor animates.
app.post('/api/designs/:id/refine', async (c) => {
  limitGenerate(c);
  const id = c.req.param('id');
  const { text, fast } = await readBody<{ text?: string; fast?: boolean }>(c);
  if (typeof text !== 'string' || !text.trim()) fail(400, 'Send {text}');
  if ((await seedIds()).includes(id)) fail(403, 'This Design is read-only in the demo; refine a copy');
  const design = await readDesign(id);
  try {
    const result = await refineDesign({ ...(await generateInputs(design.scanId, fast)), design, text: text.trim() });
    await writeJson(designPath(id), result.design);
    return c.json(result);
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    // The editor says it was the Refine that failed.
    return c.json({ error: (error as Error).message }, 502);
  }
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
function newScanId(name: string, fallback = 'floor-plan') {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40).replace(/^-|-$/g, '') || fallback;
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

// Import, on Home: a room's GLB becomes a new Scan of the Mover's, as scripts/scan-import.ts makes one,
// for Room Setup to mark up. A PLY dropped with it becomes the Scan's splat: a Splat PLY as it is, a point
// cloud through scripts/pointcloud-splat.ts first, then scripts/splat.sh. The splat keeps its own frame
// (an identity splatTransform) until the AlignPanel lines it up. Each step streams as one JSON line as it starts.
const MAX_IMPORT_BYTES = 1024 ** 3;
const SCRIPTS = fileURLToPath(new URL('../scripts/', import.meta.url));
/** A Splat PLY's vertices are Gaussians; a point cloud's are only points and their colors. */
const SPLAT_PROPERTIES = ['scale_0', 'rot_0', 'opacity', 'f_dc_0'];

/** What an import does, in order: optimize the mesh, turn a point cloud into a Splat PLY, build splat.spz. */
export type ImportStep = 'mesh' | 'points' | 'splat';
export type ImportEvent =
  | { type: 'step'; step: ImportStep }     // the step has started
  | { type: 'done'; scanId: string }
  | { type: 'error'; error: string };

/** 'splat' or 'points', read from a PLY's header; undefined when the file isn't a PLY. */
async function plyKind(file: File): Promise<'splat' | 'points' | undefined> {
  const head = Buffer.from(await file.slice(0, 64 * 1024).arrayBuffer()).toString('latin1');
  const end = head.indexOf('end_header');
  if (!/^ply\r?\n/.test(head) || end < 0) return undefined;
  const properties = new Set(head.slice(0, end).split('\n')
    .map((line) => line.trim().split(/\s+/))
    .filter(([keyword]) => keyword === 'property')
    .map((words) => words.at(-1)));
  return SPLAT_PROPERTIES.every((name) => properties.has(name)) ? 'splat' : 'points';
}

/** Runs a script; a failure carries the last line of its errors. */
function run(command: string, args: string[]) {
  const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let lastError = '';
  createInterface({ input: child.stderr }).on('line', (line) => {
    if (line.trim()) lastError = line;
  });
  return new Promise<void>((done, failed) => {
    child.on('error', failed);
    child.on('close', (code) => (code === 0 ? done() : failed(new Error(lastError || `${basename(args[0])} exited with code ${code}`))));
  });
}

app.post(
  '/api/scans/import',
  bodyLimit({ maxSize: MAX_IMPORT_BYTES, onError: (c) => c.json({ error: 'A scan can be at most 1 GB' }, 413) }),
  async (c) => {
    if (process.env.MISE_DEMO === '1') fail(403, 'Importing scans is turned off in the demo');
    const body = await c.req.parseBody().catch(() => fail(400, 'Send the scan as a form: mesh, splat and name'));
    const { mesh, splat } = body;
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!(mesh instanceof File)) fail(400, splat instanceof File ? "A PLY needs its room's GLB: drop both." : 'Send the room\'s GLB in "mesh"');
    if (splat !== undefined && !(splat instanceof File)) fail(400, 'Send the PLY as a file in "splat"');
    if (!name) fail(400, 'Name the room in "name"');
    if (Buffer.from(await mesh.slice(0, 4).arrayBuffer()).toString('latin1') !== 'glTF') fail(400, `${mesh.name} isn't a GLB`);
    const kind = splat && ((await plyKind(splat)) ?? fail(400, `${splat.name} isn't a PLY`));

    const scansDir = resolve(dataDir(), 'scans');
    const scanId = newScanId(name, 'scan');
    // Made now, so a second import of the same name can't take the id; a folder without a manifest isn't listed yet.
    await mkdir(scansDir, { recursive: true });
    await mkdir(join(scansDir, scanId));
    c.header('Content-Type', 'application/x-ndjson');
    return stream(c, async (out) => {
      const send = (event: ImportEvent) => out.write(`${JSON.stringify(event)}\n`);
      const work = await mkdtemp(join(tmpdir(), 'mise-import-'));
      try {
        await send({ type: 'step', step: 'mesh' });
        await writeFile(join(work, 'room.glb'), mesh.stream());
        await importScan({ input: join(work, 'room.glb'), scanId, name, scansDir });
        const manifest: ScanManifest = { ...scanManifest(scanId, name), mine: true };
        if (splat) {
          let ply = join(work, 'splat.ply');
          await writeFile(ply, splat.stream());
          if (kind === 'points') {
            await send({ type: 'step', step: 'points' });
            const points = ply;
            ply = join(work, 'points-splat.ply');
            await run(process.execPath, ['--import', 'tsx', join(SCRIPTS, 'pointcloud-splat.ts'), points, ply]);
          }
          await send({ type: 'step', step: 'splat' });
          // splat.sh writes into the repo's data/scans/<--scan>/; a relative --scan reaches DATA_DIR's folder from there.
          await run('bash', [join(SCRIPTS, 'splat.sh'), ply, '--scan', relative(join(SCRIPTS, '../data/scans'), join(scansDir, scanId))]);
          Object.assign(manifest, { splat: 'splat.spz', splatTransform: { position: [0, 0, 0], rotationY: 0, scale: 1 } });
        }
        await writeJson(join(scansDir, scanId, 'manifest.json'), manifest);
        await send({ type: 'done', scanId });
      } catch (error) {
        // Nothing half-made stays behind, so dropping the files again starts over.
        await rm(join(scansDir, scanId), { recursive: true, force: true });
        await send({ type: 'error', error: (error as Error).message });
      } finally {
        await rm(work, { recursive: true, force: true });
      }
    });
  },
);

// Stretch: text-to-3D for categories the Catalog lacks (spec §13.3).
app.route('/api', generateObjectRoutes(dataDir));
