import { roomItems } from './fit';
import { pointInPolygon, wallPoint } from './geometry';
import { partsFor } from './parts';
import type { Catalog, Category, Edit, Original, Placement, RoomSetup, RoomState, SkipReason, Wall } from './types';

/**
 * The room a Design shows: its Scan, with the Edits applied in list order (spec §6, ADR-0001).
 * An Edit that can't apply is recorded in `skipped`, with the reason. What rests on something (a lamp
 * on a side table, the books in a bookcase) goes with it when it is moved, swapped or replaced.
 */
export function replay(setup: RoomSetup, catalog: Catalog, edits: Edit[]): RoomState {
  const state: RoomState = {
    originals: Object.fromEntries(setup.originals.map((original) => [original.id, {
      visible: true, moved: false, partColors: {}, partFinishes: {}, placement: startPlacement(original, setup.walls),
    }])),
    pieces: {},
    surfaces: { walls: {} },
    patches: [],
    skipped: [],
  };
  const catalogItems = new Map(catalog.items.map((item) => [item.id, item]));
  const scanned = new Map(setup.originals.map((original) => [original.id, original]));
  const isKept = (originalId: string) => scanned.get(originalId)?.kept;
  // hasOwn, so that an id like "constructor" can't find something on the object prototype.
  const pieceAt = (id: string) => (Object.hasOwn(state.pieces, id) ? state.pieces[id] : undefined);
  const originalAt = (id: string) => (Object.hasOwn(state.originals, id) ? state.originals[id] : undefined);
  const isTaken = (id: string) => Object.hasOwn(state.pieces, id) || Object.hasOwn(state.originals, id);
  const addPatch = (originalId: string) => {
    if (!state.patches.includes(originalId)) state.patches.push(originalId);
  };

  /** What rests on something, and on those in turn: on its top, or inside it on a shelf's levels. A Kept Original stays. */
  function restingOn(id: string): string[] {
    const items = roomItems(setup, catalog, state);
    const found: string[] = [];
    for (let i = -1, base = id; i < found.length; base = found[++i]) {
      const under = items.find((item) => item.id === base);
      if (!under) continue;
      const [bottom, top] = under.heights;
      for (const { id: other, placement: { mount, position: [x, y, z] } } of items) {
        if (other !== id && !found.includes(other) && !isKept(other) && mount === 'surface'
          && y > bottom + RESTS_ABOVE && y <= top + RESTS_WITHIN && pointInPolygon([x, z], under.corners)) found.push(other);
      }
    }
    return found;
  }
  /** Takes what rested on something from where it stood to where it stands now, turning with it, and up by `lift` when its top rose. */
  function carry(ids: string[], from: Placement, to: Placement, lift = 0) {
    const turn = to.rotationY - from.rotationY;
    const [cos, sin] = [Math.cos(turn), Math.sin(turn)];
    for (const id of ids) {
      const target = pieceAt(id) ?? originalAt(id)!;
      const { position: [x, y, z], rotationY } = target.placement;
      const [dx, dz] = [x - from.position[0], z - from.position[2]];
      target.placement = {
        ...target.placement,
        position: [to.position[0] + dx * cos + dz * sin, y + to.position[1] - from.position[1] + lift, to.position[2] - dx * sin + dz * cos],
        rotationY: rotationY + turn,
      };
      if (!pieceAt(id)) {
        state.originals[id].moved = true;
        addPatch(id);
      }
    }
  }
  const heightOf = (catalogId: string) => catalogItems.get(catalogId)!.size[1];

  function apply(edit: Edit): SkipReason | undefined {
    switch (edit.type) {
      case 'place':
        if (isTaken(edit.pieceId)) return 'duplicate-id';
        if (!catalogItems.has(edit.catalogId)) return 'unknown-catalog';
        state.pieces[edit.pieceId] = { catalogId: edit.catalogId, placement: edit.placement, partColors: {} };
        return;
      case 'move': {
        const piece = pieceAt(edit.targetId);
        if (piece) {
          carry(restingOn(edit.targetId), piece.placement, edit.placement);
          piece.placement = edit.placement;
          return;
        }
        const original = originalAt(edit.targetId);
        if (!original?.visible) return 'missing-target';
        if (isKept(edit.targetId)) return 'kept';
        carry(restingOn(edit.targetId), original.placement, edit.placement);
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
        const item = catalogItems.get(edit.catalogId);
        if (!piece) return 'missing-target';
        if (!item) return 'unknown-catalog';
        // Every color is on a Part of the old item, so keeping the new item's Parts keeps those in both.
        const parts = partIds(item.category);
        piece.partColors = Object.fromEntries(Object.entries(piece.partColors).filter(([partId]) => parts.includes(partId)));
        carry(restingOn(edit.pieceId), piece.placement, edit.placement, item.size[1] - heightOf(piece.catalogId));
        piece.catalogId = edit.catalogId;
        piece.placement = edit.placement;
        return;
      }
      case 'replace': {
        const original = originalAt(edit.originalId);
        if (!original?.visible) return 'missing-target';
        if (isKept(edit.originalId)) return 'kept';
        if (isTaken(edit.pieceId)) return 'duplicate-id';
        if (!catalogItems.has(edit.catalogId)) return 'unknown-catalog';
        const box = scanned.get(edit.originalId)!.box;
        carry(restingOn(edit.originalId), original.placement, edit.placement, heightOf(edit.catalogId) - box.size[1]);
        original.visible = false;
        addPatch(edit.originalId);
        state.pieces[edit.pieceId] = {
          catalogId: edit.catalogId, placement: edit.placement, partColors: {}, replacesOriginalId: edit.originalId,
        };
        return;
      }
      case 'recolor': {
        const piece = pieceAt(edit.targetId);
        // place, swap and replace only ever give a Piece a catalogId that is in the Catalog.
        if (piece) return putParts(piece.partColors, partIds(catalogItems.get(piece.catalogId)!.category), edit.partId, edit.color);
        const original = scanned.get(edit.targetId);
        if (!original || !state.originals[original.id].visible) return 'missing-target';
        // sameModel: every Original still in the room that is drawn from the same Master Copy, in one Edit.
        const targets = edit.sameModel && original.model
          ? setup.originals.filter(({ id, model }) => model === original.model && state.originals[id].visible)
          : [original];
        let reason: SkipReason | undefined;
        for (const target of targets) {
          const { partColors, partFinishes } = state.originals[target.id];
          reason = putParts(partColors, partsOf(target), edit.partId, edit.color);
          // A Part shows the look its last Edit gave it, so a color replaces a Finish. Reset color leaves the Finish.
          if (!reason && edit.color !== null) putParts(partFinishes, partsOf(target), edit.partId, null);
        }
        return reason;
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
            const { partColors, partFinishes } = state.originals[original.id];
            const reason = putParts(partFinishes, partsOf(original), target.partId, finish);
            // And a Finish replaces a color: { kind: 'none' } leaves the Part as scanned.
            if (!reason) putParts(partColors, partsOf(original), target.partId, null);
            return reason;
          }
          default:
            target satisfies never; // a new FinishTarget kind needs a case
            return;
        }
      }
      default:
        edit satisfies never; // a new Edit type needs a case
        return;
    }
  }

  for (const edit of edits) {
    const reason = apply(edit);
    if (reason) state.skipped.push({ editId: edit.id, reason });
  }
  return state;
}

