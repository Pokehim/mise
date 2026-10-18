import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

// The 8 shots of spec §6 (#77). Serves the repo's data/scans files; three and Spark come from the repo's node_modules.
const viewer = fileURLToPath(new URL('.', import.meta.url));
const repo = resolve(viewer, '../../../..');
export default defineConfig({
  root: viewer,
  cacheDir: resolve(repo, 'scripts/.cache/lounge-v2/vite'),
  define: { __REPO_DIR__: JSON.stringify(repo) },
  server: { port: 5198, strictPort: true, fs: { strict: true, allow: [repo] } },
  resolve: { dedupe: ['three'] },
  optimizeDeps: { include: ['three', '@sparkjsdev/spark'] },
  logLevel: 'info',
});
