import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Document } from '@gltf-transform/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fixtureDesign from '../data/designs/ds_fixture1.json';
import fixtureSetup from '../data/scans/fixture/setup.json';
import { io } from '../scripts/scan-import';
import type { Design, ScanManifest } from '../shared/types';
import { app } from './app';

// The real writeFile, wrapped so one test can make a single write fail.
vi.mock('node:fs/promises', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs/promises')>();
  return { ...fs, writeFile: vi.fn(fs.writeFile) };
});

let dataDir: string;

// Each test gets its own copy of the fixture Scan and Design.
beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'mise-data-'));
  await cp(new URL('../data/scans/fixture', import.meta.url), join(dataDir, 'scans/fixture'), { recursive: true });
  await cp(new URL('../data/designs/ds_fixture1.json', import.meta.url), join(dataDir, 'designs/ds_fixture1.json'));
  vi.stubEnv('DATA_DIR', dataDir);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await rm(dataDir, { recursive: true, force: true });
});

const send = (method: string, path: string, body: unknown) =>
  app.request(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

const getJson = async (path: string) => (await app.request(path)).json();

const writeJson = async (path: string, value: unknown) => {
  await mkdir(dirname(join(dataDir, path)), { recursive: true });
  await writeFile(join(dataDir, path), JSON.stringify(value));
};

describe('GET /api/scans', () => {
  it('lists the manifest of every Scan', async () => {
    await writeJson('scans/dorm-v1/manifest.json', {
      version: 1, id: 'dorm-v1', name: 'Maple Hall 412', mesh: 'room.glb', meshTransform: { position: [0, 0, 0], rotationY: 0 },
    } satisfies ScanManifest);
    await mkdir(join(dataDir, 'scans/still-importing'));

    const res = await app.request('/api/scans');

    expect(res.status).toBe(200);
    const scans: ScanManifest[] = await res.json();
    expect(scans.map((scan) => [scan.id, scan.name]).sort()).toEqual([
      ['dorm-v1', 'Maple Hall 412'],
      ['fixture', 'Sample room (4 × 3 m)'],
    ]);
  });

  it('skips a Scan whose manifest.json is corrupt', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await mkdir(join(dataDir, 'scans/broken'));
    await writeFile(join(dataDir, 'scans/broken/manifest.json'), '{');

    const res = await app.request('/api/scans');

    expect(res.status).toBe(200);
    const scans: ScanManifest[] = await res.json();
    expect(scans.map((scan) => scan.id)).toEqual(['fixture']);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('scans/broken/manifest.json'));
  });
});

describe('PUT /api/scans/:id/setup', () => {
  it('saves setup.json, which /data then serves', async () => {
    const setup = { ...fixtureSetup, ceilingHeight: 2.4 };

    const res = await send('PUT', '/api/scans/fixture/setup', setup);

    expect(res.status).toBe(200);
    expect(await getJson('/data/scans/fixture/setup.json')).toEqual(setup);
  });

  it('404s for a Scan that does not exist', async () => {
    const res = await send('PUT', '/api/scans/no-such-scan/setup', fixtureSetup);
    expect(res.status).toBe(404);
  });

  it('400s for a body that is not JSON', async () => {
    const res = await app.request('/api/scans/fixture/setup', { method: 'PUT', body: '{ not json' });
    expect(res.status).toBe(400);
  });
});

describe('GET /data/*', () => {
  it('serves files from the data folder, uncached because saves change them', async () => {
    const res = await app.request('/data/designs/ds_fixture1.json');

    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-cache');
    expect(await res.json()).toEqual(fixtureDesign);
  });
});

describe('PUT /api/scans/:id/manifest', () => {
  it('saves manifest.json, which GET /api/scans then lists', async () => {
    const manifest: ScanManifest = {
      version: 1, id: 'fixture', name: 'Sample room (4 × 3 m)', mesh: 'room.glb',
      meshTransform: { position: [0, -0.02, 0], rotationY: 0.1 },
    };

    const res = await send('PUT', '/api/scans/fixture/manifest', manifest);

    expect(res.status).toBe(200);
    expect(await getJson('/api/scans')).toEqual([manifest]);
  });
});

