import { serve } from '@hono/node-server';
import { app } from './app';

// Superset's Run button sets API_PORT per workspace; 8787 is only the fallback.
const port = Number(process.env.API_PORT ?? 8787);

// localhost only, like Vite: the API writes files, so keep it off the venue Wi-Fi.
serve({ fetch: app.fetch, port, hostname: 'localhost' }, (info) => console.log(`Mise API on http://localhost:${info.port}`));
