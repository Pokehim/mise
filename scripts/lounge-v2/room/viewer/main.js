// The 8 shots of spec §6 (#77), from docs/research/lounge-compare/viewer: ?src=<source>&shot=<shot>.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { SparkRenderer, SplatMesh, SplatEdit, SplatEditSdf, SplatEditSdfType } from '@sparkjsdev/spark';

const REPO = '/@fs' + encodeURI(__REPO_DIR__);
const params = new URLSearchParams(location.search);
const src = params.get('src') ?? 'empty';
const shotName = params.get('shot') ?? 'door';
const state = (window.__state = { ready: false, src, shot: shotName, log: [] });
const log = (m) => { state.log.push(m); console.log(m); };

const ROOM = { x0: -1.5907, x1: 1.5759, z0: -3.5652, z1: 3.6244, h: 2.431 }; // the lounge's setup.json
const CX = (ROOM.x0 + ROOM.x1) / 2, CZ = (ROOM.z0 + ROOM.z1) / 2;
const CUT = ROOM.h - 0.05; // the editor's Dollhouse ceiling cut
// The editor's default Dollhouse camera (DollhouseCamera.tsx): 1.4 × the floor diagonal, 45° down.
const DOLL = Math.hypot(ROOM.x1 - ROOM.x0, ROOM.z1 - ROOM.z0) * 1.4 * Math.SQRT1_2;

// Each is a Scan: its mesh, and its splat when its manifest has one. emptymesh leaves any splat out.
const SOURCES = {
  empty: { scan: 'lounge' },
  emptymesh: { scan: 'lounge', noSplat: true },
};

// Spec §6. Table 1 is the North table, and the chair is the one North of it (layout.json).
const SHOTS = {
  door: { pos: [-1.25, 1.6, 2.75], target: [0.6, 1.2, -1.5] },                  // 1. eye level at the main door, looking in
  window: { pos: [0.4, 1.6, -3.1], target: [-0.2, 1.2, 3.6] },                  // 2. eye level at the North window end, looking South
  whiteboard: { pos: [-0.45, 1.6, -0.45], target: [1.55, 1.45, -0.45] },        // 3. 2 m from the whiteboard, facing it
  seated: { pos: [-0.4, 1.15, 0.4], target: [-0.85, 0.85, -1.4] },              // 4. seated at the middle table, looking across
  tabletop: { pos: [-0.786, 1.35, -1.25], target: [-0.786, 0.75, -1.62] },      // 5. 0.6 m above Table 1
  chairlegs: { pos: [0.583, 0.4, -1.921], target: [-0.417, 0.25, -1.921] },     // 6. 0.4 m high, 1 m from a chair
  dollhouse: { pos: [CX, 0.5 + DOLL, CZ + DOLL], target: [CX, 0.5, CZ], cut: true }, // 7. the default Dollhouse view
  topdown: { pos: [CX, 6.6, CZ], target: [CX, 0, CZ], up: [1, 0, 0], cut: true },    // 8. top-down, North on the left
};
const shot = SHOTS[shotName];
if (params.has('pos')) shot.pos = params.get('pos').split(',').map(Number);
if (params.has('target')) shot.target = params.get('target').split(',').map(Number);

const W = 1440, H = 900;
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(1);
renderer.setSize(W, H);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;
renderer.localClippingEnabled = true;
renderer.setClearColor(new THREE.Color('#f4f1ea')); // the editor's background
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, W / H, 0.05, 100); // the editor's fov
if (shot.up) camera.up.set(...shot.up);
camera.position.set(...shot.pos);
camera.lookAt(...shot.target);

// In the Dollhouse view the editor fades each Wall the camera is behind.
const WALLS = { north: [0, 0, 1, -ROOM.z0], south: [0, 0, -1, ROOM.z1], east: [-1, 0, 0, ROOM.x1], west: [1, 0, 0, -ROOM.x0] };
const behind = (name) => { const [a, , c, d] = WALLS[name]; return a * shot.pos[0] + c * shot.pos[2] + d < 0; };
const hidden = shot.cut ? Object.keys(WALLS).filter(behind) : [];

const t0 = performance.now();
let spark = null;

