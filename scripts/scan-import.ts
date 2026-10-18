// Polycam glTF export → data/scans/<scanId>/ (spec §9.2). Run with --help for usage.
import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { copyFile, cp, mkdir, mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { type Document, Logger, NodeIO, Primitive } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import {
  dedup, flatten, getBounds, getGLPrimitiveCount, instance, join as joinPrimitives, meshopt, palette, prune, simplify, sparse,
  textureCompress, unpartition, weld,
} from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import type { ScanManifest, Vec3 } from '../shared/types';

/** Spec §2.3: the room mesh is at most 500k triangles in all, Fill Captures included, with up to 4K WebP textures. */
export const MAX_TRIANGLES = 500_000;
const TEXTURE_SIZE = 4096;
/** A room's height, in meters. A Y extent outside it usually means +Y isn't up, or the units aren't meters. */
const ROOM_HEIGHT = { min: 2.0, max: 3.5 };
const ROOM_HEIGHT_TEXT = `${ROOM_HEIGHT.min.toFixed(1)}–${ROOM_HEIGHT.max.toFixed(1)} m`;
export const SCANS_DIR = fileURLToPath(new URL('../data/scans', import.meta.url));
const MODEL = /\.(gltf|glb)$/i;
const ZIP = /\.zip$/i;

const HELP = `
Turns a Polycam glTF export into a Scan folder that the editor can load: data/scans/<scanId>/.

Usage:
  npx tsx scripts/scan-import.ts <export> <scanId> [--raw <rawdata>] [--name "Maple Hall 412"] [--force]
  npx tsx scripts/scan-import.ts <export> <scanId> --fill

Arguments:
  <export>   The Polycam glTF export: the .glb or .gltf file, a .zip of it, or an unzipped folder.
  <scanId>   A short id for the Scan, such as venue-test or lounge-v1: lowercase letters, digits,
             and hyphens. It names the folder.

Options:
  --raw <rawdata>  The Polycam Raw Data export (Developer Mode), as a .zip or a folder. It is
                   unpacked into data/scans/<scanId>/raw/, which git ignores. The fallback splat
                   (msplat-train) is trained from it.
  --name <name>    The name the editor shows, such as "Maple Hall 412". Defaults to <scanId>.
  --force          Replace a Scan that already exists. This resets its meshTransform, so redo
                   Room Setup step 1 afterwards.
  --fill           Add this export to an existing Scan as a Fill Capture: one taken after moving
                   the furniture, for what it hid (ADR-0007). It is saved as captures/fill-<n>.glb;
                   room.glb and meshTransform stay as they are. Then line it up in Room Setup,
                   step 6 (Fill Captures).
  -h, --help       Show this help.

What it does:
  1. Finds the .gltf or .glb in the export.
  2. Optimizes it like "gltf-transform optimize --texture-compress webp --texture-size 4096", and
     simplifies it further while it has more than 500,000 triangles.
  3. Writes room.glb, and manifest.json with an identity meshTransform (Room Setup step 1 sets it).
     With --fill, writes captures/fill-<n>.glb and adds it to the manifest's captures instead.
  4. Prints a summary. Check that the sizes are in meters and +Y is up: a room's Y extent is ${ROOM_HEIGHT_TEXT}.

Examples:
  npx tsx scripts/scan-import.ts ~/Downloads/venue.glb venue-test --name "Venue test"
  npx tsx scripts/scan-import.ts ~/Downloads/lounge-main.glb lounge-v1 --raw ~/Downloads/lounge-raw.zip --name "Study lounge"
  npx tsx scripts/scan-import.ts ~/Downloads/lounge-fill-1.glb lounge-v1 --fill
`.trim();

// Registering the extensions also teaches gltf-transform to read WebP image sizes.
export const io = new NodeIO()
  .setLogger(new Logger(Logger.Verbosity.WARN))
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

export interface ImportOptions {
  /** The Polycam glTF export: a .glb or .gltf file, a .zip, or a folder. */
  input: string;
  scanId: string;
  name?: string;
  /** The Polycam Raw Data export: a .zip or a folder. */
  raw?: string;
  /** Replace an existing Scan. */
  force?: boolean;
  /** Add the export to an existing Scan as a Fill Capture, instead of making it the Scan's mesh. */
  fill?: boolean;
  /** Where Scan folders go. Defaults to data/scans/. */
  scansDir?: string;
}

/**
 * Imports a Polycam export as data/scans/<scanId>/ and measures the mesh it wrote: `room.glb`, or with
 * `fill`, the Fill Capture's `captures/fill-<n>.glb`.
 */
export async function importScan({ input, scanId, name = scanId, raw, force = false, fill = false, scansDir = SCANS_DIR }: ImportOptions) {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(scanId)) {
    throw new Error(`The scanId must look like lounge-v1 (lowercase letters, digits, and hyphens), not "${scanId}".`);
  }
  for (const path of [input, raw]) if (path !== undefined && !existsSync(path)) throw new Error(`Not found: ${path}`);
  const dir = join(scansDir, scanId);
  const manifestPath = join(dir, 'manifest.json');
  if (fill) {
    if (!existsSync(manifestPath)) throw new Error(`There is no Scan "${scanId}" yet. Import its Main Capture first, without --fill.`);
    if (raw) throw new Error('--raw goes with the Main Capture, not with --fill.');
  } else if (existsSync(manifestPath) && !force) {
    throw new Error(`${dir} already exists. Pass --force to replace it; then redo Room Setup step 1.`);
  }
  const manifest: ScanManifest = fill ? JSON.parse(await readFile(manifestPath, 'utf8')) : scanManifest(scanId, name);
  const captures = manifest.captures ?? { main: 'captures/main.glb', fills: [] };
  const mesh = fill ? `captures/fill-${captures.fills.length + 1}.glb` : manifest.mesh;

  const unzipped = await mkdtemp(join(tmpdir(), 'scan-import-'));
  try {
    const document = await io.read(await locateModel(input, unzipped));
    await optimizeScan(document);
    await document.transform(unpartition()); // a .glb holds one buffer
    await mkdir(join(dir, 'captures'), { recursive: true });
    await io.write(join(dir, mesh), document);
  } finally {
    await rm(unzipped, { recursive: true, force: true });
  }
  if (fill) {
    // The merge always rebuilds room.glb from the Main Capture, so keep it before room.glb changes.
    if (!manifest.captures) await copyFile(join(dir, manifest.mesh), join(dir, captures.main));
    const identity = { position: [0, 0, 0] as Vec3, rotationY: 0 };
    manifest.captures = { ...captures, fills: [...captures.fills, { mesh, transform: identity, moved: [] }] };
  }
  if (raw) await unpackRaw(raw, join(dir, 'raw'));
  // Written last: a manifest is what makes the folder a Scan (GET /api/scans lists them).
  await writeJson(manifestPath, manifest);
  return { dir, mesh, stats: measureScan(await io.read(join(dir, mesh))) };
}

