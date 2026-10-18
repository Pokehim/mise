// Flip Y-down -> Y-up (180 deg about X: y->-y, z->-z), print the height histogram, then the yaw search.
import { readSplatPly } from './ply-read.mjs';
const path = process.argv[2];
const d = readSplatPly(path);
const n = d.count;
const sel = [];
for (let i = 0; i < n; i++) if (d.opacity[i] > 0.5 && d.maxScale[i] < 0.1) sel.push(i);
const X = new Float32Array(sel.length), Y = new Float32Array(sel.length), Z = new Float32Array(sel.length);
sel.forEach((i, k) => { X[k] = d.pos[3 * i]; Y[k] = -d.pos[3 * i + 1]; Z[k] = -d.pos[3 * i + 2]; });
// height histogram, 2 cm bins, -4..6
const bins = new Map();
for (let k = 0; k < Y.length; k++) { const b = Math.floor(Y[k] / 0.02); bins.set(b, (bins.get(b) || 0) + 1); }
const sorted = [...bins.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
console.log('selected', sel.length, 'top height bins (y_up, count):', sorted.map(([b, c]) => [(b * 0.02 + 0.01).toFixed(2), c]));
// coarse histogram 10cm
const line = [];
for (let b = -30; b < 50; b++) { let c = 0; for (let j = 0; j < 5; j++) c += bins.get(b * 5 + j) || 0; if (c > 0.002 * Y.length) line.push(`${(b * 0.1).toFixed(1)}:${c}`); }
console.log('10cm bins:', line.join(' '));
const floorY = +process.argv[3] || 0, ceilY = +process.argv[4] || 0;
if (ceilY) {
  // yaw search on wall band points
  const lo = floorY + 0.3 * (ceilY - floorY), hi = floorY + 0.85 * (ceilY - floorY);
  const W = [];
  for (let k = 0; k < Y.length; k++) if (Y[k] > lo && Y[k] < hi) W.push(k);
  let best = [0, 0];
  const score = (a) => {
    const c = Math.cos(a), s = Math.sin(a);
    const hx = new Map(), hz = new Map();
    for (const k of W) { const u = c * X[k] + s * Z[k], v = -s * X[k] + c * Z[k]; const bu = Math.floor(u / 0.02), bv = Math.floor(v / 0.02); hx.set(bu, (hx.get(bu) || 0) + 1); hz.set(bv, (hz.get(bv) || 0) + 1); }
    let q = 0; for (const v of hx.values()) q += v * v; for (const v of hz.values()) q += v * v; return q;
  };
  for (let deg = 0; deg < 90; deg += 0.5) { const q = score(deg * Math.PI / 180); if (q > best[1]) best = [deg, q]; }
  let fine = best;
  for (let deg = best[0] - 0.5; deg <= best[0] + 0.5; deg += 0.05) { const q = score(deg * Math.PI / 180); if (q > fine[1]) fine = [deg, q]; }
  console.log('wall band', W.length, 'best yaw deg (rotation applied to xz)', fine[0].toFixed(2));
  const a = fine[0] * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  for (const [nm, f] of [['u', (k) => c * X[k] + s * Z[k]], ['v', (k) => -s * X[k] + c * Z[k]]]) {
    const h = new Map(); for (const k of W) { const b = Math.floor(f(k) / 0.05); h.set(b, (h.get(b) || 0) + 1); }
    const top = [...h.entries()].sort((p, q) => q[1] - p[1]).slice(0, 10).map(([b, cn]) => [(b * 0.05 + 0.025).toFixed(2), cn]).sort((p, q) => p[0] - q[0]);
    console.log(nm, 'top 5cm peaks', JSON.stringify(top));
  }
}
