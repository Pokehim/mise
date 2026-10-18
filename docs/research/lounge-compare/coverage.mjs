// Coverage (10 cm cells per room surface), floaters, and residual for an aligned splat, plus the mesh baseline.
// node coverage.mjs <ply> <alignName> <label>     |   node coverage.mjs mesh
import { readFileSync, appendFileSync } from 'node:fs';
import { readSplatPly } from './ply-read.mjs';

const ROOM = { x0: -1.568, x1: 1.55, z0: -3.545, z1: 3.673, h: 2.431 };
const CELL = 0.1, TOL = 0.06;
const [path, alignName, label] = process.argv.slice(2);

const mb = new Float32Array(readFileSync(new URL('./mesh-samples.bin', import.meta.url)).buffer.slice(0));
const mN = mb.length / 6;

// surfaces: plane coordinate + 2D cell indexing
const surfaces = [
  { name: 'floor', dist: (x, y, z) => y - 0, uv: (x, y, z) => [x - ROOM.x0, z - ROOM.z0], size: [ROOM.x1 - ROOM.x0, ROOM.z1 - ROOM.z0], inward: [0, 1, 0] },
  { name: 'ceiling', dist: (x, y, z) => y - ROOM.h, uv: (x, y, z) => [x - ROOM.x0, z - ROOM.z0], size: [ROOM.x1 - ROOM.x0, ROOM.z1 - ROOM.z0], inward: [0, -1, 0] },
  { name: 'N (z=-3.545)', dist: (x, y, z) => z - ROOM.z0, uv: (x, y, z) => [x - ROOM.x0, y], size: [ROOM.x1 - ROOM.x0, ROOM.h], inward: [0, 0, 1] },
  { name: 'S (z=3.673)', dist: (x, y, z) => z - ROOM.z1, uv: (x, y, z) => [x - ROOM.x0, y], size: [ROOM.x1 - ROOM.x0, ROOM.h], inward: [0, 0, -1] },
  { name: 'W (x=-1.568)', dist: (x, y, z) => x - ROOM.x0, uv: (x, y, z) => [z - ROOM.z0, y], size: [ROOM.z1 - ROOM.z0, ROOM.h], inward: [1, 0, 0] },
  { name: 'E (x=1.55)', dist: (x, y, z) => x - ROOM.x1, uv: (x, y, z) => [z - ROOM.z0, y], size: [ROOM.z1 - ROOM.z0, ROOM.h], inward: [-1, 0, 0] },
];
function coverage(points, minCount) {
  // points: iterable of [x,y,z,ok]
  const res = {};
  for (const s of surfaces) {
    const nu = Math.ceil(s.size[0] / CELL), nv = Math.ceil(s.size[1] / CELL);
    s.cnt = new Uint32Array(nu * nv); s.nu = nu; s.nv = nv;
  }
  points((x, y, z) => {
    for (const s of surfaces) {
      if (Math.abs(s.dist(x, y, z)) > TOL) continue;
      const [u, v] = s.uv(x, y, z);
      if (u < 0 || v < 0 || u >= s.size[0] || v >= s.size[1]) continue;
      s.cnt[Math.floor(u / CELL) * s.nv + Math.floor(v / CELL)]++;
    }
  });
  for (const s of surfaces) {
    const out = {};
    for (const k of minCount) { let c = 0; for (const v of s.cnt) if (v >= k) c++; out[`>=${k}`] = +(100 * c / s.cnt.length).toFixed(1); }
    res[s.name] = out;
  }
  return res;
}

if (path === 'mesh') {
  const res = coverage((emit) => {
    for (let i = 0; i < mN; i++) {
      const x = mb[6 * i], y = mb[6 * i + 1], z = mb[6 * i + 2];
      for (const s of surfaces) { /* facing check done per surface below */ }
      emit.call(null, x, y, z, i);
    }
  }, [1, 5]);
  // facing-filtered version
  const res2 = coverage((emit) => {
    for (let i = 0; i < mN; i++) {
      const x = mb[6 * i], y = mb[6 * i + 1], z = mb[6 * i + 2];
      // keep samples whose normal is roughly perpendicular to some room plane (facing either way)
      const nx = mb[6 * i + 3], ny = mb[6 * i + 4], nz = mb[6 * i + 5];
      if (Math.max(Math.abs(nx), Math.abs(ny), Math.abs(nz)) < 0.7) continue;
      emit(x, y, z);
    }
  }, [5]);
  console.log(JSON.stringify({ label: 'mesh room.glb', coverage: res, coverageAxisFacing: res2 }));
  appendFileSync(new URL('./coverage.jsonl', import.meta.url), JSON.stringify({ label: 'mesh', coverage: res, coverageAxisFacing: res2 }) + '\n');
  process.exit(0);
}