async function loadMesh(def, manifest) {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.loadAsync(`${REPO}/data/scans/${def.mesh}`);
  const group = new THREE.Group();
  if (manifest) {
    group.position.set(...manifest.meshTransform.position);
    group.rotation.y = manifest.meshTransform.rotationY;
  }
  const planes = shot.cut ? [new THREE.Plane(new THREE.Vector3(0, -1, 0), CUT)] : [];
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    // The editor fades the near wall's own surface in the Dollhouse view; its windows, door, and frames stay.
    if (hidden.includes(o.material?.name)) { o.visible = false; return; }
    const s = o.material;
    const m = s.isMeshBasicMaterial ? s : new THREE.MeshBasicMaterial({ map: s.map ?? null, side: s.side });
    if (!s.isMeshBasicMaterial && s.color) m.color.copy(s.color);
    m.toneMapped = false;
    // The floor is mostly seen at a grazing angle: without this it smears into streaks.
    if (m.map) m.map.anisotropy = renderer.capabilities.getMaxAnisotropy();
    m.clippingPlanes = planes;
    // Pushed back in depth, so a splat on the same surface wins (spec §3, part C).
    m.polygonOffset = true; m.polygonOffsetFactor = 1; m.polygonOffsetUnits = 4;
    o.material = m;
  });
  group.add(gltf.scene);
  scene.add(group);
}

async function loadSplat(def, manifest) {
  spark = new SparkRenderer({ renderer });
  scene.add(spark);
  const splat = new SplatMesh({ url: `${REPO}/data/scans/${def.splat}` });
  const t = manifest?.splatTransform;
  if (t) { splat.position.set(...t.position); splat.rotation.y = t.rotationY; splat.scale.setScalar(t.scale); }
  scene.add(splat);
  const edit = new SplatEdit({ name: 'clip' });
  const box = (cx, cy, cz, hx, hy, hz) => { const s = new SplatEditSdf({ type: SplatEditSdfType.BOX, opacity: 0 }); s.position.set(cx, cy, cz); s.scale.set(hx, hy, hz); edit.add(s); };
  const B = 100, F = 0.15;
  if (shot.cut) box(0, CUT + B, 0, 2 * B, B, 2 * B);
  if (hidden.includes('south')) box(0, 0, ROOM.z1 - F + B, 2 * B, 2 * B, B);
  if (hidden.includes('north')) box(0, 0, ROOM.z0 + F - B, 2 * B, 2 * B, B);
  if (hidden.includes('east')) box(ROOM.x1 - F + B, 0, 0, B, 2 * B, 2 * B);
  if (hidden.includes('west')) box(ROOM.x0 + F - B, 0, 0, B, 2 * B, 2 * B);
  scene.add(edit);
  await splat.initialized;
  state.numSplats = splat.packedSplats?.numSplats;
}

let frames = 0;
const frameTimes = [];
let last = performance.now();
renderer.setAnimationLoop(() => {
  const now = performance.now();
  frameTimes.push(now - last); last = now;
  if (frameTimes.length > 2000) frameTimes.shift();
  renderer.render(scene, camera);
  frames++;
});

window.__measureFps = (ms = 5000) => new Promise((resolve) => {
  const start = performance.now(), f0 = frames;
  setTimeout(() => {
    const dt = performance.now() - start, nf = frames - f0;
    const ft = frameTimes.slice(-Math.min(nf, frameTimes.length)).sort((a, b) => a - b);
    resolve({ fps: +(nf * 1000 / dt).toFixed(1), frames: nf, medianFrameMs: +ft[Math.floor(ft.length / 2)].toFixed(2), p95FrameMs: +ft[Math.floor(ft.length * 0.95)].toFixed(2) });
  }, ms);
});

(async () => {
  try {
    const { scan, noSplat } = SOURCES[src];
    const manifest = await (await fetch(`${REPO}/data/scans/${scan}/manifest.json`)).json();
    const only = params.get('only');   // mesh or splat, for looking at one layer
    if (only !== 'splat') await loadMesh({ mesh: `${scan}/${manifest.mesh}` }, manifest);
    if (manifest.splat && !noSplat && only !== 'mesh') await loadSplat({ splat: `${scan}/${manifest.splat}` }, manifest);
    state.loadMs = Math.round(performance.now() - t0);
    // Let Spark sort and settle: wait until no sort is pending for 30 frames in a row.
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
    log(`ready ${src} ${shotName} load ${state.loadMs} ms`);
  } catch (e) {
    state.error = String(e?.stack ?? e);
    log('ERROR ' + state.error);
  }
})();
