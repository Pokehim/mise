import { type ThreeEvent, useThree } from '@react-three/fiber';
import { useCallback } from 'react';
import { type Camera, type Intersection, type Object3D, type Ray, Raycaster, Vector2, Vector3 } from 'three';
import type { CatalogItem, Placement, RoomSetup, Vec2 } from '@shared/types';
import { pieceItem, useEditor } from '../state/store';
import { faces, wallCoordinates } from './floorPlan';
import { CLICK_TOLERANCE_PX, isDrawn } from './objects';
import { floorHit, keepInRoom, liesFlat, onWall } from './placement';
import type { SplitNodeData } from './splitScan';

/** How high a hit must be to count as a furniture top rather than the floor (spec §9.4 uses 3 cm too). */
const FLOOR_TOLERANCE = 0.03;

const facesUp = ({ face, object }: Intersection) =>
  !!face && face.normal.clone().transformDirection(object.matrixWorld).y > 0.8;

/** What a drag needs to know about what it moves: a Piece's Catalog item, or an Original's box. */
type Draggable = Pick<CatalogItem, 'category' | 'size' | 'mount'>;

/** Whether a hit is on the Original with this id: an Original being dragged mustn't rest on itself. */
const onOriginal = (id: string) => ({ object }: Intersection) => {
  for (let o: Object3D | null = object; o; o = o.parent) {
    const { kind, id: nodeId } = o.userData as Partial<SplitNodeData>;
    if (kind === 'original' && nodeId === id) return true;
  }
  return false;
};

/**
 * Where the pointer puts a floor item (spec §10.3): on the upward-facing surface under the pointer,
 * such as a desk top, with its base right at the pointer, so it can't hang off the edge; else on
 * the floor, keeping the grabbed point under the pointer. Either way walls are solid: its whole
 * footprint stays inside the room, so it stops flush at a wall while the pointer goes on, and slides
 * along it; and it snaps to a wall or into a corner near it, unless `snap` is off (Alt). Null where
 * the item can't go, or fit at all, so the drag keeps its last good placement.
 */
function onFloorOrSurface(
  raycaster: Raycaster, supports: Object3D[], skip: (hit: Intersection) => boolean,
  item: Draggable, start: Placement, offset: Vec2, setup: RoomSetup, snap: boolean,
): Placement | null {
  const hit = raycaster.intersectObjects(supports, true).find((it) => isDrawn(it) && !skip(it));
  if (hit && facesUp(hit) && hit.point.y > FLOOR_TOLERANCE && !liesFlat(item)) {
    return keepInRoom({ position: hit.point.toArray(), rotationY: start.rotationY, mount: 'surface' }, item.size, setup, { snap });
  }
  const pointer = floorHit(raycaster.ray);
  if (!pointer) return null;
  // Past a wall, the floor plane is somewhere the Mover can't see or mean: they are pointing at the
  // wall, so the item goes the nearest spot inside the room to it, against that wall.
  const [x, z] = [pointer[0] + offset[0], pointer[1] + offset[1]];
  return keepInRoom({ position: [x, 0, z], rotationY: start.rotationY, mount: 'floor' }, item.size, setup, { snap });
}

/** Where the pointer puts a wall item: centered on it, on the nearest wall in view under the pointer. */
function onWallUnder(ray: Ray, camera: Camera, item: Draggable, setup: RoomSetup): Placement | null {
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

type DragTarget = { kind: 'piece' | 'original'; id: string };

/**
 * What a drag moves: where it starts and what it is. An Original can't be dragged once it is
 * removed, and a Kept one never (spec §11.1).
 */
function dragged(editor: ReturnType<typeof useEditor.getState>, { kind, id }: DragTarget): { start: Placement; item: Draggable } | undefined {
  if (kind === 'piece') {
    const piece = editor.roomState!.pieces[id];
    const item = pieceItem(editor, id);
    return piece && item ? { start: piece.placement, item } : undefined;
  }
  const original = editor.setup!.originals.find((it) => it.id === id);
  const state = editor.roomState!.originals[id];
  if (!original || original.kept || !state?.visible) return undefined;
  const { category, box } = original;
  return { start: state.placement, item: { category, size: box.size, mount: state.placement.mount === 'wall' ? 'wall' : 'floor' } };
}

/**
 * The pointerdown handler of a Piece or an Original: selects it, then drags it. While dragging, the
 * store's preview holds where it is shown; when the drag ends, that becomes one move Edit (spec §10.3,
 * §11.1). Holding Alt (Option on a Mac) drags it freely: no snapping, though walls stay solid. A Kept
 * Original is only selected, and the drag orbits the camera as it does on empty space.
 */
function useDrag(target: DragTarget) {
  const get = useThree((s) => s.get);
  const { kind, id } = target;
  return useCallback((event: ThreeEvent<PointerEvent>) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    const editor = useEditor.getState();
    editor.select({ kind, id });
    const found = dragged(editor, { kind, id });
    if (!found) return;
    const { start, item } = found;
    const { setup } = editor;
    const { camera, gl, scene, controls, setEvents } = get();
    const raycaster = new Raycaster();
    const aim = ({ clientX, clientY }: PointerEvent) => {
      const { left, top, width, height } = gl.domElement.getBoundingClientRect();
      raycaster.setFromCamera(new Vector2(((clientX - left) / width) * 2 - 1, -((clientY - top) / height) * 2 + 1), camera);
    };

    // Keep the grabbed point under the pointer: the offset from it to the item's origin, at its base.
    aim(event.nativeEvent);
    const grabbed = floorHit(raycaster.ray, start.position[1]);
    const offset: Vec2 = grabbed ? [start.position[0] - grabbed[0], start.position[2] - grabbed[1]] : [0, 0];
    // What it can rest on: the Scan and the Pieces, but never itself.
    const supports = [
      scene.getObjectByName('scan'),
      ...(scene.getObjectByName('pieces')?.children ?? []).filter(({ name }) => name !== id),
    ].filter((object) => !!object);
    const skip = kind === 'original' ? onOriginal(id) : () => false;
    const [downX, downY] = [event.nativeEvent.clientX, event.nativeEvent.clientY];
    let dragging = false;

    // Until the pointer is released it moves the item: the camera holds still, and nothing else
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
        : onFloorOrSurface(raycaster, supports, skip, item, start, offset, setup!, !e.altKey);
      // The store's preview field is named for Pieces, but an Original's id fits it: ids are unique across both.
      if (placement) useEditor.getState().setPreview({ pieceId: id, placement });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      if (cameraControls) cameraControls.enabled = true;
      setEvents({ enabled: true });
      const { preview, applyEdit, setPreview } = useEditor.getState();
      if (preview && JSON.stringify(preview.placement) !== JSON.stringify(start)) {
        applyEdit({ type: 'move', targetId: id, placement: preview.placement });
      }
      setPreview(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }, [get, kind, id]);
}

export const useDragPiece = (pieceId: string) => useDrag({ kind: 'piece', id: pieceId });
export const useDragOriginal = (originalId: string) => useDrag({ kind: 'original', id: originalId });