/** Something rests on an item when its bottom is over the item's footprint, above its bottom by more than RESTS_ABOVE and its top by at most RESTS_WITHIN, in meters. */
const RESTS_ABOVE = 0.01;
const RESTS_WITHIN = 0.05;
/** A box whose bottom is higher than this, in meters, isn't on the floor. Room Setup's auto-box starts at 3 cm. */
const ABOVE_FLOOR = 0.1;
/** The categories that hang on walls, as in the Catalog (§8.1). */
const WALL_CATEGORIES: Category[] = ['wall_art', 'mirror'];

/**
 * Where an Original starts: at its Room Setup box. One whose box is off the floor hangs on its
 * nearest wall if its category goes on walls, or else stands on furniture.
 */
function startPlacement({ box: { position, rotationY }, category }: Original, walls: Wall[]): Placement {
  if (position[1] <= ABOVE_FLOOR) return { position, rotationY, mount: 'floor' };
  if (!WALL_CATEGORIES.includes(category)) return { position, rotationY, mount: 'surface' };
  const [x, , z] = position;
  // To the nearest point of the Wall itself, between its ends: in a room that isn't convex, two Walls can share a line.
  const distance = (wall: Wall) => {
    const { start: [sx, sz], end: [ex, ez] } = wall;
    const length = Math.hypot(ex - sx, ez - sz);
    const along = ((x - sx) * (ex - sx) + (z - sz) * (ez - sz)) / length;
    const [wx, wz] = wallPoint(wall, Math.min(Math.max(along, 0), length));
    return Math.hypot(x - wx, z - wz);
  };
  const [nearest] = walls.toSorted((a, b) => distance(a) - distance(b));
  return { position, rotationY, mount: 'wall', wallId: nearest?.id };
}

const partIds = (category: Category) => partsFor(category).map((part) => part.id);

/**
 * An Original's Parts: its category's, or null for one drawn from a Master Copy, whose Parts are the
 * file's top-level node names (ADR-0009). replay can't read the file, so it takes any Part id for it.
 */
const partsOf = (original: Original) => (original.model ? null : partIds(original.category));

/** Sets a key, or deletes it when the value is null. */
function put<V>(record: Record<string, V>, key: string, value: V | null) {
  if (value === null) delete record[key];
  else record[key] = value;
}

/**
 * Puts a value on one of the Parts, or on every Part when partId is '*'. With parts null, any Part id
 * goes, and '*' is kept as its own key, under every Part's own value: it replaces all of them.
 */
function putParts<V>(values: Record<string, V>, parts: string[] | null, partId: string, value: V | null): SkipReason | undefined {
  if (!parts) {
    if (partId === '*') for (const key of Object.keys(values)) delete values[key];
    put(values, partId, value);
    return;
  }
  if (partId !== '*' && !parts.includes(partId)) return 'unknown-part';
  for (const id of partId === '*' ? parts : [partId]) put(values, id, value);
}