describe('POST /api/scans/:id/merge', () => {
  it('rebuilds room.glb from the Main and Fill Captures, and answers with what it added', async () => {
    await cp(new URL('../data/scans/synthetic-lounge', import.meta.url), join(dataDir, 'scans/synthetic-lounge'), { recursive: true });

    const res = await app.request('/api/scans/synthetic-lounge/merge', { method: 'POST' });

    expect(res.status).toBe(200);
    const summary = await res.json();
    expect(summary.triangles).toBeGreaterThan(0);
    expect(Array.isArray(summary.patches)).toBe(true);
    expect((await app.request('/data/scans/synthetic-lounge/room.glb')).status).toBe(200);
  }, 60_000);

  it('400s for a Scan with no Fill Captures, and says why', async () => {
    const res = await app.request('/api/scans/fixture/merge', { method: 'POST' });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/has no Fill Captures/);
  });

  it('404s for a Scan that does not exist', async () => {
    expect((await app.request('/api/scans/nowhere/merge', { method: 'POST' })).status).toBe(404);
  });
});

describe('POST /api/scans/import', () => {
  /** A one-triangle room mesh, 2.5 m tall, as a GLB. */
  async function smallGlb() {
    const document = new Document();
    const buffer = document.createBuffer();
    const position = document.createAccessor().setType('VEC3').setBuffer(buffer)
      .setArray(new Float32Array([0, 0, 0, 3, 0, 0, 0, 2.5, 0]));
    const mesh = document.createMesh().addPrimitive(document.createPrimitive().setAttribute('POSITION', position));
    document.createScene().addChild(document.createNode().setMesh(mesh));
    return io.writeBinary(document);
  }

  /** A binary point cloud as Polycam exports it: x, y, z doubles and red, green, blue per point. */
  function pointCloud(points: [number, number, number][]) {
    const header = Buffer.from([
      'ply', 'format binary_little_endian 1.0', `element vertex ${points.length}`,
      ...['x', 'y', 'z'].map((axis) => `property double ${axis}`), ...['red', 'green', 'blue'].map((c) => `property uchar ${c}`),
      'end_header', '',
    ].join('\n'), 'latin1');
    const body = Buffer.alloc(points.length * 27);
    points.forEach(([x, y, z], i) => {
      [x, y, z].forEach((v, a) => body.writeDoubleLE(v, i * 27 + a * 8));
      body.set([200, 120, 40], i * 27 + 24);
    });
    return Buffer.concat([header, body]);
  }

  const importForm = (files: { mesh?: [Uint8Array, string]; splat?: [Uint8Array, string] }, name = 'Maple Hall 412') => {
    const form = new FormData();
    for (const [field, file] of Object.entries(files)) form.set(field, new Blob([file[0] as Uint8Array<ArrayBuffer>]), file[1]);
    form.set('name', name);
    return app.request('/api/scans/import', { method: 'POST', body: form });
  };
  const events = async (res: Response) => (await res.text()).trim().split('\n').map((line) => JSON.parse(line));
  const manifestOf = async (id: string): Promise<ScanManifest> => JSON.parse(await readFile(join(dataDir, 'scans', id, 'manifest.json'), 'utf8'));

  it('makes a GLB a new Scan of the Mover\'s, named after the room, and streams its steps', async () => {
    const res = await importForm({ mesh: [await smallGlb(), 'room.glb'] });

    expect(res.status).toBe(200);
    expect(await events(res)).toEqual([{ type: 'step', step: 'mesh' }, { type: 'done', scanId: 'maple-hall-412' }]);
    expect(await manifestOf('maple-hall-412')).toEqual({
      version: 1, id: 'maple-hall-412', name: 'Maple Hall 412', mesh: 'room.glb', meshTransform: { position: [0, 0, 0], rotationY: 0 }, mine: true,
    });
    expect(existsSync(join(dataDir, 'scans/maple-hall-412/room.glb'))).toBe(true);
  }, 30_000);

  it('adds "-2" when the name\'s id is taken', async () => {
    await events(await importForm({ mesh: [await smallGlb(), 'room.glb'] }));
    const res = await importForm({ mesh: [await smallGlb(), 'room.glb'] });
    expect((await events(res)).at(-1)).toEqual({ type: 'done', scanId: 'maple-hall-412-2' });
  }, 30_000);

  it('turns a point cloud dropped with the GLB into the Scan\'s splat, in its own frame', async () => {
    const points = Array.from({ length: 200 }, (_, i): [number, number, number] => [(i % 10) * 0.1, Math.floor(i / 10) * 0.1, 1]);

    const res = await importForm({ mesh: [await smallGlb(), 'room.glb'], splat: [pointCloud(points), 'room.ply'] });

    expect(await events(res)).toEqual([
      { type: 'step', step: 'mesh' }, { type: 'step', step: 'points' }, { type: 'step', step: 'splat' }, { type: 'done', scanId: 'maple-hall-412' },
    ]);
    expect(await manifestOf('maple-hall-412')).toMatchObject({
      mine: true, splat: 'splat.spz', splatTransform: { position: [0, 0, 0], rotationY: 0, scale: 1 },
    });
    expect(existsSync(join(dataDir, 'scans/maple-hall-412/splat.spz'))).toBe(true);
  }, 120_000);

  it('400s for a PLY alone, and says to drop both', async () => {
    const res = await importForm({ splat: [pointCloud([[0, 0, 0]]), 'room.ply'] });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "A PLY needs its room's GLB: drop both." });
  });

  it('400s for a mesh that isn\'t a GLB, or a splat that isn\'t a PLY, before making a Scan', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const notGlb = await importForm({ mesh: [png, 'plan.png'] });
    expect(notGlb.status).toBe(400);
    expect((await notGlb.json()).error).toBe("plan.png isn't a GLB");

    const notPly = await importForm({ mesh: [await smallGlb(), 'room.glb'], splat: [png, 'room.ply'] });
    expect(notPly.status).toBe(400);
    expect((await notPly.json()).error).toBe("room.ply isn't a PLY");
    expect(await readdir(join(dataDir, 'scans'))).toEqual(['fixture']);
  });

  it('400s without a name', async () => {
    const res = await importForm({ mesh: [await smallGlb(), 'room.glb'] }, ' ');
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Name the room/);
  });

  it('removes the Scan when a step fails, and streams why', async () => {
    const res = await importForm({ mesh: [Buffer.from('glTF but not really'), 'room.glb'] });

    const last = (await events(res)).at(-1);
    expect(last.type).toBe('error');
    expect(await readdir(join(dataDir, 'scans'))).toEqual(['fixture']);
  });
});

