// Saved takes: a Design the Mover liked, saved for the Brief that made it. When the same Brief is sent
// again, from the same room, Generate gives that Design again as its take, Edit by Edit as if Claude
// were making it, instead of asking Claude for a new one. The other takes are still Claude's.
import { createHash } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { DIRECTIONS, type Direction, type GenerateEvent, type LoopReport } from '../../shared/generate';
import { newId } from '../../shared/ids';
import type { Brief, Design, Edit } from '../../shared/types';

/** One saved take: the Design that is the take on its Brief in its direction, read when the Brief comes again. */
export interface SavedTake { key: string; direction: Direction; designId: string; savedAt: string }

/** How long a saved take waits before each Edit, so it draws itself like a take Claude is making. */
const REPLAY_EDIT_MS = 120;

/**
 * What makes two Briefs the same: the Scan, the words (in any case and spacing), the styles, the budget,
 * and the Edits the takes start from, if any.
 */
export function briefKey(scanId: string, brief: Brief, startsFrom: Edit[] = []) {
  const text = brief.text.trim().toLowerCase().replace(/\s+/g, ' ');
  const styles = (brief.styles ?? []).map((style) => style.toLowerCase()).sort();
  const start = startsFrom.length ? createHash('sha256').update(JSON.stringify(startsFrom)).digest('hex').slice(0, 16) : '';
  return JSON.stringify([scanId, text, styles, brief.budgetUsd ?? null, start]);
}

/** The key of the Brief a Design was made for, or undefined for a Design the AI didn't make from a Brief. */
export function designKey(design: Design) {
  return design.brief && briefKey(design.scanId, design.brief, design.edits.slice(0, design.startedFrom?.edits ?? 0));
}

/** The direction a Design takes when saved for its Brief: its own, else the first no other Design holds. */
export function directionFor(design: Design, saved: SavedTake[]) {
  const key = designKey(design);
  const taken = new Set(saved.filter((take) => take.key === key && take.designId !== design.id).map(({ direction }) => direction));
  return design.direction ?? DIRECTIONS.find((direction) => !taken.has(direction)) ?? 'literal';
}

export interface ReplayRequest {
  scanId: string;
  brief: Brief;
  current?: Design;
  save: (design: Design) => Promise<unknown>;
  signal?: AbortSignal;
  onEvent?: (event: GenerateEvent) => void;
  replayEditMs?: number;
}

/**
 * A saved Design as a take on its Brief: its rationale as the plan, then its own Edits one at a time, then
 * a new Design of them, so the Mover changes a copy and the saved Design stays as it was liked.
 */
export async function replaySavedTake(request: ReplayRequest, saved: Design, direction: Direction) {
  const { scanId, brief, current, onEvent, signal, replayEditMs = REPLAY_EDIT_MS } = request;
  const started = performance.now();
  const seconds = () => Math.round((performance.now() - started) / 100) / 10;
  const report: LoopReport = {
    direction, seconds: 0, requests: 0, toolCalls: 0,
    usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  };
  try {
    if (saved.rationale) onEvent?.({ type: 'plan', direction, text: `${saved.rationale}\n` });
    const edits: Edit[] = [];
    for (const edit of saved.edits.slice(saved.startedFrom?.edits ?? 0)) {
      await sleep(replayEditMs, undefined, { signal });
      const made = { ...edit, at: new Date().toISOString() };
      report.firstEditSeconds ??= seconds();
      edits.push(made);
      onEvent?.({ type: 'edit', direction, edit: made });
    }
    const now = new Date().toISOString();
    const { name, rationale, palette } = saved;
    const design: Design = {
      version: 1, id: newId('ds'), scanId, name, createdAt: now, updatedAt: now,
      origin: 'claude', brief, direction, rationale, palette, edits: [...(current?.edits ?? []), ...edits],
      ...(current && { startedFrom: { designId: current.id, edits: current.edits.length } }),
    };
    await request.save(design);
    report.designId = design.id;
    report.seconds = seconds();
    console.log(`Generate (${direction}): gave the take saved for this Brief, ${saved.id}, as ${design.id}`);
    onEvent?.({ type: 'design', direction, design, report });
    return { direction, design, report };
  } catch (error) {
    const why = (error as Error).message;
    report.seconds = seconds();
    onEvent?.({ type: 'failure', direction, error: why, report });
    return { direction, error: why, report };
  }
}
