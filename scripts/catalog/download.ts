// scripts/catalog/download.ts — the downloads the Catalog builders share. Every file is fetched once into scripts/.cache/.

import { existsSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../..', import.meta.url));
export const CACHE = join(ROOT, 'scripts/.cache');

export async function get(url: string): Promise<Response> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url}: ${res.status} ${res.statusText}`);
  return res;
}

/** The local copy of `url` at `file` under scripts/.cache/, downloaded through a .part file the first time. */
export async function cachedFile(url: string, file: string): Promise<string> {
  const path = join(CACHE, file);
  if (existsSync(path)) return path;
  const data = Buffer.from(await (await get(url)).arrayBuffer());
  await mkdir(dirname(path), { recursive: true });
  await writeFile(`${path}.part`, data);
  await rename(`${path}.part`, path);
  return path;
}
