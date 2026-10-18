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

// The Catalog with its posters (built apart, by scripts/posters-build.ts) and the items text-to-3D made on this machine.
// That's a stretch feature, so failing to get them never stops a load.
export const loadCatalog = () => Promise.all([
  request<Catalog>('GET', '/data/catalog/catalog.json'),
  request<Catalog>('GET', '/data/catalog/posters.json'),
  request<Catalog>('GET', '/api/catalog/generated').catch(() => ({ items: [] })),
]).then(([catalog, posters, generated]) => ({ ...catalog, items: [...catalog.items, ...posters.items, ...generated.items] }));
/** Starts generating a Catalog item for a search that found nothing (spec §13.3, Stretch). Poll the job with getJob. */
export const generateObject = (body: GenerateRequest) => request<{ jobId: string }>('POST', '/api/generate-object', body);
export const getJob = (jobId: string) => request<Job>('GET', `/api/jobs/${jobId}`);
/** Has the server write what a Scan's Designs read first to Claude's prompt cache (spec §13.1): how many tokens it holds. */
export const warmGenerate = (scanId: string) => request<{ cachedTokens: number }>('POST', '/api/generate/warm', { scanId });

export const listDesigns = (scanId?: string) =>
  request<Design[]>('GET', scanId ? `/api/designs?scanId=${encodeURIComponent(scanId)}` : '/api/designs');
export const loadDesign = (id: string) => request<Design>('GET', `/api/designs/${id}`);
/** A new empty Design of a Scan, or a copy of an existing Design. */
export const createDesign = (from: { scanId: string } | { duplicateOf: string }) =>
  request<Design>('POST', '/api/designs', from);
/** Saves the whole Design. With { keepalive: true }, the save lands even if the page closes first. */
export const saveDesign = (design: Design, init?: Pick<RequestInit, 'keepalive'>) =>
  request<Design>('PUT', `/api/designs/${design.id}`, design, init);
