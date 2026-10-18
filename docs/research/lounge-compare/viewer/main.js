import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { SparkRenderer, SplatMesh, SplatEdit, SplatEditSdf, SplatEditSdfType } from '@sparkjsdev/spark';

const REPO = '/@fs' + encodeURI(__REPO_DIR__);
const SCRATCH = '/@fs' + encodeURI(__TOOLS_DIR__);
const params = new URLSearchParams(location.search);
const src = params.get('src') ?? 'mesh';
const viewName = params.get('view') ?? 'door';
const state = (window.__state = { ready: false, src, view: viewName, log: [] });
const log = (m) => { state.log.push(m); console.log(m); };

const ROOM = { x0: -1.568, x1: 1.55, z0: -3.545, z1: 3.673, h: 2.431 };
const CUT = ROOM.h - 0.05; // the app's Dollhouse ceiling cut (ceilingHeight - 0.05)
const MARGIN = 1.5;        // splats further than this outside the room box are hidden in every view

const SOURCES = {
  mesh: null,
  r1sh3: { url: `${SCRATCH}/spz/room1_H3.spz`, align: 'ROOM_1', label: 'SPLAT_ROOM_1 SH3' },
  r1sh0: { url: `${REPO}/data/scans/lounge-v1/splat.spz`, align: 'ROOM_1', label: 'splat.spz (ROOM_1 SH0)' },
  r1ply: { url: `${REPO}/data/scans/real-scans/SPLAT_ROOM_1.ply`, align: 'ROOM_1', label: 'SPLAT_ROOM_1.ply raw' },
  r2sh3: { url: `${SCRATCH}/spz/room2_H3.spz`, align: 'ROOM_2', label: 'SPLAT_ROOM_2 SH3' },
  r2ply: { url: `${REPO}/data/scans/real-scans/SPLAT_ROOM_2.ply`, align: 'ROOM_2', label: 'SPLAT_ROOM_2.ply raw' },
};

const VIEWS = {
  door: { pos: [-1.15, 1.6, 2.75], target: [0.9, 1.0, -1.8], fov: 65 },
  far: { pos: [0.75, 1.6, -3.25], target: [-0.7, 1.0, 2.4], fov: 65 },
  table: { pos: [0.55, 1.45, 3.05], target: [-0.83, 0.7, 1.75], fov: 55 },
  overview: { pos: [6.2, 7.0, 0.6], target: [0, 0.6, 0.15], fov: 42, cut: true },
  overviewopen: { pos: [6.2, 7.0, 0.6], target: [0, 0.6, 0.15], fov: 42, cut: true, openEast: true },
};
const view = VIEWS[viewName];
if (params.has('pos')) view.pos = params.get('pos').split(',').map(Number);
if (params.has('target')) view.target = params.get('target').split(',').map(Number);

const W = 1440, H = 900;
const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(1);
renderer.setSize(W, H);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;
renderer.localClippingEnabled = true;
renderer.setClearColor(new THREE.Color('#2a3550'));
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(view.fov, W / H, 0.05, 100);
camera.position.set(...view.pos);
camera.lookAt(...view.target);

const t0 = performance.now();
let splat = null;
let spark = null;

async function loadMesh() {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const manifest = await (await fetch(`${REPO}/data/scans/lounge-v1/manifest.json`)).json();
  const gltf = await loader.loadAsync(`${REPO}/data/scans/lounge-v1/room.glb`);
  const group = new THREE.Group();
  group.position.set(...manifest.meshTransform.position);
  group.rotation.y = manifest.meshTransform.rotationY;
  const planes = view.cut ? [new THREE.Plane(new THREE.Vector3(0, -1, 0), CUT)] : [];
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    const s = o.material;
    o.material = new THREE.MeshBasicMaterial({ map: s.map ?? null, side: s.side, toneMapped: false, clippingPlanes: planes });
    if (s.color) o.material.color.copy(s.color);
  });
  group.add(gltf.scene);
  scene.add(group);
}

