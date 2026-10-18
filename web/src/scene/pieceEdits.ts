import type { Camera, Vector2 } from 'three';
import { newId } from '@shared/ids';
import type { CatalogItem, Edit, Placement, Vec2, Vec3 } from '@shared/types';
import { checkFit, replay } from '../state/core';
import { pieceItem, useEditor } from '../state/store';
import { faces, keepInside, nearestWall, wallCoordinates } from './floorPlan';
import { facing, floorPointInView, keepInRoom, onWall, spiral, turned } from './placement';

// The Mover's Piece Edits that aren't a drag. Each one goes through applyEdit.

/**
 * Adds a Catalog item as a new Piece and selects it (spec §10.3): on the floor point under the
 * view center, or under `at` (normalized device coordinates) when a card is dropped on the view;
 * a wall item goes on the nearest wall in view. If that spot breaks a Fit rule, it steps out in a
 * 10 cm spiral to the nearest spot that doesn't.
 */
export function addPiece(item: CatalogItem, camera: Camera, at?: Vector2) {
  const { setup, catalog, design, applyEdit, select } = useEditor.getState();
  const eye: Vec2 = [camera.position.x, camera.position.z];
  const center = keepInside(floorPointInView(camera, at), setup!, 0.01);

  let placeAt: (point: Vec2) => Placement;
  if (item.mount === 'wall') {
    const inView = setup!.walls.filter((wall) => faces(wall, eye));
    const { wall } = nearestWall(center, inView.length ? inView : setup!.walls);
    placeAt = (point) => onWall(wall, wallCoordinates(point, wall).along, 1.5, item.size);
  } else {
    const rotationY = facing(center, eye);
    // Inside the room, whole: a sofa dropped near a wall stops at it, even where no spot fits.
    placeAt = ([x, z]) => {
      const placement: Placement = { position: [x, 0, z], rotationY, mount: 'floor' };
      return keepInRoom(placement, item.size, setup!, { snap: false }) ?? placement;
    };
  }

  // Replay once with the new Piece in, then try each spot by moving just that Piece.
  const pieceId = newId('pc');
  let placement = placeAt(center);
  const place = { id: 'ed_trial', at: '', by: 'mover', type: 'place', pieceId, catalogId: item.id, placement } satisfies Edit;
  const trial = replay(setup!, catalog!, [...design!.edits, place]);
  const fits = (candidate: Placement) => {
    const pieces = { ...trial.pieces, [pieceId]: { ...trial.pieces[pieceId], placement: candidate } };
    return checkFit(setup!, catalog!, { ...trial, pieces }, [pieceId]).length === 0;
  };
  for (const point of spiral(center, 0.1, 2)) {
    const candidate = placeAt(point);
    if (fits(candidate)) {
      placement = candidate;
      break;
    }
  }
  applyEdit({ type: 'place', pieceId, catalogId: item.id, placement });
  select({ kind: 'piece', id: pieceId });
}

/**
 * A placement on the floor, or on something on it, turned by whole 15° steps. Walls are solid: an item
 * turned into a wall moves just enough to stay inside, without snapping back square. Undefined when
 * it can't fit turned that way at all, so it keeps its placement.
 */
function turnedPlacement(placement: Placement, size: Vec3, steps: number): Placement | undefined {
  const turnedBy = { ...placement, rotationY: turned(placement.rotationY, steps) };
  return keepInRoom(turnedBy, size, useEditor.getState().setup!, { snap: false }) ?? undefined;
}

/** Turns a Piece by whole 15° steps (R / Shift+R). Wall items stay square to their wall. */
export function rotatePiece(pieceId: string, steps: number) {
  const editor = useEditor.getState();
  const placement = editor.roomState!.pieces[pieceId]?.placement;
  const item = pieceItem(editor, pieceId);
  if (!placement || !item || placement.mount === 'wall') return;
  const turnedTo = turnedPlacement(placement, item.size, steps);
  if (turnedTo) editor.applyEdit({ type: 'move', targetId: pieceId, placement: turnedTo });
}

export const removePiece = (pieceId: string) => useEditor.getState().applyEdit({ type: 'remove', targetId: pieceId });

/**
 * The Original's state while the Mover can still change it: in the room, and not Kept (spec §11.1).
 * Replay would skip such an Edit, so the Mover's actions don't create it.
 */
function movableOriginal(originalId: string) {
  const { setup, roomState } = useEditor.getState();
  const state = roomState!.originals[originalId];
  return state?.visible && !setup!.originals.find(({ id }) => id === originalId)?.kept ? state : undefined;
}

/** Turns an Original by whole 15° steps, like rotatePiece. It leaves its spot, so its Patch shows. */
export function rotateOriginal(originalId: string, steps: number) {
  const placement = movableOriginal(originalId)?.placement;
  const original = useEditor.getState().setup!.originals.find(({ id }) => id === originalId);
  if (!placement || !original || placement.mount === 'wall') return;
  const turnedTo = turnedPlacement(placement, original.box.size, steps);
  if (turnedTo) useEditor.getState().applyEdit({ type: 'move', targetId: originalId, placement: turnedTo });
}

/** Remove Original (spec §11.1): hides it, and its Patch covers the spot. */
export function removeOriginal(originalId: string) {
  if (movableOriginal(originalId)) useEditor.getState().applyEdit({ type: 'remove', targetId: originalId });
}
