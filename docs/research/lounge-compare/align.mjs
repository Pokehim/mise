// Aligns a Y-down splat PLY to the room frame of lounge-v1 (mesh-samples.bin, from mesh-extract.mjs).
// Model: room = position + RotY(rotationY) * (scale * F * p_raw), F = diag(1,-1,-1) (180 deg about X).
// Usage: node align.mjs <ply> <name> [--init yaw,scale,tx,ty,tz]
import { readFileSync, writeFileSync } from 'node:fs';
import { readSplatPly } from './ply-read.mjs';

const [path, name] = process.argv.slice(2);
const initArg = process.argv.indexOf('--init');
const DEG = 180 / Math.PI;
const ROOM = { x0: -1.568, x1: 1.55, z0: -3.545, z1: 3.673, h: 2.431 };

// ---------- mesh ----------
const mb = new Float32Array(readFileSync(new URL('./mesh-samples.bin', import.meta.url)).buffer.slice(0));
const mN = mb.length / 6;
const MC = 0.05;
const key = (i, j, k) => ((i + 512) * 1024 + (j + 512)) * 1024 + (k + 512);
const grid = new Map();
for (let i = 0; i < mN; i++) {
  const kk = key(Math.floor(mb[6 * i] / MC), Math.floor(mb[6 * i + 1] / MC), Math.floor(mb[6 * i + 2] / MC));
  let a = grid.get(kk); if (!a) grid.set(kk, (a = [])); a.push(i);
}
/** nearest mesh sample within r (<= 3 cells), returns [dist, idx] */
function nearest(x, y, z, r) {
  const ci = Math.floor(x / MC), cj = Math.floor(y / MC), ck = Math.floor(z / MC);
  const R = Math.ceil(r / MC);
  let best = r * r, bi = -1;
  for (let a = -R; a <= R; a++) for (let b = -R; b <= R; b++) for (let c = -R; c <= R; c++) {
    const cell = grid.get(key(ci + a, cj + b, ck + c)); if (!cell) continue;
    for (const m of cell) { const dx = mb[6 * m] - x, dy = mb[6 * m + 1] - y, dz = mb[6 * m + 2] - z; const d = dx * dx + dy * dy + dz * dz; if (d < best) { best = d; bi = m; } }
  }
  return bi < 0 ? [Infinity, -1] : [Math.sqrt(best), bi];
}

// ---------- splat ----------
const d = readSplatPly(path);
const n = d.count;
const FX = (i) => d.pos[3 * i], FY = (i) => -d.pos[3 * i + 1], FZ = (i) => -d.pos[3 * i + 2];
const sel = [];
for (let i = 0; i < n; i++) if (d.opacity[i] > 0.5 && d.maxScale[i] < 0.1) sel.push(i);

// floor: biggest 1cm-bin peak of flipped height, then plane fit
const hb = new Map();
for (const i of sel) { const b = Math.floor(FY(i) / 0.01); hb.set(b, (hb.get(b) || 0) + 1); }
let floorPeak = [...hb.entries()].sort((a, b) => b[1] - a[1])[0][0] * 0.01 + 0.005;
let A = [0, 0, floorPeak]; // y = A0 x + A1 z + A2
for (let it = 0; it < 4; it++) {
  const band = it === 0 ? 0.03 : 0.015;
  let sxx = 0, sxz = 0, szz = 0, sx = 0, sz = 0, s1 = 0, sxy = 0, szy = 0, sy = 0;
  for (const i of sel) {
    const x = FX(i), y = FY(i), z = FZ(i);
    if (Math.abs(y - (A[0] * x + A[1] * z + A[2])) > band) continue;
    sxx += x * x; sxz += x * z; szz += z * z; sx += x; sz += z; s1++; sxy += x * y; szy += z * y; sy += y;
  }
  // solve [[sxx sxz sx][sxz szz sz][sx sz s1]] A = [sxy szy sy]
  const M = [[sxx, sxz, sx], [sxz, szz, sz], [sx, sz, s1]], v = [sxy, szy, sy];
  const det = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const D = det(M);
  A = [0, 1, 2].map((c) => det(M.map((row, r) => row.map((x, cc) => (cc === c ? v[r] : x)))) / D);
}
const tiltDeg = Math.atan(Math.hypot(A[0], A[1])) * DEG;
console.error(`[${name}] selected ${sel.length}; floor peak ${floorPeak.toFixed(3)}; plane slope x ${A[0].toFixed(4)} z ${A[1].toFixed(4)} -> tilt ${tiltDeg.toFixed(2)} deg`);

