// scripts/materials-build.ts — the Material Library (spec §11.1): CC0 materials at 1K from Poly Haven
// and ambientCG → data/materials/.
//
//   npx tsx scripts/materials-build.ts
//     Downloads each pick in PICKS into scripts/.cache/materials/ (once), checks that both sites still
//     say their assets are CC0, and writes data/materials/: <id>.jpg (the color map, re-encoded only
//     when it is over 1 MB) and materials.json.
//
// Only the color map is kept. Scan nodes are drawn unlit (spec §10.6), so a normal or roughness map
// would show nothing; LibraryMaterial's optional maps stay unused.

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import sharp from 'sharp';
import type { LibraryMaterial } from '../shared/types';

export type Site = 'polyhaven' | 'ambientcg';

/** One material of the library, pinned to an asset of Poly Haven or ambientCG. */
export interface MaterialPick {
  id: string;
  name: string;
  kind: LibraryMaterial['kind'];
  site: Site;
  /** Poly Haven's asset id ("oak_veneer_01") or ambientCG's ("Carpet016"). */
  asset: string;
  /** Meters per repeat of the texture: the real size of the sample, where the site gives one. */
  tileSize: number;
}

/** The two sites, with the page that states their license, and what that page must say. */
const SITES: Record<Site, { name: string; licenseUrl: string }> = {
  polyhaven: { name: 'Poly Haven', licenseUrl: 'https://polyhaven.com/license' },
  ambientcg: { name: 'ambientCG', licenseUrl: 'https://docs.ambientcg.com/license/' },
};

/**
 * The library: every pick is pinned to one asset, so a rebuild gives the same files. Both sites
 * license all their assets as CC0, which the build checks against their license pages.
 */
export const PICKS: MaterialPick[] = [
  { id: 'oak', name: 'Oak', kind: 'wood', site: 'polyhaven', asset: 'oak_veneer_01', tileSize: 1.83 },
  { id: 'walnut', name: 'Walnut', kind: 'wood', site: 'polyhaven', asset: 'black_walnut_veneer_02', tileSize: 1 },
  { id: 'maple', name: 'Maple', kind: 'wood', site: 'polyhaven', asset: 'white_maple_veneer', tileSize: 1 },
  { id: 'cherry', name: 'Cherry', kind: 'wood', site: 'polyhaven', asset: 'lacquered_cherry_wood', tileSize: 1 },
  { id: 'marble', name: 'Marble', kind: 'stone', site: 'ambientcg', asset: 'Marble005', tileSize: 1.5 },
  { id: 'concrete', name: 'Concrete', kind: 'stone', site: 'ambientcg', asset: 'Concrete034', tileSize: 1.5 },
  { id: 'linen', name: 'Linen', kind: 'fabric', site: 'polyhaven', asset: 'rough_linen', tileSize: 0.27 },
  { id: 'velvet', name: 'Velvet', kind: 'fabric', site: 'polyhaven', asset: 'velour_velvet', tileSize: 0.28 },
  { id: 'leather', name: 'Leather', kind: 'fabric', site: 'polyhaven', asset: 'brown_leather', tileSize: 0.4 },
  { id: 'brushed-metal', name: 'Brushed metal', kind: 'metal', site: 'ambientcg', asset: 'Metal009', tileSize: 0.5 },
  { id: 'carpet-beige', name: 'Beige carpet', kind: 'carpet', site: 'ambientcg', asset: 'Carpet014', tileSize: 0.8 },
  { id: 'carpet-grey', name: 'Grey carpet', kind: 'carpet', site: 'ambientcg', asset: 'Carpet001', tileSize: 1 },
  { id: 'carpet-navy', name: 'Navy carpet', kind: 'carpet', site: 'ambientcg', asset: 'Carpet012', tileSize: 0.6 },
  { id: 'wallpaper-woodchip', name: 'Woodchip wallpaper', kind: 'wallpaper', site: 'ambientcg', asset: 'Wallpaper001A', tileSize: 1 },
  { id: 'wallpaper-gingham', name: 'Gingham wallpaper', kind: 'wallpaper', site: 'polyhaven', asset: 'gingham_check', tileSize: 0.29 },
  { id: 'wallpaper-striped', name: 'Striped wallpaper', kind: 'wallpaper', site: 'ambientcg', asset: 'Fabric071', tileSize: 0.5 },
  { id: 'tile-white', name: 'White tile', kind: 'tile', site: 'ambientcg', asset: 'Tiles107', tileSize: 1 },
  { id: 'tile-terracotta', name: 'Terracotta tile', kind: 'tile', site: 'polyhaven', asset: 'brown_floor_tiles', tileSize: 1.7 },
];

/** Each texture must stay small enough to commit, like data/catalog. */
export const MAX_TEXTURE_BYTES = 1_000_000;
/** The swatches of the Finish picker are thumbnails, at data/materials/thumbs/<id>.jpg, so it needn't load the textures. */
const THUMB_SIDE = 96;
/** "1K": no side is longer than this. Poly Haven keeps a sample's aspect ratio, so its "1k" can be a few pixels over 1024. */
export const MAX_TEXTURE_SIDE = 1100;

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CACHE = join(ROOT, 'scripts/.cache/materials');
const OUT = join(ROOT, 'data/materials');
const run = promisify(execFile);

/** The LibraryMaterial of a pick. maps.color is a URL the server serves, like a Catalog Piece's model. */
export function toLibraryMaterial(pick: MaterialPick): LibraryMaterial {
  return {
    id: pick.id,
    name: pick.name,
    kind: pick.kind,
    maps: { color: `/data/materials/${pick.id}.jpg` },
    tileSize: pick.tileSize,
    source: `${SITES[pick.site].name} ${pick.asset} (CC0)`,
  };
}

