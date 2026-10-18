import { describe, expect, it } from 'vitest';
import { standInCandidates, standInFor } from './stand-ins';
import { item } from './test-room';
import type { Catalog } from './types';

const catalog: Catalog = {
  version: 1,
  items: [
    item('bed-low', 'bed', 'Platform Bed', [0.99, 0.6, 2.03]),
    item('bed-loft', 'bed', 'Loft Bed', [0.99, 1.8, 2.03]),
    item('chair-accent', 'chair', 'Accent Chair', [0.46, 0.85, 0.46]),
    item('chair-swivel', 'chair', 'Swivel Office Chair', [0.6, 0.95, 0.6]),
    item('dresser-wide', 'dresser', 'Wide Dresser', [1.5, 0.8, 0.5]),
    item('nightstand-3', 'nightstand', '3-Drawer Chest', [0.55, 0.7, 0.4]),
    item('placeholder-desk', 'desk', 'Placeholder Desk', [1.2, 0.75, 0.6]),
  ],
};

describe('standInCandidates', () => {
  it('offers only low beds, as dorm beds are', () => {
    expect(standInCandidates(catalog, { label: 'Bed', category: 'bed', size: [0.99, 0.6, 2.03] }).map(({ item }) => item.id)).toEqual(['bed-low']);
  });

  it('puts a swivel chair first at a desk, and the closest chair first elsewhere', () => {
    const size: [number, number, number] = [0.46, 0.85, 0.46];
    expect(standInFor(catalog, { label: 'Desk chair', category: 'chair', size })?.id).toBe('chair-swivel');
    expect(standInFor(catalog, { label: 'Chair', category: 'chair', size })?.id).toBe('chair-accent');
  });

  it('turns to a related kind when its own is far off in size: a small dresser is a chest', () => {
    expect(standInFor(catalog, { label: 'Dresser', category: 'dresser', size: [0.55, 0.9, 0.4] })?.id).toBe('nightstand-3');
  });

  it('never offers a placeholder, and offers nothing for a kind the Catalog lacks', () => {
    expect(standInFor(catalog, { label: 'Desk', category: 'desk', size: [1.2, 0.75, 0.6] })).toBeUndefined();
    expect(standInFor(catalog, { label: 'Sofa', category: 'sofa', size: [2, 0.85, 0.9] })).toBeUndefined();
  });
});
