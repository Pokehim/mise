/**
 * Screenshots of every main view, for the design loop (docs/design/iterations.md):
 *
 *   npx tsx scripts/shoot.ts <label> [--fps]
 *   ONLY=home,editor npx tsx scripts/shoot.ts <label>     (just those views)
 *
 * Start the app first (./.superset/run.sh). BASE_URL defaults to http://localhost:$PORT. The script
 * saves three Designs of the study lounge (ds_shoot_*) through the API, shoots each view at
 * 1440×900 and 1280×800 (Home and the editor also at 390×844) into docs/design/shots/<label>/ as WebP, and
 * deletes the Designs again. With --fps it also measures the frame rate with the overlays on.
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Browser, chromium, type Page } from '@playwright/test';
import sharp from 'sharp';
import type { Design, Edit, Placement } from '../shared/types';
import type { NewEdit } from '../web/src/state/store';

const label = process.argv[2];
if (!label || label.startsWith('-')) {
  console.error('Usage: npx tsx scripts/shoot.ts <label> [--fps]');
  process.exit(1);
}
const BASE_URL = process.env.BASE_URL ?? `http://localhost:${process.env.PORT ?? 5173}`;
const OUT = join('docs/design/shots', label);
const GPU_ARGS = ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'];
/** The most a screenshot may weigh: it is saved at the best WebP quality that fits. */
const MAX_BYTES = 300_000;

/** The study lounge: three tables along the west wall, a window north, a doorway west. */
const SCAN = 'lounge';
const floor = (x: number, z: number, rotationY = 0): Placement => ({ position: [x, 0, z], rotationY, mount: 'floor' });
const START = Date.parse('2026-10-17T18:00:00Z');
let edits = 0;
/** An Edit by the Mover, a minute after the one before. */
const stamp = (edit: NewEdit) =>
  ({ ...edit, id: `ed_shoot${++edits}`, at: new Date(START + edits * 60_000).toISOString(), by: 'mover' }) as Edit;

/** A few Edits of each kind, so History, the shopping list and the Patch all have something to show. */
const EDITS: Edit[] = [
  stamp({ type: 'place', pieceId: 'pc_shoot_sofa', catalogId: 'B07P6JVMJL', placement: floor(1.115, 0.3, -Math.PI / 2) }),
  stamp({ type: 'place', pieceId: 'pc_shoot_rug', catalogId: 'B0732J9VG6', placement: floor(0.5, 0.3, Math.PI / 2) }),
  stamp({ type: 'replace', originalId: 'og_table_1', pieceId: 'pc_shoot_table', catalogId: 'B07B78LZQC', placement: floor(-0.8, -1.63, Math.PI / 2), via: 'replace' }),
  stamp({ type: 'place', pieceId: 'pc_shoot_lamp', catalogId: 'B07374SBFL', placement: floor(1.3, -0.8, -Math.PI / 2) }),
  stamp({ type: 'place', pieceId: 'pc_shoot_shelf', catalogId: 'B07PSZHDMW', placement: floor(1.37, -2.6, -Math.PI / 2) }),
  stamp({ type: 'finish', target: { kind: 'wall', wallId: 'wl_2' }, finish: { kind: 'paint', color: '#9caf88' } }),
  stamp({ type: 'recolor', targetId: 'pc_shoot_sofa', partId: '*', color: '#1f2a44' }),
];
/** The row of the sofa's place in History, which selects that Piece. */
const PIECE_ROW = 0;
/** A barrel chair in the doorway: a Fit warning. */
const BLOCKER = stamp({ type: 'place', pieceId: 'pc_shoot_chair', catalogId: 'B07DBHCKJ5', placement: floor(-1.15, 2.95, Math.PI / 2) });

const DESIGNS = {
  main: { name: 'Reading corner', edits: EDITS },
  fit: { name: 'Reading corner, chair by the door', edits: [...EDITS, BLOCKER] },
  empty: { name: 'New Design', edits: [] },
};
const designId = (key: keyof typeof DESIGNS) => `ds_shoot_${key}`;