async function loadSplat(def) {
  const align = await (await fetch(`${SCRATCH}/align-${def.align}.json`)).json();
  const mode = params.get('align') ?? 'full';
  // room = t + M p_raw, with M = scale * R * F (F = 180 deg about X)
  let M, t;
  if (mode === 'full') { M = align.full.matrixRaw; t = align.full.t; }
  else { const { rotationY: a, scale: s, position } = align.yawOnly; const c = Math.cos(a), n = Math.sin(a); M = [[s * c, 0, -s * n], [0, -s, 0], [-s * n, 0, -s * c]]; t = position; }
  spark = new SparkRenderer({ renderer });
  scene.add(spark);
  splat = new SplatMesh({ url: def.url });
  splat.matrixAutoUpdate = false;
  splat.matrix.set(M[0][0], M[0][1], M[0][2], t[0], M[1][0], M[1][1], M[1][2], t[1], M[2][0], M[2][1], M[2][2], t[2], 0, 0, 0, 1);
  splat.matrixWorldNeedsUpdate = true;
  scene.add(splat);
  // Clip: hide everything beyond MARGIN outside the room box, and above the cut in the overview.
  const edit = new SplatEdit({ name: 'clip' });
  const box = (cx, cy, cz, hx, hy, hz) => { const s = new SplatEditSdf({ type: SplatEditSdfType.BOX, opacity: 0 }); s.position.set(cx, cy, cz); s.scale.set(hx, hy, hz); edit.add(s); };
  const B = 100;
  box(ROOM.x0 - MARGIN - B, 0, 0, B, 2 * B, 2 * B);
  box((view.openEast ? ROOM.x1 - 0.15 : ROOM.x1 + MARGIN) + B, 0, 0, B, 2 * B, 2 * B);
  box(0, 0, ROOM.z0 - MARGIN - B, 2 * B, 2 * B, B);
  box(0, 0, ROOM.z1 + MARGIN + B, 2 * B, 2 * B, B);
  box(0, -0.5 - B, 0, 2 * B, B, 2 * B);
  box(0, (view.cut ? CUT : 3.5) + B, 0, 2 * B, B, 2 * B);
  if (!params.has('noclip')) scene.add(edit);
  await splat.initialized;
  state.numSplats = splat.packedSplats?.numSplats ?? splat.splats?.getNumSplats?.();
  state.maxSh = splat.maxSh; state.numSh = splat.splats?.getNumSh?.();
  if (params.has('bbox')) { const bb = splat.getBoundingBox(true); state.bbox = { min: bb.min.toArray(), max: bb.max.toArray() }; }
}

let frames = 0;
const SYNC = params.has('sync');
const PX = new Uint8Array(4);
const frameTimes = [];
let last = performance.now();
renderer.setAnimationLoop(() => {
  const now = performance.now();
  frameTimes.push(now - last); last = now;
  if (frameTimes.length > 2000) frameTimes.shift();
  renderer.render(scene, camera);
  if (SYNC) { const gl = renderer.getContext(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, PX); }
  frames++;
});

window.__measureFps = (ms = 5000) => new Promise((resolve) => {
  const start = performance.now(), f0 = frames, n0 = frameTimes.length;
  setTimeout(() => {
    const dt = performance.now() - start, nf = frames - f0;
    const ft = frameTimes.slice(-Math.min(nf, frameTimes.length)).sort((a, b) => a - b);
    resolve({ fps: +(nf * 1000 / dt).toFixed(1), frames: nf, medianFrameMs: +ft[Math.floor(ft.length / 2)].toFixed(2), p95FrameMs: +ft[Math.floor(ft.length * 0.95)].toFixed(2) });
  }, ms);
});

(async () => {
  try {
    if (src === 'mesh') await loadMesh();
    else await loadSplat(SOURCES[src]);
    state.loadMs = Math.round(performance.now() - t0);
    // let Spark sort and settle: wait until no sort is pending for 30 consecutive frames
    let calm = 0;
    await new Promise((resolve) => {
      const tick = () => {
        const busy = spark && (spark.sorting || spark.sortDirty);
        calm = busy ? 0 : calm + 1;
        if (calm >= 30) resolve(); else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await new Promise((r) => setTimeout(r, 800));
    state.ready = true;
    log(`ready ${src} ${viewName} load ${state.loadMs} ms`);
  } catch (e) {
    state.error = String(e?.stack ?? e);
    log('ERROR ' + state.error);
  }
})();
