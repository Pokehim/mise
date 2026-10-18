// node scripts/lounge-v2/room/shoot.mjs <src,...> <shot,...|all> [--fps] [--out dir] [--tag name]
// Screenshots the 8 shots of spec §6 from viewer/ (start it first: npx vite --config scripts/lounge-v2/room/viewer/vite.config.mjs).
// playwright-core comes from docs/research/lounge-compare (npm install there).
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const here = new URL('.', import.meta.url).pathname;
const { chromium } = createRequire(resolve(here, '../../../docs/research/lounge-compare/package.json'))('playwright-core');
const SHOTS = ['door', 'window', 'whiteboard', 'seated', 'tabletop', 'chairlegs', 'dollhouse', 'topdown'];
const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const srcs = args[0].split(',');
const shots = args[1] === 'all' ? SHOTS : args[1].split(',');
const out = resolve(opt('--out', resolve(here, '../../.cache/lounge-v2/shots')));
const tag = opt('--tag', '');
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
for (const src of srcs) for (const shot of shots) {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`[pageerror ${src}/${shot}]`, String(e).slice(0, 300)));
  await page.goto(`http://localhost:5198/?src=${src}&shot=${shot}`);
  await page.waitForFunction(() => window.__state?.ready || window.__state?.error, null, { timeout: 300000, polling: 250 });
  const st = await page.evaluate(() => window.__state);
  if (st.error) console.log('ERROR', src, shot, st.error);
  const n = SHOTS.indexOf(shot) + 1;
  const file = `${out}/${n}-${shot}_${src}${tag ? '_' + tag : ''}.png`;
  await page.locator('canvas').screenshot({ path: file });
  const fps = args.includes('--fps') ? await page.evaluate(() => window.__measureFps(5000)) : undefined;
  console.log(JSON.stringify({ src, shot, loadMs: st.loadMs, numSplats: st.numSplats, fps, file }));
  await page.close();
}
await browser.close();
