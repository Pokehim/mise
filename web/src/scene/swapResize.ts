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
  const fields = { catalogId: item.id, placement: swapPlacement(room, target, item.size[2])!, ...(targetSize && { targetSize }) };
  return target.kind === 'piece'
    ? { type: 'swap', pieceId: target.id, via: targetSize ? 'resize' : 'swap', ...fields }
    : { type: 'replace', originalId: target.id, pieceId: newId('pc'), via: targetSize ? 'resize' : 'replace', ...fields };
}

/**
 * Where an item `depth` deep goes in place of a Piece or an Original: with its back-center where
 * the old item's was. In place of an Original, it also goes flush against a wall that back is
 * within 10 cm of, as a dragged Piece does (spec §10.3): a Room Setup box can stand a few cm off
 * the wall the real item is against, while a Piece stands exactly where the Mover put it.
 */
export function swapPlacement(room: Room, target: SwapTarget, depth: number): Placement | undefined {
  const box = targetBox(room, target);
  if (!box) return undefined;
  const { position: [x, y, z], rotationY } = box.placement;
  const forward = (depth - box.size[2]) / 2;
  const moved: Placement = { ...box.placement, position: [x + Math.sin(rotationY) * forward, y, z + Math.cos(rotationY) * forward] };
  return (target.kind === 'original' && moved.mount !== 'wall' && snapToWall(moved, depth, room.setup.walls)) || moved;
}
