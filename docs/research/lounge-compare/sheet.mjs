// Contact sheets: one per view, 2x2 grid of full-res tiles (a mesh, b R1 SH3, c R1 SH0, d R2 SH3), labeled.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const require = createRequire('/Users/jameswang/coding projects/mise/package.json');
const sharp = require('sharp');
const dir = new URL('./shots/', import.meta.url).pathname;
const outDir = new URL('./sheets/', import.meta.url).pathname;
mkdirSync(outDir, { recursive: true });
const tiles = [
  ['mesh', '(a) room.glb mesh (manifest.meshTransform)'],
  ['r1sh3', '(b) SPLAT_ROOM_1, SH3 (same crop + 1.5M as splat.spz)'],
  ['r1sh0', '(c) splat.spz = SPLAT_ROOM_1, SH0'],
  ['r2sh3', '(d) SPLAT_ROOM_2, SH3 (uncropped, 642k)'],
];
const views = (process.argv[2] ?? 'door,far,table,overview').split(',');
const tag = process.argv[3] ? '_' + process.argv[3] : '';
const W = 1440, H = 900, LB = 56;
const titles = { door: 'Eye level 1.6 m from the main door (West wall) looking in', far: 'Eye level 1.6 m from the far (North) end looking back', table: 'Close-up: table group nearest the door', overview: 'Overview from above, ~45 deg, everything above 2.38 m hidden' };
for (const v of views) {
  const comps = [];
  for (const [i, [src, label]] of tiles.entries()) {
    const x = (i % 2) * W, y = Math.floor(i / 2) * (H + LB);
    const svg = `<svg width="${W}" height="${LB}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#111"/><text x="16" y="38" font-family="Helvetica, Arial, sans-serif" font-size="30" fill="#fff">${label}</text></svg>`;
    comps.push({ input: Buffer.from(svg), left: x, top: y });
    comps.push({ input: `${dir}${v}_${src}${tag}.png`, left: x, top: y + LB });
  }
  const file = `${outDir}${v}${tag}.jpg`;
  await sharp({ create: { width: 2 * W, height: 2 * (H + LB), channels: 3, background: '#111' } }).composite(comps).jpeg({ quality: 85 }).toFile(file);
  console.log(file, titles[v]);
}
