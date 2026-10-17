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
import { copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';
import { gunzipSync } from 'node:zlib';
import type { Catalog, CatalogItem, Category, Hex, Vec3 } from '../shared/types';

type AboText = { language_tag: string; value: string };

/** One line of ABO's listings/metadata/listings_<i>.json.gz (see its listings/README.md), with the keys this script reads. */
export interface AboListing {
  item_id: string;                   // an ASIN
  domain_name?: string;              // "amazon.com"
  item_name?: AboText[];
  brand?: AboText[];
  product_type?: { value: string }[];
  color?: (AboText & { standardized_values?: string[] })[];  // unused standardized_values: some are wrong, such as "Beige" for walnut
  color_code?: string[];             // "#40474E"
  material?: AboText[];
  style?: AboText[];
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
      const text = fields.flatMap(englishValues).join(' ').toLowerCase();
      return words.every((word) => text.includes(word));
    })
    .sort((a, b) => Number(!a.model) - Number(!b.model) || titleOf(a).localeCompare(titleOf(b)));
}

const isCategory = (value: string): value is Category => Object.hasOwn(DEFAULT_PRICE_USD, value);

/** Every HTML entity in ABO's English text, such as the "&amp;" in 57 product names. */
const ENTITIES: Record<string, string> = { amp: '&', quot: '"', apos: "'", nbsp: ' ', eacute: 'é' };

/** The values of a multilingual ABO field in en_US, or else in another English, such as en_GB, with entities decoded. */
function englishValues(texts: AboText[] = []): string[] {
  const us = texts.filter((text) => text.language_tag === 'en_US');
  return (us.length > 0 ? us : texts.filter((text) => text.language_tag.startsWith('en_')))
    .map((text) => text.value.replace(/&(\w+);/g, (entity, name) => ENTITIES[name] ?? entity));
}

/** The English product name, without the "Amazon Brand – " that starts the house brands' names. */
const titleOf = (listing: AboListing) =>
  (englishValues(listing.item_name)[0] ?? listing.item_id).replace(/^Amazon Brand\s*[-–—]\s*/, '');

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
  if (!isCategory(pick.category)) throw new Error(`"${pick.category}" is not a Category`);
  const id = listing.item_id;
  const brand = englishValues(listing.brand)[0];
  // ABO copies a word of the brand name into `material`: "stone" in 929 Stone & Beam listings.
  const brandWords = new Set(brand?.toLowerCase().split(/\W+/));
  const materials = englishValues(listing.material).filter((material) => !brandWords.has(material.toLowerCase()));
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
    colors: tidy(englishValues(listing.color)),
    colorHex: listing.color_code?.[0]?.toLowerCase() as Hex | undefined,
    materials: tidy(materials),
    styleTags: tidy(englishValues(listing.style)),
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

const readGzip = async (file: string) => gunzipSync(await readFile(file)).toString('utf8');

/** The rows of one of ABO's gzipped CSV files, which have CRLF line endings. */
async function readCsv(file: string): Promise<Record<string, string>[]> {
  const [header, ...lines] = (await readGzip(file)).split(/\r?\n/).filter(Boolean);
  const columns = csvFields(header);
  return lines.map((line) => Object.fromEntries(csvFields(line).map((value, i) => [columns[i], value])));
}

/** Each ABO image's path under images/original/ and images/small/, by image_id. */
const loadImagePaths = async () =>
  new Map((await readCsv(await cached('images/metadata/images.csv.gz'))).map((row) => [row.image_id, row.path]));

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
    for (const line of (await readGzip(shard)).split('\n')) {
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
async function buildPick(pick: CatalogPick, listing: Listing | undefined, imagePaths: Map<string, string>) {
  if (!listing?.model) throw new Error('no ABO listing with a 3D model has this item_id');
  // A few ABO models are in the wrong units, such as B07HZ7TKSV: a loveseat 221 m wide.
  const { extent } = listing.model;
  if (Math.max(...extent) > 4) throw new Error(`${extent.join(' × ')} m is not a real furniture size`);
  const original = await cached(`3dmodels/original/${listing.model.path}`);
  // Center first: `center` decodes meshopt and writes the file uncompressed, so it must not run after `optimize`.
  const centered = join(CACHE, 'build', `${pick.id}.centered.glb`);
  const glb = join(CACHE, 'build', `${pick.id}.glb`);
  await gltfTransform('center', original, centered, '--pivot', 'below');
  await gltfTransform('optimize', centered, glb, '--texture-compress', 'webp', '--texture-size', '1024');
  await rm(centered);                         // as large as the original
  await gltfTransform('validate', glb);      // exits with an error when the glTF validator reports one
  const bytes = (await stat(glb)).size;
  if (bytes > MAX_GLB_BYTES) throw new Error(`${megabytes(bytes)} MB is over the 2 MB budget`);
  const item = toCatalogItem(pick, listing, sizeFromInspect(await gltfTransform('inspect', glb, '--format', 'csv')));

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
  const file = join(CATALOG_DIR, 'catalog.json');
  const previous: Catalog = JSON.parse(await readFile(file, 'utf8'));
  const [listings, imagePaths] = await Promise.all([loadListings(), loadImagePaths()]);
  await mkdir(join(CACHE, 'build'), { recursive: true });

  // Four picks at a time, since each gltf-transform run keeps about one core busy. Items keep the picks' order.
  const built: (CatalogItem | undefined)[] = [];
  let next = 0;
  const worker = async () => {
    for (let i = next++; i < picks.length; i = next++) {
      const pick = picks[i];
      try {
        const { item, bytes } = await buildPick(pick, listings.get(pick.id), imagePaths);
        built[i] = item;
        console.log(`✓ ${pick.id} ${pick.category.padEnd(10)} ${item.size.join(' × ')} m  ${megabytes(bytes)} MB  ${item.title}`);
      } catch (error) {
        // Keep the last good build, so that a failed download doesn't take the item out of Designs that use it.
        built[i] = previous.items.find((item) => item.source === 'abo' && item.id === pick.id);
        const kept = built[i] ? '; kept its previous build' : '';
        console.error(`✗ ${pick.id} ${pick.category.padEnd(10)} skipped: ${error instanceof Error ? error.message : error}${kept}`);
      }
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  const items = built.filter((item) => item !== undefined);

  // Items from other sources, such as the placeholder boxes, are built elsewhere: keep them.
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
  if (!isCategory(category)) {
    throw new Error(`Unknown category "${category}". Use one of: ${Object.keys(DEFAULT_PRICE_USD).join(', ')}`);
  }
  const [listings, imagePaths] = await Promise.all([loadListings(), loadImagePaths()]);
  const found = findListings(listings.values(), category, keywords);
  const cm = (meters: number) => Math.round(meters * 100);
  const inches = ({ length, width, height }: NonNullable<AboListing['item_dimensions']>) =>
    [length, width, height].map((side) => side?.normalized_value?.value ?? '?').join('×');
  const thumbnail = (imageId = '') => (imagePaths.has(imageId) ? `${ABO}/images/small/${imagePaths.get(imageId)}` : '');
  console.log(['item_id', '3D model W×H×D', 'listed L×W×H', 'color', 'style', 'name', 'thumbnail'].join('\t'));
  for (const listing of found.slice(0, limit)) {
    console.log([
      listing.item_id,
      listing.model ? `${listing.model.extent.map(cm).join('×')} cm` : 'no 3D model',
      listing.item_dimensions ? `${inches(listing.item_dimensions)} in` : '?',
      englishValues(listing.color).join(', '),
      englishValues(listing.style).join(', '),
      titleOf(listing),
      thumbnail(listing.main_image_id),
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