async function saveDesigns() {
  for (const [key, { name, edits }] of Object.entries(DESIGNS)) {
    const id = designId(key as keyof typeof DESIGNS);
    const time = new Date(START).toISOString();
    const design: Design = { version: 1, id, scanId: SCAN, name, createdAt: time, updatedAt: time, origin: 'mover', edits };
    const res = await fetch(`${BASE_URL}/api/designs/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(design) });
    if (!res.ok) throw new Error(`Saving ${id}: ${res.status} ${await res.text()}`);
  }
}

/** The API has no delete, so this removes the files, when the app runs from this checkout. */
function deleteDesigns() {
  for (const key of Object.keys(DESIGNS)) {
    const file = join('data/designs', `${designId(key as keyof typeof DESIGNS)}.json`);
    if (existsSync(file)) rmSync(file);
  }
}

/**
 * Waits for the editor's 3D view to draw the Scan, then for the Pieces and the camera's glide in. It
 * shoots at the Quick Realism level, the Scan's textured mesh: the splat look of Real (#16) still
 * renders at ~10 fps and isn't lined up with the mesh. `editor-real` shoots the default level.
 */
async function openDesign(page: Page, key: keyof typeof DESIGNS, { query = '', quick = true } = {}) {
  await page.goto(`${BASE_URL}/d/${designId(key)}${query}`);
  // Forced: on a phone, the old TopBar (before the sketch style) lays other controls over it.
  if (quick) await page.getByRole('group', { name: 'Realism' }).getByRole('button', { name: 'Quick' }).click({ force: true });
  // A view with no room to draw in, such as the old editor's on a phone, never draws a frame: shoot it as it is.
  await page.waitForFunction(() => window.__miseSceneReady === true, null, { timeout: 30_000 })
    .catch(() => console.warn(`The 3D view of ${key} never drew a frame.`));
  // The Pieces' models; not the splat, which Real starts streaming before Quick is picked.
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(1800);
}

/** Selects the sofa from its History row, and moves the pointer off the row so the row's hover outline goes. */
async function selectPiece(page: Page) {
  await page.locator('.history li').nth(PIECE_ROW).locator('button.text').click();
  await page.mouse.move(0, 0);
}

/** Whether the 3D view came out black, as it does when headless Chromium gets no GPU. */
async function canvasIsBlack(page: Page) {
  const shot = await page.locator('.view canvas').screenshot();
  const { channels } = await sharp(shot).stats();
  return channels.slice(0, 3).every(({ mean }) => mean < 12);
}

interface View { name: string; open: (page: Page) => Promise<void>; phone?: boolean }

const VIEWS: View[] = [
  {
    name: 'home',
    phone: true,
    open: async (page) => {
      await page.goto(BASE_URL);
      await page.locator('.scan:not(.loading)').first().waitFor();
      await page.waitForTimeout(400);
    },
  },
  { name: 'editor', phone: true, open: (page) => openDesign(page, 'main') },
  { name: 'editor-real', open: (page) => openDesign(page, 'main', { quick: false }) },
  {
    name: 'selected',
    open: async (page) => {
      await openDesign(page, 'main');
      await selectPiece(page);
      await page.waitForTimeout(600);
    },
  },
  {
    name: 'resize',
    open: async (page) => {
      await openDesign(page, 'main');
      await selectPiece(page);
      await page.getByRole('button', { name: 'Resize', exact: true }).click();
      await page.mouse.move(0, 0);
      await page.waitForTimeout(600);
    },
  },
  {
    name: 'catalog-search',
    open: async (page) => {
      await openDesign(page, 'main');
      await page.locator('.catalog input[type="search"]').fill('chair');
      await page.waitForTimeout(400);
    },
  },
  {
    name: 'shopping-list',
    open: async (page) => {
      await openDesign(page, 'main');
      await page.locator('.cart .popover-button').click();
      await page.waitForTimeout(500);
    },
  },
  {
    name: 'history',
    open: async (page) => {
      await openDesign(page, 'main');
      await page.locator('.history li').nth(2).hover();
      await page.waitForTimeout(500);
    },
  },
  { name: 'fit-warning', open: (page) => openDesign(page, 'fit') },
  { name: 'empty', open: (page) => openDesign(page, 'empty') },
];

/** The views to shoot: all of them, or those ONLY names. */
const shown = VIEWS.filter(({ name }) => !process.env.ONLY || process.env.ONLY.split(',').includes(name));

const SIZES = [{ width: 1440, height: 900 }, { width: 1280, height: 800 }];
/** Shot at 2× and with touch, as the online demo is opened on phones: only the views marked `phone`. */
const PHONE = { width: 390, height: 844 };
let failed = 0;

/**
 * Saves a screenshot as WebP, at the best quality under MAX_BYTES. A PNG of the room with the panels'
 * paper grain runs past it even at 64 colors, and palette PNGs band the photo.
 */
async function save(page: Page, file: string) {
  const png = await page.screenshot();
  let out = Buffer.alloc(0);
  for (const quality of [90, 85, 80, 75, 70]) {
    out = await sharp(png).webp({ quality, smartSubsample: true }).toBuffer();
    if (out.length <= MAX_BYTES) break;
  }
  if (out.length > MAX_BYTES) console.warn(`${file} is ${Math.round(out.length / 1000)} KB`);
  writeFileSync(join(OUT, file), out);
}

/** Frames per second over 3 s, with a Piece selected (its outline, dimensions and callout drawn) and the camera orbiting. */
async function measureFps(page: Page) {
  await openDesign(page, 'fit', { query: '?debug' });
  await selectPiece(page);
  const box = (await page.locator('.view').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.8);
  await page.mouse.down({ button: 'right' });
  // A string, as tsx would wrap a function's inner functions in a helper the page doesn't have.
  const sample: Promise<number> = page.evaluate(`new Promise((resolve) => {
    let frames = 0;
    const start = performance.now();
    const tick = (now) => {
      frames++;
      if (now - start < 3000) requestAnimationFrame(tick);
      else resolve((frames * 1000) / (now - start));
    };
    requestAnimationFrame(tick);
  })`);
  for (let i = 0; i < 30; i++) {
    await page.mouse.move(box.x + box.width / 2 + Math.sin(i / 5) * 120, box.y + box.height * 0.8, { steps: 4 });
  }
  await page.mouse.up({ button: 'right' });
  return sample;
}

async function shoot(headless: boolean): Promise<boolean> {
  const browser: Browser = await chromium.launch({ headless, args: GPU_ARGS });
  try {
    for (const size of [...SIZES, PHONE]) {
      const phone = size === PHONE;
      const page = await browser.newPage({ viewport: size, ...(phone ? { deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { deviceScaleFactor: 1 }) });
      page.on('pageerror', (error) => console.warn(`page error: ${error.message}`));
      for (const view of shown.filter((it) => !phone || it.phone)) {
        const at = `${view.name} @ ${size.width}×${size.height}`;
        try {
          await view.open(page);
        } catch (error) {
          console.warn(`${at} failed: ${(error as Error).message.split('\n')[0]}`);
          failed++;
          continue;
        }
        if (!phone && view.name === 'editor' && (await canvasIsBlack(page))) {
          if (headless) return false;
          console.warn('The 3D view is black even in a headed browser.');
        }
        await save(page, `${view.name}-${size.width}x${size.height}.webp`);
        console.log(at);
      }
      await page.close();
    }
    if (process.argv.includes('--fps')) {
      const page = await browser.newPage({ viewport: SIZES[0] });
      const fps = await measureFps(page);
      writeFileSync(join(OUT, 'fps.txt'), `${fps.toFixed(1)} fps (${headless ? 'headless' : 'headed'}, 1440×900, a Piece selected, orbiting)\n`);
      console.log(`${fps.toFixed(1)} fps`);
    }
    return true;
  } finally {
    await browser.close();
  }
}

mkdirSync(OUT, { recursive: true });
await saveDesigns();
try {
  if (!(await shoot(true))) {
    console.warn('The 3D view came out black headless; shooting again in a headed browser.');
    await shoot(false);
  }
} finally {
  deleteDesigns();
}
if (failed) {
  console.error(`${failed} views failed.`);
  process.exitCode = 1;
}
