import { useMemo, useState } from 'react';
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
 * The offer under a Catalog search that found nothing: generate it with text-to-3D (spec §13.3, Stretch), about 30 s.
 * The new item joins the Catalog and is placed like any other. Without a category, the Mover picks one, since it sets
 * the item's size. A run keeps going if this unmounts, and still adds its item.
 */
export function GenerateItem({ query, category, targetSize }: { query: string; category: Category | null; targetSize?: Vec3 }) {
  const catalog = useEditor((s) => s.catalog!);
  const categories = useMemo(() => [...new Set(catalog.items.map((item) => item.category))].sort(), [catalog]);
  const [chosen, setChosen] = useState<Category>('decor');
  const [run, setRun] = useState<Job & { startedAt: number }>();
  const text = query.trim();
  if (!text) return null;

  async function generate() {
    const startedAt = Date.now();
    const show = (job: Job) => setRun({ ...job, startedAt });
    show({ status: 'running', step: 'photo', progress: 0 });
    try {
      const { jobId } = await generateObject({ query: text, category: category ?? chosen, targetSize });
      for (;;) {
        const job = await getJob(jobId);
        show(job);
        if (job.status === 'done') return addToCatalog(job.item!);
        if (job.status === 'failed') return;
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    } catch (error) {
      show({ status: 'failed', progress: 0, error: (error as Error).message });
    }
  }

  if (run?.status === 'running') {
    return (
      <div className="generate" role="status">
        <progress value={run.progress} />
        <span className="muted">
          Generating “{text}”: {STEP_LABELS[run.step!]}… {Math.round((Date.now() - run.startedAt) / 1000)} s
        </span>
      </div>
    );
  }
  if (run?.status === 'done') return <p className="muted">“{run.item!.title}” is in the Catalog now.</p>;
  return (
    <div className="generate">
      {run?.status === 'failed' && <p className="muted" role="alert">Couldn't generate it: {run.error}</p>}
      {!category && (
        <label className="muted">
          Category{' '}
          <select value={chosen} onChange={(e) => setChosen(e.target.value as Category)}>
            {categories.map((c) => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}
          </select>
        </label>
      )}
      <button onClick={generate}>Can't find it? Generate “{text}” (~30 s)</button>
    </div>
  );
}
