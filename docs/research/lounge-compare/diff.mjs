import { createRequire } from 'node:module';
const require = createRequire('/Users/jameswang/coding projects/mise/package.json');
const sharp = require('sharp');
const dir = new URL('./shots/', import.meta.url).pathname;
async function px(f) { return (await sharp(dir + f).removeAlpha().raw().toBuffer()); }
const pairs = [['door_r1sh3.png','door_r1sh0.png'],['far_r1sh3.png','far_r1sh0.png'],['table_r1sh3.png','table_r1sh0.png'],['overview_r1sh3.png','overview_r1sh0.png'],['door_r1sh3.png','door_r1ply.png']];
for (const [a,b] of pairs) {
  const A = await px(a), B = await px(b);
  let s = 0, big = 0, n = A.length / 3;
  for (let i = 0; i < A.length; i += 3) { const d = (Math.abs(A[i]-B[i]) + Math.abs(A[i+1]-B[i+1]) + Math.abs(A[i+2]-B[i+2])) / 3; s += d; if (d > 20) big++; }
  console.log(a, 'vs', b, 'meanAbsDiff(0-255)', (s/n).toFixed(2), 'pixels >20 levels', (100*big/n).toFixed(1)+'%');
}
// detail crops: [view, left, top, w, h, name]
const crops = [['door', 950, 180, 490, 330, 'whiteboard'], ['door', 330, 230, 330, 260, 'window'], ['table', 300, 250, 560, 380, 'tabletop'], ['table', 0, 120, 420, 520, 'glass']];
const srcs = ['mesh', 'r1sh3', 'r1sh0', 'r2sh3'];
for (const [v, l, t, w, h, name] of crops) {
  const comps = [];
  for (const [i, s] of srcs.entries()) comps.push({ input: await sharp(`${dir}${v}_${s}.png`).extract({ left: l, top: t, width: w, height: h }).resize(w * 2, h * 2, { kernel: 'nearest' }).toBuffer(), left: i * (w * 2 + 8), top: 0 });
  await sharp({ create: { width: 4 * (w * 2 + 8), height: h * 2, channels: 3, background: '#111' } }).composite(comps).jpeg({ quality: 88 }).toFile(new URL(`./sheets/crop_${name}.jpg`, import.meta.url).pathname);
}
