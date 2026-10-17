import type { Catalog, Edit, FitViolation, RoomSetup, RoomState, SkipReason } from '@shared/types';

// Stand-ins for #5's shared/replay.ts and shared/fit.ts, with the same signatures.
// Only core.ts imports this file; delete it once both have merged.

/** A trivial reducer: enough of spec §6 to render the editor's own Edits and the fixture Design. */
export function replay(setup: RoomSetup, catalog: Catalog, edits: Edit[]): RoomState {
  const state: RoomState = {
    originals: Object.fromEntries(setup.originals.map((original) => [original.id, {
      visible: true,
      placement: { position: original.box.position, rotationY: original.box.rotationY, mount: 'floor' as const },
      moved: false,
      partColors: {},
      partFinishes: {},
    }])),
    pieces: {},
    surfaces: { walls: {} },
    patches: [],
    skipped: [],
  };
  const inCatalog = (id: string) => catalog.items.some((item) => item.id === id);

  const apply = (edit: Edit): SkipReason | undefined => {
    switch (edit.type) {
      case 'place':
        if (state.pieces[edit.pieceId]) return 'duplicate-id';
        if (!inCatalog(edit.catalogId)) return 'unknown-catalog';
        state.pieces[edit.pieceId] = { catalogId: edit.catalogId, placement: edit.placement, partColors: {} };
        return;
      case 'move':
      case 'remove': {
        const piece = state.pieces[edit.targetId];
        if (!piece) return 'missing-target';   // moving and removing Originals is Phase 2
        if (edit.type === 'move') piece.placement = edit.placement;
        else delete state.pieces[edit.targetId];
        return;
      }
      case 'swap': {
        const piece = state.pieces[edit.pieceId];
        if (!piece) return 'missing-target';
        if (!inCatalog(edit.catalogId)) return 'unknown-catalog';
        state.pieces[edit.pieceId] = { ...piece, catalogId: edit.catalogId, placement: edit.placement };
        return;
      }
      case 'replace': {
        const original = state.originals[edit.originalId];
        if (!original?.visible) return 'missing-target';
        if (state.pieces[edit.pieceId]) return 'duplicate-id';
        if (!inCatalog(edit.catalogId)) return 'unknown-catalog';
        original.visible = false;
        state.patches.push(edit.originalId);
        state.pieces[edit.pieceId] = {
          catalogId: edit.catalogId, placement: edit.placement, partColors: {}, replacesOriginalId: edit.originalId,
        };
        return;
      }
      case 'recolor': {
        const target = state.pieces[edit.targetId] ?? state.originals[edit.targetId];
        if (!target) return 'missing-target';
        if (edit.color) target.partColors[edit.partId] = edit.color;
        else delete target.partColors[edit.partId];
        return;
      }
      case 'finish':
        if (edit.target.kind !== 'wall') return 'missing-target';   // floor and Original Finishes are Phase 2
        state.surfaces.walls[edit.target.wallId] = edit.finish;
        return;
    }
  };

  for (const edit of edits) {
    const reason = apply(edit);
    if (reason) state.skipped.push({ editId: edit.id, reason });
  }
  return state;
}

/** No Fit rules yet: every spot is free. */
export function checkFit(
  _setup: RoomSetup, _catalog: Catalog, _state: RoomState, _subjectIds?: string[],
): FitViolation[] {
  return [];
}
