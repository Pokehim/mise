// The one color gain that matches a whole Capture to another of the same room. Run with --help for usage.
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import type { RoomSetup } from '../shared/types';
import { IDENTITY } from '../web/src/setup/geometry/align';
import { triangleClassifier } from '../web/src/setup/geometry/classify';
import { captureGain, captureSources, parseTransform, surfaces } from './capture-tools';
import { readExport } from './scan-import';

const HELP = `
The one color gain that matches a whole Capture to a reference Capture of the same room, from Polycam
or KIRI Engine (ADR-0008): the per-channel median, over the floor and wall cells both saw, of
reference ÷ other, in linear RGB (multiply the other Capture's baseColorFactor by it). Use it before
any per-region gain, so Captures from different apps and walk-throughs meet without a color step.

Usage:
  npx tsx scripts/capture-gain.ts <setup.json> <reference> <other> [--reference-transform <t>] [--other-transform <t>]

Arguments:
  <setup.json>  A Room Setup in the room frame: its floor polygon, walls and ceiling tell which
                triangles are floor and wall.
  <reference>   The Capture to match, such as the Main Capture: a .glb, .gltf or KIRI .obj, a .zip,
                or a folder (anything scan-import reads).
  <other>       The Capture whose colors to match to it.

Options:
  --reference-transform <t>, --other-transform <t>
                Each Capture's frame → the room frame: JSON like a manifest's meshTransform, or
                "x,y,z,rotationY". Default: none (already in the room frame).
  -h, --help    Show this help.

Example (lounge-v1: the KIRI scene against the Main Capture):
  npx tsx scripts/capture-gain.ts data/scans/lounge-v1/setup.json data/scans/real-scans/POLYCAM_ROOM_GLB_1.glb \\
    data/scans/real-scans/KIRI_ENGINE_CHAIR_1 --reference-transform '{"position":[-0.044,1.202,0.029],"rotationY":-0.008005}' \\
    --other-transform '{"position":[0.718,1.337,0.809],"rotationY":1.03249}'
`.trim();

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      'reference-transform': { type: 'string' },
      'other-transform': { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) return console.log(HELP);
  if (positionals.length !== 3) {
    console.error(`Expected <setup.json>, <reference> and <other>.\n\n${HELP}`);
    process.exitCode = 1;
    return;
  }
  const [setupPath, referencePath, otherPath] = positionals;
  const setup: RoomSetup = JSON.parse(await readFile(setupPath, 'utf8'));
  const { classify } = triangleClassifier(setup);
  const [reference, other] = await Promise.all([
    [referencePath, values['reference-transform']], [otherPath, values['other-transform']],
  ].map(async ([path, transform]) => surfaces(
    captureSources(await readExport(path!), transform ? parseTransform(transform) : IDENTITY, IDENTITY, classify), setup,
  )));
  const { gain, cells } = await captureGain(reference, other);
  console.log(`Gain ${gain.join(' / ')} (linear RGB), from ${cells} cells of floor and wall both Captures saw.`);
  if (cells < 10) console.log('⚠ Too few cells in common, so the gain is 1. Check that both transforms put the Captures in the room frame.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: Error) => {
    console.error(`capture-gain: ${error.message}`);
    process.exitCode = 1;
  });
}