// ---------- coarse: yaw histogram + scale/translation by 2D occupancy correlation ----------
const floorAt = (x, z) => A[0] * x + A[1] * z + A[2];
function yawFromHist(pts) {
  const score = (a) => { const c = Math.cos(a), s = Math.sin(a); const hx = new Map(), hz = new Map();
    for (const [x, z] of pts) { const bu = Math.floor((c * x + s * z) / 0.02), bv = Math.floor((-s * x + c * z) / 0.02); hx.set(bu, (hx.get(bu) || 0) + 1); hz.set(bv, (hz.get(bv) || 0) + 1); }
    let q = 0; for (const v of hx.values()) q += v * v; for (const v of hz.values()) q += v * v; return q; };
  let best = [0, -1]; for (let deg = 0; deg < 90; deg += 0.5) { const q = score(deg / DEG); if (q > best[1]) best = [deg, q]; }
  let fine = best; for (let deg = best[0] - 0.5; deg <= best[0] + 0.5; deg += 0.05) { const q = score(deg / DEG); if (q > fine[1]) fine = [deg, q]; }
  return fine[0] / DEG;
}
// wall-band splat points (in splat units above the floor: 0.2..1.3 units, roughly 0.3-2 m at s~1.5)
const band = [];
for (const i of sel) { const h = FY(i) - floorAt(FX(i), FZ(i)); if (h > 0.15 && h < 1.4) band.push([FX(i), FZ(i), h]); }
const yaw0 = yawFromHist(band.map(([x, z]) => [x, z]));
// rotation used in yawFromHist: u = c x + s z ; v = -s x + c z  == RotY(-a)?? three's RotY(t): x' = c x + s z, z' = -s x + c z. So it's RotY(a).
const CELL = 0.1, G = 140, OFF = 70; // mesh grid over [-7,7]
const meshOcc = new Uint8Array(G * G);
{
  const cnt = new Uint16Array(G * G);
  for (let i = 0; i < mN; i++) { const y = mb[6 * i + 1]; if (y < 0.3 || y > 2.0) continue; const gi = Math.floor(mb[6 * i] / CELL) + OFF, gk = Math.floor(mb[6 * i + 2] / CELL) + OFF; if (gi >= 0 && gi < G && gk >= 0 && gk < G) cnt[gi * G + gk]++; }
  for (let c = 0; c < G * G; c++) meshOcc[c] = cnt[c] >= 8 ? 1 : 0;
}
const meshCells = meshOcc.reduce((a, b) => a + b, 0);
let coarse = null;
if (initArg > 0) {
  const [yw, sc, tx, ty, tz] = process.argv[initArg + 1].split(',').map(Number);
  coarse = { yaw: yw / DEG, scale: sc, t: [tx, ty, tz], score: NaN };
} else {
  const results = [];
  for (let k = 0; k < 4; k++) {
    const yaw = yaw0 + k * Math.PI / 2, c = Math.cos(yaw), s = Math.sin(yaw);
    for (let scale = 0.8; scale <= 2.4001; scale += 0.02) {
      const cnt = new Map();
      let cx = 0, cz = 0, m = 0;
      for (const [x, z, h] of band) { const hm = h * scale; if (hm < 0.3 || hm > 2.0) continue; const u = scale * (c * x + s * z), v = scale * (-s * x + c * z); cx += u; cz += v; m++; const kk = Math.floor(u / CELL) * 100000 + Math.floor(v / CELL); cnt.set(kk, (cnt.get(kk) || 0) + 1); }
      cx /= m; cz /= m;
      const cells = [];
      for (const [kk, c2] of cnt) if (c2 >= 6) { const a = Math.round(kk / 100000); cells.push([a, kk - a * 100000]); }
      // translation search: centroid of splat band -> anywhere within +-3.5 m of room center (cells)
      const ci = Math.round(cx / CELL), ck = Math.round(cz / CELL);
      let best = [-1, 0, 0];
      for (let dx = -35; dx <= 35; dx++) for (let dz = -40; dz <= 40; dz++) {
        const sx = dx - ci + OFF, sz = dz - ck + OFF;
        let hit = 0;
        for (const [a, b] of cells) { const gi = a + sx, gk = b + sz; if (gi >= 0 && gi < G && gk >= 0 && gk < G) hit += meshOcc[gi * G + gk]; }
        if (hit > best[0]) best = [hit, dx - ci, dz - ck];
      }
      const f1 = 2 * best[0] / (cells.length + meshCells);
      results.push({ k, yaw, scale, tx: best[1] * CELL, tz: best[2] * CELL, f1, cells: cells.length });
    }
  }
  results.sort((a, b) => b.f1 - a.f1);
  console.error(`[${name}] yaw0 ${(yaw0 * DEG).toFixed(2)}; top coarse:`, results.slice(0, 6).map((r) => `k${r.k} s${r.scale.toFixed(2)} t(${r.tx.toFixed(1)},${r.tz.toFixed(1)}) f1 ${r.f1.toFixed(3)}`).join(' | '));
  // best per k for reporting
  const perK = [0, 1, 2, 3].map((k) => results.find((r) => r.k === k));
  console.error(`[${name}] best per 90deg candidate:`, perK.map((r) => `k${r.k} s${r.scale.toFixed(2)} f1 ${r.f1.toFixed(3)}`).join(' | '));
  const r = results[0];
  coarse = { yaw: r.yaw, scale: r.scale, t: [r.tx, -r.scale * floorPeak, r.tz], score: r.f1, perK };
}

