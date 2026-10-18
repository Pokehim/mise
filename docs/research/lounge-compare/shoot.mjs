// node shoot.mjs <src,src,...> <view,view,...> [--fps] [--headed] [--extra "a=b&c=d"] [--tag name]
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
const args = process.argv.slice(2);
const srcs = args[0].split(','), views = args[1].split(',');
const fps = args.includes('--fps');
const headed = args.includes('--headed');
const extra = args.includes('--extra') ? '&' + args[args.indexOf('--extra') + 1] : '';
const tag = args.includes('--tag') ? args[args.indexOf('--tag') + 1] : '';
const out = new URL('./shots/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const flags = ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'];
if (args.includes('--novsync')) flags.push('--disable-gpu-vsync', '--disable-frame-rate-limit');
const browser = await chromium.launch({ headless: !headed, args: flags });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
for (const src of srcs) for (const view of views) {
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') console.log(`[console ${src}/${view}]`, m.text().slice(0, 300)); });
  page.on('pageerror', (e) => console.log(`[pageerror ${src}/${view}]`, String(e).slice(0, 300)));
  const t = Date.now();
  await page.goto(`http://localhost:5199/?src=${src}&view=${view}${extra}`);
  try {
    await page.waitForFunction(() => window.__state?.ready || window.__state?.error, null, { timeout: 300000, polling: 250 });
  } catch (e) { console.log('timeout', src, view); }
  const st = await page.evaluate(() => window.__state);
  if (st.error) console.log('ERROR', src, view, st.error);
  const file = `${out}${view}_${src}${tag ? '_' + tag : ''}.png`;
  if (!args.includes('--noshot')) await page.locator('canvas').screenshot({ path: file });
  let f = null;
  if (fps) f = await page.evaluate(() => window.__measureFps(6000));
  const gpu = await page.evaluate(() => { const gl = document.querySelector('canvas').getContext('webgl2'); const e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'n/a'; });
  const rec = { src, view, tag, wallMs: Date.now() - t, loadMs: st.loadMs, numSplats: st.numSplats, maxSh: st.maxSh, numSh: st.numSh, bbox: st.bbox, fps: f, gpu, file };
  console.log(JSON.stringify(rec));
  appendFileSync(new URL('./shots/log.jsonl', import.meta.url), JSON.stringify(rec) + '\n');
  await page.close();
}
await browser.close();
