// scripts/catalog-build.ts — hand-picked Amazon Berkeley Objects (ABO) → data/catalog/ (spec §8.1).
//
//   npx tsx scripts/catalog-build.ts --find <category> [--q <keywords>] [--limit <n>]
//     Lists ABO listings to pick from, the ones with a 3D model first.
//   npx tsx scripts/catalog-build.ts
//     Builds every pick in scripts/catalog-picks.json into data/catalog/: models/<id>.glb, thumbs/<id>.jpg, catalog.json.
//
// ABO files are downloaded once into scripts/.cache/, at their paths in the bucket.

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';
import { gunzipSync } from 'node:zlib';
import type { Catalog, CatalogItem, Category, Hex, Vec3 } from '../shared/types';

type Text = { language_tag: string; value: string };

/** One line of ABO's listings/metadata/listings_<i>.json.gz (see its listings/README.md), with the keys this script reads. */
export interface AboListing {
  item_id: string;                   // an ASIN
  domain_name?: string;              // "amazon.com"
  item_name?: Text[];
  brand?: Text[];
  product_type?: { value: string }[];
  color?: (Text & { standardized_values?: string[] })[];
  color_code?: string[];             // "#40474E"
  material?: Text[];
  style?: Text[];
  item_dimensions?: Partial<Record<'length' | 'width' | 'height', { normalized_value?: { value: number } }>>; // inches
  main_image_id?: string;
  '3dmodel_id'?: string;
}

/** One row of ABO's 3dmodels/metadata/3dmodels.csv.gz: the GLB's path under 3dmodels/original/, and its extent in meters. */
export interface AboModel { path: string; extent: Vec3 }

/** A listing joined to its 3D model, when it has one. */
export type Listing = AboListing & { model?: AboModel };

/** One entry of scripts/catalog-picks.json. */
export interface CatalogPick { id: string; category: Category; price?: number }

/** §8.3: ABO has no prices, so each Category has a default estimate. */
const DEFAULT_PRICE_USD: Record<Category, number> = {
  chair: 120, desk: 180, table: 90, nightstand: 70, bed: 300, sofa: 450, dresser: 220, wardrobe: 260,
  shelf: 90, storage: 110, rug: 80, lamp: 45, wall_art: 40, mirror: 60, plant: 30, decor: 25,
};

/** The ABO product types each Category is filed under. ABO has no nightstand or wardrobe type: narrow those with --q. */
const PRODUCT_TYPES: Record<Category, string[]> = {
  chair: ['CHAIR', 'STOOL_SEATING', 'BEAN_BAG_CHAIR'],
  desk: ['DESK'],
  table: ['TABLE'],
  nightstand: ['TABLE', 'CABINET', 'DRESSER'],
  bed: ['BED', 'BED_FRAME'],
  sofa: ['SOFA'],
  dresser: ['DRESSER'],
  wardrobe: ['CABINET'],
  shelf: ['SHELF'],
  storage: ['CABINET', 'STORAGE_BOX', 'STORAGE_DRAWER', 'STORAGE_RACK'],
  rug: ['RUG'],
  lamp: ['LAMP'],
  wall_art: ['WALL_ART', 'PICTURE_FRAME'],
  mirror: ['HOME_MIRROR'],
  plant: ['PLANTER'],
  decor: ['VASE', 'CANDLE_HOLDER', 'CLOCK', 'PILLOW', 'HOME_FURNITURE_AND_DECOR', 'HOME'],
};

/**
 * The listings filed under a Category's ABO product types whose title, color, material or style contain every keyword:
 * the ones with a 3D model first, since only those can be built, then by title.
 */
export function findListings(listings: Iterable<Listing>, category: Category, keywords = ''): Listing[] {
  const words = keywords.toLowerCase().split(/\s+/).filter(Boolean);
  return [...listings]
    .filter((listing) => {
      if (!PRODUCT_TYPES[category].includes(listing.product_type?.[0]?.value ?? '')) return false;
      const fields = [listing.item_name, listing.color, listing.material, listing.style];
      const text = fields.flatMap((field) => english(field).map((entry) => entry.value)).join(' ').toLowerCase();
      return words.every((word) => text.includes(word));
    })
    .sort((a, b) => Number(!a.model) - Number(!b.model) || titleOf(a).localeCompare(titleOf(b)));
}