/** Writes JSON the way the server's PUT routes do, so a later save makes a small diff. */
export const writeJson = (path: string, value: unknown) => writeFile(path, `${JSON.stringify(value, null, 2)}\n`);

/** The path of the model to import: the input itself, or the one model inside the folder or .zip. */
async function locateModel(input: string, unzipDir: string): Promise<string> {
  if (MODEL.test(input)) return input;
  if (ZIP.test(input)) {
    // Check the zip's index first: extracting the Raw Data zip by mistake would take minutes.
    const model = findModel(listZip(input));
    unzip(input, unzipDir);
    return join(unzipDir, model);
  }
  if (!statSync(input).isDirectory()) throw new Error(`Expected a .glb or .gltf file, a .zip, or a folder: ${input}`);
  const files = await readdir(input, { recursive: true });
  return join(input, findModel(files.map((file) => file.replaceAll('\\', '/'))));
}

/** The model file among the paths of an unzipped Polycam export. */
export function findModel(files: string[]): string {
  if (files.some((file) => /(^|\/)keyframes\//.test(file))) {
    throw new Error('This is the Raw Data export (it has keyframes/). Pass the glTF export here, and this one with --raw.');
  }
  // Zips made on a Mac also hold "__MACOSX/" and "._name" copies of each file.
  const models = files.filter((file) => MODEL.test(file) && !/(^|\/)(__MACOSX\/|\._)/.test(file));
  if (models.length === 0) throw new Error('No .gltf or .glb file in the export');
  if (models.length > 1) {
    throw new Error(`The export has ${models.length} models (${models.join(', ')}). Pass the one to import instead of the whole export.`);
  }
  return models[0];
}

/** Puts the Raw Data export in raw/, without the zip's top folder, so raw/ holds keyframes/ as msplat-train expects. */
async function unpackRaw(raw: string, rawDir: string) {
  await rm(rawDir, { recursive: true, force: true });
  if (ZIP.test(raw)) unzip(raw, rawDir);
  else await cp(raw, rawDir, { recursive: true });
  const entries = await readdir(rawDir);
  if (entries.length === 1 && (await stat(join(rawDir, entries[0]))).isDirectory()) {
    await rename(rawDir, `${rawDir}.unpacking`);
    await rename(join(`${rawDir}.unpacking`, entries[0]), rawDir);
    await rm(`${rawDir}.unpacking`, { recursive: true });
  }
}

// unzip's output is captured, which hides its notes about patterns that matched nothing; a failure still throws with it.
const runUnzip = (args: string[]) => execFileSync('unzip', args, { encoding: 'utf8', stdio: 'pipe' });
const listZip = (zip: string) => runUnzip(['-Z1', zip]).split('\n');
/** Extracts a zip, leaving out the "__MACOSX/" and "._name" copies that zips made on a Mac carry. */
const unzip = (zip: string, dir: string) => runUnzip(['-q', '-o', zip, '-d', dir, '-x', '__MACOSX/*', '._*', '*/._*']);

/**
 * Does what `gltf-transform optimize --texture-compress webp --texture-size 2048` does, with the CLI's
 * defaults (v4.5), in process. Then, while the mesh has more than maxTriangles, simplify passes target
 * that count. Scans have no animation, so the CLI's resample step is left out.
 */
export async function optimizeScan(document: Document, maxTriangles = MAX_TRIANGLES) {
  await Promise.all([MeshoptSimplifier.ready, MeshoptEncoder.ready]);
  await document.transform(
    dedup(), instance(), palette(), flatten(), joinPrimitives(), weld(),
    simplify({ simplifier: MeshoptSimplifier, error: 0.0001 }),
  );
  // meshoptimizer collapses the cheapest edges first, so with no error limit it stops at the target count.
  // The ratio applies to each primitive; when one can't shrink that far, the next pass takes more from the others.
  for (let triangles = countTriangles(document), before = Infinity; triangles > maxTriangles && triangles < before;) {
    await document.transform(simplify({ simplifier: MeshoptSimplifier, ratio: maxTriangles / triangles, error: 1 }));
    [before, triangles] = [triangles, countTriangles(document)];
  }
  await document.transform(
    prune(), sparse(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [TEXTURE_SIZE, TEXTURE_SIZE] }),
    meshopt({ encoder: MeshoptEncoder, level: 'high' }),
  );
}