// ---------- ICP (yaw + uniform scale + translation), trimmed, point-to-point ----------
// Source: subsample of selected splats near the room (after coarse transform)
const apply = (T, x, y, z) => { const c = Math.cos(T.yaw), s = Math.sin(T.yaw); const X = T.scale * x, Y = T.scale * y, Z = T.scale * z; return [c * X + s * Z + T.t[0], Y + T.t[1], -s * X + c * Z + T.t[2]]; };
let T = { yaw: coarse.yaw, scale: coarse.scale, t: [...coarse.t] };
let seed = 7; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const srcAll = sel.filter(() => rnd() < 120000 / sel.length);
function icpRound(maxD, iters) {
  for (let it = 0; it < iters; it++) {
    const P = [], Q = [];
    for (const i of srcAll) {
      const p = [FX(i), FY(i), FZ(i)];
      const r = apply(T, ...p);
      if (r[0] < ROOM.x0 - 0.5 || r[0] > ROOM.x1 + 0.5 || r[2] < ROOM.z0 - 0.5 || r[2] > ROOM.z1 + 0.5 || r[1] < -0.3 || r[1] > ROOM.h + 0.3) continue;
      const [dist, m] = nearest(r[0], r[1], r[2], maxD);
      if (m < 0) continue;
      P.push(p); Q.push([mb[6 * m], mb[6 * m + 1], mb[6 * m + 2]]);
    }
    // Umeyama about Y with scale (as AlignPanel.fitPointPairs)
    const cen = (a) => a.reduce((s, v) => [s[0] + v[0], s[1] + v[1], s[2] + v[2]], [0, 0, 0]).map((v) => v / a.length);
    const ps = cen(P), pr = cen(Q);
    let cs = 0, sn = 0, spread = 0;
    for (let i = 0; i < P.length; i++) { const ax = P[i][0] - ps[0], ay = P[i][1] - ps[1], az = P[i][2] - ps[2]; const bx = Q[i][0] - pr[0], bz = Q[i][2] - pr[2]; cs += ax * bx + az * bz; sn += az * bx - ax * bz; spread += ax * ax + ay * ay + az * az; }
    const yaw = Math.atan2(sn, cs), c = Math.cos(yaw), s = Math.sin(yaw);
    let along = 0;
    for (let i = 0; i < P.length; i++) { const ax = P[i][0] - ps[0], ay = P[i][1] - ps[1], az = P[i][2] - ps[2]; const rx = c * ax + s * az, rz = -s * ax + c * az; along += (Q[i][0] - pr[0]) * rx + (Q[i][1] - pr[1]) * ay + (Q[i][2] - pr[2]) * rz; }
    const scale = along / spread;
    const rp = [c * ps[0] + s * ps[2], ps[1], -s * ps[0] + c * ps[2]];
    T = { yaw, scale, t: [pr[0] - scale * rp[0], pr[1] - scale * rp[1], pr[2] - scale * rp[2]] };
  }
}
for (const [maxD, iters] of [[0.4, 6], [0.25, 6], [0.15, 8], [0.1, 8], [0.06, 10]]) icpRound(maxD, iters);


