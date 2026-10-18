import { useState } from 'react';
import type { CatalogItem, Category, Vec3 } from '@shared/types';
import type { Step } from '../../../server/generate-object/pipeline';
import type { Job } from '../../../server/generate-object/routes';
import { generateObject, getJob } from '../api';
import { useEditor } from '../state/store';
import './generate.css';

const STEP_LABELS: Record<Step, string> = {
  photo: 'Picturing it',
  queued: 'Waiting for a GPU',
  model: 'Building the 3D model',
  fitting: 'Fitting it to size',
};

/** Adds a generated item to the open Catalog, where the search that found nothing now finds it. */
function addToCatalog(item: CatalogItem) {
  useEditor.setState(({ catalog }) =>
    catalog!.items.some(({ id }) => id === item.id) ? {} : { catalog: { ...catalog!, items: [...catalog!.items, item] } });
}

/**
 * The offer where the Catalog has nothing to show: under a search that found nothing, and in Resize when no item of the
 * category is left. It generates `query` with text-to-3D (spec §13.3, Stretch), in a minute or two, scaled into `targetSize`
 * or else the category's typical size, so under All the Mover picks a category first. The new item joins the Catalog
 * and is placed like any other. A run keeps going if this unmounts, and still adds its item.
 */
export function GenerateItem({ query, category, targetSize }: { query: string; category: Category | null; targetSize?: Vec3 }) {
  const [run, setRun] = useState<Job & { startedAt: number }>();
  const text = query.trim();
  if (!text) return null;

  async function generate(inCategory: Category) {
    const startedAt = Date.now();
    const showJob = (job: Job) => setRun({ ...job, startedAt });
    showJob({ status: 'running', step: 'photo', progress: 0 });
    try {
      const { jobId } = await generateObject({ query: text, category: inCategory, targetSize });
      for (;;) {
        const job = await getJob(jobId);
        showJob(job);
        if (job.status === 'done') return addToCatalog(job.item);
        if (job.status === 'failed') return;
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    } catch (error) {
      showJob({ status: 'failed', progress: 0, error: (error as Error).message });
    }
  }

  if (run?.status === 'running') {
    return (
      <div className="generate" role="status">
        <progress value={run.progress} />
        <span className="muted">
          Generating “{text}”: {STEP_LABELS[run.step]}… {Math.round((Date.now() - run.startedAt) / 1000)} s
        </span>
      </div>
    );
  }
  if (run?.status === 'done') return <p className="muted">“{run.item.title}” is in the Catalog now.</p>;
  return (
    <div className="generate">
      {run?.status === 'failed' && <p role="alert">Couldn't generate it: {run.error}</p>}
      {category
        ? <button onClick={() => generate(category)}>Can't find it? Generate “{text}” (1–2 min)</button>
        : <p className="muted">Can't find it? Pick a category above to generate “{text}”.</p>}
    </div>
  );
}
