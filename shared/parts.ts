import type { Category, PartDef } from './types';

const PARTS: Partial<Record<Category, PartDef[]>> = {
  table: [{ id: 'top', name: 'Top' }, { id: 'legs', name: 'Legs' }],
  desk: [{ id: 'top', name: 'Top' }, { id: 'legs', name: 'Legs' }],
  chair: [{ id: 'seat_back', name: 'Seat and back' }, { id: 'legs', name: 'Legs' }],
  bed: [{ id: 'frame', name: 'Frame' }, { id: 'bedding', name: 'Bedding' }],
};

/** The Parts of a category (spec §7). */
export function partsFor(category: Category): PartDef[] {
  return PARTS[category] ?? [{ id: 'body', name: 'Body' }];
}
