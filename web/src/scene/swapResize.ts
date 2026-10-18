import { search, type SearchResult } from '@shared/catalog-search';
import { newId } from '@shared/ids';
import type { Catalog, CatalogItem, Category, Placement, RoomSetup, RoomState, Vec3 } from '@shared/types';
import type { NewEdit } from '../state/store';
import { snapToWall } from './placement';

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

/** Resize's live candidates (spec §8.2, §10.5): the 3 items closest to the target size. */
export function resizeCandidates(catalog: Catalog, { category, targetSize, lockHeight, currentId }: ResizeQuery): SearchResult[] {
  return search(catalog, { category, targetSize, lockHeight, limit: Infinity })
    .filter(({ item }) => item.id !== currentId)
    .slice(0, 3);
}

/** What a swap or a Resize changes: a Piece, or an Original that a Piece will replace. */
export type SwapTarget = { kind: 'piece' | 'original'; id: string };

/** The parts of the editor's state a swap reads. */
export interface Room { setup: RoomSetup; catalog: Catalog; roomState: RoomState }

/** The box a Piece or a visible Original takes up: where it stands, and its size. */
export function targetBox({ setup, catalog, roomState }: Room, { kind, id }: SwapTarget): { placement: Placement; size: Vec3 } | undefined {
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
export function swapEdit(room: Room, target: SwapTarget, item: CatalogItem, targetSize?: Vec3): NewEdit {
  const box = targetBox(room, target)!;
  const placement = swapPlacement(room.setup, box.placement, box.size[2], item.size[2]);
  const resize = targetSize && { via: 'resize' as const, targetSize };
  return target.kind === 'piece'
    ? { type: 'swap', pieceId: target.id, catalogId: item.id, placement, ...(resize ?? { via: 'swap' }) }
    : { type: 'replace', originalId: target.id, pieceId: newId('pc'), catalogId: item.id, placement, ...(resize ?? { via: 'replace' }) };
}

/**
 * Where an item `toDepth` deep goes in place of one `fromDepth` deep: with its back-center where
 * the old item's was, and, like a dragged Piece, flush against a wall that back is within 10 cm of
 * (spec §10.3).
 */
export function swapPlacement(setup: RoomSetup, placement: Placement, fromDepth: number, toDepth: number): Placement {
  const [x, y, z] = placement.position;
  const forward = (toDepth - fromDepth) / 2;
  const moved = { ...placement, position: [x + Math.sin(placement.rotationY) * forward, y, z + Math.cos(placement.rotationY) * forward] } satisfies Placement;
  return (moved.mount !== 'wall' && snapToWall(moved, toDepth, setup.walls)) || moved;
}
