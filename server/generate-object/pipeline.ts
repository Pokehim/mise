// Text-to-3D for categories the Catalog lacks (spec §13.3, Stretch; never on the demo path).
// TRELLIS.2 on fal is image-to-3D only, so it takes two calls: text → a FLUX.1 [schnell] product photo → TRELLIS.2,
// whose GLB is then normalized the way scripts/catalog-build.ts normalizes ABO models.

import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fal } from '@fal-ai/client';
import type { Trellis2Output } from '@fal-ai/client/endpoints';
import { getBounds } from '@gltf-transform/core';
import { center } from '@gltf-transform/functions';
import sharp from 'sharp';
import { DEFAULT_PRICE_USD, mountOf, optimizeModel } from '../../scripts/catalog-build';
import { io, writeJson } from '../../scripts/scan-import';
import type { Catalog, CatalogItem, Category, Vec3 } from '../../shared/types';
import { fitScale, targetBox } from './normalize';

export interface GenerateRequest {
  /** What the Mover searched for, such as "aquarium". */
  query: string;
  category: Category;
  /** The box to scale into; the category's typical size when absent. */
  targetSize?: Vec3;
}

/** The steps of a run, in order. A run starts on 'photo'. */
export type Step = 'photo' | 'queued' | 'model' | 'fitting';

// 1024 costs $0.30 (llms.txt). fal's schema takes integers here, though the SDK's generated types still say strings.
// 50k vertices is the docs' advice for the web, and keeps a Piece under §2.3's 2 MB.
const TRELLIS_INPUT = { resolution: 1024, texture_size: 1024, decimation_target: 50_000 };

async function download(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url}: ${res.status} ${res.statusText}`);
  return new Uint8Array(await res.arrayBuffer());
}

const generatedPath = (dataDir: string) => join(dataDir, 'catalog/generated.json');

/** The items text-to-3D has made: data/catalog/generated.json, kept apart from the built catalog.json. */
export async function readGenerated(dataDir: string): Promise<Catalog> {
  const file = generatedPath(dataDir);
  return existsSync(file) ? JSON.parse(await readFile(file, 'utf8')) : { version: 1, items: [] };
}

let appending = Promise.resolve();

/** Appends an item to generated.json, one write at a time, so two runs finishing together both land. */
function addGenerated(dataDir: string, item: CatalogItem): Promise<void> {
  const append = appending.then(async () => {
    const catalog = await readGenerated(dataDir);
    await writeJson(generatedPath(dataDir), { ...catalog, items: [...catalog.items, item] });
  });
  appending = append.catch(() => {});
  return append;
}

/**
 * Generates `request.query` as Catalog item `id`: its model and thumbnail go in data/catalog/models and thumbs, and
 * the item in generated.json. `onStep` hears each step after the first as it starts.
 */
export async function generateObject(request: GenerateRequest, id: string, dataDir: string, onStep: (step: Step) => void) {
  const { query, category, targetSize } = request;
  const model = `/data/catalog/models/${id}.glb`;
  const thumbnail = `/data/catalog/thumbs/${id}.jpg`;
  const inData = (url: string) => join(dataDir, url.slice('/data/'.length));

  const { data: photo } = await fal.subscribe('fal-ai/flux/schnell', {
    input: {
      prompt: `Studio product photo of ${query}, a single product, centered, plain white background, soft light, three-quarter view`,
      image_size: 'square_hd',
    },
  });
  const photoUrl = photo.images[0].url;
  // The thumbnail downloads while TRELLIS.2 runs. The catch only keeps a failed model from leaving it unhandled.
  const thumbnailJpeg = download(photoUrl).then((bytes) => sharp(bytes).resize(256, 256, { fit: 'inside' }).jpeg().toBuffer());
  thumbnailJpeg.catch(() => {});

  onStep('queued');
  const { data: trellis }: { data: Trellis2Output } = await fal.subscribe<string>('fal-ai/trellis-2', {
    input: { image_url: photoUrl, ...TRELLIS_INPUT },
    onQueueUpdate: ({ status }) => status !== 'IN_QUEUE' && onStep('model'),
  });

  onStep('fitting');
  const work = await mkdtemp(join(tmpdir(), 'mise-generate-'));
  try {
    // Bottom-center pivot, then one uniform scale about it into the box.
    const doc = await io.readBinary(await download(trellis.model_glb.url));
    await doc.transform(center({ pivot: 'below' }));
    const scene = doc.getRoot().listScenes()[0];
    const { min, max } = getBounds(scene);
    const box = targetSize ?? targetBox(JSON.parse(await readFile(join(dataDir, 'catalog/catalog.json'), 'utf8')), category);
    const scale = fitScale([max[0] - min[0], max[1] - min[1], max[2] - min[2]], box, category);
    for (const node of scene.listChildren()) {
      node.setTranslation(node.getTranslation().map((v) => v * scale) as Vec3).setScale(node.getScale().map((v) => v * scale) as Vec3);
    }
    const centered = join(work, 'centered.glb');
    await io.write(centered, doc);
    await mkdir(join(dataDir, 'catalog/models'), { recursive: true });
    await mkdir(join(dataDir, 'catalog/thumbs'), { recursive: true });
    const { size } = await optimizeModel(centered, inData(model));
    await writeFile(inData(thumbnail), await thumbnailJpeg);

    const item: CatalogItem = {
      id,
      source: 'generated',
      title: query[0].toUpperCase() + query.slice(1),
      category,
      mount: mountOf(category),
      size,
      model,
      thumbnail,
      colors: [],
      materials: [],
      styleTags: [],
      priceEstimateUsd: DEFAULT_PRICE_USD[category],
      url: '',
      attribution: 'Generated with FLUX.1 [schnell] and TRELLIS.2 (MIT) on fal',
    };
    await addGenerated(dataDir, item);
    return item;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
