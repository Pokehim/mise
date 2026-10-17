import { partsFor } from './parts';
import type { Catalog, Edit, Hex, RoomSetup } from './types';

/** The History text for one Edit (spec §6), such as "Painted North wall · Sage". */
export function describe(edit: Edit, setup: RoomSetup, catalog: Catalog): string {
  const item = (catalogId: string) => catalog.items.find((catalogItem) => catalogItem.id === catalogId);
  const title = (catalogId: string) => item(catalogId)?.title ?? catalogId;
  const yours = (originalId: string) => {
    const original = setup.originals.find(({ id }) => id === originalId);
    return original && `your ${original.label.toLowerCase()}`;
  };
  /** "your bed frame", "your bed" ('*'), "legs" or "all Parts" for a Piece. */
  const parts = (targetId: string, partId: string) => {
    const owner = yours(targetId);
    if (partId === '*') return owner ?? 'all Parts';
    return [owner, PART_NAMES.get(partId) ?? partId].filter(Boolean).join(' ');
  };

  switch (edit.type) {
    case 'place':
      return `Placed ${title(edit.catalogId)}`;
    case 'move':
      return `Moved ${yours(edit.targetId) ?? 'a Piece'}`;
    case 'remove':
      return `Removed ${yours(edit.targetId) ?? 'a Piece'}`;
    case 'swap': {
      const category = item(edit.catalogId)?.category.replace('_', ' ') ?? 'a Piece';
      return `${edit.via === 'resize' ? 'Resized' : 'Swapped'} ${category} → ${title(edit.catalogId)}`;
    }
    case 'replace': {
      const original = yours(edit.originalId) ?? 'an Original';
      return edit.via === 'resize'
        ? `Resized ${original} → ${title(edit.catalogId)}`
        : `Replaced ${original} with ${title(edit.catalogId)}`;
    }
    case 'recolor':
      return edit.color
        ? `Recolored ${parts(edit.targetId, edit.partId)} · ${colorName(edit.color)}`
        : `Cleared the color of ${parts(edit.targetId, edit.partId)}`;
    case 'finish': {
      const { target, finish } = edit;
      const surface = target.kind === 'wall' ? setup.walls.find(({ id }) => id === target.wallId)?.name ?? 'a wall'
        : target.kind === 'floor' ? 'the floor'
        : parts(target.originalId, target.partId);
      switch (finish.kind) {
        case 'paint':
          return `Painted ${surface} · ${colorName(finish.color)}`;
        case 'material':
          // The Material Library isn't an input, so its name comes from the id: "oak" → "Oak".
          return `Finished ${surface} · ${finish.materialId[0].toUpperCase()}${finish.materialId.slice(1)}`;
        case 'none':
          return `Reset ${surface} to scanned`;
      }
    }
  }
}

// One category per §7 rule: together they name every Part.
const PART_NAMES = new Map((['desk', 'chair', 'bed'] as const)
  .flatMap((category) => partsFor(category))
  .map(({ id, name }) => [id, name.toLowerCase()]));

// Interior colors for History text. A color gets the name nearest to it, so any color picked
// or proposed by Claude still reads as a word ("#1a1a1a" → Black).
const COLOR_NAMES: [string, Hex][] = [
  ['Black', '#1c1c1c'], ['Charcoal', '#3a3d42'], ['Gray', '#8a8d91'], ['Greige', '#b4ab9c'],
  ['Warm White', '#f2ece1'], ['White', '#ffffff'], ['Cream', '#efe4c8'], ['Beige', '#d6c3a3'],
  ['Tan', '#c19a6b'], ['Walnut', '#5c4033'], ['Terracotta', '#c8714e'], ['Rust', '#a3432b'],
  ['Red', '#b52a2a'], ['Blush', '#e6b8b0'], ['Pink', '#e48aa8'], ['Orange', '#e07b28'],
  ['Mustard', '#d1a12b'], ['Yellow', '#f1d14b'], ['Olive', '#6b6b3a'], ['Sage', '#9caf88'],
  ['Green', '#3e7b4f'], ['Teal', '#2a7b7b'], ['Navy', '#1f2a44'], ['Blue', '#3c6db0'],
  ['Powder Blue', '#a9c4de'], ['Lavender', '#b5a6cf'], ['Plum', '#6b3a5b'],
];

const rgb = (color: Hex) => [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));

/** Squared "redmean" distance: plain RGB distance, weighted to follow the eye more closely. */
function colorDistance(a: Hex, b: Hex) {
  const [[r1, g1, b1], [r2, g2, b2]] = [rgb(a), rgb(b)];
  const r = (r1 + r2) / 2;
  return (2 + r / 256) * (r1 - r2) ** 2 + 4 * (g1 - g2) ** 2 + (2 + (255 - r) / 256) * (b1 - b2) ** 2;
}

const colorName = (color: Hex) =>
  COLOR_NAMES.reduce((best, entry) => (colorDistance(color, entry[1]) < colorDistance(color, best[1]) ? entry : best))[0];
