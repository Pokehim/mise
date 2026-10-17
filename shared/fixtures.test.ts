import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import catalogJson from '../data/catalog/catalog.json';
import designJson from '../data/designs/ds_fixture1.json';
import manifestJson from '../data/scans/fixture/manifest.json';
import setupJson from '../data/scans/fixture/setup.json';
import type {
  Box, Catalog, CatalogItem, Category, Design, Edit, Opening, Original, Placement, RoomSetup, ScanManifest, Wall,
} from './types';

// Compile time: a JSON import widens literals ('door' → string) and tuples
// ([x, z] → number[]), so each fixture is checked against its type widened the same way.
type Json<T> = T extends string ? string
  : T extends number ? number
  : T extends boolean ? boolean
  : T extends readonly (infer U)[] ? Json<U>[]
  : T extends object ? { [K in keyof T]: Json<T[K]> }
  : T;

const manifest: Json<ScanManifest> = manifestJson;
const setup: Json<RoomSetup> = setupJson;
const catalog: Json<Catalog> = catalogJson;
const design: Json<Design> = designJson;

// Run time: every key a type requires. Record<RequiredKey<T>, true> makes the
// compiler reject a list that misses a required key or names an extra one.
type RequiredKey<T> = { [K in keyof T]-?: {} extends Pick<T, K> ? never : K }[keyof T];
const required = <T>(keys: Record<RequiredKey<T>, true>) => Object.keys(keys);

function expectRequired(value: object, keys: string[]) {
  expect(Object.keys(value)).toEqual(expect.arrayContaining(keys));
}

const CATEGORIES = Object.keys({
  chair: true, desk: true, table: true, nightstand: true, bed: true, sofa: true,
  dresser: true, wardrobe: true, shelf: true, storage: true,
  rug: true, lamp: true, wall_art: true, mirror: true, plant: true, decor: true,
} satisfies Record<Category, true>);
const HEX = /^#[0-9a-f]{6}$/;

describe('fixture Scan', () => {
  it('manifest.json is a ScanManifest', () => {
    expectRequired(manifest, required<ScanManifest>({ version: true, id: true, name: true, mesh: true, meshTransform: true }));
    expect(manifest).toMatchObject({ version: 1, id: 'fixture', mesh: 'room.glb' });
    expect(manifest.meshTransform.position).toHaveLength(3);
  });

  it('setup.json is a RoomSetup', () => {
    expectRequired(setup, required<RoomSetup>({
      version: true, scanId: true, ceilingHeight: true, floor: true, walls: true, openings: true, originals: true,
    }));
    expect(setup).toMatchObject({ version: 1, scanId: 'fixture' });
    for (const wall of setup.walls) {
      expectRequired(wall, required<Wall>({ id: true, name: true, start: true, end: true, normal: true, height: true }));
    }
    for (const opening of setup.openings) {
      expectRequired(opening, required<Opening>({
        id: true, kind: true, wallId: true, offset: true, width: true, bottom: true, height: true,
      }));
    }
    for (const original of setup.originals) {
      expectRequired(original, required<Original>({
        id: true, label: true, category: true, box: true, kept: true, floorColor: true,
      }));
      expectRequired(original.box, required<Box>({ position: true, size: true, rotationY: true }));
      expect(CATEGORIES).toContain(original.category);
      expect(original.floorColor).toMatch(HEX);
    }
  });

  it('is a 4 × 3 m room with a 2.6 m ceiling', () => {
    const xs = setup.floor.polygon.map(([x]) => x);
    const zs = setup.floor.polygon.map(([, z]) => z);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(4);
    expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(3);
    expect(setup.ceilingHeight).toBe(2.6);
  });

  it('has one wall per floor edge, each with a unit normal pointing into the room', () => {
    const { polygon } = setup.floor;
    const center = [0, 1].map((axis) => polygon.reduce((sum, corner) => sum + corner[axis], 0) / polygon.length);
    expect(setup.walls).toHaveLength(4);
    setup.walls.forEach((wall, i) => {
      expect([wall.start, wall.end]).toEqual([polygon[i], polygon[(i + 1) % polygon.length]]);
      const [nx, nz] = wall.normal;
      const [dx, dz] = [wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]];
      const toCenter = [center[0] - (wall.start[0] + wall.end[0]) / 2, center[1] - (wall.start[1] + wall.end[1]) / 2];
      expect(Math.hypot(nx, nz)).toBeCloseTo(1);
      expect(nx * dx + nz * dz).toBeCloseTo(0);
      expect(nx * toCenter[0] + nz * toCenter[1]).toBeGreaterThan(0);
    });
  });

  it('has one door and one window, each in a wall', () => {
    expect(setup.openings.map((opening) => opening.kind).sort()).toEqual(['door', 'window']);
    const wallIds = setup.walls.map((wall) => wall.id);
    for (const opening of setup.openings) expect(wallIds).toContain(opening.wallId);
  });

  it('has two Originals: a Kept bed and a desk', () => {
    expect(setup.originals.map(({ id, kept }) => ({ id, kept }))).toEqual([
      { id: 'og_bed', kept: true },
      { id: 'og_desk', kept: false },
    ]);
  });
});