/** The entries of a multilingual ABO field in en_US, or else in another English, such as en_GB. */
function english<T extends Text>(texts: T[] = []): T[] {
  const us = texts.filter((text) => text.language_tag === 'en_US');
  return us.length > 0 ? us : texts.filter((text) => text.language_tag.startsWith('en_'));
}

/** The English product name, without the "Amazon Brand – " that starts the house brands' names, and with "&amp;" decoded. */
const titleOf = (listing: AboListing) =>
  (english(listing.item_name)[0]?.value ?? listing.item_id).replace(/^Amazon Brand\s*[-–—]\s*/, '').replaceAll('&amp;', '&');

/** ABO's free text, tidied: "faux_leather" → "Faux leather", repeats in any case dropped, and so are junk values such as "0" or "Y". */
function tidy(values: string[]): string[] {
  const byKey = new Map<string, string>();
  for (const value of values) {
    const text = value.replaceAll('_', ' ').trim();
    if (!/\p{L}.*\p{L}/u.test(text)) continue;
    if (!byKey.has(text.toLowerCase())) byKey.set(text.toLowerCase(), text[0].toUpperCase() + text.slice(1));
  }
  return [...byKey.values()];
}

/** The Catalog entry for a pick: §8.1 step 5, with its size measured from the optimized GLB. */
export function toCatalogItem(pick: CatalogPick, listing: AboListing, size: Vec3): CatalogItem {
  if (!Object.hasOwn(DEFAULT_PRICE_USD, pick.category)) throw new Error(`"${pick.category}" is not a Category`);
  const id = listing.item_id;
  const brand = english(listing.brand)[0]?.value;
  const colorHex = listing.color_code?.[0]?.toLowerCase() as Hex | undefined;
  // ABO copies the brand name into `material` as "stone" for 773 of the 782 Stone & Beam listings that have it.
  const materials = english(listing.material).map((m) => m.value).filter((m) => !(brand === 'Stone & Beam' && m === 'stone'));
  return {
    id,
    source: 'abo',
    title: titleOf(listing),
    brand,
    category: pick.category,
    mount: pick.category === 'wall_art' || pick.category === 'mirror' ? 'wall' : 'floor',
    size,
    model: `/data/catalog/models/${id}.glb`,
    thumbnail: `/data/catalog/thumbs/${id}.jpg`,
    colors: tidy(english(listing.color).flatMap((color) => [color.value, ...(color.standardized_values ?? [])])),
    colorHex,
    materials: tidy(materials),
    styleTags: tidy(english(listing.style).map((style) => style.value)),
    priceEstimateUsd: pick.price ?? DEFAULT_PRICE_USD[pick.category],
    url: `https://www.amazon.com/dp/${id}`,
    attribution: 'Amazon Berkeley Objects (CC BY 4.0), Amazon.com',
  };
}

