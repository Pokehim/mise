import { type ThreeEvent, useThree } from '@react-three/fiber';
import { useCallback } from 'react';
import { type Intersection, MathUtils, type Object3D, type Ray, Raycaster, Vector2, Vector3 } from 'three';
import { restsOnFloorOnly } from '@shared/fit';
import { wallPoint } from '@shared/geometry';
import { dragSnap } from '@shared/snap-together';
import type { CatalogItem, Placement, RoomSetup, Vec2, Wall } from '@shared/types';
import { pieceItem, useEditor } from '../state/store';
import { faces, nearestWall, wallCoordinates, wallLength } from './floorPlan';
import { CLICK_TOLERANCE_PX, isDrawn } from './objects';
import { floorHit, keepInRoom, liesFlat, onWall } from './placement';
import type { SplitNodeData } from './splitScan';

/** How high a hit must be to count as a furniture top rather than the floor (spec §9.4 uses 3 cm too). */
const FLOOR_TOLERANCE = 0.03;

const facesUp = ({ face, object }: Intersection) =>
  !!face && face.normal.clone().transformDirection(object.matrixWorld).y > 0.8;

/** What a drag needs to know about what it moves: a Piece's Catalog item, or an Original's box. */
type Draggable = Pick<CatalogItem, 'category' | 'size' | 'mount'>;

/** The snaps to other items (`dragSnap`): from where an item stands, wall-snapped and not, to where it goes. */
type Snap = (placed: Placement, unsnapped: Placement) => Placement;

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
 * the floor, keeping the grabbed point under the pointer: the pointer slides it over a level plane
 * `lift` above the floor, its height on the item, so the item moves just as far as the pointer.
 * A big item (`restsOnFloorOnly`) never rests on a surface: over a desk top it goes on the floor under the pointer, so a chair goes under the desk. Either way walls are solid: its whole
 * footprint stays inside the room, so it stops flush at a wall while the pointer goes on, and slides
 * along it; and it snaps to a wall or into a corner near it, unless `snap` is off (Alt). On the
 * floor, it then snaps to the furniture near it (`snaps`): a chair tucks in at a desk, a table
 * pushes flush against another; unless `snap` is off. Null where
 * the item can't go, or fit at all, so the drag keeps its last good placement.
 */
function onFloorOrSurface(
  raycaster: Raycaster, supports: Object3D[], skip: (hit: Intersection) => boolean,
  item: Draggable, start: Placement, lift: number, offset: Vec2, setup: RoomSetup, snap: boolean, snaps?: Snap,
): Placement | null {
  const hit = raycaster.intersectObjects(supports, true).find((it) => isDrawn(it) && !skip(it));
  if (hit && facesUp(hit) && hit.point.y > FLOOR_TOLERANCE && !liesFlat(item) && !restsOnFloorOnly(item.category)) {
    return keepInRoom({ position: hit.point.toArray(), rotationY: start.rotationY, mount: 'surface' }, item.size, setup, { snap });
  }
  const pointer = floorHit(raycaster.ray, lift);
  if (!pointer) return null;
  // Past a wall, the floor plane is somewhere the Mover can't see or mean: they are pointing at the
  // wall, so the item goes the nearest spot inside the room to it, against that wall.
  const [x, z] = [pointer[0] + offset[0], pointer[1] + offset[1]];
  const free: Placement = { position: [x, 0, z], rotationY: start.rotationY, mount: 'floor' };
  const placed = keepInRoom(free, item.size, setup, { snap });
  if (!placed || !snap || !snaps) return placed;
  // Walls win, so the snaps need to know where the wall snap moved it.
  return snaps(placed, keepInRoom(free, item.size, setup, { snap: false }) ?? placed);
}

/**
 * Where a ray meets a wall's plane, in the wall's terms: how far along it, how high, and how far
 * away; and its slant, the sine of the angle it meets the plane at (a ray's direction is a unit vector).
 */
function wallHit(ray: Ray, wall: Wall) {
  const [nx, nz] = wall.normal;
  const toward = ray.direction.x * nx + ray.direction.z * nz;
  // Only from in front of the wall, as the Dollhouse view shows it.
  if (toward >= 0) return null;
  const distance = -((ray.origin.x - wall.start[0]) * nx + (ray.origin.z - wall.start[1]) * nz) / toward;
  const hit = ray.at(distance, new Vector3());
  return { along: wallCoordinates([hit.x, hit.z], wall).along, y: hit.y, distance, slant: -toward };
}

/** Below this slant, a ray barely meets a wall: where it meets is too unsteady to follow, so the item holds still. */
const MIN_SLANT = Math.sin(MathUtils.degToRad(3));
/**
 * How much farther than the pointer a wall item may move: at most this many times as far as a point
 * under the pointer, square on to the view, would. Keeping the grabbed point under the pointer needs
 * more only where the view meets the wall over 70° from square on, so foreshortened that it would
 * fling the item along the wall; there the item lags behind the pointer instead.
 */
