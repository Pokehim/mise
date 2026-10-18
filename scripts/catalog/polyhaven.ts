// scripts/catalog/polyhaven.ts — Poly Haven models (CC0, https://polyhaven.com/license) for the Catalog.
//
// Poly Haven's glTF downloads are in meters, +Y up and +Z front (Blender's front, -Y, exported), with the textures
// as separate files. Some assets hold several variants side by side, such as anthurium_botany_01's four plants:
// a pick keeps one of them by its node name.

import { join } from 'node:path';
import { cachedFile, get } from './download';

/** The glTF resolution downloaded: its textures are 1K, as the Catalog's GLBs keep (catalog-build's --texture-size). */
const RESOLUTION = '1k';

interface PolyHavenFile { url: string; md5: string; size: number }
interface PolyHavenFiles { gltf?: Record<string, { gltf: PolyHavenFile & { include?: Record<string, PolyHavenFile> } }> }

/** The asset's page, the url of its Catalog item. */
export const polyHavenUrl = (asset: string) => `https://polyhaven.com/a/${asset}`;

/** The asset's .gltf, with the .bin and textures it names beside it, under scripts/.cache/polyhaven/<asset>/. */
export async function polyHavenGltf(asset: string): Promise<string> {
  const files = await (await get(`https://api.polyhaven.com/files/${asset}`)).json() as PolyHavenFiles;
  const gltf = files.gltf?.[RESOLUTION]?.gltf;
  if (!gltf) throw new Error(`Poly Haven ${asset} has no ${RESOLUTION} glTF`);
  const dir = join('polyhaven', asset);
  // `include` is keyed by each file's path relative to the .gltf, as its uris name them.
  await Promise.all(Object.entries(gltf.include ?? {}).map(([path, file]) => cachedFile(file.url, join(dir, path))));
  return cachedFile(gltf.url, join(dir, `${asset}.gltf`));
}
