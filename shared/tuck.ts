import { checkFit, type Item, roomItems, TOLERANCE } from './fit';
import { footprint, overlapLength, rectCorners } from './geometry';
import type { Catalog, Category, Placement, RoomSetup, RoomState, Vec2, Vec3 } from './types';

/** How far, in meters, each step of a push-in sweep goes. */
const STEP = 0.01;
/** How near first contact, in meters, the sweep's bisection gets. */
const PRECISION = 0.005;
/** How far short of a desk or table edge, in meters, a dragged chair is pulled in from. */
export const PULL_IN = 0.15;
/** What a dragged chair tucks in at. */
export const TUCK_TARGETS: Category[] = ['desk', 'table'];
/** How far, in meters, the wall snap may move a chair across an edge before the wall wins: floating point. */
const EPSILON = 1e-3;

/** A Placement moved `distance` meters along the unit vector [dx, dz]. */
export const moved = (placement: Placement, [dx, dz]: Vec2, distance: number): Placement => {
  const [x, y, z] = placement.position;
  return { ...placement, position: [x + dx * distance, y, z + dz * distance] };
};

/**
 * A push-in for one item in a room, which works out the room once, so a drag can call it on every
 * move: how far the item can slide from a placement along the unit vector `direction`, up to
 * `maxDistance`, before it meets any other item or a wall. Null when it can't go there at all.
 */
export function pusher(setup: RoomSetup, catalog: Catalog, state: RoomState, subjectId: string):
  (placement: Placement, direction: Vec2, maxDistance: number) => number | null {
  const items = roomItems(setup, catalog, state);
  const subject = items.find(({ id }) => id === subjectId);
  const isOriginal = Object.hasOwn(state.originals, subjectId);
  // Only what it can meet counts, not the floor an Opening needs clear.
  const room = { ...setup, openings: [] };
  return (placement, direction, maxDistance) => {
    // Only the items near its way in are checked, as a room of the rest: the sweep checks the Fit rules at every step.
    const way = [placement, moved(placement, direction, maxDistance)]
      .flatMap((at) => (subject ? rectCorners(footprint(at, [subject.rect.size[0], 0, subject.rect.size[1]])) : []));
    const near = (item: Item) => item !== subject && boundsMeet(way, item.corners);
    const nearby = new Set(items.filter(near).map(({ id }) => id));
    const pieces = Object.fromEntries(Object.entries(state.pieces).filter(([id]) => nearby.has(id) || id === subjectId));
    const catalogIds = new Set(Object.values(pieces).map(({ catalogId }) => catalogId));
    const nearCatalog = { ...catalog, items: catalog.items.filter(({ id }) => catalogIds.has(id)) };
    const originals = Object.fromEntries(Object.entries(state.originals).filter(([id]) => nearby.has(id) || id === subjectId));
    const clear = (distance: number) => {
      const at = moved(placement, direction, distance);
      const nearState: RoomState = isOriginal
        ? { ...state, pieces, originals: { ...originals, [subjectId]: { ...originals[subjectId], placement: at } } }
        : { ...state, originals, pieces: { ...pieces, [subjectId]: { ...pieces[subjectId], placement: at } } };
      return !checkFit(room, nearCatalog, nearState, [subjectId]).length;
    };
    if (!clear(0)) return null;
    // In steps until it meets something, then halving the step between the last clear spot and that one.
    let free = 0;
    while (free < maxDistance) {
      const next = Math.min(free + STEP, maxDistance);
      if (clear(next)) {
        free = next;
        continue;
      }
      let blocked = next;
      while (blocked - free > PRECISION) {
        const middle = (free + blocked) / 2;
        if (clear(middle)) free = middle;
        else blocked = middle;
      }
      // The Fit rules let things overlap by TOLERANCE, to stand flush: it stops where it touches.
      return Math.max(0, free - TOLERANCE);
    }
    return maxDistance;
  };
}

/** Whether the boxes around two sets of floor points meet. */
function boundsMeet(a: Vec2[], b: Vec2[]): boolean {
  const span = (points: Vec2[], axis: 0 | 1): [number, number] =>
    [Math.min(...points.map((point) => point[axis])), Math.max(...points.map((point) => point[axis]))];
  return overlapLength(span(a, 0), span(b, 0)) > 0 && overlapLength(span(a, 1), span(b, 1)) > 0;
}

/**
 * How far `subject` can slide along the unit vector `direction` from `placement`, up to `maxDistance`
 * meters, before it meets any other item, as the Fit rules see them, or a wall: to within 5 mm of
 * touching (spec §10.3). Where it can't move at all, or can't stand at `placement`, it stays there.
 */
export function pushIn(
  setup: RoomSetup, catalog: Catalog, state: RoomState, subjectId: string, placement: Placement, direction: Vec2, maxDistance: number,
): Placement {
  return moved(placement, direction, pusher(setup, catalog, state, subjectId)(placement, direction, maxDistance) ?? 0);
}

/** A side of a desk or table, as seen from above: its middle, the way out of it, its half length, and how deep the item is across it. */
export interface Edge { middle: Vec2; outward: Vec2; along: Vec2; halfLength: number; depth: number }

/** The four sides of an item's footprint. */
export function edgesOf({ rect: { center: [cx, cz], size: [width, depth], rotationY } }: Item): Edge[] {
  // Its own +X and +Z, turned as rectCorners turns them.
  const right: Vec2 = [Math.cos(rotationY), -Math.sin(rotationY)];
  const front: Vec2 = [Math.sin(rotationY), Math.cos(rotationY)];
  const side = ([ox, oz]: Vec2, half: number, halfLength: number, along: Vec2): Edge =>
    ({ middle: [cx + ox * half, cz + oz * half], outward: [ox, oz], along, halfLength, depth: 2 * half });
  const back: Vec2 = [-front[0], -front[1]];
  const left: Vec2 = [-right[0], -right[1]];
  return [
    side(front, depth / 2, width / 2, right), side(back, depth / 2, width / 2, right),
    side(right, width / 2, depth / 2, front), side(left, width / 2, depth / 2, front),
  ];
}

