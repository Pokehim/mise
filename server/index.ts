import { copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { compress } from 'hono/compress';
import { app } from './app';

if (process.env.NODE_ENV !== 'production') {
  // Superset's Run button sets API_PORT per workspace; 8787 is only the fallback.
  const port = Number(process.env.API_PORT ?? 8787);

  // localhost only, like Vite: the API writes files, so keep it off the venue Wi-Fi.
  serve({ fetch: app.fetch, port, hostname: 'localhost' }, (info) => console.log(`Mise API on http://localhost:${info.port}`));
} else {
  await pruneData();
  await seedDesigns();

  // npm start (#42): the API, the data and the built web app (npm run build) from one server.
  const site = new Hono();
  site.use(compress());
  site.route('/', app);
  // Vite's hashed files never change, so browsers keep them. index.html they check each time.
  site.use('/assets/*', async (c, next) => {
    await next();
    c.header('Cache-Control', 'public, max-age=31536000, immutable');
  });
  // Without a header, a browser may keep its old index.html for a while after a deploy, and so the old app.
  site.use('*', async (c, next) => {
    await next();
    if (c.res.headers.get('Content-Type')?.startsWith('text/html')) c.header('Cache-Control', 'no-cache');
  });
  site.use('/*', serveStatic({ root: './dist/web' }));
  // Every other page is the web app's to route, such as /d/:designId. A missing /api or /data file stays a 404.
  site.get('*', (c, next) => (/^\/(api|data)\//.test(c.req.path) ? next() : serveStatic({ path: './dist/web/index.html' })(c, next)));

  const port = Number(process.env.PORT ?? 8080);
  serve({ fetch: site.fetch, port, hostname: '0.0.0.0' }, (info) => console.log(`Mise on port ${info.port}`));
}

/**
 * Azure's zip deploy leaves behind files the repo has since deleted, such as a removed Scan (#42). The deploy
 * lists every file it ships in .deployed-files, and on start, data/ is pruned to that list.
 */
async function pruneData() {
  if (process.env.DATA_DIR) return;
  const listed = await readFile('.deployed-files', 'utf8').catch(() => null);
  if (!listed) return;
  const shipped = new Set(listed.split('\n'));
  const stale = (await readdir('data', { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .filter((file) => !shipped.has(file));
  await Promise.all(stale.map((file) => rm(file)));
  if (stale.length) console.log(`Removed ${stale.length} files the deploy no longer ships`);
}

/**
 * The public demo keeps its Designs in DESIGNS_DIR, which outlives a redeploy (#42). Every Design that ships
 * in data/designs is a seed: copied in over any older copy of it, and listed in _seed.json, which makes it
 * read-only. A seed the deploy no longer ships is removed. Designs that visitors made aren't in data/designs,
 * so they are left alone.
 */
async function seedDesigns() {
  const dir = process.env.DESIGNS_DIR;
  if (!dir) return;
  const from = join(process.env.DATA_DIR ?? './data', 'designs');
  const seeds = (await readdir(from)).filter((file) => file.endsWith('.json') && !file.startsWith('_'));
  await mkdir(dir, { recursive: true });
  const ids = seeds.map((file) => file.slice(0, -'.json'.length));
  const before: string[] = JSON.parse(await readFile(join(dir, '_seed.json'), 'utf8').catch(() => '[]'));
  await Promise.all(before.filter((id) => !ids.includes(id)).map((id) => rm(join(dir, `${id}.json`), { force: true })));
  await Promise.all(seeds.map((file) => copyFile(join(from, file), join(dir, file))));
  await writeFile(join(dir, '_seed.json'), JSON.stringify(ids));
  console.log(`${seeds.length} seed Designs in ${dir}`);
}
