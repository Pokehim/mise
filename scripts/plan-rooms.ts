// Rooms from real floor plans (ADR-0010). Each data/floor-plans/<school>/room.json is one dorm room,
// read off the plan its university publishes (the plan image and its sources sit beside it). It
// becomes a Scan with no Capture, drawn from its Room Setup alone, and a "Move-in layout" Design
// with the room's own furniture placed from the Catalog where the plan shows it.
//
// Run: npx tsx scripts/plan-rooms.ts [school ...]   (all of them by default)
import { mkdir, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { search } from '../shared/catalog-search';
import { checkFit } from '../shared/fit';
import { distanceToWall } from '../shared/geometry';
import { replay } from '../shared/replay';
import type {
  Catalog, CatalogItem, Category, Design, Edit, Hex, LibraryEntry, Opening, RoomSetup, RoomSurfaces, ScanManifest, Vec2, Vec3,
} from '../shared/types';
import { moveInLayoutId } from '../web/src/plan/library';
import { wallsFromPolygon } from '../web/src/setup/geometry/walls';
import { writeJson } from './scan-import';

/** One room as read off its floor plan: meters, x east, z south (down the plan), origin at the room's center. */
export interface PlanRoom {
  id: string;
  school: string;
  hall: string;
  roomType: string;
  name: string;
  sourceUrls: string[];
  planFile?: string;
  derivedFrom: string;
  ceilingHeightM: number | null;
  finishes: { floor: string; walls: string; ceiling: string; evidence?: string };
  polygon: Vec2[];
  openings: {
    kind: 'door' | 'window';
    /** The polygon edge from polygon[wall] to polygon[wall + 1]. */
    wall: number;
    offsetM: number;
    widthM: number;
    bottomM?: number;
    heightM?: number;
    swing?: Opening['swing'];
  }[];
  furniture: {
    label: string;
    category: Category;
    center: Vec2;
    size: Vec3;
    facing: 'north' | 'south' | 'east' | 'west';
    builtIn?: boolean;
  }[];
  confidence: string;
}

/**
 * Each room's paint and floor where the plan's text leaves a choice, from its official room photos:
 * dorm walls are an off-white, carpet comes in the Material Library's three colors, and vinyl plank
 * in its woods.
 */
const LOOKS: Record<string, { wallColor?: Hex; carpet?: string; wood?: string }> = {
  stanford: { wallColor: '#efebe3', carpet: 'carpet-beige' },
  berkeley: { wallColor: '#f1f0ec', wood: 'oak' },
  cmu: { wallColor: '#ece6da', carpet: 'carpet-grey' },
  uw: { wallColor: '#eeeae2', carpet: 'carpet-navy' },
  mit: { wallColor: '#f0eee9' },
  uiuc: { wallColor: '#f2f0ea', wood: 'maple' },
  ucla: { wallColor: '#ede8de', carpet: 'carpet-grey' },
  columbia: { wallColor: '#eceae4', wood: 'oak' },
  umich: { wallColor: '#f0ede6', wood: 'walnut' },
  gatech: { wallColor: '#eeebe5', wood: 'maple' },
};

/**
 * Each room in the floor plan library, as "Import from floor plan" finds it: its school's full name
 * and what students call it, and its hall and room. room.json's own school and hall carry notes
 * ("substitute for Harvard") that a search mustn't match.
 */
const LIBRARY: Record<string, LibraryEntry> = {
  stanford: { school: 'Stanford University', aliases: ['Stanford'], hall: 'Wilbur Hall', room: 'Double' },
  berkeley: { school: 'University of California, Berkeley', aliases: ['UC Berkeley', 'Berkeley', 'Cal'], hall: 'Blackwell Hall', room: 'Double' },
  cmu: { school: 'Carnegie Mellon University', aliases: ['CMU', 'Carnegie Mellon'], hall: 'Donner House', room: 'Traditional double' },
  uw: { school: 'University of Washington', aliases: ['UW', 'UDub', 'U Dub'], hall: 'Lander Hall', room: 'Double, private bath' },
  mit: { school: 'Massachusetts Institute of Technology', aliases: ['MIT'], hall: 'New Vassar', room: 'Double' },
  uiuc: { school: 'University of Illinois Urbana-Champaign', aliases: ['UIUC', 'Illinois', 'Urbana-Champaign'], hall: 'Wassaja Hall', room: 'Double, type 2A' },
  ucla: { school: 'University of California, Los Angeles', aliases: ['UCLA'], hall: 'Dykstra Hall', room: 'Classic triple' },
  columbia: { school: 'Columbia University', aliases: ['Columbia'], hall: 'Carman Hall', room: 'Double, 507A' },
  umich: { school: 'University of Michigan', aliases: ['Michigan', 'UMich', 'U of M', 'U-M'], hall: 'Wolverine Village', room: 'Double' },
  gatech: { school: 'Georgia Institute of Technology', aliases: ['Georgia Tech', 'GT', 'GaTech'], hall: 'Peterson Hall', room: 'Double, N303' },
};

const DOOR_HEIGHT = 2.03;
const WINDOW = { bottom: 0.9, height: 1.3 };
const CEILING_HEIGHT = 2.6;

/** What the plan's finishes say the room is made of, as RoomSurfaces. */
export function surfacesFor({ finishes }: PlanRoom, school: string): RoomSurfaces {
  const floor = finishes.floor.toLowerCase();
  const look = LOOKS[school] ?? {};
  const floorId =
    /carpet/.test(floor) ? look.carpet ?? 'carpet-grey'
    : /plank|lvp|hardwood|wood|laminate/.test(floor) ? look.wood ?? 'oak'
    : /vct|vinyl|linoleum|tile/.test(floor) ? 'vct'
    : /concrete/.test(floor) ? 'concrete'
    : 'carpet-grey';
  return {
    walls: /block|cmu|cinder/.test(finishes.walls.toLowerCase()) ? 'cinderblock' : 'drywall',
    wallColor: look.wallColor ?? '#eeebe4',
    floor: floorId,
    ceiling: /acoustic|tile/.test(finishes.ceiling.toLowerCase()) ? 'acoustic-tile' : 'drywall',
    baseboard: /oak|maple|walnut|cherry/.test(floorId) ? 'wood' : 'rubber',
  };
}

/** The room's Room Setup: its walls one per polygon edge, its Openings, and no Originals. */
export function planSetup(plan: PlanRoom, school: string): RoomSetup {
  const ceilingHeight = plan.ceilingHeightM ?? CEILING_HEIGHT;
  const walls = wallsFromPolygon(plan.polygon, ceilingHeight);
  const openings: Opening[] = plan.openings.map((o, i) => {
    const door = o.kind === 'door';
    return {
      id: `op_${i + 1}`, kind: o.kind, wallId: walls[o.wall].id, offset: o.offsetM, width: o.widthM,
      bottom: door ? 0 : o.bottomM ?? WINDOW.bottom,
      height: o.heightM ?? (door ? DOOR_HEIGHT : WINDOW.height),
      ...(door ? { swing: o.swing ?? 'in-right' } : {}),
    };
  });
  return {
    version: 1, scanId: plan.id, ceilingHeight, floor: { polygon: plan.polygon }, walls, openings, originals: [],
    surfaces: surfacesFor(plan, school),
  };
}

/** Which way each compass facing points on the floor, and the rotationY that turns a front (+Z) that way. */
const FACING: Record<PlanRoom['furniture'][number]['facing'], { dir: Vec2; rotationY: number }> = {
  south: { dir: [0, 1], rotationY: 0 },
  east: { dir: [1, 0], rotationY: Math.PI / 2 },
  north: { dir: [0, -1], rotationY: Math.PI },
  west: { dir: [-1, 0], rotationY: -Math.PI / 2 },
};

/**
 * The Catalog item closest to a piece of the plan's furniture: by size, a swivel chair at a desk, and
 * a low bed, as dorm beds are, which clears a window sill.
 */
export function catalogFor(catalog: Catalog, piece: PlanRoom['furniture'][number]): CatalogItem | undefined {
  const real = {
    ...catalog,
    items: catalog.items.filter((item) => !item.id.startsWith('placeholder') && (piece.category !== 'bed' || item.size[1] < 0.8)),
  };
  if (piece.category === 'chair' && /desk/i.test(piece.label)) {
    const [swivel] = search(real, { category: 'chair', text: 'swivel', limit: 1 });
    if (swivel) return swivel.item;
  }
  const [best] = search(real, { category: piece.category, targetSize: piece.size, limit: 1 });
  if (best && best.score <= 0.25) return best.item;
  // Far off in size: a kind of furniture that does the same job, if one is closer.
  const others = (RELATED[piece.category] ?? []).flatMap((category) => search(real, { category, targetSize: piece.size, limit: 1 }));
  return [best, ...others].filter(Boolean).sort((a, b) => a.score - b.score)[0]?.item;
}

/** Furniture that can stand in for another kind when the Catalog has none near its size: a small dresser is a chest. */
const RELATED: Partial<Record<Category, Category[]>> = {
  dresser: ['nightstand', 'storage'],
  nightstand: ['dresser', 'storage'],
  wardrobe: ['shelf'],
  desk: ['table'],
};

/**
 * The room's furniture as a Design of `place` Edits. Each item keeps its back where the plan's
 * furniture has it, usually against a wall, since a Catalog item is seldom exactly the plan's size.
 */
export function moveInDesign(plan: PlanRoom, catalog: Catalog, at: string): Design {
  const edits: Edit[] = [];
  for (const piece of plan.furniture) {
    const item = catalogFor(catalog, piece);
    if (!item) continue;
    const { dir: [fx, fz], rotationY } = FACING[piece.facing];
    const shift = (item.size[2] - piece.size[2]) / 2;
    const n = edits.length + 1;
    edits.push({
      id: `ed_${n}`, at, by: 'mover', type: 'place', pieceId: `pc_${n}`, catalogId: item.id,
      placement: {
        position: [round(piece.center[0] + fx * shift), 0, round(piece.center[1] + fz * shift)], rotationY, mount: 'floor',
      },
    });
  }
  return {
    version: 1, id: moveInLayoutId(plan.id), scanId: plan.id, name: 'Move-in layout',
    createdAt: at, updatedAt: at, origin: 'mover', edits,
  };
}

const round = (v: number) => Math.round(v * 1000) / 1000;

/** How far one nudge moves a Piece, and the most nudges a layout gets. */
const NUDGE = 0.02;
const MAX_NUDGES = 80;

/**
 * Nudges the Design's Pieces, 2 cm at a time, until its layout breaks no Fit rule, as far as nudging
 * can: a Catalog item is seldom the plan's size, so it can poke through a wall or into its neighbor.
 * Each step, every Piece in trouble moves once, by the sum of what pushes it: away from each Piece
 * it overlaps (a chair backs straight out from a desk it's tucked under), and in from each wall it
 * pokes through. Returns the violations left.
 */
export function settle(setup: RoomSetup, catalog: Catalog, design: Design) {
  const placed = new Map(design.edits.flatMap((edit) => (edit.type === 'place' ? [[edit.pieceId, edit] as const] : [])));
  const categoryOf = (pieceId: string, state: ReturnType<typeof replay>) =>
    catalog.items.find(({ id }) => id === state.pieces[pieceId]?.catalogId)?.category;
  for (let nudge = 0; nudge < MAX_NUDGES; nudge++) {
    const state = replay(setup, catalog, design.edits);
    const violations = checkFit(setup, catalog, state);
    if (!violations.length) return [];
    const push = new Map<string, [number, number]>();
    const add = (pieceId: string, dx: number, dz: number) => {
      const [x, z] = push.get(pieceId) ?? [0, 0];
      push.set(pieceId, [x + dx, z + dz]);
    };
    for (const { rule, subjectId, otherId } of violations) {
      const subject = state.pieces[subjectId];
      if (!subject) continue;
      const [sx, , sz] = subject.placement.position;
      if (rule === 'overlap' && otherId && state.pieces[otherId]) {
        const other = state.pieces[otherId];
        const tucked = categoryOf(subjectId, state) === 'chair' && ['desk', 'table'].includes(categoryOf(otherId, state) ?? '');
        if (tucked) {
          add(subjectId, -Math.sin(subject.placement.rotationY), -Math.cos(subject.placement.rotationY));
        } else if (categoryOf(otherId, state) !== 'chair' || categoryOf(subjectId, state) === 'chair') {
          const [ox, , oz] = other.placement.position;
          const length = Math.hypot(sx - ox, sz - oz) || 1;
          add(subjectId, (sx - ox) / length, (sz - oz) / length);
        }
      } else if (rule === 'outside-floor') {
        for (const wall of setup.walls) {
          if (distanceToWall([sx, sz], wall) < 1.5) add(subjectId, wall.normal[0] * 0.5, wall.normal[1] * 0.5);
        }
        const wall = setup.walls.reduce((a, b) => (distanceToWall([sx, sz], b) < distanceToWall([sx, sz], a) ? b : a));
        add(subjectId, wall.normal[0], wall.normal[1]);
      }
    }
    if (!push.size) return violations;
    for (const [pieceId, [dx, dz]] of push) {
      const edit = placed.get(pieceId)!;
      const length = Math.hypot(dx, dz) || 1;
      const [x, y, z] = edit.placement.position;
      edit.placement.position = [round(x + (dx / length) * NUDGE), y, round(z + (dz / length) * NUDGE)];
    }
  }
  return checkFit(setup, catalog, replay(setup, catalog, design.edits));
}

/** What's left out first when a room's furniture can't all fit: never a bed or a desk. */
const DROP_FIRST: Category[] = ['shelf', 'storage', 'nightstand', 'chair', 'dresser', 'table', 'wardrobe'];

/**
 * Settles the Design, then, while Pieces still break a Fit rule, leaves out the one that matters
 * least, by DROP_FIRST, among those in trouble. Returns the labels of what it left out.
 */
export function settleOrDrop(setup: RoomSetup, catalog: Catalog, design: Design): string[] {
  const dropped: string[] = [];
  for (let left = settle(setup, catalog, design); left.length; left = settle(setup, catalog, design)) {
    const troubled = new Set(left.map(({ subjectId }) => subjectId));
    const category = (edit: Edit) => (edit.type === 'place' ? catalog.items.find(({ id }) => id === edit.catalogId)?.category : undefined);
    const rank = (edit: Edit) => {
      const index = DROP_FIRST.indexOf(category(edit)!);
      return index < 0 ? Infinity : index;
    };
    const candidates = design.edits.filter((edit) => edit.type === 'place' && troubled.has(edit.pieceId) && rank(edit) < Infinity);
    if (!candidates.length) break;
    const drop = candidates.sort((a, b) => rank(a) - rank(b))[0];
    design.edits = design.edits.filter((edit) => edit !== drop);
    dropped.push(`${category(drop)} (${drop.type === 'place' ? drop.pieceId : ''})`);
  }
  return dropped;
}

async function main() {
  const root = join(import.meta.dirname, '..', 'data');
  const catalog: Catalog = JSON.parse(await readFile(join(root, 'catalog', 'catalog.json'), 'utf8'));
  const named = process.argv.slice(2);
  const schools = named.length ? named : (await readdir(join(root, 'floor-plans'), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  // A fixed time, so running it again changes nothing.
  const at = '2026-10-18T08:00:00.000Z';
  for (const school of schools) {
    const plan: PlanRoom = JSON.parse(await readFile(join(root, 'floor-plans', school, 'room.json'), 'utf8'));
    const setup = planSetup(plan, school);
    const manifest: ScanManifest = {
      version: 1, id: plan.id, name: plan.name, mesh: 'room.glb', meshTransform: { position: [0, 0, 0], rotationY: 0 },
      library: LIBRARY[school],
    };
    const design = moveInDesign(plan, catalog, at);
    const dropped = settleOrDrop(setup, catalog, design);
    const left = checkFit(setup, catalog, replay(setup, catalog, design.edits));
    await mkdir(join(root, 'scans', plan.id), { recursive: true });
    await writeJson(join(root, 'scans', plan.id, 'manifest.json'), manifest);
    await writeJson(join(root, 'scans', plan.id, 'setup.json'), setup);
    await writeJson(join(root, 'designs', `${design.id}.json`), design);
    const { floor, walls } = setup.surfaces!;
    console.log(`${plan.id}: ${setup.walls.length} walls, ${setup.openings.length} openings, ${walls} walls, ${floor} floor; ${design.edits.length} of ${plan.furniture.length} pieces placed → ${design.id}`);
    if (dropped.length) console.log(`  left out, to fit: ${dropped.join(', ')}`);
    for (const { message, subjectId } of left) console.log(`  still: ${subjectId} ${message}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
