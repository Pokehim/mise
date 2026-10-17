import { type ThreeEvent, useThree } from '@react-three/fiber';
import { useCallback } from 'react';
import { type Camera, type Object3D, Plane, type Ray, Raycaster, Vector2, Vector3 } from 'three';
import type { CatalogItem, Placement, RoomSetup, Vec2 } from '@shared/types';
import { useEditor } from '../state/store';
import { faces, keepInside, wallCoordinates } from './floorPlan';
import { isShown } from './objects';
import { floorHit, onWall, snapToWall } from './placement';

const DRAG_THRESHOLD_PX = 3;

/**
 * Where the pointer puts a floor item: on the first upward-facing surface under it (normal.y > 0.8,
 * such as a desk top), else on the floor inside the room. Snaps to a wall it is backed up against.
 */
function onFloorOrSurface(
  raycaster: Raycaster, targets: Object3D[], item: CatalogItem, start: Placement, offset: Vec2, setup: RoomSetup,
): Placement | null {
  const hit = raycaster.intersectObjects(targets, true).find((h) => isShown(h.object));
  const upward = hit?.face && hit.face.normal.clone().transformDirection(hit.object.matrixWorld).y > 0.8;
  const onSurface = hit && upward && hit.point.y > 0.03 && item.category !== 'rug';
  const pointer = onSurface ? ([hit.point.x, hit.point.z] as Vec2) : floorHit(raycaster.ray);
  if (!pointer) return null;
  let [x, z]: Vec2 = [pointer[0] + offset[0], pointer[1] + offset[1]];
  if (!onSurface) [x, z] = keepInside([x, z], setup, 0.001);
  const placement: Placement = {
    position: [x, onSurface ? hit.point.y : 0, z], rotationY: start.rotationY, mount: onSurface ? 'surface' : 'floor',
  };
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
    const { setup, catalog, roomState } = editor;
    const start = roomState!.pieces[pieceId].placement;
    const item = catalog!.items.find(({ id }) => id === roomState!.pieces[pieceId].catalogId)!;
    const { camera, gl, scene, controls } = get();
    const raycaster = new Raycaster();
    const aim = ({ clientX, clientY }: PointerEvent) => {
      const { left, top, width, height } = gl.domElement.getBoundingClientRect();
      raycaster.setFromCamera(new Vector2(((clientX - left) / width) * 2 - 1, -((clientY - top) / height) * 2 + 1), camera);
    };

    // Keep the grabbed point under the pointer: the offset from it to the Piece's origin, at the Piece's base.
    aim(event.nativeEvent);
    const grabbed = raycaster.ray.intersectPlane(new Plane(new Vector3(0, 1, 0), -start.position[1]), new Vector3());
    const offset: Vec2 = grabbed ? [start.position[0] - grabbed.x, start.position[2] - grabbed.z] : [0, 0];
    const targets = [scene.getObjectByName('scan'), ...(scene.getObjectByName('pieces')?.children ?? [])]
      .filter((object): object is Object3D => !!object && object.name !== pieceId);
    const [downX, downY] = [event.nativeEvent.clientX, event.nativeEvent.clientY];
    let dragging = false;

    // The pointer now moves the Piece, not the camera. Walk view checks the preview instead.
    const cameraControls = controls as { enabled: boolean } | null;
    if (cameraControls) cameraControls.enabled = false;
    editor.setPreview({ pieceId, placement: start });

    const onMove = (e: PointerEvent) => {
      if (!dragging && Math.hypot(e.clientX - downX, e.clientY - downY) < DRAG_THRESHOLD_PX) return;
      dragging = true;
      aim(e);
      const placement = item.mount === 'wall'
        ? onWallUnder(raycaster.ray, camera, item, setup!)
        : onFloorOrSurface(raycaster, targets, item, start, offset, setup!);
      if (placement) useEditor.getState().setPreview({ pieceId, placement });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      if (cameraControls) cameraControls.enabled = true;
      const { preview, applyEdit, setPreview } = useEditor.getState();
      if (dragging && preview && JSON.stringify(preview.placement) !== JSON.stringify(start)) {
        applyEdit({ type: 'move', targetId: pieceId, placement: preview.placement });
      }
      setPreview(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }, [get, pieceId]);
}
