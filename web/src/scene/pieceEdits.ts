import type { Camera, Vector2 } from 'three';
import { newId } from '@shared/ids';
import type { CatalogItem, Edit, Placement, Vec2 } from '@shared/types';
import { checkFit, replay } from '../state/core';
import { useEditor } from '../state/store';
import { faces, keepInside, nearestWall, wallCoordinates } from './floorPlan';
import { facing, floorPointInView, onWall, spiral, turned } from './placement';

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
    placeAt = ([x, z]) => ({ position: [x, 0, z], rotationY, mount: 'floor' });
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

/** Turns a Piece by whole 15° steps (R / Shift+R). Wall items stay square to their wall. */
export function rotatePiece(pieceId: string, steps: number) {
  const { roomState, applyEdit } = useEditor.getState();
  const placement = roomState!.pieces[pieceId]?.placement;
  if (!placement || placement.mount === 'wall') return;
  applyEdit({ type: 'move', targetId: pieceId, placement: { ...placement, rotationY: turned(placement.rotationY, steps) } });
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
  if (!placement || placement.mount === 'wall') return;
  useEditor.getState().applyEdit({ type: 'move', targetId: originalId, placement: { ...placement, rotationY: turned(placement.rotationY, steps) } });
}

/** Remove Original (spec §11.1): hides it, and its Patch covers the spot. */
export function removeOriginal(originalId: string) {
  if (movableOriginal(originalId)) useEditor.getState().applyEdit({ type: 'remove', targetId: originalId });
}
