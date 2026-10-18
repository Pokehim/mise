// The 8 camera shots of lounge-v2 (spec §6), for ?shot=<1–8>: screenshots and the walk-through take
// each one furnished and, with ?empty=1, as the Empty Room. They are found from the Room Setup by the
// lounge's names (West wall, North wall, Whiteboard, Table 1, Chair 1), so fixture-models has them too.
import { wallPoint } from '@shared/geometry';
import type { Original, RoomSetup, Vec3 } from '@shared/types';
import type { View } from '../state/store';

export interface Shot {
  view: View;
  /** Where the camera is and what it looks at; none for the default Dollhouse view. */
  pose?: { position: Vec3; target: Vec3 };
  /** Straight down on the whole room, its long side across the view (DollhouseCamera fits it to the view). */
  topDown?: true;
}

/** Each shot's name, in spec §6's order, for ?shot=<name>; ?shot=<1–8> works too. */
const SHOT_NAMES = ['door', 'window', 'whiteboard', 'seated', 'tabletop', 'legs', 'dollhouse', 'top'];

/** The shot ?shot= asks for, 1 to 8, or null. */
export const SHOT_NUMBER = ((value) => {
  const n = SHOT_NAMES.includes(value) ? SHOT_NAMES.indexOf(value) + 1 : Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 8 ? n : null;
})(new URLSearchParams(location.search).get('shot') ?? '');

/** The View a shot is taken in: eye-level shots walk, and the last two look in from above. */
export const shotView = (n: number): View => (n <= 6 ? 'walk' : 'dollhouse');

const EYE = 1.6;
const SEATED = 1.15;

/** An Original's box frame: its center on the floor, its front (+Z) and its right (+X), turned by rotationY. */
function frame({ box: { position: [x, y, z], size, rotationY: r } }: Original) {
  return { x, y, z, size, front: [Math.sin(r), Math.cos(r)] as const, right: [Math.cos(r), -Math.sin(r)] as const };
}

const find = (setup: RoomSetup, test: (original: Original) => boolean) => setup.originals.find(test);
const named = (label: string) => (original: Original) => original.label.toLowerCase() === label.toLowerCase();

/** The camera of shot n in this room, or null when the room lacks what it looks at. */
export function shotOf(n: number, setup: RoomSetup): Shot | null {
  const xs = setup.floor.polygon.map(([x]) => x);
  const zs = setup.floor.polygon.map(([, z]) => z);
  const [cx, cz] = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...zs) + Math.max(...zs)) / 2];
  const wall = (name: string) => setup.walls.find((w) => w.name === name);
  const tables = setup.originals.filter(({ category }) => category === 'table' || category === 'desk');

  switch (n) {
    case 1: {
      // 1. Eye level at the main door on the West wall, looking in.
      const west = wall('West wall');
      const door = setup.openings.find((o) => o.kind === 'door' && o.wallId === west?.id);
      if (!west || !door) return null;
      const [x, z] = wallPoint(west, door.offset + door.width / 2, 0.3);
      return { view: 'walk', pose: { position: [x, EYE, z], target: [cx, 1.3, cz] } };
    }
    case 2: {
      // 2. Eye level at the North window end, looking South.
      const north = wall('North wall');
      if (!north) return null;
      const length = Math.hypot(north.end[0] - north.start[0], north.end[1] - north.start[1]);
      const [x, z] = wallPoint(north, length / 2, 0.4);
      const [tx, tz] = wallPoint(north, length / 2, 4);
      return { view: 'walk', pose: { position: [x, EYE, z], target: [tx, 1.3, tz] } };
    }
    case 3: {
      // 3. Eye level 2 m from the whiteboard, facing it.
      const board = find(setup, named('Whiteboard'));
      if (!board) return null;
      const { x, y, z, size, front } = frame(board);
      const middle = y + size[1] / 2;
      return { view: 'walk', pose: { position: [x + 2 * front[0], EYE, z + 2 * front[1]], target: [x, middle, z] } };
    }
    case 4: {
      // 4. Seated at the middle table, looking across it: along its shorter side.
      const middle = tables.toSorted((a, b) => a.box.position[2] - b.box.position[2])[Math.floor(tables.length / 2)];
      if (!middle) return null;
      const { x, z, size: [w, , d], front, right } = frame(middle);
      const [axis, half] = w >= d ? [front, d / 2] : [right, w / 2];
      return {
        view: 'walk',
        pose: { position: [x + axis[0] * (half + 0.35), SEATED, z + axis[1] * (half + 0.35)], target: [x - axis[0] * (half + 1), 0.95, z - axis[1] * (half + 1)] },
      };
    }
    case 5: {
      // 5. A tabletop close-up, 0.6 m above Table 1.
      const table = find(setup, named('Table 1')) ?? tables[0];
      if (!table) return null;
      const { x, y, z, size, front } = frame(table);
      const top = y + size[1];
      return { view: 'walk', pose: { position: [x + 0.3 * front[0], top + 0.6, z + 0.3 * front[1]], target: [x, top, z] } };
    }
    case 6: {
      // 6. Chair legs: 0.4 m high, 1 m behind a chair, which is where there's room.
      const chair = find(setup, named('Chair 1')) ?? find(setup, ({ category }) => category === 'chair');
      if (!chair) return null;
      const { x, z, front } = frame(chair);
      return { view: 'walk', pose: { position: [x - front[0], 0.4, z - front[1]], target: [x, 0.25, z] } };
    }
    case 7:
      // 7. The default Dollhouse view.
      return { view: 'dollhouse' };
    case 8:
      // 8. Top-down.
      return { view: 'dollhouse', topDown: true };
    default:
      return null;
  }
}
