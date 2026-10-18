// The door shot of the lounge's Empty Room, as the landing page's room clips frame it, and its camera:
//   node door.mjs <out dir>       (the app up; BASE_URL defaults to http://localhost:$PORT)
// Saves <out>/door.png, the clips' 4:3 band of the view from 16% down (scripts/landing-clips.ts), and
// <out>/door.json, the camera and the view's size, for gridclip.py to render the scan through.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const BASE_URL = process.env.BASE_URL ?? `http://localhost:${process.env.PORT ?? 5173}`;
const out = process.argv[2];
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
page.on('pageerror', (error) => console.warn(error.message));
await page.goto(`${BASE_URL}/d/ds_lounge?shot=door&empty=1`, { waitUntil: 'networkidle' });
await page.waitForTimeout(5000);
// The camera, from React Three Fiber's store: the page's own copy of the module, by the URL Vite served.
const camera = await page.evaluate(async () => {
  const url = performance.getEntriesByType('resource').map((r) => r.name).find((name) => name.includes('@react-three_fiber'));
  const fiber = await import(url);
  const { camera } = [...fiber._roots.values()][0].store.getState();
  camera.updateMatrixWorld();
  const view = document.querySelector('canvas');
  const { left, top, width, height } = view.getBoundingClientRect();
  return {
    position: camera.position.toArray(), dir: camera.getWorldDirection(camera.position.clone()).toArray(), fov: camera.fov,
    canvas: [view.width, view.height], rect: [left, top, width, height],
  };
});
const [left, top, width, height] = camera.rect;
await page.screenshot({ path: join(out, 'door.png'), clip: { x: left, y: top + height * 0.16, width, height: (width * 3) / 4 } });
writeFileSync(join(out, 'door.json'), JSON.stringify(camera));
await browser.close();
