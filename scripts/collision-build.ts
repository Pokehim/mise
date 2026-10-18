// scripts/collision-build.ts — fits the collision boxes (#129) of a Scan's Originals that are drawn from a Master Copy
// (ADR-0009), and writes them into its setup.json. The shadow is dropped; a Master Copy a little off its Original's
// box.size has its boxes scaled to box.size, so they stay inside it.
//
//   npx tsx scripts/collision-build.ts <scan>      e.g. lounge, fixture-models

import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RoomSetup } from '../shared/types';
import { type Collision, decide, type Fit, fitModel, readOverrides, summary, toJson, withCollision } from './collision';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const COLLISION_OVERRIDES = join(ROOT, 'scripts/catalog/collision-overrides.json');

/** A Scan's setup with every Master Copy Original's collision boxes fitted, or as an override `<scan>/<originalId>` sets them. */
export async function fitOriginals(scan: string): Promise<RoomSetup> {
  const dir = join(ROOT, 'data/scans', scan);
  const setup: RoomSetup = JSON.parse(await readFile(join(dir, 'setup.json'), 'utf8'));
  const overrides = await readOverrides(COLLISION_OVERRIDES);
  const fits = new Map<string, Fit>();
  const results: { id: string; before: RoomSetup['originals'][number]['box']['size']; collision: Collision }[] = [];
  const originals = [];
  for (const original of setup.originals) {
    if (!original.model) {
      originals.push(original);
      continue;
    }
    if (!fits.has(original.model)) fits.set(original.model, await fitModel(join(dir, original.model)));
    const key = `${scan}/${original.id}`;
    const collision = decide(key, fits.get(original.model)!, original.box.size, overrides[key], true);
    console.log(collision.line);
    results.push({ id: key, before: original.box.size, collision });
    originals.push(withCollision({ ...original, box: { ...original.box, size: collision.size } }, collision.collision, 'model'));
  }
  console.log(summary(results));
  return { ...setup, originals };
}

// Run only as a script, not when the tests import this file.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const scan = process.argv[2];
  if (!scan) {
    console.error('Usage: npx tsx scripts/collision-build.ts <scan>');
    process.exit(1);
  }
  fitOriginals(scan)
    .then((setup) => writeFile(join(ROOT, 'data/scans', scan, 'setup.json'), toJson(setup)))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    });
}
