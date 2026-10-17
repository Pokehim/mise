import { type ThreeEvent, useThree } from '@react-three/fiber';
import { useCallback } from 'react';
import { type Camera, type Intersection, type Object3D, type Ray, Raycaster, Vector2, Vector3 } from 'three';
import type { CatalogItem, Placement, RoomSetup, Vec2 } from '@shared/types';
import { pieceItem, useEditor } from '../state/store';
import { faces, keepInside, wallCoordinates } from './floorPlan';
import { CLICK_TOLERANCE_PX, isDrawn } from './objects';
import { floorHit, liesFlat, onWall, snapToWall } from './placement';

/** How high a hit must be to count as a furniture top rather than the floor (spec §9.4 uses 3 cm too). */
const FLOOR_TOLERANCE = 0.03;

const facesUp = ({ face, object }: Intersection) =>
  !!face && face.normal.clone().transformDirection(object.matrixWorld).y > 0.8;

/**
 * Where the pointer puts a floor item (spec §10.3): on the upward-facing surface under the pointer,
 * such as a desk top, with its base right at the pointer, so it can't hang off the edge; else on
 * the floor, keeping the grabbed point under the pointer and the Piece inside the room. Either
 * way it snaps to a wall it is backed up against.
 */
function onFloorOrSurface(
  raycaster: Raycaster, surfaces: Object3D[], item: CatalogItem, start: Placement, offset: Vec2, setup: RoomSetup,
): Placement | null {
  const hit = raycaster.intersectObjects(surfaces, true).find(isDrawn);
  let placement: Placement;
  if (hit && facesUp(hit) && hit.point.y > FLOOR_TOLERANCE && !liesFlat(item)) {
    placement = { position: hit.point.toArray(), rotationY: start.rotationY, mount: 'surface' };
  } else {
    const pointer = floorHit(raycaster.ray);
    if (!pointer) return null;
    const [x, z] = keepInside([pointer[0] + offset[0], pointer[1] + offset[1]], setup, 0.001);
    placement = { position: [x, 0, z], rotationY: start.rotationY, mount: 'floor' };
  }
  return snapToWall(placement, item.size[2], setup.walls) ?? placement;
}

/** Where the pointer puts a wall item: centered on it, on the nearest wall in view under the pointer. */
function onWallUnder(ray: Ray, camera: Camera, item: CatalogItem, setup: RoomSetup): Placement | null {
  const eye: Vec2 = [camera.position.x, camera.position.z];
  let best: { placement: Placement; distance: number } | null = null;
  for (const wall of setup.walls) {
    const [nx, nz] = wall.normal;
    const toward = ray.direction.x * nx + ray.direction.z * nz;
    if (!faces(wall, eye) || toward >= 0) continue;
    const distance = -((ray.origin.x - wall.start[0]) * nx + (ray.origin.z - wall.start[1]) * nz) / toward;
    const hit = ray.at(distance, new Vector3());
    const { along, length } = wallCoordinates([hit.x, hit.z], wall);
    if (along < 0 || along > length || hit.y < 0 || hit.y > wall.height) continue;
    if (!best || distance < best.distance) best = { placement: onWall(wall, along, hit.y, item.size), distance };
  }
  return best?.placement ?? null;
}

/**
 * The pointerdown handler of a Piece: selects it, then drags it. While dragging, the store's
 * preview holds where it is shown; when the drag ends, that becomes one move Edit (spec §10.3).
 */
export function useDragPiece(pieceId: string) {
  const get = useThree((s) => s.get);
  return useCallback((event: ThreeEvent<PointerEvent>) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    const editor = useEditor.getState();
    editor.select({ kind: 'piece', id: pieceId });
    const { setup, roomState } = editor;
    const start = roomState!.pieces[pieceId].placement;
    const item = pieceItem(editor, pieceId)!;
    const { camera, gl, scene, controls, setEvents } = get();
    const raycaster = new Raycaster();
    const aim = ({ clientX, clientY }: PointerEvent) => {
      const { left, top, width, height } = gl.domElement.getBoundingClientRect();
      raycaster.setFromCamera(new Vector2(((clientX - left) / width) * 2 - 1, -((clientY - top) / height) * 2 + 1), camera);
    };

    // Keep the grabbed point under the pointer: the offset from it to the Piece's origin, at the Piece's base.
    aim(event.nativeEvent);
    const grabbed = floorHit(raycaster.ray, start.position[1]);
    const offset: Vec2 = grabbed ? [start.position[0] - grabbed[0], start.position[2] - grabbed[1]] : [0, 0];
    // What the Piece can rest on: the Scan and the other Pieces, except flat ones like rugs.
    const surfaces = [
      scene.getObjectByName('scan'),
      ...(scene.getObjectByName('pieces')?.children ?? []).filter(({ name }) => {
        const other = pieceItem(editor, name);
        return name !== pieceId && other && !liesFlat(other);
      }),
    ].filter((object) => !!object);
    const [downX, downY] = [event.nativeEvent.clientX, event.nativeEvent.clientY];
    let dragging = false;

    // Until the pointer is released it moves the Piece: the camera holds still, and nothing else
    // in the scene listens to it.
    const cameraControls = controls as { enabled: boolean } | null;
    if (cameraControls) cameraControls.enabled = false;
    setEvents({ enabled: false });

    const onMove = (e: PointerEvent) => {
      if (!dragging && Math.hypot(e.clientX - downX, e.clientY - downY) <= CLICK_TOLERANCE_PX) return;
      dragging = true;
      aim(e);
      const placement = item.mount === 'wall'
        ? onWallUnder(raycaster.ray, camera, item, setup!)
        : onFloorOrSurface(raycaster, surfaces, item, start, offset, setup!);
      if (placement) useEditor.getState().setPreview({ pieceId, placement });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      if (cameraControls) cameraControls.enabled = true;
      setEvents({ enabled: true });
      const { preview, applyEdit, setPreview } = useEditor.getState();
      if (preview && JSON.stringify(preview.placement) !== JSON.stringify(start)) {
        applyEdit({ type: 'move', targetId: pieceId, placement: preview.placement });
      }
      setPreview(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }, [get, pieceId]);
}
