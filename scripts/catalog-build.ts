// scripts/catalog-build.ts — hand-picked Amazon Berkeley Objects (ABO), Poly Haven and Google Scanned Objects items →
// data/catalog/ (spec §8.1).
//
//   npx tsx scripts/catalog-build.ts --find <category> [--q <keywords>] [--limit <n>]
//     Lists ABO listings to pick from, the ones with a 3D model first.
//   npx tsx scripts/catalog-build.ts [--only <id,id,…>]
//     Builds every pick in scripts/catalog-picks.json (or just those) into data/catalog/: models/<id>.glb,
//     thumbs/<id>.jpg, catalog.json. Each source's license is in data/catalog/CREDITS.md.
//
// A pick is one of:
//   - an ABO listing with a 3D model (the default);
//   - an ABO rug listing without one (`flat`), built as a thin slab with the listing's photo on top (catalog/flat-rug);
//   - a Poly Haven asset or a Google Scanned Objects scan (`source`), optionally set in a pot (catalog/models);
//   - an ABO bed frame built made up (`madeUp`): a mattress of the listed size and bedding on it (catalog/models).
//
// Downloads are kept in scripts/.cache/: ABO's files at their paths in the bucket.

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';
import { gunzipSync } from 'node:zlib';
import sharp from 'sharp';
import type { Catalog, CatalogItem, Category, Hex, PartParams, Vec2, Vec3 } from '../shared/types';
import { ASPECT_TOLERANCE, rugDocument, rugTexture } from './catalog/flat-rug';
import { gsoDocument, gsoUrl, writeGlb } from './catalog/gso';
import { clearGlass, io, keepNodes, type MadeUp, madeUp, potted, turn } from './catalog/models';
import { polyHavenGltf, polyHavenUrl } from './catalog/polyhaven';
import { renderThumbnails } from './catalog/thumbnail';

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
  spin_id?: string;                  // a 360° image sequence
  '3dmodel_id'?: string;
}

/** One row of ABO's 3dmodels/metadata/3dmodels.csv.gz: the GLB's path under 3dmodels/original/, and its extent in meters. */
export interface AboModel { path: string; extent: Vec3 }

/** A listing joined to its 3D model, when it has one. */
export type Listing = AboListing & { model?: AboModel };

/** A model from another source than ABO: a Poly Haven asset id, or a Google Scanned Objects model name. */
export interface ModelRef { source: 'polyhaven' | 'gso'; asset: string }

/**
 * One entry of scripts/catalog-picks.json. `price`, `colors`, `materials`, `styleTags` and `title` override the
 * defaults and ABO's data. An ABO pick's `id` is its item_id; another's is the Catalog id it gets, and it must give every field ABO would.
 */
export interface CatalogPick {
  id: string;
  category: Category;
  price?: number;
  colors?: string[];
  styleTags?: string[];
  /** For words a Mover searches by that the listing's name lacks, such as "Beanbag" for "Bean Bag". */
  title?: string;
  /** Overrides of its category's Part rule (ADR-0006), such as where a made-up bed's bedding is. */
  partParams?: PartParams;
  /** An ABO rug listing with no 3D model: which of its photos looks straight down at the whole rug (the main image by
   *  default), and its size in inches, width × length, when the listing has no item_dimensions. */
  flat?: { image?: string; inches?: Vec2 };
  /** Not ABO: where the model comes from. */
  source?: ModelRef['source'];
  asset?: string;
  brand?: string;
  materials?: string[];
  /** Keep only these top-level nodes of the asset: one of the variants a Poly Haven botany asset lays side by side. */
  nodes?: string[];
  /** Degrees to turn the model about +Y, counterclockwise from above, so that its front faces +Z. */
  turn?: number;
  /** A pot to stand the model, a plant, in. */
  pot?: ModelRef & { name: string };
  /** An ABO bed frame, built made up: with a mattress of this size and bedding on it, its thumbnail rendered from the result. */
  madeUp?: MadeUp;
}