/** One CSV line's fields. A quoted field may hold commas, as gltf-transform writes "x, y, z". */
const csvFields = (line: string) => [...line.matchAll(/(?:^|,)("[^"]*"|[^,]*)/g)].map(([, field]) => field.replace(/^"|"$/g, ''));

/** [W, H, D] in meters, to the millimeter, from the first scene's bounding box in `gltf-transform inspect --format csv`. */
export function sizeFromInspect(inspect: string): Vec3 {
  const lines = inspect.split(/\r?\n/);
  const header = lines.findIndex((line) => line.startsWith('#,name,rootName,bboxMin,bboxMax'));
  const [, , , min = '', max = ''] = header < 0 ? [] : csvFields(lines[header + 1]);
  const [x0, y0, z0] = min.split(',').map(Number);
  const [x1, y1, z1] = max.split(',').map(Number);
  const mm = (meters: number) => Math.round(meters * 1000) / 1000;
  const size: Vec3 = [mm(x1 - x0), mm(y1 - y0), mm(z1 - z0)];
  if (!size.every(Number.isFinite)) throw new Error('gltf-transform inspect printed no scene bounding box');
  return size;
}

/* ───────────── Files and commands ───────────── */

const ABO = 'https://amazon-berkeley-objects.s3.amazonaws.com';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CACHE = join(ROOT, 'scripts/.cache');
const PICKS = join(ROOT, 'scripts/catalog-picks.json');
const CATALOG_DIR = join(ROOT, 'data/catalog');
const GLTF_TRANSFORM = join(ROOT, 'node_modules/.bin/gltf-transform');
const MAX_GLB_BYTES = 2_000_000;     // §2.3: each Piece ≤ 2 MB

const LISTING_KEYS: (keyof AboListing)[] = [
  'item_id', 'domain_name', 'item_name', 'brand', 'product_type', 'color', 'color_code', 'material', 'style',
  'item_dimensions', 'main_image_id', '3dmodel_id',
];

/** The local copy of an ABO file, downloaded into scripts/.cache/ the first time. */
async function cached(key: string): Promise<string> {
  const file = join(CACHE, key);
  if (existsSync(file)) return file;
  const res = await fetch(`${ABO}/${key}`);
  if (!res.ok) throw new Error(`GET ${ABO}/${key}: ${res.status} ${res.statusText}`);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(`${file}.part`, Buffer.from(await res.arrayBuffer()));
  await rename(`${file}.part`, file);
  return file;
}

/** The rows of one of ABO's gzipped CSV files, which have CRLF line endings and no quoted fields. */
async function readCsv(file: string): Promise<Record<string, string>[]> {
  const [header, ...lines] = gunzipSync(await readFile(file)).toString('utf8').split(/\r?\n/).filter(Boolean);
  const columns = header.split(',');
  return lines.map((line) => Object.fromEntries(line.split(',').map((value, i) => [columns[i], value])));
}

/** Every ABO listing by item_id, joined to its 3D model. Of a listing on several Amazon sites, the amazon.com one wins. */
async function loadListings(): Promise<Map<string, Listing>> {
  const [modelsCsv, ...shards] = await Promise.all([
    cached('3dmodels/metadata/3dmodels.csv.gz'),
    ...[...'0123456789abcdef'].map((shard) => cached(`listings/metadata/listings_${shard}.json.gz`)),
  ]);
  const models = new Map((await readCsv(modelsCsv)).map((row): [string, AboModel] => [
    row['3dmodel_id'],
    { path: row.path, extent: [Number(row.extent_x), Number(row.extent_y), Number(row.extent_z)] },
  ]));
  const listings = new Map<string, Listing>();
  for (const shard of shards) {
    for (const line of gunzipSync(await readFile(shard)).toString('utf8').split('\n')) {
      if (!line) continue;
      const json = JSON.parse(line);
      const listing = Object.fromEntries(LISTING_KEYS.filter((key) => key in json).map((key) => [key, json[key]])) as Listing;
      listing.model = models.get(listing['3dmodel_id'] ?? '');
      if (!listings.has(listing.item_id) || listing.domain_name === 'amazon.com') listings.set(listing.item_id, listing);
    }
  }
  return listings;
}

/** Runs the gltf-transform CLI and returns what it printed. */
async function gltfTransform(...args: string[]): Promise<string> {
  const { stdout } = await promisify(execFile)(GLTF_TRANSFORM, args, { maxBuffer: 64 * 1024 * 1024 });
  return stdout;
}

const megabytes = (bytes: number) => (bytes / 1e6).toFixed(2);

/** Builds a pick's GLB and thumbnail into data/catalog/ and returns its Catalog entry. */
async function buildPick(pick: CatalogPick, listing: Listing | undefined, imagePaths: Map<string, string>, work: string) {
  if (!listing?.model) throw new Error('no ABO listing with a 3D model has this item_id');
  const original = await cached(`3dmodels/original/${listing.model.path}`);
  // Center first: `center` decodes meshopt and writes the file uncompressed, so it must not run after `optimize`.
  const centered = join(work, `${pick.id}.centered.glb`);
  const glb = join(work, `${pick.id}.glb`);
  await gltfTransform('center', original, centered, '--pivot', 'below');
  await gltfTransform('optimize', centered, glb, '--texture-compress', 'webp', '--texture-size', '1024');
  await gltfTransform('validate', glb);      // exits with an error when the glTF validator reports one
  const bytes = (await stat(glb)).size;
  if (bytes > MAX_GLB_BYTES) throw new Error(`${megabytes(bytes)} MB is over the 2 MB budget`);
  const size = sizeFromInspect(await gltfTransform('inspect', glb, '--format', 'csv'));
  // A few ABO models are in the wrong units, such as B07HZ7TKSV: a loveseat 221 m wide.
  if (Math.max(...size) > 4) throw new Error(`${size.join(' × ')} m is not a real furniture size`);
  const item = toCatalogItem(pick, listing, size);

  const imagePath = imagePaths.get(listing.main_image_id ?? '');
  if (!imagePath?.endsWith('.jpg')) throw new Error(`the main image ${listing.main_image_id} is not a JPEG in ABO`);
  const thumbnail = await cached(`images/small/${imagePath}`);   // the 256 px copy
  await copyFile(glb, join(ROOT, item.model));
  await copyFile(thumbnail, join(ROOT, item.thumbnail));
  return { item, bytes };
}

/** Builds every pick, skipping (and logging) the ones that fail, then writes catalog.json. */
async function build() {
  const picks: CatalogPick[] = JSON.parse(await readFile(PICKS, 'utf8'));
  const [listings, imagesCsv] = await Promise.all([loadListings(), cached('images/metadata/images.csv.gz')]);
  const imagePaths = new Map((await readCsv(imagesCsv)).map((row) => [row.image_id, row.path]));
  const work = await mkdtemp(join(tmpdir(), 'catalog-build-'));
  const items: CatalogItem[] = [];
  try {
    for (const pick of picks) {
      try {
        const { item, bytes } = await buildPick(pick, listings.get(pick.id), imagePaths, work);
        items.push(item);
        console.log(`✓ ${pick.id} ${pick.category.padEnd(10)} ${item.size.join(' × ')} m  ${megabytes(bytes)} MB  ${item.title}`);
      } catch (error) {
        console.error(`✗ ${pick.id} ${pick.category.padEnd(10)} skipped: ${error instanceof Error ? error.message : error}`);
      }
    }
  } finally {
    await rm(work, { recursive: true, force: true });
  }

  // Items from other sources, such as the placeholder boxes, are built elsewhere: keep them.
  const file = join(CATALOG_DIR, 'catalog.json');
  const previous: Catalog = JSON.parse(await readFile(file, 'utf8'));
  const catalog: Catalog = { version: 1, items: [...items, ...previous.items.filter((item) => item.source !== 'abo')] };
  await writeFile(file, `${JSON.stringify(catalog, null, 2)}\n`);

  // Remove the files of items that left the Catalog, such as earlier picks.
  const used = new Set(catalog.items.flatMap((item) => [item.model, item.thumbnail]));
  for (const dir of ['models', 'thumbs']) {
    for (const name of await readdir(join(CATALOG_DIR, dir))) {
      if (!used.has(`/data/catalog/${dir}/${name}`)) await rm(join(CATALOG_DIR, dir, name));
    }
  }
  console.log(`Wrote ${items.length} of ${picks.length} picks to data/catalog/catalog.json (${catalog.items.length} items).`);
}

/** Prints the listings of a Category that contain the keywords, for picking. */
async function find(category: string, keywords: string | undefined, limit: number) {
  if (!Object.hasOwn(PRODUCT_TYPES, category)) {
    throw new Error(`Unknown category "${category}". Use one of: ${Object.keys(PRODUCT_TYPES).join(', ')}`);
  }
  const found = findListings((await loadListings()).values(), category as Category, keywords);
  const cm = (meters: number) => Math.round(meters * 100);
  const inches = ({ length, width, height }: NonNullable<AboListing['item_dimensions']>) =>
    [length, width, height].map((side) => side?.normalized_value?.value ?? '?').join('×');
  const first = (texts?: Text[]) => english(texts).map((text) => text.value).join(', ');
  console.log(['item_id', '3D model W×H×D', 'listed L×W×H', 'color', 'style', 'name'].join('\t'));
  for (const listing of found.slice(0, limit)) {
    console.log([
      listing.item_id,
      listing.model ? `${listing.model.extent.map(cm).join('×')} cm` : 'no 3D model',
      listing.item_dimensions ? `${inches(listing.item_dimensions)} in` : '?',
      first(listing.color),
      first(listing.style),
      titleOf(listing),
    ].join('\t'));
  }
  const withModel = found.filter((listing) => listing.model).length;
  console.log(`${found.length} listings, ${withModel} with a 3D model${found.length > limit ? `; showing ${limit} (--limit)` : ''}`);
}

async function main() {
  const { values } = parseArgs({
    options: { find: { type: 'string' }, q: { type: 'string' }, limit: { type: 'string', default: '40' } },
  });
  if (values.find) await find(values.find, values.q, Number(values.limit));
  else await build();
}

// Run only as a script, not when the tests import this file.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
