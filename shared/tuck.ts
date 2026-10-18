import { type Item, itemsMeet, roomItems, TOLERANCE } from './fit';
import { footprint, overlapLength, rectCorners, rectInPolygon } from './geometry';
import type { Catalog, Category, Placement, RoomSetup, RoomState, Vec2, Vec3 } from './types';

/** How far, in meters, each step of a push-in sweep goes. */
const STEP = 0.01;
/** How near first contact, in meters, the sweep's bisection gets: finer than the 5 mm asked for, so that where a dragged item touches doesn't flicker as the pointer moves. */
const PRECISION = 0.0005;
/** How far, in meters, each step backs a dragged item out of something the pointer pushed it into, before halving back. */
const BACK_OUT = 0.05;
/** How near another item's side, in meters, a dragged item comes before the snaps look at that side. */
export const NEAR = 0.2;
/** How near first contact, in meters, a dragged item must come before it snaps the rest of the way: a short, quiet step. */
export const CAPTURE = 0.06;
/** How far back from contact, in meters, the pointer must pull a snapped item to let it go: it holds firm till then. */
export const RELEASE = 0.2;
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
 * `maxDistance`, before it meets any other item or a wall, as the Fit rules see them: overlap
 * (`itemsMeet`) and outside-floor. Null when it can't go there at all.
 */
