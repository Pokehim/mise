import type { SearchResult } from '@shared/catalog-search';
import { newId } from '@shared/ids';
import type { Catalog, CatalogItem, Category, Placement, RoomSetup, RoomState, Vec3 } from '@shared/types';
import { search } from '../state/core';
import type { NewEdit } from '../state/store';
import { keepInRoom } from './placement';

/** Swap's list (spec §10.4): the other items of the Piece's category, closest in size first. */
export const swapCandidates = (catalog: Catalog, current: CatalogItem): CatalogItem[] =>
  search(catalog, { category: current.category, targetSize: current.size, limit: Infinity })
    .flatMap(({ item }) => (item.id === current.id ? [] : [item]));

/** What Resize looks for (spec §10.5). */
export interface ResizeQuery {
  category: Category;
  targetSize: Vec3;
  /** 🔒: count the height in the size closeness too. */
  lockHeight?: boolean;
  /** The Catalog item of the Piece being resized, which is never a candidate for it. */
  currentId?: string;
}

/**
 * Resize's live candidates (spec §8.2, §10.5): up to 3 items that fit the target size, closest
 * first, or, when none does, the 3 closest, labeled "Closest available".
 */
export function resizeCandidates(catalog: Catalog, { category, targetSize, lockHeight, currentId }: ResizeQuery): SearchResult[] {
  const ranked = search(catalog, { category, targetSize, lockHeight, limit: Infinity }).filter(({ item }) => item.id !== currentId);
  const fits = ranked.filter(({ label }) => label === 'fits');
  return (fits.length ? fits : ranked).slice(0, 3);
}

/** What a swap or a Resize changes: a Piece, or an Original that a Piece will replace. */
export type SwapTarget = { kind: 'piece' | 'original'; id: string };

/** What a swap reads from the editor: the Scan's setup, the Catalog, and the Design's room state. */
export interface SwapContext { setup: RoomSetup; catalog: Catalog; roomState: RoomState }

/** The box a Piece or a visible Original takes up: where it stands, and its size. */
export function targetBox({ setup, catalog, roomState }: SwapContext, { kind, id }: SwapTarget): { placement: Placement; size: Vec3 } | undefined {
  if (kind === 'piece') {
    const piece = roomState.pieces[id];
    const item = piece && catalog.items.find(({ id: itemId }) => itemId === piece.catalogId);
    return item && { placement: piece.placement, size: item.size };
  }
  const original = setup.originals.find((o) => o.id === id);
  const state = roomState.originals[id];
  return original && state?.visible ? { placement: state.placement, size: original.box.size } : undefined;
}

/**
 * The Edit that puts a Catalog item where a Piece or an Original stands, keeping the old item's
 * back-center (spec §10.5): a swap for a Piece, a replace for an Original. With a targetSize, it
 * is a Resize.
 */
export function swapEdit(context: SwapContext, target: SwapTarget, item: CatalogItem, targetSize?: Vec3): NewEdit {
  const fields = { catalogId: item.id, placement: swapPlacement(context, target, item.size[2], item.size[0])!, ...(targetSize && { targetSize }) };
  return target.kind === 'piece'
    ? { type: 'swap', pieceId: target.id, via: targetSize ? 'resize' : 'swap', ...fields }
    : { type: 'replace', originalId: target.id, pieceId: newId('pc'), via: targetSize ? 'resize' : 'replace', ...fields };
}

/**
 * Where an item `depth` deep and `width` wide (by default, as wide as the old item) goes in place of
 * a Piece or an Original: with its back-center where the old item's was. Walls are solid: a bigger
 * item moves the shortest way to stay inside the room, or, when it can't fit at all, stays put for
 * the outside-floor Fit rule to report. In place of an Original, it also goes flush against a wall
 * or into a corner within 15 cm, as a dragged Piece does (spec §10.3): a Room Setup box can stand a
 * few cm off the wall the real item is against, while a Piece stands exactly where the Mover put it.
 */
export function swapPlacement(context: SwapContext, target: SwapTarget, depth: number, width?: number): Placement | undefined {
  const box = targetBox(context, target);
  if (!box) return undefined;
  const { position: [x, y, z], rotationY } = box.placement;
  const forward = (depth - box.size[2]) / 2;
  const moved: Placement = { ...box.placement, position: [x + Math.sin(rotationY) * forward, y, z + Math.cos(rotationY) * forward] };
  if (moved.mount === 'wall') return moved;
  const size: Vec3 = [width ?? box.size[0], box.size[1], depth];
  return keepInRoom(moved, size, context.setup, { snap: target.kind === 'original' }) ?? moved;
}