describe('PUT /api/scans/:id/files/:name', () => {
  const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const png = (extra = 8) => new Uint8Array([...PNG_SIGNATURE, ...new Array(extra).fill(7)]);
  const put = (path: string, body: BodyInit) => app.request(path, { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body });

  it('saves a PNG under the Scan’s patches folder and answers with its path', async () => {
    const res = await put('/api/scans/fixture/files/og_sofa.wl_2.png', png());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ path: 'patches/og_sofa.wl_2.png' });
    expect(new Uint8Array(await (await app.request('/data/scans/fixture/patches/og_sofa.wl_2.png')).arrayBuffer())).toEqual(png());
  });

  it('replaces the file when it is baked again', async () => {
    await put('/api/scans/fixture/files/og_sofa.floor.png', png(4));
    await put('/api/scans/fixture/files/og_sofa.floor.png', png(12));

    const saved = new Uint8Array(await (await app.request('/data/scans/fixture/patches/og_sofa.floor.png')).arrayBuffer());
    expect(saved).toEqual(png(12));
  });

  it.each(['..%2Fsetup.png', '%2e%2e%2f%2e%2e%2fmanifest.png', 'a%2Fb.png', 'a..png', '.png', 'floor.jpg', 'floor.png.exe', 'floor', 'sofa.floor.PNG'])(
    '400s for the name %s, so nothing is written outside patches/',
    async (name) => {
      const res = await put(`/api/scans/fixture/files/${name}`, png());
      expect(res.status).toBe(400);
      expect(existsSync(join(dataDir, 'scans/fixture/patches'))).toBe(false);
      expect(existsSync(join(dataDir, 'scans/setup.png'))).toBe(false);
    },
  );

  it('400s for a body that is not a PNG', async () => {
    const res = await put('/api/scans/fixture/files/og_sofa.floor.png', '<script>alert(1)</script>');
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/must be a PNG/);
    expect(existsSync(join(dataDir, 'scans/fixture/patches'))).toBe(false);
  });

  it('413s for a body over 2 MB', async () => {
    const res = await put('/api/scans/fixture/files/og_sofa.floor.png', new Uint8Array([...PNG_SIGNATURE, ...new Array(2 * 1024 * 1024).fill(0)]));
    expect(res.status).toBe(413);
    expect(existsSync(join(dataDir, 'scans/fixture/patches'))).toBe(false);
  });

  it('404s for a Scan that does not exist', async () => {
    expect((await put('/api/scans/nowhere/files/og_sofa.floor.png', png())).status).toBe(404);
  });

  it('400s for a Scan id that is not a plain id', async () => {
    expect((await put('/api/scans/..%2Ffixture/files/og_sofa.floor.png', png())).status).toBe(400);
  });
});

