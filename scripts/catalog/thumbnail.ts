// scripts/catalog/thumbnail.ts — thumbnails rendered from the Catalog's own GLBs, for items with no product photo
// (Poly Haven and Google Scanned Objects). three.js draws each model in headless Chromium, on white like ABO's photos,
// from the front-right and a little above, so the thumbnail shows the model exactly as it will be placed.

import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { extname, join, normalize } from 'node:path';
import { chromium } from '@playwright/test';
import sharp from 'sharp';
import { ROOT } from './download';

/** The side of a thumbnail, as ABO's small images: catalog-build writes JPEGs of at most 256 px. */
const SIDE = 256;

const PAGE = `<!doctype html>
<html><body style="margin:0;background:#fff">
<script type="importmap">{ "imports": { "three": "/three/build/three.module.js", "three/addons/": "/three/examples/jsm/" } }</script>
<script type="module">
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const side = ${SIDE * 2};
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(side, side);
renderer.setClearColor(0xffffff);
renderer.toneMapping = THREE.NeutralToneMapping;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.9;
const sun = new THREE.DirectionalLight(0xffffff, 1.2);
sun.position.set(2, 4, 3);
scene.add(sun);
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);

/** Renders one GLB and returns a PNG data URL. */
window.render = async (url) => {
  const gltf = await loader.loadAsync(url);
  scene.add(gltf.scene);
  const box = new THREE.Box3().setFromObject(gltf.scene);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  // From the front-right, 25° above: +Z is the front.
  const direction = new THREE.Vector3(Math.sin(0.55), 0, Math.cos(0.55)).multiplyScalar(Math.cos(0.44)).setY(Math.sin(0.44));
  const camera = new THREE.PerspectiveCamera(30, 1, sphere.radius / 100, sphere.radius * 100);
  const distance = sphere.radius / Math.sin(THREE.MathUtils.degToRad(15)) * 0.92;
  camera.position.copy(sphere.center).addScaledVector(direction, distance);
  camera.lookAt(sphere.center);
  renderer.render(scene, camera);
  scene.remove(gltf.scene);
  return renderer.domElement.toDataURL('image/png');
};
window.ready = true;
</script></body></html>`;

const TYPES: Record<string, string> = { '.js': 'text/javascript', '.glb': 'model/gltf-binary', '.html': 'text/html' };

/** Serves the page, three.js from node_modules, and the GLBs by their absolute path under /files/. */
function serve(): Promise<Server> {
  const three = join(ROOT, 'node_modules/three');
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
    try {
      const file = path === '/' ? null
        : path.startsWith('/three/') ? join(three, normalize(path.slice('/three/'.length)))
        : path.startsWith('/files/') ? normalize(path.slice('/files'.length))
        : undefined;
      if (file === undefined) throw new Error('not found');
      res.setHeader('Content-Type', TYPES[file ? extname(file) : '.html'] ?? 'application/octet-stream');
      res.end(file ? await readFile(file) : PAGE);
    } catch {
      res.statusCode = 404;
      res.end();
    }
  });
  return new Promise((done) => server.listen(0, '127.0.0.1', () => done(server)));
}

/** Renders each GLB to its JPEG thumbnail, SIDE px square. */
export async function renderThumbnails(jobs: { glb: string; out: string }[]) {
  if (jobs.length === 0) return;
  const server = await serve();
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`);
    await page.waitForFunction(() => (window as unknown as { ready?: boolean }).ready, null, { timeout: 30_000 })
      .catch(() => { throw new Error(`the thumbnail page didn't load: ${errors.join('; ')}`); });
    for (const { glb, out } of jobs) {
      const dataUrl = await page.evaluate(
        (url) => (window as unknown as { render: (url: string) => Promise<string> }).render(url),
        `/files${glb}`,
      );
      const png = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
      await sharp(png).resize(SIDE, SIDE).jpeg({ quality: 88 }).toFile(out);
    }
  } finally {
    await browser.close();
    server.close();
  }
}
