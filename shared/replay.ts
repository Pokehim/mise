import { partsFor } from './parts';
import type { Catalog, Category, Edit, RoomSetup, RoomState, SkipReason } from './types';

/**
 * The room a Design shows: its Scan, with the Edits applied in list order (spec §6, ADR-0001).
 * An Edit that can't apply is recorded in `skipped`, with the reason.
 */
export function replay(setup: RoomSetup, catalog: Catalog, edits: Edit[]): RoomState {
  const state: RoomState = {
    originals: Object.fromEntries(setup.originals.map(({ id, box: { position, rotationY } }) => [id, {
      visible: true, moved: false, partColors: {}, partFinishes: {},
      placement: { position, rotationY, mount: 'floor' },
    }])),
    pieces: {},
    surfaces: { walls: {} },
    patches: [],
    skipped: [],
  };
  const items = new Map(catalog.items.map((item) => [item.id, item]));
  const scanned = new Map(setup.originals.map((original) => [original.id, original]));
  const isKept = (originalId: string) => scanned.get(originalId)?.kept;
  // hasOwn, so that an id like "constructor" can't find something on the object prototype.
  const pieceAt = (id: string) => (Object.hasOwn(state.pieces, id) ? state.pieces[id] : undefined);
  const originalAt = (id: string) => (Object.hasOwn(state.originals, id) ? state.originals[id] : undefined);
  const isTaken = (id: string) => Object.hasOwn(state.pieces, id) || Object.hasOwn(state.originals, id);
  const addPatch = (originalId: string) => {
    if (!state.patches.includes(originalId)) state.patches.push(originalId);
  };

  function apply(edit: Edit): SkipReason | undefined {
    switch (edit.type) {
      case 'place':
        if (isTaken(edit.pieceId)) return 'duplicate-id';
        if (!items.has(edit.catalogId)) return 'unknown-catalog';
        state.pieces[edit.pieceId] = { catalogId: edit.catalogId, placement: edit.placement, partColors: {} };
        return;
      case 'move': {
        const piece = pieceAt(edit.targetId);
        if (piece) {
          piece.placement = edit.placement;
          return;
        }
        const original = originalAt(edit.targetId);
        if (!original?.visible) return 'missing-target';
        if (isKept(edit.targetId)) return 'kept';
        original.placement = edit.placement;
        original.moved = true;
        addPatch(edit.targetId);
        return;
      }
      case 'remove': {
        if (pieceAt(edit.targetId)) {
          delete state.pieces[edit.targetId];
          return;
        }
        const original = originalAt(edit.targetId);
        if (!original) return 'missing-target';
        if (isKept(edit.targetId)) return 'kept';
        original.visible = false;
        addPatch(edit.targetId);
        return;
      }
      case 'swap': {
        const piece = pieceAt(edit.pieceId);
        const item = items.get(edit.catalogId);
        if (!piece) return 'missing-target';
        if (!item) return 'unknown-catalog';
        // Every color is on a Part of the old item, so keeping the new item's Parts keeps those in both.
        const parts = partsFor(item.category).map((part) => part.id);
        piece.partColors = Object.fromEntries(Object.entries(piece.partColors).filter(([partId]) => parts.includes(partId)));
        piece.catalogId = edit.catalogId;
        piece.placement = edit.placement;
        return;
      }
      case 'replace': {
        const original = originalAt(edit.originalId);
        if (!original?.visible) return 'missing-target';
        if (isKept(edit.originalId)) return 'kept';
        if (isTaken(edit.pieceId)) return 'duplicate-id';
        if (!items.has(edit.catalogId)) return 'unknown-catalog';
        original.visible = false;
        addPatch(edit.originalId);
        state.pieces[edit.pieceId] = {
          catalogId: edit.catalogId, placement: edit.placement, partColors: {}, replacesOriginalId: edit.originalId,
        };
        return;
      }
      case 'recolor': {
        const piece = pieceAt(edit.targetId);
        const original = originalAt(edit.targetId);
        const target = piece ?? (original?.visible ? original : undefined);
        const category = piece ? items.get(piece.catalogId)?.category : scanned.get(edit.targetId)?.category;
        if (!target || !category) return 'missing-target';
        return putParts(target.partColors, category, edit.partId, edit.color);
      }
      case 'finish': {
        const { target } = edit;
        const finish = edit.finish.kind === 'none' ? null : edit.finish;
        switch (target.kind) {
          case 'floor':
            if (finish) state.surfaces.floor = finish;
            else delete state.surfaces.floor;
            return;
          case 'wall':
            if (!setup.walls.some((wall) => wall.id === target.wallId)) return 'missing-target';
            put(state.surfaces.walls, target.wallId, finish);
            return;
          case 'original': {
            const original = scanned.get(target.originalId);
            if (!original) return 'missing-target';
            return putParts(state.originals[original.id].partFinishes, original.category, target.partId, finish);
          }
        }
      }
    }
  }

  for (const edit of edits) {
    const reason = apply(edit);
    if (reason) state.skipped.push({ editId: edit.id, reason });
  }
  return state;
}

/** Sets a key, or deletes it when the value is null. */
function put<V>(record: Record<string, V>, key: string, value: V | null) {
  if (value === null) delete record[key];
  else record[key] = value;
}

/** Puts a value on one Part of the category, or on every Part when partId is '*'. */
function putParts<V>(values: Record<string, V>, category: Category, partId: string, value: V | null): SkipReason | undefined {
  const parts = partsFor(category).map((part) => part.id);
  if (partId !== '*' && !parts.includes(partId)) return 'unknown-part';
  for (const id of partId === '*' ? parts : [partId]) put(values, id, value);
}
