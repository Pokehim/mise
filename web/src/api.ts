import type { FloorPlanDraft, PlanReading } from '@shared/floor-plan';
import type { Catalog, Design, RoomSetup, ScanManifest } from '@shared/types';
import type { MergeSummary } from '../../scripts/scan-merge';
import type { ImportEvent } from '../../server/app';
import type { GenerateRequest } from '../../server/generate-object/pipeline';
import type { Job } from '../../server/generate-object/routes';

async function request<T>(method: string, url: string, body?: unknown, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    method,
    ...(body !== undefined && { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  if (!res.ok) throw new Error(`${method} ${url}: ${res.status} ${await res.text()}`);
  return res.json();
}

/** A file in a Scan's folder, such as its mesh: scanFileUrl('dorm-v1', 'room.glb'). */
export const scanFileUrl = (scanId: string, file: string) => `/data/scans/${scanId}/${file}`;

export const listScans = () => request<ScanManifest[]>('GET', '/api/scans');
export const loadManifest = (scanId: string) => request<ScanManifest>('GET', scanFileUrl(scanId, 'manifest.json'));

/* Floor Plans (ADR-0011): a plan image becomes a Scan, read by Claude, and corrected in Room Setup. */
export type PlanUpload = PlanReading & { scanId: string };
/** Uploads a plan image to become a new Scan; answers once Claude has read it (or been skipped). */
export async function uploadFloorPlan(file: Blob, name: string): Promise<PlanUpload> {
  const form = new FormData();
  form.set('file', file, 'plan');
  form.set('name', name);
  const res = await fetch('/api/floor-plans', { method: 'POST', body: form });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `The server answered ${res.status}`);
  return body;
}
/* Import (on Home): a room's GLB, with its PLY if there is one, becomes a new Scan of the Mover's. */
export type ImportProgress = { type: 'upload'; fraction: number } | ImportEvent;
/**
 * Uploads a room's scan, reporting the upload and then each step the server streams; resolves to the
 * new Scan's id. It uses XMLHttpRequest, since fetch can't report how much of a request is sent.
 */
export function importScanFiles(
  { mesh, splat, name }: { mesh: File; splat?: File; name: string },
  onProgress: (event: ImportProgress) => void,
): Promise<string> {
  const form = new FormData();
  form.set('mesh', mesh, mesh.name);
  if (splat) form.set('splat', splat, splat.name);
  form.set('name', name);
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let read = 0;
    let last: ImportEvent | undefined;
    // Each whole line of the stream so far that hasn't been read yet is one ImportEvent.
    const readLines = () => {
      if (xhr.status !== 200) return;
      const end = xhr.responseText.lastIndexOf('\n') + 1;
      for (const line of xhr.responseText.slice(read, end).split('\n').filter(Boolean)) {
        last = JSON.parse(line);
        onProgress(last!);
      }
      read = end;
    };
    xhr.upload.onprogress = (event) => event.lengthComputable && onProgress({ type: 'upload', fraction: event.loaded / event.total });
    xhr.onprogress = readLines;
    xhr.onload = () => {
      if (xhr.status !== 200) {
        const { error } = (() => { try { return JSON.parse(xhr.responseText); } catch { return {}; } })();
        return reject(new Error(error ?? `The server answered ${xhr.status}`));
      }
      readLines();
      if (last?.type === 'done') resolve(last.scanId);
      else reject(new Error(last?.type === 'error' ? last.error : 'The import stopped before it finished'));
    };
    xhr.onerror = () => reject(new Error("Couldn't reach the API server"));
    xhr.open('POST', '/api/scans/import');
    xhr.send(form);
  });
}
export const readFloorPlanAgain =(scanId: string) => request<PlanUpload>('POST', `/api/floor-plans/${scanId}/read`);
export const loadFloorPlanDraft = ({ id, floorPlan }: ScanManifest) => request<FloorPlanDraft>('GET', scanFileUrl(id, floorPlan!.draft));
export const saveFloorPlanDraft = (scanId: string, draft: FloorPlanDraft) =>
  request<FloorPlanDraft>('PUT', `/api/floor-plans/${scanId}/draft`, draft);
export const saveManifest = (manifest: ScanManifest) =>
  request<ScanManifest>('PUT', `/api/scans/${manifest.id}/manifest`, manifest);