/**
 * Where a footprint is from an edge: its gap to the edge's line, negative once it crosses it; how far
 * it reaches out past the line; where it runs along the edge, from its middle; and how far it runs
 * alongside the edge.
 */
export function besideEdge({ middle: [mx, mz], outward: [ox, oz], along: [ax, az], halfLength }: Edge, corners: Vec2[]) {
  const out = corners.map(([x, z]) => (x - mx) * ox + (z - mz) * oz);
  const alongIt = corners.map(([x, z]) => (x - mx) * ax + (z - mz) * az);
  const [alongFrom, alongTo] = [Math.min(...alongIt), Math.max(...alongIt)];
  return {
    gap: Math.min(...out),
    reach: Math.max(...out),
    alongFrom,
    alongTo,
    alongside: overlapLength([alongFrom, alongTo], [-halfLength, halfLength]),
  };
}

/**
 * Snapping a dragged item at an edge, for one drag: a function from where the drag puts it, and how
 * it snaps at an edge (null where it can't), to where it goes; null when no edge near it takes it.
 * It tries the edges it runs alongside, within 15 cm of them or across them, into the item they are
 * the edge of, not past its far side: those it crosses first,
 * the shallowest first, so that it comes out of what it overlaps; then the nearest. Once at an edge,
 * it holds that edge while it stays near it, so pushing an item through another doesn't take it out
 * the far side.
 */
export function edgeHolder(edges: Edge[], size: Vec3): (placed: Placement, snapAt: (edge: Edge) => Placement | null) => Placement | null {
  let held: Edge | undefined;
  return (placed, snapAt) => {
    const corners = rectCorners(footprint(placed, size));
    const near = edges.flatMap((edge) => {
      const { gap, reach, alongside } = besideEdge(edge, corners);
      return alongside > TOLERANCE && gap <= PULL_IN && reach > -edge.depth ? [{ edge, gap }] : [];
    });
    if (!near.some(({ edge }) => edge === held)) held = undefined;
    const tries = near.sort((a, b) => (a.gap < 0 === b.gap < 0 ? Math.abs(a.gap) - Math.abs(b.gap) : a.gap - b.gap)).map(({ edge }) => edge);
    for (const edge of held ? [held, ...tries.filter((it) => it !== held)] : tries) {
      const snapped = snapAt(edge);
      if (snapped) {
        held = edge;
        return snapped;
      }
    }
    held = undefined;
    return null;
  };
}

/** Whether the wall snap moved an item toward or away from an edge, so that the wall wins over a snap to it. */
export const wallSnapped = ({ outward: [ox, oz] }: Edge, placed: Placement, unsnapped: Placement) =>
  Math.abs((placed.position[0] - unsnapped.position[0]) * ox + (placed.position[2] - unsnapped.position[2]) * oz) > EPSILON;

/**
 * An item slid straight in at an edge until it touches what is in its way, never past: from where it
 * is when that's outside the edge, else from just outside it. It slides to the edge's line first, and
 * on from there, so that where it stops doesn't depend on where it started. Null when even backing it
 * out to the edge is blocked, by a wall or another item.
 */
export function slideIn(push: ReturnType<typeof pusher>, edge: Edge, placement: Placement, size: Vec3): Placement | null {
  const { outward: [ox, oz], depth } = edge;
  const inward: Vec2 = [-ox, -oz];
  const { gap } = besideEdge(edge, rectCorners(footprint(placement, size)));
  if (gap > 0) {
    const toEdge = push(placement, inward, gap);
    if (toEdge === null || toEdge < gap) return toEdge === null ? null : moved(placement, inward, toEdge);
  }
  const start = moved(placement, [ox, oz], -gap);
  const distance = push(start, inward, depth);
  return distance === null ? null : moved(start, inward, distance);
}

/**
 * Tucking in, for a drag of one item (spec §10.3): a function from where the drag puts a chair, after
 * the wall snap and before it, to where it goes. Near a desk or table edge, within 15 cm of it or
 * across it, the chair slides straight in along the edge's inward normal until it touches the desk,
 * another item or a wall, and never past: the desk is solid. Where there's no room under that edge,
 * it stops at the edge. Its angle and its position along the edge never change. Walls win: where the
 * wall snap moved the chair toward or away from the edge, it stays there. Away from any desk or
 * table edge, it is where the drag put it: the same Placement. Undefined for anything but a chair:
 * seating, which includes ottomans and poufs.
 */
export function tuckSnap(setup: RoomSetup, catalog: Catalog, state: RoomState, subjectId: string):
  ((placed: Placement, unsnapped: Placement) => Placement) | undefined {
  const items = roomItems(setup, catalog, state);
  const subject = items.find(({ id }) => id === subjectId);
  if (subject?.category !== 'chair') return undefined;
  const size: Vec3 = [subject.rect.size[0], subject.heights[1] - subject.heights[0], subject.rect.size[1]];
  const snapAtEdge = edgeHolder(items
    .filter((item) => item !== subject && item.placement.mount === 'floor' && TUCK_TARGETS.includes(item.category))
    .flatMap(edgesOf), size);
  const push = pusher(setup, catalog, state, subjectId);
  return (placed, unsnapped) =>
    snapAtEdge(placed, (edge) => (wallSnapped(edge, placed, unsnapped) ? placed : slideIn(push, edge, placed, size))) ?? placed;
}