const MAX_STRETCH = 3;
/** How far in from a wall's ends, in meters, the pointer must be to take a wall item onto that wall. */
const CLEARLY_OVER = 0.15;

/**
 * A wall item's drag (spec §10.3), from the pointer's ray at pointerdown: a function from each later
 * ray to where the item goes. It keeps the grabbed point under the pointer, as a floor item does, by
 * sliding the item over its own wall's plane, kept whole on the wall by `onWall`. It moves to another
 * wall only when the pointer is clearly over that wall and the item fits there, and never faster than
 * the pointer: where the view grazes the wall, it lags behind, or holds still.
 */
export function wallDrag(grab: Ray, start: Placement, item: Draggable, setup: RoomSetup): (ray: Ray) => Placement {
  const [width, height] = item.size;
  let wall = setup.walls.find(({ id }) => id === start.wallId)
    ?? nearestWall([start.position[0], start.position[2]], setup.walls).wall;
  const center = { along: wallCoordinates([start.position[0], start.position[2]], wall).along, y: start.position[1] + height / 2 };
  const grabbed = wallHit(grab, wall);
  // From the grabbed point to the item's center, in the wall's terms.
  const offset = grabbed ? { along: center.along - grabbed.along, y: center.y - grabbed.y } : { along: 0, y: 0 };
  // Where the item is shown, its center on `wall` (unknown just after it changes wall), and the pointer's last ray.
  let shown = start;
  let placed: { along: number; y: number } | null = center;
  let direction = grab.direction.clone();
  return (ray) => {
    // The wall the pointer is over, if any: the nearest one in view that the ray meets within it.
    const eye: Vec2 = [ray.origin.x, ray.origin.z];
    const over = setup.walls
      .filter((it) => faces(it, eye))
      .map((it) => ({ wall: it, hit: wallHit(ray, it) }))
      .filter(({ wall: it, hit }) => hit && hit.along >= 0 && hit.along <= wallLength(it) && hit.y >= 0 && hit.y <= it.height)
      .sort((a, b) => a.hit!.distance - b.hit!.distance)[0];
    const turn = direction.angleTo(ray.direction);
    direction = ray.direction.clone();
    // Onto another wall only when the pointer is clearly over it, not just past a corner; and never
    // onto one the item doesn't fit on, so a big Original stays on its own.
    const clearly = !!over && over.hit!.along >= CLEARLY_OVER && over.hit!.along <= wallLength(over.wall) - CLEARLY_OVER;
    if (clearly && over.wall !== wall && wallLength(over.wall) >= width && over.wall.height >= height) {
      wall = over.wall;
      placed = null;
    }
    // Where the pointer is, in the wall's terms: on the wall's plane while it is over the wall, or over
    // nothing; else the spot it is over, on another wall or the floor, straight out from the wall. The
    // plane there would be past the wall, or under the floor, and pull the item the wrong way.
    const floor = over ? null : floorHit(ray);
    let pointer: { along: number; y: number };
    if (over?.wall === wall || (!over && !floor)) {
      const hit = wallHit(ray, wall);
      if (!hit || hit.slant < MIN_SLANT) return shown;
      pointer = hit;
    } else {
      const { x, z } = over ? ray.at(over.hit!.distance, new Vector3()) : { x: floor![0], z: floor![1] };
      pointer = { along: wallCoordinates([x, z], wall).along, y: over ? over.hit!.y : 0 };
    }
    let [along, y] = [pointer.along + offset.along, pointer.y + offset.y];
    if (placed) {
      // No faster than the pointer: the grabbed point moves at most MAX_STRETCH times as far as the
      // pointer's turn moves a point square on to the view, as far away as it is.
      const [x, z] = wallPoint(wall, placed.along - offset.along);
      const reach = MAX_STRETCH * turn * ray.origin.distanceTo(new Vector3(x, placed.y - offset.y, z));
      const step = Math.hypot(along - placed.along, y - placed.y);
      if (step > reach) [along, y] = [placed.along + ((along - placed.along) * reach) / step, placed.y + ((y - placed.y) * reach) / step];
    }
    shown = onWall(wall, along, y, item.size);
    placed = { along: wallCoordinates([shown.position[0], shown.position[2]], wall).along, y: shown.position[1] + height / 2 };
    return shown;
  };
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

/** What a press on a Piece or an Original is for (spec §10.3). */
export type PressIntent = 'select' | 'move-item' | 'view';

/**
 * What a press on a Piece or an Original is for (spec §10.3). Only the selected one moves, if it
 * can: a press on it with the main button is `move-item`. Any other press with the main button is
 * `select`: a click selects the item, and a drag moves the view. Shift never moves an item, since
 * Shift+drag turns the view. Other buttons are `view`: the view alone has the press.
 */
export function pressIntent({ selected, movable, shiftKey, button }: {
  selected: boolean; movable: boolean; shiftKey: boolean; button: number;
}): PressIntent {
  if (button !== 0) return 'view';
  return selected && movable && !shiftKey ? 'move-item' : 'select';
}

/**
 * The pointerdown handler of a Piece or an Original. A click selects it (the node's click handler);
 * a drag moves only the selected one (pressIntent). A drag that starts on any other item, a Kept
 * Original, or with Shift held moves the view, as it does on empty space, and selects nothing, so
 * the Mover can't move furniture by accident.
 *
 * While the selected item is dragged, the camera holds still and the grabbed point stays under the
 * pointer; the store's preview holds where it is shown, and when the drag ends, that becomes one
 * move Edit (spec §10.3, §11.1). Near other furniture it snaps against it, and a chair near a desk
 * or table edge tucks in under it (`dragSnap`). Holding Alt (Option on a Mac) drags it freely: no
 * snapping or tucking, though walls stay solid. A wall item slides over its own wall (`wallDrag`). A Kept Original never moves
 * (spec §11.1).
 */
function useDrag(target: DragTarget) {
  const get = useThree((s) => s.get);
  const { kind, id } = target;
  return useCallback((event: ThreeEvent<PointerEvent>) => {
    const editor = useEditor.getState();
    const found = dragged(editor, { kind, id });
    const { selection } = editor;
    const intent = pressIntent({
      selected: selection?.kind === kind && selection.id === id,
      movable: !!found,
      shiftKey: event.shiftKey,
      button: event.button,
    });
    if (intent === 'view') return;
    // Not on to the Scan behind it.
    event.stopPropagation();
    // The view has this press: a click selects the item, and a drag moves the view.
    if (intent === 'select' || !found) return;
    const { start, item } = found;
    const { setup } = editor;
    const { camera, gl, scene, controls, setEvents, events } = get();
    const element = (events.connected as HTMLElement | undefined) ?? gl.domElement;
    const raycaster = new Raycaster();
    const aim = ({ clientX, clientY }: PointerEvent) => {
      const { left, top, width, height } = gl.domElement.getBoundingClientRect();
      raycaster.setFromCamera(new Vector2(((clientX - left) / width) * 2 - 1, -((clientY - top) / height) * 2 + 1), camera);
    };

    // Keep the grabbed point under the pointer: how high it is above the item's base, and the offset
    // from it to the item's origin. A level plane at the floor would move the item more than the
    // pointer, as the grabbed point is nearer the eye. The plane stays well below the eye, where a
    // level plane is steady enough to follow, as in the Walk view.
    aim(event.nativeEvent);
    const lift = MathUtils.clamp(Math.min(event.point.y, camera.position.y / 2) - start.position[1], 0, item.size[1]);
    const grabbed = floorHit(raycaster.ray, start.position[1] + lift);
    const offset: Vec2 = grabbed ? [start.position[0] - grabbed[0], start.position[2] - grabbed[1]] : [0, 0];
    // What it can rest on: the Scan and the Pieces, but never itself.
    const supports = [
      scene.getObjectByName('scan'),
      ...(scene.getObjectByName('pieces')?.children ?? []).filter(({ name }) => name !== id),
    ].filter((object) => !!object);
    const skip = kind === 'original' ? onOriginal(id) : () => false;
    const onWallDragged = item.mount === 'wall' ? wallDrag(raycaster.ray.clone(), start, item, setup!) : null;
    const snaps = onWallDragged ? undefined : dragSnap(setup!, editor.catalog!, editor.roomState!, id);
    const [downX, downY] = [event.nativeEvent.clientX, event.nativeEvent.clientY];
    // The item cursor the node set on hover, back once the item is let go.
    const cursor = element.dataset.item;
    let dragging = false;

    // Until the pointer is released it moves the item: the camera holds still, and nothing else
    // in the scene listens to it.
    const cameraControls = controls as { enabled: boolean } | null;
    if (cameraControls) cameraControls.enabled = false;
    setEvents({ enabled: false });

    const onMove = (e: PointerEvent) => {
      if (!dragging && Math.hypot(e.clientX - downX, e.clientY - downY) <= CLICK_TOLERANCE_PX) return;
      dragging = true;
      element.dataset.item = 'moving';
      aim(e);
      const placement = onWallDragged
        ? onWallDragged(raycaster.ray)
        : onFloorOrSurface(raycaster, supports, skip, item, start, lift, offset, setup!, !e.altKey, snaps);
      // The store's preview field is named for Pieces, but an Original's id fits it: ids are unique across both.
      if (placement) useEditor.getState().setPreview({ pieceId: id, placement });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      if (cameraControls) cameraControls.enabled = true;
      setEvents({ enabled: true });
      if (cursor) element.dataset.item = cursor;
      else delete element.dataset.item;
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