const align = JSON.parse(readFileSync(new URL(`./align-${alignName}.json`, import.meta.url)));
const M = align.full.matrixRaw, t = align.full.t;
const d = readSplatPly(path);
const n = d.count;
const P = new Float32Array(n * 3);
for (let i = 0; i < n; i++) {
  const x = d.pos[3 * i], y = d.pos[3 * i + 1], z = d.pos[3 * i + 2];
  P[3 * i] = M[0][0] * x + M[0][1] * y + M[0][2] * z + t[0];
  P[3 * i + 1] = M[1][0] * x + M[1][1] * y + M[1][2] * z + t[1];
  P[3 * i + 2] = M[2][0] * x + M[2][1] * y + M[2][2] * z + t[2];
}
const scale = align.full.scale;

const cov = coverage((emit) => { for (let i = 0; i < n; i++) if (d.opacity[i] >= 0.3) emit(P[3 * i], P[3 * i + 1], P[3 * i + 2]); }, [1, 4]);

// mesh proximity grid: 5 cm voxels within 15 cm of a mesh sample
const V = 0.05, ox = -4, oy = -1, oz = -6, NX = 140, NY = 80, NZ = 240;
const occ = new Uint8Array(NX * NY * NZ), near = new Uint8Array(NX * NY * NZ);
const vid = (x, y, z) => { const i = Math.floor((x - ox) / V), j = Math.floor((y - oy) / V), k = Math.floor((z - oz) / V); return i < 0 || j < 0 || k < 0 || i >= NX || j >= NY || k >= NZ ? -1 : (i * NY + j) * NZ + k; };
for (let i = 0; i < mN; i++) { const v = vid(mb[6 * i], mb[6 * i + 1], mb[6 * i + 2]); if (v >= 0) occ[v] = 1; }
const R = 3;
for (let i = 0; i < NX; i++) for (let j = 0; j < NY; j++) for (let k = 0; k < NZ; k++) {
  if (!occ[(i * NY + j) * NZ + k]) continue;
  for (let a = -R; a <= R; a++) for (let b = -R; b <= R; b++) for (let c = -R; c <= R; c++) {
    if (a * a + b * b + c * c > R * R) continue;
    const ii = i + a, jj = j + b, kk = k + c;
    if (ii < 0 || jj < 0 || kk < 0 || ii >= NX || jj >= NY || kk >= NZ) continue;
    near[(ii * NY + jj) * NZ + kk] = 1;
  }
}
let vis = 0, out03 = 0, out15 = 0, inRoom = 0, inRoomFloat = 0, inRoomOpaque = 0, inRoomFloatOpaque = 0, bigIn = 0;
for (let i = 0; i < n; i++) {
  if (d.opacity[i] < 0.05) continue;
  vis++;
  const x = P[3 * i], y = P[3 * i + 1], z = P[3 * i + 2];
  const o = (m) => x < ROOM.x0 - m || x > ROOM.x1 + m || z < ROOM.z0 - m || z > ROOM.z1 + m || y < -m || y > ROOM.h + m;
  if (o(0.3)) out03++;
  if (o(1.5)) out15++;
  if (x > ROOM.x0 && x < ROOM.x1 && z > ROOM.z0 && z < ROOM.z1 && y > 0.05 && y < ROOM.h - 0.05) {
    inRoom++;
    const v = vid(x, y, z);
    const far = v < 0 || !near[v];
    if (far) inRoomFloat++;
    if (d.opacity[i] >= 0.2) { inRoomOpaque++; if (far) inRoomFloatOpaque++; }
    if (d.maxScale[i] * scale > 0.3) bigIn++;
  }
}
// residual for opaque compact splats in the room (nearest-sample distance via a 5cm hash of mesh samples)
const res = {
  label, count: n, alignedWith: alignName,
  coverage: cov,
  floaters: {
    visibleSplats: vis,
    outsideRoomPlus0p3mPct: +(100 * out03 / vis).toFixed(1),
    outsideRoomPlus1p5mPct: +(100 * out15 / vis).toFixed(1),
    inRoomSplats: inRoom,
    inRoomFarFromMeshGt15cmPct: +(100 * inRoomFloat / inRoom).toFixed(1),
    inRoomOpaqueFarFromMeshGt15cmPct: +(100 * inRoomFloatOpaque / inRoomOpaque).toFixed(1),
    inRoomBigGt0p3mPct: +(100 * bigIn / inRoom).toFixed(3),
  },
  bigSplatsGt0p3mMetricPct: +(100 * Array.from(d.maxScale).filter((s) => s * scale > 0.3).length / n).toFixed(3),
};
console.log(JSON.stringify(res));
appendFileSync(new URL('./coverage.jsonl', import.meta.url), JSON.stringify(res) + '\n');