function countTriangles(document: Document) {
  let triangles = 0;
  for (const mesh of document.getRoot().listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      if (primitive.getMode() === Primitive.Mode.TRIANGLES) triangles += getGLPrimitiveCount(primitive);
    }
  }
  return triangles;
}

/** A new Scan's manifest. Room Setup step 1 replaces the identity meshTransform. */
export const scanManifest = (id: string, name: string): ScanManifest => ({
  version: 1,
  id,
  name,
  mesh: 'room.glb',
  meshTransform: { position: [0, 0, 0], rotationY: 0 },
});

/** What the import summary reports about room.glb. Lengths are in the file's units, which should be meters. */
export interface ScanStats {
  triangles: number;
  textures: { width: number; height: number; mimeType: string; bytes: number }[];
  bounds: { min: Vec3; max: Vec3 };
}

/** Measures the default scene. The bounds are in world space, so node transforms (including quantization's) apply. */
export function measureScan(document: Document): ScanStats {
  const root = document.getRoot();
  const textures = root.listTextures().map((texture) => {
    const [width, height] = texture.getSize() ?? [0, 0];
    return { width, height, mimeType: texture.getMimeType(), bytes: texture.getImage()?.byteLength ?? 0 };
  });
  const { min, max } = getBounds(root.getDefaultScene() ?? root.listScenes()[0]);
  return { triangles: countTriangles(document), textures, bounds: { min, max } };
}

