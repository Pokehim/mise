import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkFit } from './fit';
import { replay } from './replay';
import type { Catalog, Design, RoomSetup } from './types';

// Every Design in data/designs, checked as the editor checks it. The Fit rules may only ever grow more
// permissive: collision boxes lie inside an item's size box (#129), so a Design gets no violation it didn't have.

const data = new URL('../data/', import.meta.url);
const read = <T>(path: string): T => JSON.parse(readFileSync(new URL(path, data), 'utf8'));
const catalog = read<Catalog>('catalog/catalog.json');
const designs = readdirSync(new URL('designs/', data)).filter((name) => name.endsWith('.json')).sort();

/** The lounge as scanned: each chair pulled up to its table overlaps it as one solid box, and the third table's corner is in the door's swing. */
const LOUNGE = [
  ...[1, 2, 3].flatMap((table) => [1, 2, 3, 4].map((seat) => `overlap og_table_${table} og_chair_${(table - 1) * 4 + seat}`)),
  'door-swing og_table_3 op_2',
  ...Array.from({ length: 12 }, (_, i) => `overlap og_chair_${i + 1} og_table_${Math.floor(i / 4) + 1}`),
  'door-swing og_chair_11 op_2',
];

/** Each Design's violations before the Fit rules used collision boxes, as `<rule> <subjectId> <otherId>`. */
const BEFORE: Record<string, string[]> = {
  'ds_lounge.json': LOUNGE,
};

describe('the Designs in data/designs', () => {
  it.each(designs)('%s has no Fit violation it didn\'t have before', (name) => {
    const design = read<Design>(`designs/${name}`);
    const setup = read<RoomSetup>(`scans/${design.scanId}/setup.json`);
    const violations = checkFit(setup, catalog, replay(setup, catalog, design.edits))
      .map(({ rule, subjectId, otherId }) => `${rule} ${subjectId} ${otherId ?? ''}`.trim());
    expect(violations.filter((violation) => !(BEFORE[name] ?? []).includes(violation))).toEqual([]);
  });
});