function residualOf(applyFn) {
  const dists = [];
  for (const i of srcAll) {
    const r = applyFn(FX(i), FY(i), FZ(i));
    if (r[0] < ROOM.x0 || r[0] > ROOM.x1 || r[2] < ROOM.z0 || r[2] > ROOM.z1 || r[1] < -0.1 || r[1] > ROOM.h + 0.1) continue;
    dists.push(nearest(r[0], r[1], r[2], 0.3)[0]);
  }
  dists.sort((a, b) => a - b);
  const inl = dists.filter((x) => x < 0.1);
  const q = (p) => dists[Math.floor(p * dists.length)];
  return { pointsInRoom: dists.length, medianM: +q(0.5).toFixed(4), p80M: +q(0.8).toFixed(4), inlierShareLt10cm: +(inl.length / dists.length).toFixed(3), rmsInliersM: +Math.sqrt(inl.reduce((a, b) => a + b * b, 0) / inl.length).toFixed(4) };
}
const res5 = residualOf((x, y, z) => apply(T, x, y, z));

// ---------- stage 2: full rotation (Horn quaternion) + scale + translation, starting from T ----------
function jacobiEig4(Ain) {
  const a = Ain.map((r) => r.slice()); const V = [[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]];
  for (let sweep = 0; sweep < 50; sweep++) {
    let off = 0; for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) off += a[i][j] * a[i][j];
    if (off < 1e-20) break;
    for (let p = 0; p < 4; p++) for (let q = p + 1; q < 4; q++) {
      if (Math.abs(a[p][q]) < 1e-30) continue;
      const th = (a[q][q] - a[p][p]) / (2 * a[p][q]);
      const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < 4; k++) { const akp = a[k][p], akq = a[k][q]; a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq; }
      for (let k = 0; k < 4; k++) { const apk = a[p][k], aqk = a[q][k]; a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk; }
      for (let k = 0; k < 4; k++) { const vkp = V[k][p], vkq = V[k][q]; V[k][p] = c * vkp - s * vkq; V[k][q] = s * vkp + c * vkq; }
    }
  }
  let bi = 0; for (let i = 1; i < 4; i++) if (a[i][i] > a[bi][bi]) bi = i;
  return [V[0][bi], V[1][bi], V[2][bi], V[3][bi]];
}
const quatToMat = ([w, x, y, z]) => [
  [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
  [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
  [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)]];
// initial R from yaw: three RotY(a): [[c,0,s],[0,1,0],[-s,0,c]]
let R = [[Math.cos(T.yaw), 0, Math.sin(T.yaw)], [0, 1, 0], [-Math.sin(T.yaw), 0, Math.cos(T.yaw)]];
let S7 = T.scale, t7 = [...T.t];
const apply7 = (x, y, z) => [S7 * (R[0][0] * x + R[0][1] * y + R[0][2] * z) + t7[0], S7 * (R[1][0] * x + R[1][1] * y + R[1][2] * z) + t7[1], S7 * (R[2][0] * x + R[2][1] * y + R[2][2] * z) + t7[2]];
for (const [maxD, iters] of [[0.1, 8], [0.06, 12]]) for (let it = 0; it < iters; it++) {
  const P = [], Q = [];
  for (const i of srcAll) {
    const p = [FX(i), FY(i), FZ(i)]; const r = apply7(...p);
    if (r[0] < ROOM.x0 - 0.5 || r[0] > ROOM.x1 + 0.5 || r[2] < ROOM.z0 - 0.5 || r[2] > ROOM.z1 + 0.5 || r[1] < -0.3 || r[1] > ROOM.h + 0.3) continue;
    const [, m] = nearest(r[0], r[1], r[2], maxD); if (m < 0) continue;
    P.push(p); Q.push([mb[6 * m], mb[6 * m + 1], mb[6 * m + 2]]);
  }
  const cen = (a) => a.reduce((s, v) => [s[0] + v[0], s[1] + v[1], s[2] + v[2]], [0, 0, 0]).map((v) => v / a.length);
  const ps = cen(P), pr = cen(Q);
  const Sm = [[0,0,0],[0,0,0],[0,0,0]]; let spread = 0;
  for (let i = 0; i < P.length; i++) { const a = [P[i][0]-ps[0], P[i][1]-ps[1], P[i][2]-ps[2]], b = [Q[i][0]-pr[0], Q[i][1]-pr[1], Q[i][2]-pr[2]]; for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) Sm[r][c] += a[r] * b[c]; spread += a[0]*a[0]+a[1]*a[1]+a[2]*a[2]; }
  const [[Sxx,Sxy,Sxz],[Syx,Syy,Syz],[Szx,Szy,Szz]] = Sm;
  const N = [[Sxx+Syy+Szz, Syz-Szy, Szx-Sxz, Sxy-Syx],[Syz-Szy, Sxx-Syy-Szz, Sxy+Syx, Szx+Sxz],[Szx-Sxz, Sxy+Syx, -Sxx+Syy-Szz, Syz+Szy],[Sxy-Syx, Szx+Sxz, Syz+Szy, -Sxx-Syy+Szz]];
  R = quatToMat(jacobiEig4(N));
  let along = 0; for (let i = 0; i < P.length; i++) { const a = [P[i][0]-ps[0], P[i][1]-ps[1], P[i][2]-ps[2]]; for (let r = 0; r < 3; r++) along += (Q[i][r]-pr[r]) * (R[r][0]*a[0]+R[r][1]*a[1]+R[r][2]*a[2]); }
  S7 = along / spread;
  t7 = [0,1,2].map((r) => pr[r] - S7 * (R[r][0]*ps[0]+R[r][1]*ps[1]+R[r][2]*ps[2]));
}
const res7 = residualOf(apply7);
// decompose R = RotY(yaw) * tilt: yaw from where R maps x axis in xz; tilt = angle between R*(0,1,0) and +Y
const upY = [R[0][1], R[1][1], R[2][1]];
const tilt7 = Math.acos(Math.min(1, upY[1])) * DEG;
const yaw7 = Math.atan2(R[0][2] - 0, R[2][2]); // approx yaw (R*z axis)
// full matrix in raw PLY coords: M = S7 * R * F, F = diag(1,-1,-1)
const Mraw = R.map((row) => [S7 * row[0], -S7 * row[1], -S7 * row[2]]);
const res = {
  name, floorPeakSplatUnits: +floorPeak.toFixed(3), floorTiltDeg: +tiltDeg.toFixed(2),
  coarse: { yawDeg: +(coarse.yaw * DEG).toFixed(2), scale: +coarse.scale.toFixed(3), t: coarse.t.map((v) => +v.toFixed(2)), f1: coarse.score, perK: coarse.perK?.map((r) => ({ k: r.k, scale: r.scale, f1: +r.f1.toFixed(3) })) },
  yawOnly: { axisFlip: 'rotate 180deg about X first (y->-y, z->-z)', position: T.t.map((v) => +v.toFixed(3)), rotationY: +T.yaw.toFixed(4), rotationYDeg: +(T.yaw * DEG).toFixed(2), scale: +T.scale.toFixed(4), residual: res5 },
  full: { note: 'room = t + scale * R * F * p_raw', R: R.map((r) => r.map((v) => +v.toFixed(6))), scale: +S7.toFixed(4), t: t7.map((v) => +v.toFixed(4)), tiltDeg: +tilt7.toFixed(2), yawDegApprox: +(yaw7 * DEG).toFixed(2), residual: res7, matrixRaw: Mraw.map((r) => r.map((v) => +v.toFixed(6))) },
};
console.log(JSON.stringify(res));
writeFileSync(new URL(`./align-${name}.json`, import.meta.url), JSON.stringify(res, null, 2));
