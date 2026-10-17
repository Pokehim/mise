import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Superset's Run button sets API_PORT per workspace; 8787 is only the fallback.
const api = `http://localhost:${process.env.API_PORT ?? 8787}`;

export default defineConfig({
  root: 'web',
  plugins: [react()],
  resolve: { alias: { '@shared': fileURLToPath(new URL('./shared', import.meta.url)) } },
  server: { proxy: { '/api': api, '/data': api } },
});
