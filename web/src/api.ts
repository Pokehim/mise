import type { Catalog, Design, RoomSetup, ScanManifest } from '@shared/types';
import type { MergeSummary } from '../../scripts/scan-merge';

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

export const loadCatalog = () => request<Catalog>('GET', '/data/catalog/catalog.json');

export const listDesigns = (scanId?: string) =>
  request<Design[]>('GET', scanId ? `/api/designs?scanId=${encodeURIComponent(scanId)}` : '/api/designs');
export const loadDesign = (id: string) => request<Design>('GET', `/api/designs/${id}`);
/** A new empty Design of a Scan, or a copy of an existing Design. */
export const createDesign = (from: { scanId: string } | { duplicateOf: string }) =>
  request<Design>('POST', '/api/designs', from);
/** Saves the whole Design. With { keepalive: true }, the save lands even if the page closes first. */
export const saveDesign = (design: Design, init?: Pick<RequestInit, 'keepalive'>) =>
  request<Design>('PUT', `/api/designs/${design.id}`, design, init);