describe('GET /api/designs', () => {
  beforeEach(async () => {
    await writeJson('designs/ds_dorm0001.json', {
      ...fixtureDesign, id: 'ds_dorm0001', scanId: 'dorm-v1', createdAt: '2026-10-17T20:00:00.000Z',
    });
  });

  it('lists every Design, oldest first', async () => {
    const res = await app.request('/api/designs');

    expect(res.status).toBe(200);
    const designs: Design[] = await res.json();
    expect(designs.map((design) => design.id)).toEqual(['ds_dorm0001', 'ds_fixture1']);
  });

  it('lists only the Designs of the Scan given as scanId', async () => {
    const designs: Design[] = await getJson('/api/designs?scanId=fixture');
    expect(designs.map((design) => design.id)).toEqual(['ds_fixture1']);
  });

  it('skips a corrupt file and a file starting with _', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await writeFile(join(dataDir, 'designs/ds_broken1.json'), '{');
    // Like #42's planned list of seed Design ids: valid JSON, but not a Design.
    await writeJson('designs/_seed.json', ['ds_fixture1']);

    const res = await app.request('/api/designs');

    expect(res.status).toBe(200);
    const designs: Design[] = await res.json();
    expect(designs.map((design) => design.id)).toEqual(['ds_dorm0001', 'ds_fixture1']);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('designs/ds_broken1.json'));
  });
});

describe('GET /api/designs/:id', () => {
  it('returns one Design', async () => {
    const res = await app.request('/api/designs/ds_fixture1');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(fixtureDesign);
  });

  it('404s for a Design that does not exist', async () => {
    expect((await app.request('/api/designs/ds_missing1')).status).toBe(404);
  });
});

