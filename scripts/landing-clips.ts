/**
 * The landing page's room clips (web/src/pages/landing): each Design in docs/landing/designs recorded
 * assembling itself, as the editor's reveal (web/src/scene/Reveal.tsx) plays it from the door.
 *
 *   npx tsx scripts/landing-clips.ts [<designId> …]      (every Design in docs/landing/designs by default)
 *
 * Start the app first (./.superset/run.sh). BASE_URL defaults to http://localhost:$PORT. For each Design,
 * the script opens /d/<id>?shot=door, presses Replay, and records the 3D view from the empty lounge to
 * the finished room: a 4:3 band of it, at 640×480, as WebM. It saves <id>.webm, the last frame as
 * <id>.webp, and the first frame (the empty lounge, the same for every Design) as empty.webp. The editor
 * reads Designs from data/designs, so each one is copied there while it is recorded, then removed.
 * The GPU flags matter: without them Chromium draws the scene in software, at about 6 frames a second.
 */
import { copyFileSync, existsSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const BASE_URL = process.env.BASE_URL ?? `http://localhost:${process.env.PORT ?? 5173}`;
const DESIGNS = 'docs/landing/designs';
const OUT = 'web/src/pages/landing';
const GPU_ARGS = ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'];
const WIDTH = 640;
const HEIGHT = 480;
/** Enough for 640×480 VP9 to stay clean while Pieces drop in: about 250 KB for a 5 s reveal. */
const BITS_PER_SECOND = 400_000;
/** How long the finished room holds at the end of a clip. */
const HOLD_MS = 900;

declare global {
  interface Window {
    __clip?: { recorder: MediaRecorder; chunks: Blob[]; crop: HTMLCanvasElement };
    /** A Blob in the page as base64, to bring it out of the page. */
    __base64?: (blob: Blob | null) => Promise<string>;
  }
}

const ids = process.argv.slice(2).length
  ? process.argv.slice(2)
  : readdirSync(DESIGNS).filter((file) => file.endsWith('.json')).map((file) => file.slice(0, -'.json'.length));

const browser = await chromium.launch({ args: GPU_ARGS });
for (const [n, id] of ids.entries()) {
  const lent = join('data/designs', `${id}.json`);
  const lend = !existsSync(lent);
  if (lend) copyFileSync(join(DESIGNS, `${id}.json`), lent);
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 });
    page.on('pageerror', (error) => console.warn(`${id}: ${error.message}`));
    await page.goto(`${BASE_URL}/d/${id}?shot=door`, { waitUntil: 'networkidle' });
    // Every Piece's model loaded, so none is still loading when the reveal drops it in.
    await page.waitForTimeout(3000);

    // A 2D canvas copies the view's 4:3 band, less most of the ceiling, every frame, and records it.
    await page.evaluate(({ width, height, bitsPerSecond }) => {
      const view = document.querySelector('canvas')!;
      const crop = Object.assign(document.createElement('canvas'), { width, height });
      const context = crop.getContext('2d')!;
      const [sw, sh, sy] = [view.width, Math.round((view.width * 3) / 4), Math.round(view.height * 0.16)];
      const draw = () => {
        context.drawImage(view, 0, sy, sw, sh, 0, 0, width, height);
        requestAnimationFrame(draw);
      };
      draw();
      const recorder = new MediaRecorder(crop.captureStream(30), { mimeType: 'video/webm;codecs=vp9', videoBitsPerSecond: bitsPerSecond });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => chunks.push(event.data);
      window.__clip = { recorder, chunks, crop };
      window.__base64 = (blob) => new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(',')[1]);
        reader.readAsDataURL(blob!);
      });
    }, { width: WIDTH, height: HEIGHT, bitsPerSecond: BITS_PER_SECOND });

    // Replay empties the room at once and shows its first Edit 300 ms later: record from the empty room.
    await page.click('button.replay');
    await page.waitForTimeout(100);
    await page.evaluate(() => window.__clip!.recorder.start());
    await page.waitForTimeout(50);
    if (n === 0) {
      const empty = await page.evaluate(async () =>
        window.__base64!(await new Promise((resolve) => window.__clip!.crop.toBlob(resolve, 'image/webp', 0.8))));
      writeFileSync(join(OUT, 'empty.webp'), Buffer.from(empty, 'base64'));
    }

    // Replay counts the reveal's steps while it plays.
    const start = Date.now();
    await page.waitForSelector('button.replay .progress', { state: 'detached', timeout: 60_000 });
    const seconds = (Date.now() - start) / 1000;
    await page.waitForTimeout(HOLD_MS);

    const [clip, still] = await page.evaluate(async () => {
      const { recorder, chunks, crop } = window.__clip!;
      const last = await new Promise<Blob | null>((resolve) => crop.toBlob(resolve, 'image/webp', 0.8));
      await new Promise((resolve) => {
        recorder.onstop = resolve;
        recorder.stop();
      });
      return [await window.__base64!(new Blob(chunks, { type: 'video/webm' })), await window.__base64!(last)];
    });
    writeFileSync(join(OUT, `${id}.webm`), Buffer.from(clip, 'base64'));
    writeFileSync(join(OUT, `${id}.webp`), Buffer.from(still, 'base64'));
    console.log(`${id}: reveal ${seconds.toFixed(1)} s, ${Math.round((clip.length * 0.75) / 1024)} KB`);
    await page.close();
  } finally {
    if (lend) rmSync(lent);
  }
}
await browser.close();
