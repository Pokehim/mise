// FAL_KEY=sandbox: text-to-3D without paying fal, to try it out. A run takes about as long as a real one, but its photo
// and model are the example input and output in TRELLIS.2's docs, a leather satchel whatever the query. Everything
// after fal runs for real, on a GLB that TRELLIS.2 made. Its items are kept apart from real ones.
import type { fal } from '@fal-ai/client';

export const inSandbox = () => process.env.FAL_KEY === 'sandbox';

// From fal's schema for TRELLIS.2: https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/trellis-2
const EXAMPLE_PHOTO = 'https://v3b.fal.media/files/b/0a86b60d/xkpao5B0uxmH0tmJm0HVL_2fe35ce1-fe44-475b-b582-6846a149537c.png';
const EXAMPLE_GLB = 'https://v3b.fal.media/files/b/0a86b61d/DNmTkiWHUQ8k-rG6aussB_trellis2_68d6300f70f34d23b69a912b5fe60487.glb';

const wait = (seconds: number) => new Promise((resolve) => setTimeout(resolve, seconds * 1000));

/** fal.subscribe as the pipeline calls it: FLUX.1 [schnell], then TRELLIS.2 with its queue updates. */
async function subscribe(endpoint: string, { onQueueUpdate }: { onQueueUpdate?: (update: { status: string }) => void }) {
  if (endpoint === 'fal-ai/flux/schnell') {
    await wait(1);
    return { data: { images: [{ url: EXAMPLE_PHOTO }] }, requestId: 'sandbox' };
  }
  onQueueUpdate?.({ status: 'IN_QUEUE' });
  await wait(3);
  onQueueUpdate?.({ status: 'IN_PROGRESS' });
  await wait(15);
  return { data: { model_glb: { url: EXAMPLE_GLB } }, requestId: 'sandbox' };
}

export const sandboxFal = { subscribe: subscribe as unknown as typeof fal.subscribe };
