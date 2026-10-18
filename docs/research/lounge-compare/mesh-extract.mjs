// Mesh (room.glb) -> area-weighted surface samples with normals, in the room frame (manifest.meshTransform).
// Output: mesh-samples.bin = Float32 [x,y,z,nx,ny,nz] * N
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const REPO = '/Users/jameswang/coding projects/mise';
const req = createRequire(REPO + '/package.json');
const imp = (m) => import(pathToFileURL(req.resolve(m)).href);
const { NodeIO } = await imp('@gltf-transform/core');
const { ALL_EXTENSIONS } = await imp('@gltf-transform/extensions');
const { MeshoptDecoder } = await imp('meshoptimizer');
await MeshoptDecoder.ready;

const manifest = JSON.parse(readFileSync(`${REPO}/data/scans/lounge-v1/manifest.json`, 'utf8'));
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(`${REPO}/data/scans/lounge-v1/room.glb`);
const { position: P, rotationY: ry } = manifest.meshTransform;
const c = Math.cos(ry), s = Math.sin(ry);
const toRoom = (x, y, z) => [c * x + s * z + P[0], y + P[1], -s * x + c * z + P[2]];

const tris = [];
let totalArea = 0;
for (const node of doc.getRoot().listNodes()) {
  const mesh = node.getMesh();
  if (!mesh) continue;
  const m = node.getWorldMatrix(); // column-major 4x4
  const apply = (x, y, z) => toRoom(
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14]);
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute('POSITION');
    const idx = prim.getIndices();
    const n = pos.getCount();
    const v = new Float32Array(n * 3);
    const el = [0, 0, 0];
    for (let i = 0; i < n; i++) { pos.getElement(i, el); const r = apply(el[0], el[1], el[2]); v.set(r, 3 * i); }
    const ia = idx ? idx.getArray() : Uint32Array.from({ length: n }, (_, i) => i);
    for (let t = 0; t < ia.length; t += 3) {
      const a = ia[t] * 3, b = ia[t + 1] * 3, d = ia[t + 2] * 3;
      const ux = v[b] - v[a], uy = v[b + 1] - v[a + 1], uz = v[b + 2] - v[a + 2];
      const wx = v[d] - v[a], wy = v[d + 1] - v[a + 1], wz = v[d + 2] - v[a + 2];
      let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
      const l = Math.hypot(nx, ny, nz);
      if (l < 1e-12) continue;
      const area = l / 2;
      totalArea += area;
      tris.push([v[a], v[a + 1], v[a + 2], ux, uy, uz, wx, wy, wz, nx / l, ny / l, nz / l, area]);
    }
  }
}
// ~1 sample per 4 cm^2 (deterministic stratified by cumulative area)
const target = Math.round(totalArea / 0.0004);
const out = new Float32Array(target * 6);
let k = 0, acc = 0, step = totalArea / target, next = step / 2;
let seed = 12345;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
for (const t of tris) {
  acc += t[12];
  while (next < acc && k < target) {
    let r1 = rnd(), r2 = rnd();
    if (r1 + r2 > 1) { r1 = 1 - r1; r2 = 1 - r2; }
    out[6 * k] = t[0] + r1 * t[3] + r2 * t[6];
    out[6 * k + 1] = t[1] + r1 * t[4] + r2 * t[7];
    out[6 * k + 2] = t[2] + r1 * t[5] + r2 * t[8];
    out[6 * k + 3] = t[9]; out[6 * k + 4] = t[10]; out[6 * k + 5] = t[11];
    k++; next += step;
  }
}
writeFileSync(new URL('./mesh-samples.bin', import.meta.url), Buffer.from(out.buffer, 0, k * 24));
let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
for (let i = 0; i < k; i++) for (let j = 0; j < 3; j++) { mn[j] = Math.min(mn[j], out[6 * i + j]); mx[j] = Math.max(mx[j], out[6 * i + j]); }
console.log({ triangles: tris.length, totalArea: totalArea.toFixed(1), samples: k, min: mn.map((x) => +x.toFixed(3)), max: mx.map((x) => +x.toFixed(3)) });
