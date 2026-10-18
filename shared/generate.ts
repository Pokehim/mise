// Brief → 3 Designs (spec §13): what the editor and the server share about it.
import type { Design } from './types';

/** The three takes on one Brief, one per agent loop (spec §13.1, step 3), in the order the server returns them. */
export const DIRECTIONS = ['literal', 'bolder', 'budget'] as const;
export type Direction = (typeof DIRECTIONS)[number];

/** What one loop took, and the Design it made: its time, its requests and tool calls, and its tokens. */
export interface LoopReport {
  direction: Direction;
  /** The Design the loop made, unless it failed. */
  designId?: string;
  seconds: number;
  requests: number;
  toolCalls: number;
  usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number };
}

/** POST /api/generate's answer: every Design a loop finished, and why the others failed. */
export interface GenerateResult {
  designs: Design[];
  failures: { direction: Direction; error: string }[];
  loops: LoopReport[];
  seconds: number;
}

/** A budget the Brief's own words name, such as "under $400". */
export function budgetInText(text: string): number | undefined {
  const amount = /\$\s?(\d[\d,]*)/.exec(text)?.[1];
  const usd = amount && Number(amount.replaceAll(',', ''));
  return usd && usd > 0 ? usd : undefined;
}
