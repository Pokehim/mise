import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Separate from vite.config.ts, whose root is web/: tests live in shared/, server/ and scripts/, and in
// web/ next to the code they test, which imports shared/ through the same alias as the app.
export default defineConfig({
  resolve: { alias: { '@shared': fileURLToPath(new URL('./shared', import.meta.url)) } },
});