/* ───────────── Downloads ───────────── */

async function get(url: string): Promise<Response> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url}: ${res.status} ${res.statusText}`);
  return res;
}

/** Writes through a .part file, so an interrupted download is never mistaken for a cached one. */
async function save(file: string, data: Buffer) {
  await mkdir(join(file, '..'), { recursive: true });
  await writeFile(`${file}.part`, data);
  await rename(`${file}.part`, file);
}

/** Throws unless the site's license page still says its assets are CC0. */
async function checkLicense(site: Site) {
  const { name, licenseUrl } = SITES[site];
  const page = await (await get(licenseUrl)).text();
  if (!/CC0/.test(page)) throw new Error(`${licenseUrl} no longer mentions CC0: check ${name}'s license before using it`);
}

/** Poly Haven's 1K diffuse JPG of an asset, checked against the md5 its API lists. */
async function polyHavenColorMap(asset: string): Promise<string> {
  const file = join(CACHE, 'polyhaven', `${asset}_diff_1k.jpg`);
  if (existsSync(file)) return file;
  const files = await (await get(`https://api.polyhaven.com/files/${asset}`)).json() as
    { Diffuse?: { '1k'?: { jpg?: { url: string; md5: string } } } };
  const listed = files.Diffuse?.['1k']?.jpg;
  if (!listed) throw new Error(`Poly Haven ${asset} has no 1K diffuse JPG`);
  const data = Buffer.from(await (await get(listed.url)).arrayBuffer());
  if (createHash('md5').update(data).digest('hex') !== listed.md5) throw new Error(`${listed.url}: wrong md5`);
  await save(file, data);
  return file;
}

/** ambientCG's 1K color map: the Color JPG inside the asset's 1K-JPG zip, which also holds maps we don't keep. */
async function ambientCgColorMap(asset: string): Promise<string> {
  const file = join(CACHE, 'ambientcg', `${asset}_1K-JPG_Color.jpg`);
  if (existsSync(file)) return file;
  const zip = join(CACHE, 'ambientcg', `${asset}_1K-JPG.zip`);
  if (!existsSync(zip)) await save(zip, Buffer.from(await (await get(`https://ambientcg.com/get?file=${asset}_1K-JPG.zip`)).arrayBuffer()));
  const { stdout } = await run('unzip', ['-p', zip, `${asset}_1K-JPG_Color.jpg`], { encoding: 'buffer', maxBuffer: 50_000_000 });
  await save(file, stdout);
  return file;
}

const colorMap = (pick: MaterialPick) =>
  pick.site === 'polyhaven' ? polyHavenColorMap(pick.asset) : ambientCgColorMap(pick.asset);

/* ───────────── Build ───────────── */

/**
 * The texture's own bytes, or, when they are over MAX_TEXTURE_BYTES, the first of a few JPEG
 * qualities that fits. Fine, noisy textures such as carpets are the ones that need it.
 */
async function underLimit(file: string, bytes: number): Promise<{ data: Buffer; quality?: number }> {
  const original = await readFile(file);
  if (bytes <= MAX_TEXTURE_BYTES) return { data: original };
  for (const quality of [90, 85, 80, 75, 70]) {
    const data = await sharp(original).jpeg({ quality, mozjpeg: true }).toBuffer();
    if (data.length <= MAX_TEXTURE_BYTES) return { data, quality };
  }
  throw new Error(`${file}: still over ${MAX_TEXTURE_BYTES} bytes at JPEG quality 70: pick another asset`);
}

async function build() {
  await Promise.all((Object.keys(SITES) as Site[]).map(checkLicense));
  await mkdir(join(OUT, 'thumbs'), { recursive: true });

  for (const pick of PICKS) {
    const source = await colorMap(pick);
    const { width = 0, height = 0, format } = await sharp(source).metadata();
    const bytes = (await readFile(source)).length;
    if (format !== 'jpeg' || Math.max(width, height) > MAX_TEXTURE_SIDE) {
      throw new Error(`${pick.asset}: expected a JPEG of at most ${MAX_TEXTURE_SIDE}px, got ${format} ${width}×${height}`);
    }
    const { data, quality } = await underLimit(source, bytes);
    await writeFile(join(OUT, `${pick.id}.jpg`), data);
    await sharp(data).resize(THUMB_SIDE, THUMB_SIDE, { fit: 'cover' }).jpeg({ quality: 80 }).toFile(join(OUT, 'thumbs', `${pick.id}.jpg`));
    console.log(`${pick.id.padEnd(20)} ${SITES[pick.site].name} ${pick.asset} ${width}×${height} ${Math.round(data.length / 1000)} kB${quality ? ` (re-encoded at quality ${quality}, was ${Math.round(bytes / 1000)} kB)` : ''}`);
  }

  // Drop textures and thumbnails of picks that were removed.
  const keep = new Set(PICKS.map(({ id }) => `${id}.jpg`));
  for (const dir of [OUT, join(OUT, 'thumbs')]) {
    for (const file of await readdir(dir)) if (file.endsWith('.jpg') && !keep.has(file)) await rm(join(dir, file));
  }

  await writeFile(join(OUT, 'materials.json'), `${JSON.stringify(PICKS.map(toLibraryMaterial), null, 2)}\n`);
  console.log(`${PICKS.length} materials → data/materials/materials.json`);
}

// Run only as a script, not when the tests import this file.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  build().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