export function pusher(setup: RoomSetup, catalog: Catalog, state: RoomState, subjectId: string):
  (placement: Placement, direction: Vec2, maxDistance: number) => number | null {
  const others = roomItems(setup, catalog, state).filter(({ id }) => id !== subjectId).map((item) => ({ item, bounds: boundsOf(item.corners) }));
  // The subject alone, worked out once for each way it is turned, and moved from there.
  const isOriginal = Object.hasOwn(state.originals, subjectId);
  const piece = isOriginal ? undefined : state.pieces[subjectId];
  const alone = { ...catalog, items: catalog.items.filter(({ id }) => id === piece?.catalogId) };
  const turned = new Map<number, Item | undefined>();
  const subjectAt = (placement: Placement): Item | undefined => {
    if (!turned.has(placement.rotationY)) {
      turned.set(placement.rotationY, roomItems(setup, alone, isOriginal
        ? { ...state, pieces: {}, originals: { [subjectId]: { ...state.originals[subjectId], placement } } }
        : { ...state, originals: {}, pieces: { [subjectId]: { ...piece!, placement } } })[0]);
    }
    const base = turned.get(placement.rotationY);
    if (!base) return undefined;
    const [dx, dz] = [placement.position[0] - base.placement.position[0], placement.position[2] - base.placement.position[2]];
    const distance = Math.hypot(dx, dz);
    const at = distance ? shifted(base, [dx / distance, dz / distance], distance) : base;
    return { ...at, placement };
  };
  return (placement, direction, maxDistance) => {
    const subject = subjectAt(placement);
    if (!subject) return null;
    // Only the items near its way in can stop it.
    const way = boundsOf([...subject.corners, ...shifted(subject, direction, maxDistance).corners]);
    const nearby = others.filter(({ bounds }) => boundsMeet(way, bounds)).map(({ item }) => item);
    const clear = (distance: number) => {
      const at = shifted(subject, direction, distance);
      return (at.placement.mount !== 'floor' || rectInPolygon(at.rect, setup.floor.polygon, TOLERANCE))
        && !nearby.some((other) => itemsMeet(at, other));
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

/** A room item moved `distance` meters along the unit vector [dx, dz], its footprint and boxes with it. */
function shifted(item: Item, [dx, dz]: Vec2, distance: number): Item {
  const [ox, oz] = [dx * distance, dz * distance];
  const by = ([x, z]: Vec2): Vec2 => [x + ox, z + oz];
  return {
    ...item,
    placement: moved(item.placement, [dx, dz], distance),
    rect: { ...item.rect, center: by(item.rect.center) },
    corners: item.corners.map(by),
    boxes: item.boxes.map((box) => ({ ...box, center: by(box.center) })),
  };
}

/** The box around some floor points: its [minX, minZ, maxX, maxZ]. */
function boundsOf(points: Vec2[]): [number, number, number, number] {
  let [minX, minZ, maxX, maxZ] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, z] of points) [minX, minZ, maxX, maxZ] = [Math.min(minX, x), Math.min(minZ, z), Math.max(maxX, x), Math.max(maxZ, z)];
  return [minX, minZ, maxX, maxZ];
}

/** Whether two such boxes meet. */
const boundsMeet = (a: number[], b: number[]) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

/**
 * How far `subject` can slide along the unit vector `direction` from `placement`, up to `maxDistance`
 * meters, before it meets any other item, as the Fit rules see them, or a wall: to within 0.5 mm of
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
 * It tries the edges it runs alongside, within NEAR of them or across them, with part of it still
 * outside: those it crosses first,
 * the shallowest first, so that it comes out of what it overlaps; then the nearest. Once at an edge,
 * it holds that edge while it stays near it, even once all of it is across, up to the item's far side,
 * so pushing an item through another doesn't take it out the far side.
 */
export function edgeHolder(edges: Edge[], size: Vec3):
  (placed: Placement, snapAt: (edge: Edge, backOut: boolean) => Placement | null) => Placement | null {
  let held: Edge | undefined;
  return (placed, snapAt) => {
    const corners = rectCorners(footprint(placed, size));
    const near = edges.flatMap((edge) => {
      const { gap, reach, alongside } = besideEdge(edge, corners);
      return alongside > TOLERANCE && gap <= NEAR && reach > (edge === held ? -edge.depth : 0) ? [{ edge, gap }] : [];
    });
    if (!near.some(({ edge }) => edge === held)) held = undefined;
    const tries = near.sort((a, b) => (a.gap < 0 === b.gap < 0 ? Math.abs(a.gap) - Math.abs(b.gap) : a.gap - b.gap)).map(({ edge }) => edge);
    // Where the drag put it; then, where nothing takes it from there, backed out of what it was pushed
    // into at the first edge only, as backing out at every edge would cost more than a move may take.
    const order = held ? [held, ...tries.filter((it) => it !== held)] : tries;
    for (const [edge, backOut] of [...order.map((it) => [it, false] as const), ...order.slice(0, 1).map((it) => [it, true] as const)]) {
      const snapped = snapAt(edge, backOut);
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
 * is when that's outside the edge, else from just outside it; with `backOut`, backed out further
 * where something is already there, such as a neighbor the drag pushed it into. It slides to the
 * edge's line first, and on from there, so that where it stops doesn't depend on where it started.
 * Null when it can't stand there, or backing it out doesn't clear it within its size and NEAR.
 */
export function slideIn(push: ReturnType<typeof pusher>, edge: Edge, placement: Placement, size: Vec3, backOut = false): Placement | null {
  const { outward: [ox, oz], depth } = edge;
  const inward: Vec2 = [-ox, -oz];
  const { gap } = besideEdge(edge, rectCorners(footprint(placement, size)));
  const outside = gap >= 0 ? placement : moved(placement, [ox, oz], -gap);
  const clear = (distance: number) => push(moved(outside, [ox, oz], distance), inward, 0) !== null;
  let backedOut = 0;
  if (!clear(0)) {
    if (!backOut) return null;
    // Out in BACK_OUT steps to the first clear spot, then halving back to within STEP of where it clears.
    const most = Math.max(size[0], size[2]) + NEAR;
    let blocked = 0;
    for (backedOut = BACK_OUT; !clear(backedOut); backedOut += BACK_OUT) {
      blocked = backedOut;
      if (backedOut > most) return null;
    }
    while (backedOut - blocked > STEP) {
      const middle = (blocked + backedOut) / 2;
      if (clear(middle)) backedOut = middle;
      else blocked = middle;
    }
  }
  // Clear is within the Fit rules' TOLERANCE of it: backed out, it stands just touching, where there's room.
  if (backedOut > 0 && clear(backedOut + TOLERANCE)) backedOut += TOLERANCE;
  const start = moved(outside, [ox, oz], backedOut);
  const startGap = Math.max(0, gap) + backedOut;
  if (startGap > 0) {
    const toEdge = push(start, inward, startGap)!;
    if (toEdge < startGap) return rounded(moved(start, inward, toEdge));
  }
  const atEdge = moved(start, inward, startGap);
  const distance = push(atEdge, inward, depth);
  return distance === null ? null : rounded(moved(atEdge, inward, distance));
}

/**
 * A Placement with its floor position rounded to the micrometer: sliding out to an edge and back
 * leaves floating-point noise, and a drag that ends where it started mustn't make an Edit for it.
 */
const rounded = (placement: Placement): Placement => {
  const [x, y, z] = placement.position;
  return { ...placement, position: [Math.round(x * 1e6) / 1e6, y, Math.round(z * 1e6) / 1e6] };
};

/**
 * Snapping with a short reach and a firm hold, for one drag: a function from an edge, where the drag
 * puts an item, and where it would touch at that edge, to where it goes. It goes where the drag puts
 * it until that is within CAPTURE of touching, then snaps the rest of the way, a step too short to
 * jump out at the Mover; once snapped, it holds there until the pointer pulls it RELEASE back.
 */
export function contactHold(size: Vec3): {
  contactFrom: (push: ReturnType<typeof pusher>, edge: Edge, placed: Placement) => Placement | 'free' | 'blocked';
  at: (edge: Edge, placed: Placement, contact: Placement) => Placement;
  letGo: () => void;
} {
  let snappedTo: Edge | undefined;
  const into = (edge: Edge, at: Placement) => -besideEdge(edge, rectCorners(footprint(at, size))).gap;
  return {
    // Where it touches, from a short sweep in from where the drag puts it: within CAPTURE, or RELEASE
    // once snapped, and past that 'free', as it won't snap, so it is let go. 'blocked' where it is past
    // touching already, for slideIn to back it out. The sweep goes TOLERANCE further, as the Fit rules
    // let things overlap by that much, and twice that for floating point.
    contactFrom: (push, edge, placed) => {
      const reach = (snappedTo === edge ? RELEASE : CAPTURE) + 2 * TOLERANCE;
      const inward: Vec2 = [-edge.outward[0], -edge.outward[1]];
      const free = push(placed, inward, reach);
      if (free === null) return 'blocked';
      if (free < reach) return rounded(moved(placed, inward, free));
      snappedTo = undefined;
      return 'free';
    },
    at: (edge, placed, contact) => {
      // How far short of touching the drag leaves it, along the edge's inward normal.
      const short = into(edge, contact) - into(edge, placed);
      snappedTo = short <= (snappedTo === edge ? RELEASE : CAPTURE) ? edge : undefined;
      return snappedTo ? contact : placed;
    },
    letGo: () => {
      snappedTo = undefined;
    },
  };
}

/**
 * Tucking in, for a drag of one item (spec §10.3): a function from where the drag puts a chair, after
 * the wall snap and before it, to where it goes. At a desk or table edge it moves along the edge's
 * inward normal: where the drag puts it, under the top too, but never past first contact with the
 * desk, another item or a wall, as the desk is solid. Within 6 cm of contact it snaps in to touch, and
 * holds there until pulled 20 cm back (`contactHold`). Where there's no room under that edge, contact
 * is at the edge. Its angle and its position along the edge never change. Walls win: where the wall
 * snap moved the chair toward or away from the edge, it stays there. Away from any desk or table edge,
 * or short of snapping, it is where the drag put it. Undefined for anything but a chair: seating,
 * which includes ottomans and poufs.
 */
export function tuckSnap(setup: RoomSetup, catalog: Catalog, state: RoomState, subjectId: string):
  ((placed: Placement, unsnapped: Placement) => Placement) | undefined {
  const tuck = tuckAtEdge(setup, catalog, state, subjectId);
  return tuck && ((placed, unsnapped) => tuck(placed, unsnapped) ?? placed);
}

/** `tuckSnap`, but null where no desk or table edge is near the chair, so that another snap may take it (`dragSnap`). */
export function tuckAtEdge(setup: RoomSetup, catalog: Catalog, state: RoomState, subjectId: string):
  ((placed: Placement, unsnapped: Placement) => Placement | null) | undefined {
  const items = roomItems(setup, catalog, state);
  const subject = items.find(({ id }) => id === subjectId);
  if (subject?.category !== 'chair') return undefined;
  const size: Vec3 = [subject.rect.size[0], subject.heights[1] - subject.heights[0], subject.rect.size[1]];
  const snapAtEdge = edgeHolder(items
    .filter((item) => item !== subject && item.placement.mount === 'floor' && TUCK_TARGETS.includes(item.category))
    .flatMap(edgesOf), size);
  const push = pusher(setup, catalog, state, subjectId);
  const hold = contactHold(size);
  return (placed, unsnapped) => snapAtEdge(placed, (edge, backOut) => {
    if (wallSnapped(edge, placed, unsnapped)) {
      hold.letGo();
      return placed;
    }
    const near = hold.contactFrom(push, edge, placed);
    if (near === 'free') return placed;
    const contact = near === 'blocked' ? slideIn(push, edge, placed, size, backOut) : near;
    return contact && hold.at(edge, placed, contact);
  });
}
