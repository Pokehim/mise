// Lines a close-up of one piece of furniture up with its copies in a room scan, scale included.
// Run with --help for usage.
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import type { Box } from '../shared/types';
import { roundedYaw } from '../web/src/setup/geometry/align';
import { type CloseupFit, documentTriangles, parseTransform, registerCloseup } from './capture-tools';
import { parseCrop, readExport } from './scan-import';

const HELP = `
Lines a close-up of one piece of furniture (a Detail Capture, such as POLYCAM_CHAIR_1.glb) up with its
copies in a room scan: its turn, position and scale, since an app's object mode can get a close-up's
size 10–40% wrong (ADR-0008). Each box is fitted on its own; the median scale is the close-up's true size.

Usage:
  npx tsx scripts/register-closeup.ts <close-up> <room-scan> --box <box> [--box <box> …] [options]

Arguments:
  <close-up>   The close-up, in meters as its app saved it, +Y up: a .glb, .gltf or KIRI .obj, a .zip,
               or a folder (anything scan-import reads). It stands on its floor in its own frame.
  <room-scan>  A room scan with the piece in it, in meters, such as POLYCAM_ROOM_GLB_1.glb.

Options:
  --box <box>             A copy of the piece in the room frame, as setup.json and layout.json store boxes:
                          '{"position":[x,y,z],"size":[w,h,d],"rotationY":r}' (bottom-center). Repeat it
                          for each copy, such as each of the 12 chairs.
  --boxes <file>          A JSON file with an array of boxes, or of objects that have a "box" (such as
                          setup.json's originals). Used with or instead of --box.
  --room-transform <t>    The room scan's frame → the room frame: JSON like a manifest's meshTransform, or
                          "x,y,z,rotationY". Default: none (the scan is in the room frame already).
  --crop <rect>           Keep only the close-up's triangles whose center is inside "minX,minZ,maxX,maxZ"
                          in its own frame, to cut the piece out of the floor and walls around it. Write it
                          as --crop=<rect> when it starts with a minus sign.
  --json                  Print the result as JSON only.
  -h, --help              Show this help.

Prints, for each box: the transform that carries the close-up's frame into the room frame (with its
"scale"), the median distance between the two copies, the share of the close-up that found a match,
and the scale the two copies' heights gave to start from; then the median scale over the boxes.

Example (lounge-v1's room frame; the chair boxes from a setup.json):
  npx tsx scripts/register-closeup.ts data/scans/real-scans/POLYCAM_CHAIR_1.glb data/scans/real-scans/POLYCAM_ROOM_GLB_1.glb \\
    --room-transform '{"position":[-0.044,1.202,0.029],"rotationY":-0.008005}' --crop=-0.55,-0.70,0.36,0.20 \\
    --box '{"position":[-1.24,0,2.18],"size":[0.48,0.84,0.54],"rotationY":3.1416}'
`.trim();

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      box: { type: 'string', multiple: true },
      boxes: { type: 'string' },
      'room-transform': { type: 'string' },
      crop: { type: 'string' },
      json: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) return console.log(HELP);
  const boxes: Box[] = (values.box ?? []).map((text) => JSON.parse(text));
  if (values.boxes) {
    const list = JSON.parse(await readFile(values.boxes, 'utf8')) as (Box | { box: Box })[];
    boxes.push(...list.map((item) => ('box' in item ? item.box : item)));
  }
  if (positionals.length !== 2 || boxes.length === 0) {
    console.error(`Expected <close-up>, <room-scan> and at least one box.\n\n${HELP}`);
    process.exitCode = 1;
    return;
  }
  const [closeupPath, roomPath] = positionals;
  const closeup = documentTriangles(await readExport(closeupPath, values.crop === undefined ? undefined : parseCrop(values.crop)));
  const room = documentTriangles(await readExport(roomPath), values['room-transform'] ? parseTransform(values['room-transform']) : undefined);
  const fits = boxes.map((box) => ({ box, ...summarize(registerCloseup(closeup, room, box)) }));
  const scales = fits.map((f) => f.transform.scale ?? 1).sort((a, b) => a - b);
  const medianScale = Math.round(((scales[Math.floor((scales.length - 1) / 2)] + scales[Math.floor(scales.length / 2)]) / 2) * 1e4) / 1e4;
  if (values.json) return console.log(JSON.stringify({ fits, medianScale }, null, 2));
  fits.forEach(({ box, transform, residual, matched, heightScale }, i) => {
    console.log(`Box ${i + 1} at (${box.position.map((v) => v.toFixed(2)).join(', ')}): scale ${transform.scale ?? 1}, `
      + `within ${(residual * 100).toFixed(1)} cm (median), ${Math.round(matched * 100)}% matched, heights gave ${heightScale.toFixed(3)}`);
    console.log(`  transform ${JSON.stringify(transform)}`);
  });
  console.log(`\nMedian scale over ${fits.length} box${fits.length > 1 ? 'es' : ''}: ${medianScale}`);
}

const summarize = ({ transform, residual, matched, heightScale }: CloseupFit) => ({
  transform: roundedYaw(transform), residual: Math.round(residual * 1e4) / 1e4, matched: Math.round(matched * 100) / 100,
  heightScale: Math.round(heightScale * 1e4) / 1e4,
});

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: Error) => {
    console.error(`register-closeup: ${error.message}`);
    process.exitCode = 1;
  });
}