describe('fixture Catalog', () => {
  it('catalog.json is a Catalog', () => {
    expectRequired(catalog, required<Catalog>({ version: true, items: true }));
    expect(catalog.version).toBe(1);
    for (const item of catalog.items) {
      expectRequired(item, required<CatalogItem>({
        id: true, source: true, title: true, category: true, mount: true, size: true, model: true,
        thumbnail: true, colors: true, materials: true, styleTags: true, priceEstimateUsd: true, url: true, attribution: true,
      }));
      expect(CATEGORIES).toContain(item.category);
      expect(item.size).toHaveLength(3);
    }
  });

  it('points every item at a model and a thumbnail that exist under data/', () => {
    for (const item of catalog.items) {
      for (const url of [item.model, item.thumbnail]) {
        expect(url).toMatch(/^\/data\//);
        expect(existsSync(new URL(`..${url}`, import.meta.url)), url).toBe(true);
      }
    }
  });
});

type EditOf<T extends Edit['type']> = Extract<Edit, { type: T }>;
const EDIT_BASE = { id: true, at: true, by: true, type: true } as const;
const EDIT_KEYS: Record<Edit['type'], string[]> = {
  place: required<EditOf<'place'>>({ ...EDIT_BASE, pieceId: true, catalogId: true, placement: true }),
  move: required<EditOf<'move'>>({ ...EDIT_BASE, targetId: true, placement: true }),
  remove: required<EditOf<'remove'>>({ ...EDIT_BASE, targetId: true }),
  swap: required<EditOf<'swap'>>({ ...EDIT_BASE, pieceId: true, catalogId: true, placement: true, via: true }),
  replace: required<EditOf<'replace'>>({
    ...EDIT_BASE, originalId: true, pieceId: true, catalogId: true, placement: true, via: true,
  }),
  recolor: required<EditOf<'recolor'>>({ ...EDIT_BASE, targetId: true, partId: true, color: true }),
  finish: required<EditOf<'finish'>>({ ...EDIT_BASE, target: true, finish: true }),
};

describe('fixture Design', () => {
  it('ds_fixture1.json is a Design of the fixture Scan', () => {
    expectRequired(design, required<Design>({
      version: true, id: true, scanId: true, name: true, createdAt: true, updatedAt: true, origin: true, edits: true,
    }));
    expect(design).toMatchObject({ version: 1, id: 'ds_fixture1', scanId: manifest.id });
    for (const edit of design.edits) {
      expect(Object.keys(EDIT_KEYS)).toContain(edit.type);
      expectRequired(edit, EDIT_KEYS[edit.type as Edit['type']]);
      if ('placement' in edit) expectRequired(edit.placement, required<Placement>({ position: true, rotationY: true, mount: true }));
    }
  });
});
