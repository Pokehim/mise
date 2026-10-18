/*
 * Brief → 3 Designs as the Mover sees it (spec §13.1): each take drawn Edit by Edit as the server streams
 * it, and each Design as soon as it is finished. It lives outside the editor, which remounts when a
 * Design opens, so the other takes keep arriving while the Mover looks at the first.
 *
 *   useGenerate(selector)   status 'brief' | 'designing' | 'done'; the Scan and Brief; the takes by direction;
 *                           since (when the Brief was sent), seconds (once done); error (why the Brief was refused).
 *   generate(scanId, brief) Sends the Brief and reads the stream to its end.
 *   warm(scanId)            Has the server cache what the Scan's Designs read first, so they start sooner.
 */
import { create } from 'zustand';
import { DIRECTIONS, type Direction, type GenerateEvent, type LoopReport } from '@shared/generate';
import type { Brief, Design, Edit } from '@shared/types';
import { rememberDesigns, warmGenerate } from '../api';

/** One take on the Brief: Claude's plan for it and its Edits so far, then its Design, or why it failed. */
export interface Take { plan?: string; edits: Edit[]; design?: Design; report?: LoopReport; error?: string }

interface Generating {
  status: 'brief' | 'designing' | 'done';
  scanId?: string;
  brief?: Brief;
  takes: Record<Direction, Take>;
  since?: number;
  seconds?: number;
  error?: string;
}

const noTakes = (): Record<Direction, Take> => ({ literal: { edits: [] }, bolder: { edits: [] }, budget: { edits: [] } });

export const useGenerate = create<Generating>()(() => ({ status: 'brief', takes: noTakes() }));

/** Sends the Brief, and keeps each take up to date from the server's stream until every take is done. */
export async function generate(scanId: string, brief: Brief): Promise<void> {
  // The takes' requests keep the cache warm as warm() would.
  warmed.set(scanId, Date.now());
  useGenerate.setState({ status: 'designing', scanId, brief, takes: noTakes(), since: Date.now(), seconds: undefined, error: undefined });
  try {
    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' },
      body: JSON.stringify({ scanId, brief }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `The server answered ${res.status}`);
    for await (const event of ndjson<GenerateEvent>(res.body!)) receive(event);
    if (useGenerate.getState().status === 'designing') throw new Error('The server stopped before every take was done');
  } catch (err) {
    const { takes } = useGenerate.getState();
    const begun = DIRECTIONS.some((direction) => takes[direction].edits.length || takes[direction].design);
    if (!begun) return useGenerate.setState({ status: 'brief', error: (err as Error).message });
    // Some takes made it: they stay, and the rest say why they stopped.
    const error = (err as Error).message;
    useGenerate.setState({
      status: 'done',
      takes: Object.fromEntries(DIRECTIONS.map((direction) => {
        const take = takes[direction];
        return [direction, take.design || take.error ? take : { ...take, error }];
      })) as Record<Direction, Take>,
    });
  }
}

/** One event of the stream, into the take it belongs to. */
function receive(event: GenerateEvent) {
  // The public demo lists each visitor's own Designs (#42), and Claude's takes are theirs.
  if (event.type === 'design') rememberDesigns([event.design.id]);
  if (event.type === 'done') return useGenerate.setState({ status: 'done', seconds: event.result.seconds });
  useGenerate.setState(({ takes }) => {
    const take = takes[event.direction];
    const next = ((): Take => {
      switch (event.type) {
        case 'plan': return { ...take, plan: (take.plan ?? '') + event.text };
        case 'edit': return { ...take, edits: [...take.edits, event.edit] };
        case 'design': return { ...take, edits: event.design.edits, design: event.design, report: event.report };
        case 'failure': return { ...take, error: event.error, report: event.report };
      }
    })();
    return { takes: { ...takes, [event.direction]: next } };
  });
}

/** The values of a stream of JSON lines, as each line completes. */
async function* ndjson<T>(body: ReadableStream<Uint8Array>): AsyncGenerator<T> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop()!;
    for (const line of lines) if (line.trim()) yield JSON.parse(line);
  }
}

/** Claude's prompt cache keeps a prefix 5 minutes after its last use; warming again before then is wasted. */
const WARM_FOR_MS = 4 * 60_000;
const warmed = new Map<string, number>();

/**
 * Has the server write what every take of this Scan's Brief reads first to Claude's prompt cache, so that
 * the Designs start a few seconds sooner. Called when the Mover starts writing a Brief; once is enough.
 */
export function warm(scanId: string): void {
  if (Date.now() - (warmed.get(scanId) ?? -Infinity) < WARM_FOR_MS) return;
  warmed.set(scanId, Date.now());
  warmGenerate(scanId).catch(() => warmed.delete(scanId));
}
