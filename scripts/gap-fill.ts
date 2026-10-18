// The floor and wall other Captures saw where a reference Capture has holes, written as a .glb.
// Run with --help for usage.
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { Document, Logger } from '@gltf-transform/core';
import { createDefaultPropertyResolver, dedup, prune } from '@gltf-transform/functions';
import type { RoomSetup } from '../shared/types';
import { IDENTITY } from '../web/src/setup/geometry/align';
import { triangleClassifier } from '../web/src/setup/geometry/classify';
import { addPieces, captureSources, gapFill, parseTransform, pickedArea } from './capture-tools';
import { io, readExport } from './scan-import';

const HELP = `
Gap fill (ADR-0008): the floor and wall that other Captures of the room saw where a reference
Capture has holes, written as a .glb in the room frame, color-matched to the reference per 1 m cell.
Each other Capture only fills what the reference and the ones before it left. Conservative: only
floor and wall triangles that face their floor or wall, where no surface of the reference lies within
3 cm along it and 8 cm in front of or behind it, in pieces of at least 50 cm². Furniture is left out.

Usage:
  npx tsx scripts/gap-fill.ts <setup.json> <reference> <other> [<other> …] --out <gaps.glb> [--transform <t> …]

Arguments:
  <setup.json>  A Room Setup in the room frame: its floor polygon, walls and ceiling tell which
                triangles are floor and wall, and keep the fill inside the room.
  <reference>   The Capture whose holes to fill, such as the Main Capture: a .glb, .gltf or KIRI .obj,
                a .zip, or a folder (anything scan-import reads).
  <other>       Captures that saw the room too, in order of preference.

Options:
  --out <file>      Where to write the gap pieces: one primitive per source texture, tagged
                    extras.mise.fill = { kind: "gap", capture: <index among the others> }.
  --transform <t>   Each Capture's frame → the room frame, in the order given (reference first): JSON like
                    a manifest's meshTransform, or "x,y,z,rotationY". Missing ones are none.
  -h, --help        Show this help.

Example (lounge-v1: fill the Main Capture's holes from POLYCAM_ROOM_GLB_2, then the KIRI scene):
  npx tsx scripts/gap-fill.ts data/scans/lounge-v1/setup.json data/scans/real-scans/POLYCAM_ROOM_GLB_1.glb \\
    data/scans/real-scans/POLYCAM_ROOM_GLB_2.glb data/scans/real-scans/KIRI_ENGINE_CHAIR_1 --out gaps.glb \\
    --transform '{"position":[-0.044,1.202,0.029],"rotationY":-0.008005}' \\
    --transform '{"position":[-0.001,1.203,0.041],"rotationY":-0.012187}' \\
    --transform '{"position":[0.718,1.337,0.809],"rotationY":1.03249}'
`.trim();

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      out: { type: 'string' },
      transform: { type: 'string', multiple: true },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) return console.log(HELP);
  if (positionals.length < 3 || !values.out) {
    console.error(`Expected <setup.json>, <reference>, at least one <other>, and --out.\n\n${HELP}`);
    process.exitCode = 1;
    return;
  }
  const [setupPath, ...capturePaths] = positionals;
  const setup: RoomSetup = JSON.parse(await readFile(setupPath, 'utf8'));
  const { classify } = triangleClassifier(setup);
  const documents = await Promise.all(capturePaths.map((path) => readExport(path)));
  const sources = documents.map((document, i) => {
    const transform = values.transform?.[i];
    return captureSources(document, transform ? parseTransform(transform) : IDENTITY, IDENTITY, classify);
  });
  const pieces = await gapFill(setup, sources[0], sources.slice(1));

  const out = new Document().setLogger(new Logger(Logger.Verbosity.WARN));
  out.createScene();
  for (const { capture, triangles, gainAt } of pieces) {
    const from = documents[capture + 1];
    const name = `Gap fill (${capturePaths[capture + 1].split('/').pop()})`;
    addPieces(out, from, createDefaultPropertyResolver(out, from), triangles, gainAt, name, { mise: { fill: { kind: 'gap', capture } } });
    console.log(`${capturePaths[capture + 1]}: ${triangles.length.toLocaleString('en-US')} triangles, ${pickedArea(triangles).toFixed(2)} m²`);
  }
  if (pieces.length === 0) console.log('No gaps that the other Captures saw.');
  await out.transform(dedup(), prune());
  await io.write(values.out, out);
  console.log(`Wrote ${values.out}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: Error) => {
    console.error(`gap-fill: ${error.message}`);
    process.exitCode = 1;
  });
}