describe('POST /api/designs', () => {
  it('creates an empty Design for a Scan, with a new id', async () => {
    const res = await send('POST', '/api/designs', { scanId: 'fixture' });

    expect(res.status).toBe(201);
    const created: Design = await res.json();
    expect(created.id).toMatch(/^ds_[a-z0-9]{8}$/);
    expect(created).toMatchObject({ version: 1, scanId: 'fixture', name: 'New Design', origin: 'mover', edits: [] });
    expect(await getJson(`/api/designs/${created.id}`)).toEqual(created);
  });

  it('404s for a Scan that does not exist', async () => {
    expect((await send('POST', '/api/designs', { scanId: 'no-such-scan' })).status).toBe(404);
  });

  it('duplicates a Design: a new id with the same Edits, leaving the source Design unchanged', async () => {
    const res = await send('POST', '/api/designs', { duplicateOf: 'ds_fixture1' });

    expect(res.status).toBe(201);
    const copy: Design = await res.json();
    expect(copy.id).toMatch(/^ds_[a-z0-9]{8}$/);
    expect(copy).toMatchObject({ scanId: 'fixture', name: 'Sample Design (copy)', edits: fixtureDesign.edits });
    expect(await getJson(`/api/designs/${copy.id}`)).toEqual(copy);
    expect(await getJson('/api/designs/ds_fixture1')).toEqual(fixtureDesign);
  });

  it("copies only the Edits of Claude's Design: the copy is the Mover's", async () => {
    await writeJson('designs/ds_claude01.json', {
      ...fixtureDesign, id: 'ds_claude01', origin: 'claude', brief: { text: 'cozy Japandi' }, rationale: 'Warm woods',
    });

    const copy: Design = await (await send('POST', '/api/designs', { duplicateOf: 'ds_claude01' })).json();

    expect(copy).toMatchObject({ origin: 'mover', edits: fixtureDesign.edits });
    expect(copy).not.toHaveProperty('brief');
    expect(copy).not.toHaveProperty('rationale');
  });

  it('404s for a Design to duplicate that does not exist', async () => {
    expect((await send('POST', '/api/designs', { duplicateOf: 'ds_missing1' })).status).toBe(404);
  });

  it('400s without a scanId or duplicateOf', async () => {
    expect((await send('POST', '/api/designs', {})).status).toBe(400);
  });
});

describe('PUT /api/designs/:id', () => {
  afterEach(() => vi.useRealTimers());

  it('saves the whole Design and stamps updatedAt', async () => {
    vi.setSystemTime(new Date('2026-10-18T09:00:00.000Z'));
    const edited = { ...fixtureDesign, name: 'Sage and walnut', edits: fixtureDesign.edits.slice(0, 2) };

    const res = await send('PUT', '/api/designs/ds_fixture1', edited);

    expect(res.status).toBe(200);
    const saved: Design = await res.json();
    expect(saved).toEqual({ ...edited, updatedAt: '2026-10-18T09:00:00.000Z' });
    expect(await getJson('/api/designs/ds_fixture1')).toEqual(saved);
  });

  it('400s when the body is a different Design', async () => {
    const res = await send('PUT', '/api/designs/ds_fixture1', { ...fixtureDesign, id: 'ds_other001' });
    expect(res.status).toBe(400);
  });
});

