import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import catalogJson from '../data/catalog/catalog.json';
import designJson from '../data/designs/ds_fixture1.json';
import manifestJson from '../data/scans/fixture/manifest.json';
import setupJson from '../data/scans/fixture/setup.json';
import type {
  Actor, Box, Catalog, CatalogItem, Category, Design, Edit, Finish, FinishTarget, Opening, Original, Placement,
  RoomSetup, ScanManifest, Wall,
} from './types';

// Compile time: a JSON import widens literals ('door' → string) and tuples
// ([x, z] → number[]), so each fixture is checked against its type widened the same way.
// The runtime checks below cover what that hides: literal values and tuple lengths.
type Json<T> = T extends string ? string
  : T extends number ? number
  : T extends readonly (infer U)[] ? Json<U>[]
  : T extends object ? { [K in keyof T]: Json<T[K]> }
  : T;

const manifest: Json<ScanManifest> = manifestJson;
const setup: Json<RoomSetup> = setupJson;
const catalog: Json<Catalog> = catalogJson;
const design: Json<Design> = designJson;

// Run time: a type's required keys, or a union's values, as lists. Typing them as
// Record<…, true> makes the compiler reject a list that misses or adds one.
type RequiredKey<T> = { [K in keyof T]-?: {} extends Pick<T, K> ? never : K }[keyof T];
const required = <T>(keys: Record<RequiredKey<T>, true>) => Object.keys(keys);
const oneOf = <T extends string>(values: Record<T, true>) => Object.keys(values);

function expectRequired(value: object, keys: string[]) {
  expect(Object.keys(value)).toEqual(expect.arrayContaining(keys));
}

const CATEGORIES = oneOf<Category>({
  chair: true, desk: true, table: true, nightstand: true, bed: true, sofa: true,
  dresser: true, wardrobe: true, shelf: true, storage: true,
  rug: true, lamp: true, wall_art: true, mirror: true, plant: true, decor: true,
});
const ACTORS = oneOf<Actor>({ mover: true, claude: true });
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
    for (const corner of setup.floor.polygon) expect(corner).toHaveLength(2);
    for (const wall of setup.walls) {
      expectRequired(wall, required<Wall>({ id: true, name: true, start: true, end: true, normal: true, height: true }));
      for (const point of [wall.start, wall.end, wall.normal]) expect(point).toHaveLength(2);
    }
    for (const opening of setup.openings) {
      expectRequired(opening, required<Opening>({
        id: true, kind: true, wallId: true, offset: true, width: true, bottom: true, height: true,
      }));
      expect(oneOf<Opening['kind']>({ door: true, window: true })).toContain(opening.kind);
      if (opening.swing !== undefined) {
        expect(oneOf<NonNullable<Opening['swing']>>({ 'in-left': true, 'in-right': true, none: true })).toContain(opening.swing);
      }
    }
    for (const original of setup.originals) {
      expectRequired(original, required<Original>({
        id: true, label: true, category: true, box: true, kept: true, floorColor: true,
      }));
      expectRequired(original.box, required<Box>({ position: true, size: true, rotationY: true }));
      expect(original.box.position).toHaveLength(3);
      expect(original.box.size).toHaveLength(3);
      expect(CATEGORIES).toContain(original.category);
      expect(original.floorColor).toMatch(HEX);
    }
  });

  it('gives every wall a unit normal pointing into the room', () => {
    // The fixture room is centered on the origin, so "into the room" means toward it.
    for (const { start, end, normal: [nx, nz] } of setup.walls) {
      expect(Math.hypot(nx, nz)).toBeCloseTo(1);
      expect(nx * (start[0] + end[0]) + nz * (start[1] + end[1])).toBeLessThan(0);
    }
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
      expect(oneOf<CatalogItem['source']>({ abo: true, polyhaven: true, generated: true })).toContain(item.source);
      expect(oneOf<CatalogItem['mount']>({ floor: true, wall: true })).toContain(item.mount);
      expect(CATEGORIES).toContain(item.category);
      expect(item.size).toHaveLength(3);
      if (item.colorHex !== undefined) expect(item.colorHex).toMatch(HEX);
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
    expect(ACTORS).toContain(design.origin);
    // Edit is a union keyed by type, so check the type first, then narrow on it.
    for (const edit of design.edits as Edit[]) {
      expect(Object.keys(EDIT_KEYS)).toContain(edit.type);
      expectRequired(edit, EDIT_KEYS[edit.type]);
      expect(ACTORS).toContain(edit.by);
      if ('placement' in edit) {
        expectRequired(edit.placement, required<Placement>({ position: true, rotationY: true, mount: true }));
        expect(edit.placement.position).toHaveLength(3);
        expect(oneOf<Placement['mount']>({ floor: true, wall: true, surface: true })).toContain(edit.placement.mount);
      }
      if (edit.type === 'swap' || edit.type === 'replace') expect([edit.type, 'resize']).toContain(edit.via);
      if (edit.type === 'recolor' && edit.color !== null) expect(edit.color).toMatch(HEX);
      if (edit.type === 'finish') {
        expect(oneOf<FinishTarget['kind']>({ wall: true, floor: true, original: true })).toContain(edit.target.kind);
        expect(oneOf<Finish['kind']>({ paint: true, material: true, none: true })).toContain(edit.finish.kind);
        if (edit.finish.kind === 'paint') expect(edit.finish.color).toMatch(HEX);
      }
    }
  });
});
