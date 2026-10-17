import type { Camera } from 'three';
import { newId } from '@shared/ids';
import type { CatalogItem, Edit, Placement, Vec2 } from '@shared/types';
import { checkFit, replay } from '../state/core';
import { useEditor } from '../state/store';
import { faces, insideFloor, keepInside, nearestWall, wallCoordinates } from './floorPlan';
import { facing, onWall, spiral, turned, viewCenterOnFloor } from './placement';

// The Mover's Piece Edits that aren't a drag. Each one goes through applyEdit.

/**
 * Adds a Catalog item as a new Piece where the view is centered, and selects it (spec §10.3): on
 * the floor point under the view center, or for a wall item, on the nearest wall in view. If that
 * spot breaks a Fit rule, it steps out in a 10 cm spiral to the nearest spot that doesn't.
 */
export function addPiece(item: CatalogItem, camera: Camera) {
  const { setup, catalog, design, applyEdit, select } = useEditor.getState();
  const eye: Vec2 = [camera.position.x, camera.position.z];
  const center = keepInside(viewCenterOnFloor(camera), setup!, 0.01);

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
    const [x, , z] = candidate.position;
    if (candidate.mount === 'floor' && !insideFloor([x, z], setup!.floor.polygon)) return false;
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