export const loadSetup = (scanId: string) => request<RoomSetup>('GET', scanFileUrl(scanId, 'setup.json'));
export const saveSetup = (setup: RoomSetup) => request<RoomSetup>('PUT', `/api/scans/${setup.scanId}/setup`, setup);
/** Saves a baked Patch image (spec §11.2) as patches/<name> in the Scan's folder; returns that path. */
export async function savePatchImage(scanId: string, name: string, png: Blob): Promise<string> {
  const res = await fetch(`/api/scans/${scanId}/files/${name}`, { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: png });
  if (!res.ok) throw new Error(`PUT ${name}: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { path: string }).path;
}
/** Rebuilds a Scan's room.glb from its Main Capture and its lined-up Fill Captures (ADR-0007). */
export const mergeScan = (scanId: string) => request<MergeSummary>('POST', `/api/scans/${scanId}/merge`);

// The Catalog with the parts built apart (posters, textiles and modeled objects, by scripts/posters-build.ts,
// textiles-build.ts and objects-build.ts) and the items text-to-3D made on this machine. That's a stretch feature, so
// failing to get them never stops a load.
export const loadCatalog = () => Promise.all([
  request<Catalog>('GET', '/data/catalog/catalog.json'),
  ...['posters', 'textiles', 'objects'].map((part) => request<Catalog>('GET', `/data/catalog/${part}.json`)),
  request<Catalog>('GET', '/api/catalog/generated').catch(() => ({ items: [] })),
]).then(([catalog, ...rest]) => ({ ...catalog, items: [...catalog.items, ...rest.flatMap(({ items }) => items)] }));
/** Starts generating a Catalog item for a search that found nothing (spec §13.3, Stretch). Poll the job with getJob. */
export const generateObject = (body: GenerateRequest) => request<{ jobId: string }>('POST', '/api/generate-object', body);
export const getJob = (jobId: string) => request<Job>('GET', `/api/jobs/${jobId}`);
/** Has the server write what a Scan's Designs read first to Claude's prompt cache (spec §13.1): how many tokens it holds. */
export const warmGenerate = (scanId: string) => request<{ cachedTokens: number }>('POST', '/api/generate/warm', { scanId });

/** A Scan's Designs. The demo is shared, so there each visitor sees the seeds and their own Designs, with their copy of a seed in its place. */
export async function listDesigns(scanId?: string) {
  const [designs, { demo, seeds }] = await Promise.all([
    request<Design[]>('GET', scanId ? `/api/designs?scanId=${encodeURIComponent(scanId)}` : '/api/designs'),
    loadConfig(),
  ]);
  if (!demo) return designs;
  const { ids, copies } = readMine();
  return designs.filter(({ id }) => ids.includes(id) || (seeds.includes(id) && !copies[id]));
}
export const loadDesign = (id: string) => request<Design>('GET', `/api/designs/${id}`);
/** A new empty Design of a Scan, or a copy of an existing Design. */
export async function createDesign(from: { scanId: string } | { duplicateOf: string }) {
  const design = await request<Design>('POST', '/api/designs', from);
  rememberDesigns([design.id]);
  return design;
}
/** Saves the whole Design. With { keepalive: true }, the save lands even if the page closes first. */
export const saveDesign = (design: Design, init?: Pick<RequestInit, 'keepalive'>) =>
  request<Design>('PUT', `/api/designs/${design.id}`, design, init);

/* ───────────── The public demo (#42) ───────────── */

/** What the server offers (GET /api/config). */
export interface ServerConfig { demo: boolean; seeds: string[]; generate: boolean; textTo3d: boolean }

let config: Promise<ServerConfig> | undefined;
/** The server's config, asked for once. A server that can't say is a local one, which offers everything. */
export const loadConfig = () =>
  (config ??= request<ServerConfig>('GET', '/api/config').catch(() => ({ demo: false, seeds: [], generate: true, textTo3d: true })));

/** The Designs this browser made, and its copy of each seed Design it opened. */
interface Mine { ids: string[]; copies: Record<string, string> }
const MINE = 'mise.demo.mine';

function readMine(): Mine {
  try {
    return { ids: [], copies: {}, ...JSON.parse(localStorage.getItem(MINE) ?? '{}') };
  } catch {
    return { ids: [], copies: {} };
  }
}

function writeMine(mine: Mine) {
  try {
    localStorage.setItem(MINE, JSON.stringify(mine));
  } catch {
    // Storage is off, as in some private windows: each visit then starts from fresh copies.
  }
}

/** Remembers Designs this browser made, such as Claude's for a Brief, so the demo's lists show them. */
export function rememberDesigns(ids: string[]) {
  const mine = readMine();
  writeMine({ ...mine, ids: [...new Set([...mine.ids, ...ids])] });
}

/** The Design a visitor edits when they open designId: in the demo, their own copy of a seed, made on first open. */
export async function editableDesignId(designId: string): Promise<string> {
  const { demo, seeds } = await loadConfig();
  if (!demo || !seeds.includes(designId)) return designId;
  const copy = readMine().copies[designId];
  if (copy && (await loadDesign(copy).then(() => true, () => false))) return copy;
  const made = await createDesign({ duplicateOf: designId });
  const mine = readMine();
  writeMine({ ...mine, copies: { ...mine.copies, [designId]: made.id } });
  return made.id;
}
