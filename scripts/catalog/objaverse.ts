// scripts/catalog/objaverse.ts — Sketchfab models for the Catalog, through the Objaverse dataset (Deitke et al., CVPR 2023),
// which mirrors them as GLBs on Hugging Face with Sketchfab's own uid, name, author and license. Only CC BY 4.0 and CC0
// models are picked; a CC BY model is credited to its author on Sketchfab wherever it is shown.
//
// A model's scale and which way is up are whatever its author chose, so a pick gives the size it really is and, when it
// lies on its side, the turn about X that stands it up.

import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { cachedFile } from './download';

const OBJAVERSE = 'https://huggingface.co/datasets/allenai/objaverse/resolve/main';

/** The model's page on Sketchfab, the url of its Catalog item. */
export const sketchfabUrl = (uid: string) => `https://sketchfab.com/3d-models/${uid}`;

let paths: Promise<Record<string, string>> | undefined;

/** The model's GLB, downloaded once into scripts/.cache/objaverse/. */
export async function objaverseGlb(uid: string): Promise<string> {
  // object-paths.json.gz maps each uid to its GLB's path in the dataset, such as "glbs/000-023/<uid>.glb".
  paths ??= cachedFile(`${OBJAVERSE}/object-paths.json.gz`, 'objaverse/object-paths.json.gz')
    .then(async (file) => JSON.parse(gunzipSync(await readFile(file)).toString('utf8')));
  const path = (await paths)[uid];
  if (!path) throw new Error(`Objaverse has no model ${uid}`);
  return cachedFile(`${OBJAVERSE}/${path}`, `objaverse/${path}`);
}
