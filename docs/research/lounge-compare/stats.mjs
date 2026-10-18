import { readSplatPly } from './ply-read.mjs';
const files = {
  ROOM_1: '/Users/jameswang/coding projects/mise/data/scans/real-scans/SPLAT_ROOM_1.ply',
  ROOM_2: '/Users/jameswang/coding projects/mise/data/scans/real-scans/SPLAT_ROOM_2.ply',
  SPZ: new URL('./spz-as.ply', import.meta.url).pathname,
};
const pct = (arr, ps) => { const a = Float32Array.from(arr).sort(); return ps.map((p) => +a[Math.min(a.length - 1, Math.floor(p * a.length))].toFixed(3)); };
for (const [name, path] of Object.entries(files)) {
  const t = Date.now();
  const d = readSplatPly(path);
  const n = d.count;
  const axis = [0, 1, 2].map((j) => { const v = new Float32Array(n); for (let i = 0; i < n; i++) v[i] = d.pos[3 * i + j]; return v; });
  const mn = axis.map((v) => v.reduce((a, b) => Math.min(a, b), Infinity));
  const mx = axis.map((v) => v.reduce((a, b) => Math.max(a, b), -Infinity));
  let transp = 0, big = 0, big1 = 0, op5 = 0;
  for (let i = 0; i < n; i++) { if (d.opacity[i] < 0.05) transp++; if (d.maxScale[i] > 0.3) big++; if (d.maxScale[i] > 1) big1++; if (d.opacity[i] > 0.5) op5++; }
  console.log(JSON.stringify({
    name, count: n, shDegree: d.shDegree, props: d.props.length,
    min: mn.map((x) => +x.toFixed(3)), max: mx.map((x) => +x.toFixed(3)),
    p01_p99: axis.map((v) => pct(v, [0.01, 0.5, 0.99])),
    transparentLt005: +(transp / n * 100).toFixed(2), bigGt03m: +(big / n * 100).toFixed(3), bigGt1m: +(big1 / n * 100).toFixed(3), opaqueGt05: +(op5 / n * 100).toFixed(1),
    maxScalePct: pct(d.maxScale, [0.5, 0.9, 0.99, 0.999]), opacityPct: pct(d.opacity, [0.1, 0.5, 0.9]),
    meanAbsSHrest: d.shDegree ? +(d.shAbs.reduce((a, b) => a + b, 0) / n).toFixed(4) : 0,
    sec: (Date.now() - t) / 1000,
  }));
}
