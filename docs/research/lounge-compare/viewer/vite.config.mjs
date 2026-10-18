import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

// Paths are relative to this folder, so the viewer runs from docs/research/lounge-compare/ in any checkout.
const viewer = fileURLToPath(new URL('.', import.meta.url));
const tools = resolve(viewer, '..');
const repo = resolve(tools, '../../..');
export default defineConfig({
  root: viewer,
  cacheDir: resolve(tools, '.vite-cache'),
  define: { __TOOLS_DIR__: JSON.stringify(tools), __REPO_DIR__: JSON.stringify(repo) },
  server: { port: 5199, strictPort: true, fs: { strict: true, allow: [tools, repo] } },
  resolve: { dedupe: ['three'] },
  optimizeDeps: { include: ['three', '@sparkjsdev/spark'] },
  logLevel: 'info',
});