describe('saves', () => {
  /** Every file in the data folder, with its contents. */
  const snapshot = async () => {
    const files = (await readdir(dataDir, { recursive: true, withFileTypes: true })).filter((entry) => entry.isFile());
    return Object.fromEntries(await Promise.all(files.map(async (entry) => {
      const path = join(entry.parentPath, entry.name);
      return [path, await readFile(path, 'utf8')];
    })));
  };

  it('concurrent PUTs of one Design never corrupt it', async () => {
    // Bodies of different lengths: a shorter write over a longer one leaves the longer one's tail.
    const withEdits = (count: number) => ({
      ...fixtureDesign,
      edits: Array.from({ length: count }, (_, i) => ({ ...fixtureDesign.edits[i % fixtureDesign.edits.length], id: `ed_${i + 1}` })),
    });

    for (let round = 0; round < 50; round++) {
      await Promise.all([send('PUT', '/api/designs/ds_fixture1', withEdits(40)), send('PUT', '/api/designs/ds_fixture1', withEdits(30))]);

      const res = await app.request('/api/designs/ds_fixture1');
      expect(res.status).toBe(200);
      const saved: Design = await res.json();
      expect([40, 30]).toContain(saved.edits.length);
    }
  });

  it('PUT /api/scans/:id/setup, PUT /api/scans/:id/manifest, PUT /api/designs/:id and POST /api/designs answer 400 for a null body, and write nothing', async () => {
    const before = await snapshot();

    for (const [method, path] of [
      ['PUT', '/api/scans/fixture/setup'], ['PUT', '/api/scans/fixture/manifest'], ['PUT', '/api/designs/ds_fixture1'], ['POST', '/api/designs'],
    ]) {
      const res = await send(method, path, null);
      expect(res.status, `${method} ${path}`).toBe(400);
      expect(await res.json()).toEqual({ error: 'The body must be a JSON object' });
    }

    expect(await snapshot()).toEqual(before);
  });

  it('a failed write leaves the old file and no .part file', async () => {
    const fs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    // The disk fills partway through the temp file.
    vi.mocked(writeFile).mockImplementationOnce(async (file, data) => {
      await fs.writeFile(file, String(data).slice(0, 100));
      throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' });
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await send('PUT', '/api/designs/ds_fixture1', { ...fixtureDesign, name: 'Never saved' });

    expect(res.status).toBe(500);
    expect(await getJson('/api/designs/ds_fixture1')).toEqual(fixtureDesign);
    expect(await readdir(join(dataDir, 'designs'))).toEqual(['ds_fixture1.json']);
  });
});

describe('ids', () => {
  it('400s for a Design id in the path that could reach outside the data folder', async () => {
    const res = await send('PUT', '/api/designs/..%2F..%2Fescaped', { ...fixtureDesign, id: '../../escaped' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Not a valid id: ../../escaped' });
  });

  it('400s for an id in the body that could reach outside the data folder', async () => {
    expect((await send('POST', '/api/designs', { duplicateOf: '../designs/ds_fixture1' })).status).toBe(400);
  });
});

describe('the public demo (MISE_DEMO=1, #42)', () => {
  let designsDir: string;

  // As npm start leaves it: the shipped Designs copied into DESIGNS_DIR, and listed as its seeds.
  beforeEach(async () => {
    designsDir = join(dataDir, 'saved-designs');
    await cp(join(dataDir, 'designs'), designsDir, { recursive: true });
    await writeFile(join(designsDir, '_seed.json'), JSON.stringify(['ds_fixture1']));
    vi.stubEnv('DESIGNS_DIR', designsDir);
    vi.stubEnv('MISE_DEMO', '1');
  });

  it('says it is the demo, and which Designs are its seeds', async () => {
    expect(await getJson('/api/config')).toMatchObject({ demo: true, seeds: ['ds_fixture1'] });
  });

  it('refuses to change a seed, but a copy of it keeps its name and saves', async () => {
    expect((await send('PUT', '/api/designs/ds_fixture1', fixtureDesign)).status).toBe(403);

    const res = await send('POST', '/api/designs', { duplicateOf: 'ds_fixture1' });
    const copy: Design = await res.json();
    expect(copy.name).toBe(fixtureDesign.name);
    expect((await send('PUT', `/api/designs/${copy.id}`, { ...copy, name: 'Mine' })).status).toBe(200);
    expect(existsSync(join(designsDir, `${copy.id}.json`))).toBe(true);
  });

  it('turns Room Setup off but still lists the Scans', async () => {
    expect((await send('PUT', '/api/scans/fixture/setup', fixtureSetup)).status).toBe(403);
    expect((await app.request('/api/scans')).status).toBe(200);
  });

  it('allows one visitor 5 Briefs a minute', async () => {
    const brief = () => app.request('/api/generate', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.5:54321' }, body: '{}' });
    // Each counts, even though its body is refused.
    for (let n = 0; n < 5; n++) expect((await brief()).status).toBe(400);
    expect((await brief()).status).toBe(429);
  });
});

describe('outside the demo', () => {
  it('has no seeds, so every Design can be changed', async () => {
    expect(await getJson('/api/config')).toMatchObject({ demo: false, seeds: [] });
    expect((await send('PUT', '/api/designs/ds_fixture1', fixtureDesign)).status).toBe(200);
  });
});