const formatBytes = (bytes: number) =>
  bytes < 1e3 ? `${bytes} B` : bytes < 1e6 ? `${Math.round(bytes / 1e3)} KB` : `${(bytes / 1e6).toFixed(1)} MB`;
// signDisplay: 'negative' prints scan noise just below 0 as "0.00", not "-0.00".
const formatMeters = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: 'negative' }).format;
const formatPoint = (point: Vec3) => `(${point.map(formatMeters).join(', ')})`;

/** The summary printed after an import. */
export function formatSummary({ triangles, textures, bounds: { min, max } }: ScanStats): string {
  const [sx, sy, sz] = max.map((value, axis) => value - min[axis]);
  const textureList = textures
    .map(({ width, height, mimeType, bytes }) => `${width}×${height} ${mimeType.replace('image/', '')} (${formatBytes(bytes)})`)
    .join(', ');
  const lines = [
    `Mesh      ${triangles.toLocaleString('en-US')} triangles`,
    `Textures  ${textures.length}: ${textureList}`,
    `Bounds    min ${formatPoint(min)} m, max ${formatPoint(max)} m`,
    `Size      X ${formatMeters(sx)} m, Y ${formatMeters(sy)} m (up), Z ${formatMeters(sz)} m`,
  ];
  if (triangles > MAX_TRIANGLES) {
    lines.push(`⚠ ${triangles.toLocaleString('en-US')} triangles is over the limit of ${MAX_TRIANGLES.toLocaleString('en-US')}.`);
  }
  if (sy < ROOM_HEIGHT.min || sy > ROOM_HEIGHT.max) {
    lines.push(`⚠ The Y extent is ${formatMeters(sy)} m, outside ${ROOM_HEIGHT_TEXT} for a room. Check that +Y is up and the units are meters.`);
  }
  return lines.join('\n');
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      raw: { type: 'string' },
      name: { type: 'string' },
      force: { type: 'boolean' },
      fill: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) return console.log(HELP);
  if (positionals.length !== 2) {
    console.error(`Expected <export> and <scanId>.\n\n${HELP}`);
    process.exitCode = 1;
    return;
  }
  const [input, scanId] = positionals;
  console.log(`Importing ${input} as Scan "${scanId}". Optimizing can take a minute…`);
  const { dir, mesh, stats } = await importScan({ input, scanId, ...values });
  const shown = relative(process.cwd(), dir);
  console.log(`\nWrote ${shown}/${mesh} and manifest.json${values.raw ? ', and unpacked the Raw Data into raw/' : ''}.\n`);
  console.log(formatSummary(stats));
  console.log(values.fill
    ? `\nNext: commit ${mesh}, captures/main.glb and manifest.json, then line it up in /setup/${scanId}, step 6 (Fill Captures).`
    : `\nNext: commit room.glb and manifest.json (git ignores raw/), then open /setup/${scanId} for Room Setup.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: Error) => {
    console.error(`scan-import: ${error.message}`);
    process.exitCode = 1;
  });
}
