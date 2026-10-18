import { readFileSync } from 'node:fs';
import { readSplatPly } from './ply-read.mjs';
const jobs = [['SPLAT_ROOM_1', '/Users/jameswang/coding projects/mise/data/scans/real-scans/SPLAT_ROOM_1.ply', 'ROOM_1'], ['SPLAT_ROOM_2', '/Users/jameswang/coding projects/mise/data/scans/real-scans/SPLAT_ROOM_2.ply', 'ROOM_2'], ['splat.spz', new URL('./spz-as.ply', import.meta.url).pathname, 'ROOM_1']];
for (const [label, path, al] of jobs) {
  const a = JSON.parse(readFileSync(new URL(`./align-${al}.json`, import.meta.url)));
  const M = a.full.matrixRaw, t = a.full.t;
  const d = readSplatPly(path);
  const ax = [[], [], []];
  for (let i = 0; i < d.count; i++) { if (d.opacity[i] < 0.05) continue; const x = d.pos[3*i], y = d.pos[3*i+1], z = d.pos[3*i+2]; for (let r = 0; r < 3; r++) ax[r].push(M[r][0]*x + M[r][1]*y + M[r][2]*z + t[r]); }
  const q = (v, p) => v[Math.floor(p * v.length)];
  const res = ax.map((v) => { const s = Float32Array.from(v).sort(); return [q(s, 0), q(s, 0.01), q(s, 0.5), q(s, 0.99), q(s, 0.9999999)].map((x) => +x.toFixed(2)); });
  console.log(label, 'room-frame [min,p1,median,p99,max] x', JSON.stringify(res[0]), 'y', JSON.stringify(res[1]), 'z', JSON.stringify(res[2]));
}