/** §8.3: ABO has no prices, so each Category has a default estimate. */
export const DEFAULT_PRICE_USD: Record<Category, number> = {
  chair: 120, desk: 180, table: 90, nightstand: 70, bed: 300, sofa: 450, dresser: 220, wardrobe: 260,
  shelf: 90, storage: 110, rug: 80, lamp: 45, wall_art: 40, mirror: 60, plant: 30, decor: 25,
};

/** The ABO product types each Category is filed under. ABO has no nightstand or wardrobe type: narrow those with --q. */
const PRODUCT_TYPES: Record<Category, string[]> = {
  chair: ['CHAIR', 'STOOL_SEATING', 'BEAN_BAG_CHAIR', 'OTTOMAN', 'BENCH'],
  desk: ['DESK'],
  table: ['TABLE'],
  nightstand: ['TABLE', 'CABINET', 'DRESSER'],
  bed: ['BED', 'BED_FRAME'],
  sofa: ['SOFA'],
  dresser: ['DRESSER'],
  wardrobe: ['CABINET'],
  shelf: ['SHELF'],
  storage: ['CABINET', 'STORAGE_BOX', 'STORAGE_DRAWER', 'STORAGE_RACK', 'OTTOMAN', 'BENCH'],
  rug: ['RUG'],
  lamp: ['LAMP'],
  wall_art: ['WALL_ART', 'PICTURE_FRAME', 'WRITING_BOARD', 'CLOCK'],
  mirror: ['HOME_MIRROR'],
  plant: ['PLANTER', 'ARTIFICIAL_PLANT'],
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

export const isCategory = (value: string): value is Category => Object.hasOwn(DEFAULT_PRICE_USD, value);

/** §8.1 step 5: wall art and mirrors hang on a wall; everything else stands on the floor. */
export const mountOf = (category: Category): CatalogItem['mount'] => (category === 'wall_art' || category === 'mirror' ? 'wall' : 'floor');

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

/** The style words ABO titles use, a longer one before any it contains. About half of ABO's listings have no `style`. */
const TITLE_STYLES = [
  'Mid-Century Modern', 'Mid-Century', 'Modern', 'Contemporary', 'Classic', 'Casual', 'Farmhouse', 'Rustic', 'Vintage',
  'Traditional', 'Transitional', 'Industrial', 'Scandinavian', 'Bohemian', 'Boho', 'Glam', 'Coastal', 'Moroccan', 'Retro',
  'Minimalist', 'Art Deco', 'French Country',
];
const TITLE_STYLE = new RegExp(`\\b(${TITLE_STYLES.join('|')})\\b`, 'gi');

/** "Rivet Mid Century Modern Desk" → ["Mid-Century Modern"]. */
const titleStyles = (title: string) =>
  (title.replace(/\bmid century\b/gi, 'Mid-Century').match(TITLE_STYLE) ?? [])
    .map((word) => TITLE_STYLES.find((style) => style.toLowerCase() === word.toLowerCase())!);

/** The Catalog entry for a pick: §8.1 step 5, with its size measured from the optimized GLB. */
export function toCatalogItem(pick: CatalogPick, listing: AboListing, size: Vec3): CatalogItem {
  if (!isCategory(pick.category)) throw new Error(`"${pick.category}" is not a Category`);
  const id = listing.item_id;
  const brand = englishValues(listing.brand)[0];
  // ABO copies a word of the brand name into `material`: "stone" in 929 Stone & Beam listings.
  const brandWords = new Set(brand?.toLowerCase().split(/\W+/));
  const materials = englishValues(listing.material).filter((material) => !brandWords.has(material.toLowerCase()));
  const title = pick.title ?? titleOf(listing);
  const styles = tidy(englishValues(listing.style));
  return {
    id,
    source: 'abo',
    title,
    brand,
    category: pick.category,
    mount: mountOf(pick.category),
    size,
    model: `/data/catalog/models/${id}.glb`,
    thumbnail: `/data/catalog/thumbs/${id}.jpg`,
    colors: pick.colors ?? tidy(englishValues(listing.color)),
    colorHex: listing.color_code?.[0]?.toLowerCase() as Hex | undefined,
    materials: pick.materials ?? tidy(materials),
    styleTags: pick.styleTags ?? (styles.length > 0 ? styles : tidy(titleStyles(title))),
    ...(pick.partParams && { partParams: pick.partParams }),
    priceEstimateUsd: pick.price ?? DEFAULT_PRICE_USD[pick.category],
    url: `https://www.amazon.com/dp/${id}`,
    attribution: 'Amazon Berkeley Objects (CC BY 4.0), Amazon.com',
  };
}

/** Each source's credit line, CREDITS.md's short form; CC BY asks for one wherever an item is used. */
const CREDIT: Record<ModelRef['source'], string> = {
  polyhaven: 'Poly Haven (CC0)',
  gso: 'Google Scanned Objects (CC BY 4.0), Google LLC',
};

/** The Catalog entry for a Poly Haven or Google Scanned Objects pick, which gives every field itself. */
export function toSourcedItem(pick: CatalogPick, size: Vec3): CatalogItem {
  const { source, asset, title, colors, materials, styleTags, price } = pick;
  if (!isCategory(pick.category)) throw new Error(`"${pick.category}" is not a Category`);
  if (!source || !asset || !title || !colors || !materials || !styleTags || price === undefined) {
    throw new Error('a pick from another source than ABO needs source, asset, title, colors, materials, styleTags and price');
  }
  const credit = (ref: ModelRef) => `${CREDIT[ref.source]}: ${ref.asset}`;
  return {
    id: pick.id,
    source,
    title,
    ...(pick.brand && { brand: pick.brand }),
    category: pick.category,
    mount: mountOf(pick.category),
    size,
    model: `/data/catalog/models/${pick.id}.glb`,
    thumbnail: `/data/catalog/thumbs/${pick.id}.jpg`,
    colors,
    materials,
    styleTags,
    priceEstimateUsd: price,
    url: source === 'polyhaven' ? polyHavenUrl(asset) : gsoUrl(asset),
    attribution: [credit({ source, asset }), ...(pick.pot ? [`pot: ${credit(pick.pot)}`] : [])].join('; '),
  };
}

/**
 * Each source the Catalog draws on, with its license, as data/catalog/CREDITS.md states them. The posters are built
 * apart, by scripts/posters-build.ts, and credited in data/catalog/posters/CREDITS.md.
 */
const SOURCES: Record<Exclude<CatalogItem['source'], 'generated' | 'publicdomain'>, { name: string; url: string; license: string; terms: string }> = {
  abo: {
    name: 'Amazon Berkeley Objects',
    url: 'https://amazon-berkeley-objects.s3.amazonaws.com/index.html',
    license: '[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)',
    terms: 'Credit "Amazon Berkeley Objects (CC BY 4.0), Amazon.com" wherever the models are shown, as the app footer does. '
      + 'Covers both the 3D models and the product photos the flat rugs and thumbnails are made from.',
  },
  polyhaven: {
    name: 'Poly Haven',
    url: 'https://polyhaven.com/license',
    license: '[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)',
    terms: 'Public domain: no conditions. Credited here anyway.',
  },
  gso: {
    name: 'Google Scanned Objects',
    url: 'https://app.gazebosim.org/GoogleResearch/fuel/collections/Scanned%20Objects%20by%20Google%20Research',
    license: '[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)',
    terms: 'Credit "Google Scanned Objects (CC BY 4.0), Google LLC" wherever the models are shown. Downs, L., et al. '
      + '(2022), "Google Scanned Objects: A High-Quality Dataset of 3D Scanned Household Items", ICRA 2022.',
  },
};

/** data/catalog/CREDITS.md: every source with its license, then every item with its own credit line. */
export function creditsMarkdown(catalog: Catalog): string {
  const lines = [
    '# Catalog credits',
    '',
    'Written by `scripts/catalog-build.ts` from `catalog.json`: edit the script, not this file.',
    '',
    '## Sources',
    '',
    '| Source | License | Items | Terms |',
    '|---|---|---|---|',
  ];
  // An item counts for every source its credit names: a Poly Haven plant in a scanned pot counts for both.
  const count = (name: string) => catalog.items.filter((item) => item.attribution.includes(name)).length;
  for (const { name, url, license, terms } of Object.values(SOURCES)) {
    lines.push(`| [${name}](${url}) | ${license} | ${count(name)} | ${terms} |`);
  }
  const generated = catalog.items.filter((item) => item.source === 'generated').length;
  lines.push(
    `| Mise | — | ${generated} | Made for this project: placeholder boxes, and text-to-3D items (generated.json). |`,
    '',
    'Excluded on purpose: datasets whose license forbids commercial use (3D-FUTURE, ShapeNet), and Objaverse, whose license',
    'differs from object to object.',
    '',
    '## Items',
    '',
    '| Id | Item | Credit |',
    '|---|---|---|',
  );
  const cell = (text: string) => text.replaceAll('|', '\\|');
  for (const item of catalog.items) lines.push(`| ${item.id} | [${cell(item.title)}](${item.url}) | ${cell(item.attribution)} |`);
  return `${lines.join('\n')}\n`;
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

/** The triangles of every mesh instance in `gltf-transform inspect --format csv`'s MESHES table. */
export function trianglesFromInspect(inspect: string): number {
  const lines = inspect.split(/\r?\n/);
  const header = lines.findIndex((line) => line.startsWith('#,name,mode,meshPrimitives,glPrimitives'));
  if (header < 0) throw new Error('gltf-transform inspect printed no meshes');
  const columns = csvFields(lines[header]);
  let triangles = 0;
  for (const line of lines.slice(header + 1)) {
    if (!/^\d/.test(line)) break;
    const row = Object.fromEntries(csvFields(line).map((value, i) => [columns[i], value]));
    if (row.mode === 'TRIANGLES') triangles += Number(row.glPrimitives) * Number(row.instances || 1);
  }
  return triangles;
}

/** How many inches an ABO rug listing's item_dimensions give, width × length, if it gives both. */
export function listedRugInches(listing: AboListing): Vec2 | undefined {
  const { width, length } = listing.item_dimensions ?? {};
  const [w, l] = [width?.normalized_value?.value, length?.normalized_value?.value];
  return w && l ? [Math.min(w, l), Math.max(w, l)] : undefined;
}

/* ───────────── Files and commands ───────────── */

const ABO = 'https://amazon-berkeley-objects.s3.amazonaws.com';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CACHE = join(ROOT, 'scripts/.cache');
const PICKS = join(ROOT, 'scripts/catalog-picks.json');
const CATALOG_DIR = join(ROOT, 'data/catalog');
const GLTF_TRANSFORM = join(ROOT, 'node_modules/.bin/gltf-transform');
const MAX_GLB_BYTES = 2_000_000;     // §2.3: each Piece ≤ 2 MB
const MAX_TRIANGLES = 50_000;
/** Simplification tolerances to try, as a fraction of the mesh's extent, until a model is within MAX_TRIANGLES. */
const SIMPLIFY_ERRORS = [0.0001, 0.001, 0.003, 0.01];

const LISTING_KEYS: (keyof AboListing)[] = [
  'item_id', 'domain_name', 'item_name', 'brand', 'product_type', 'color', 'color_code', 'material', 'style',
  'item_dimensions', 'main_image_id', 'spin_id', '3dmodel_id',
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

/**
 * §8.1 step 3 after centering: optimizes a GLB whose pivot is already at its bottom center into `glb`, checks it, and
 * measures it. Center first: `center` decodes meshopt and writes the file uncompressed, so it must not run after this.
 * A model over MAX_TRIANGLES is simplified harder, step by step, until it is within.
 */
export async function optimizeModel(centered: string, glb: string): Promise<{ size: Vec3; bytes: number; triangles: number }> {
  for (const error of SIMPLIFY_ERRORS) {
    // No instancing: inspect reports an instanced model's bounds as its quantized ±1, such as a chess set's pieces.
    await gltfTransform('optimize', centered, glb, '--texture-compress', 'webp', '--texture-size', '1024',
      '--simplify-error', String(error), '--instance', 'false');
    const inspect = await gltfTransform('inspect', glb, '--format', 'csv');
    const triangles = trianglesFromInspect(inspect);
    if (triangles > MAX_TRIANGLES) continue;
    // A few ABO models lost their materials and were exported with a placeholder, which draws magenta.
    if (inspect.includes('PinkErrorMaterial')) throw new Error('its material is PinkErrorMaterial, a placeholder');
    await gltfTransform('validate', glb);      // exits with an error when the glTF validator reports one
    const bytes = (await stat(glb)).size;
    if (bytes > MAX_GLB_BYTES) throw new Error(`${megabytes(bytes)} MB is over the 2 MB budget`);
    return { size: sizeFromInspect(inspect), bytes, triangles };
  }
  throw new Error(`still over ${MAX_TRIANGLES} triangles at a simplify error of ${SIMPLIFY_ERRORS.at(-1)}`);
}

/**
 * Writes a listing's thumbnail: ABO's 256 px copy of the main image or, for listings without one (such as every
 * AmazonBasics bean bag), the first frame of its 360° spin, scaled to the same size.
 */
async function writeThumbnail(listing: Listing, imagePaths: Map<string, string>, file: string) {
  const imagePath = imagePaths.get(listing.main_image_id ?? '');
  if (imagePath?.endsWith('.jpg')) return copyFile(await cached(`images/small/${imagePath}`), file);
  const spin = listing.spin_id;
  if (!spin) throw new Error('ABO has neither a JPEG main image nor a 360° spin for it');
  const frame = await cached(`spins/original/${spin.slice(0, 2)}/${spin}/${spin}_00.jpg`);   // path template: spins/README.md
  await sharp(frame).resize(256, 256, { fit: 'inside' }).jpeg().toFile(file);
}

/** Centers a GLB's pivot at its bottom center, then optimizes, checks and measures it into build/<id>.glb. */
async function finishModel(id: string, original: string) {
  const centered = join(CACHE, 'build', `${id}.centered.glb`);
  const glb = join(CACHE, 'build', `${id}.glb`);
  await gltfTransform('center', original, centered, '--pivot', 'below');
  const result = await optimizeModel(centered, glb).finally(() => rm(centered));   // as large as the original
  return { glb, ...result };
}

/** Builds an ABO pick with a 3D model. */
async function buildAboModel(pick: CatalogPick, listing: Listing | undefined, imagePaths: Map<string, string>) {
  if (!listing?.model) throw new Error('no ABO listing with a 3D model has this item_id');
  // A few ABO models are in the wrong units, such as B07HZ7TKSV: a loveseat 221 m wide.
  const { extent } = listing.model;
  if (Math.max(...extent) > 4) throw new Error(`${extent.join(' × ')} m is not a real furniture size`);
  const thumbnail = join(CACHE, 'build', `${pick.id}.jpg`);
  const original = await cached(`3dmodels/original/${listing.model.path}`);
  if (pick.madeUp) {
    // The listing's photos show the bare frame, so the thumbnail is rendered from the made-up bed.
    const raw = join(CACHE, 'build', `${pick.id}.raw.glb`);
    await io().write(raw, madeUp(await io().read(original), pick.madeUp));
    const model = await finishModel(pick.id, raw);
    await renderThumbnails([{ glb: model.glb, out: thumbnail }]);
    return { item: toCatalogItem(pick, listing, model.size), model, thumbnail };
  }
  await writeThumbnail(listing, imagePaths, thumbnail);
  const model = await finishModel(pick.id, original);
  return { item: toCatalogItem(pick, listing, model.size), model, thumbnail };
}

/** Builds an ABO rug listing that has no 3D model as a flat rug, its thumbnail the photo it is made from. */
async function buildFlatRug(pick: CatalogPick, listing: Listing | undefined, imagePaths: Map<string, string>) {
  if (!listing) throw new Error('no ABO listing has this item_id');
  if (pick.category !== 'rug') throw new Error('only a rug can be built flat');
  const inches = pick.flat?.inches ?? listedRugInches(listing);
  if (!inches) throw new Error('the listing has no item_dimensions: give the rug\'s size as flat.inches');
  const imagePath = imagePaths.get(pick.flat?.image ?? listing.main_image_id ?? '');
  if (!imagePath) throw new Error('ABO has no such image');
  const meters = inches.map((side) => side * 0.0254) as Vec2;
  const { jpeg, aspect } = await rugTexture(await cached(`images/original/${imagePath}`), meters);
  // A photo taken at an angle shows the rug narrower than it is: only one straight down matches the listed size.
  const listed = meters[0] / meters[1];
  if (Math.abs(aspect / listed - 1) > ASPECT_TOLERANCE) {
    throw new Error(`the rug in the photo is ${aspect.toFixed(2)}:1, not the listing's ${listed.toFixed(2)}:1: not straight down`);
  }
  const raw = join(CACHE, 'build', `${pick.id}.raw.glb`);
  await writeGlb(rugDocument(jpeg, meters, pick.id), raw);
  const model = await finishModel(pick.id, raw);
  const thumbnail = join(CACHE, 'build', `${pick.id}.jpg`);
  await sharp(jpeg).resize(256, 256, { fit: 'inside' }).jpeg().toFile(thumbnail);
  return { item: toCatalogItem(pick, listing, model.size), model, thumbnail };
}

/** A Poly Haven or Google Scanned Objects model as a glTF Document. */
async function sourcedDocument({ source, asset }: ModelRef) {
  return source === 'polyhaven' ? clearGlass(await io().read(await polyHavenGltf(asset))) : gsoDocument(asset);
}

/** Builds a Poly Haven or Google Scanned Objects pick, its thumbnail rendered from the finished GLB. */
async function buildSourced(pick: CatalogPick) {
  if (!pick.source || !pick.asset) throw new Error('a pick from another source than ABO needs source and asset');
  let doc = await sourcedDocument({ source: pick.source, asset: pick.asset });
  if (pick.nodes) await keepNodes(doc, pick.nodes);
  if (pick.turn) turn(doc, pick.turn);
  if (pick.pot) doc = await potted(await sourcedDocument(pick.pot), doc);
  const raw = join(CACHE, 'build', `${pick.id}.raw.glb`);
  await io().write(raw, doc);
  const model = await finishModel(pick.id, raw);
  const thumbnail = join(CACHE, 'build', `${pick.id}.jpg`);
  await renderThumbnails([{ glb: model.glb, out: thumbnail }]);
  return { item: toSourcedItem(pick, model.size), model, thumbnail };
}

/** Builds a pick's GLB and thumbnail into data/catalog/ and returns its Catalog entry. */
async function buildPick(pick: CatalogPick, listing: Listing | undefined, imagePaths: Map<string, string>) {
  const { item, model, thumbnail } = pick.source ? await buildSourced(pick)
    : pick.flat ? await buildFlatRug(pick, listing, imagePaths)
    : await buildAboModel(pick, listing, imagePaths);
  await copyFile(model.glb, join(ROOT, item.model));
  await copyFile(thumbnail, join(ROOT, item.thumbnail));
  return { item, ...model };
}

/** The sources this script builds; the Catalog's other items, such as the placeholder boxes, are built elsewhere. */
const BUILT_SOURCES = new Set<CatalogItem['source']>(['abo', 'polyhaven', 'gso']);

/**
 * Builds every pick, skipping (and logging) the ones that fail, then writes catalog.json. With `only`, builds just
 * those picks and keeps the others' last builds.
 */
async function build(only?: Set<string>) {
  const picks: CatalogPick[] = JSON.parse(await readFile(PICKS, 'utf8'));
  const file = join(CATALOG_DIR, 'catalog.json');
  const previous: Catalog = JSON.parse(await readFile(file, 'utf8'));
  // ABO's metadata is a large download: load it only when an ABO pick is being built.
  const needsAbo = picks.some((pick) => !pick.source && (!only || only.has(pick.id)));
  const [listings, imagePaths] = needsAbo ? await Promise.all([loadListings(), loadImagePaths()]) : [new Map<string, Listing>(), new Map<string, string>()];
  await mkdir(join(CACHE, 'build'), { recursive: true });

  // Four picks at a time, since each gltf-transform run keeps about one core busy. Items keep the picks' order.
  const built: (CatalogItem | undefined)[] = [];
  let next = 0;
  const worker = async () => {
    for (let i = next++; i < picks.length; i = next++) {
      const pick = picks[i];
      const previousBuild = previous.items.find((item) => BUILT_SOURCES.has(item.source) && item.id === pick.id);
      if (only && !only.has(pick.id)) {
        built[i] = previousBuild;
        continue;
      }
      try {
        const { item, bytes, triangles } = await buildPick(pick, listings.get(pick.id), imagePaths);
        built[i] = item;
        console.log(`✓ ${pick.id} ${pick.category.padEnd(10)} ${item.size.join(' × ')} m  ${megabytes(bytes)} MB  ${triangles} △  ${item.title}`);
      } catch (error) {
        // Keep the last good build, so that a failed download doesn't take the item out of Designs that use it.
        built[i] = previousBuild;
        const kept = built[i] ? '; kept its previous build' : '';
        console.error(`✗ ${pick.id} ${pick.category.padEnd(10)} skipped: ${error instanceof Error ? error.message : error}${kept}`);
      }
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  const items = built.filter((item) => item !== undefined);

  // Items from other sources, such as the placeholder boxes, are built elsewhere: keep them.
  const catalog: Catalog = { version: 1, items: [...items, ...previous.items.filter((item) => !BUILT_SOURCES.has(item.source))] };
  await writeFile(file, `${JSON.stringify(catalog, null, 2)}\n`);
  await writeFile(join(CATALOG_DIR, 'CREDITS.md'), creditsMarkdown(catalog));

  // Remove the files of items that left the Catalog, such as earlier picks. Text-to-3D's items stay (generated.json, and
  // its sandbox's generated-sandbox.json).
  const generated = await Promise.all(['generated.json', 'generated-sandbox.json'].map(async (name): Promise<Catalog> => {
    const generatedFile = join(CATALOG_DIR, name);
    return existsSync(generatedFile) ? JSON.parse(await readFile(generatedFile, 'utf8')) : { version: 1, items: [] };
  }));
  const used = new Set([catalog, ...generated].flatMap(({ items }) => items.flatMap((item) => [item.model, item.thumbnail])));
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
    options: {
      find: { type: 'string' }, q: { type: 'string' }, limit: { type: 'string', default: '40' }, only: { type: 'string' },
    },
  });
  if (values.find) await find(values.find, values.q, Number(values.limit));
  else await build(values.only ? new Set(values.only.split(',')) : undefined);
}

// Run only as a script, not when the tests import this file.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
