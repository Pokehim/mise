import { Box3, type Material, Mesh, type MeshBasicMaterial, type Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import type { RoomSetup } from '@shared/types';
import { setup } from '@shared/test-room';
import { buildRoom, DEFAULT_SURFACES } from './buildRoom';

const meshes = (node: Object3D) => {
  const found: Mesh[] = [];
  node.traverse((object) => {
    if (object instanceof Mesh) found.push(object);
  });
  return found;
};
const named = (node: Object3D, suffix: string) => meshes(node).find(({ name }) => name.endsWith(suffix));

describe('buildRoom', () => {
  it('lights the Surfaces with light maps, which paint and Finishes leave alone', () => {
    const { floor, ceiling, walls } = buildRoom(setup);
    for (const node of [floor, ceiling, ...Object.values(walls)]) {
      const surface = meshes(node).find((mesh) => !(mesh.material as Material).userData.fixture)!;
      const material = surface.material as MeshBasicMaterial;
      expect(material.lightMap).not.toBeNull();
      expect(material.lightMapIntensity).toBeCloseTo(Math.PI);
      expect(surface.geometry.getAttribute('uv1')).toBeDefined();
    }
    // A Finish replaces the floor's and walls' own detail; the light stays in the light map (ADR-0010).
    expect((floor.material as Material).userData.finishDetail).toBe(0);
    expect((named(walls.wl_north, ' face')!.material as Material).userData.finishDetail).toBe(0);
  });

  it("gives each wall materials of its own, so WallFader fades one wall alone", () => {
    const { walls } = buildRoom(setup);
    const owners = new Map<Material, string>();
    for (const [id, node] of Object.entries(walls)) {
      for (const mesh of meshes(node)) {
        const material = mesh.material as Material;
        expect(owners.get(material) ?? id).toBe(id);
        owners.set(material, id);
      }
    }
  });

  it('frames the door and the window, and breaks the baseboard at the door', () => {
    const { walls } = buildRoom(setup);
    // The door is in the South wall at x 0.8–1.7; the window in the North wall.
    expect(named(walls.wl_south, ' door')).toBeDefined();
    expect(named(walls.wl_south, ' door handle')).toBeDefined();
    expect(named(walls.wl_north, ' glass')).toBeDefined();
    expect(named(walls.wl_south, ' glass')).toBeUndefined();
    const base = named(walls.wl_south, ' baseboard')!;
    const position = base.geometry.getAttribute('position');
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i);
      expect(x < 0.8 - 0.06 || x > 1.7 + 0.06).toBe(true);
    }
    // Every piece of trim is a fixture, which paint leaves alone.
    for (const suffix of [' trim', ' baseboard', ' door', ' glass', ' top', ' outside']) {
      for (const node of Object.values(walls)) {
        const mesh = named(node, suffix);
        if (mesh) expect((mesh.material as Material).userData.fixture).toBe(true);
      }
    }
  });

  it('gives the walls their thickness outside the room, with their tops under the ceiling', () => {
    const { walls } = buildRoom(setup);
    const bounds = new Box3().setFromObject(walls.wl_north);
    // The North wall's inside face is at z = −1.5; it is 15 cm thick, out toward −Z.
    expect(bounds.min.z).toBeCloseTo(-1.65, 2);
    expect(bounds.max.z).toBeLessThan(-1.4);
    const top = new Box3().setFromObject(named(walls.wl_north, ' top')!);
    expect(top.max.y).toBeCloseTo(setup.ceilingHeight - 0.06);
  });

  it('hangs a light from the ceiling, and draws a room with no RoomSurfaces as the default', () => {
    const { ceiling, floor } = buildRoom(setup);
    expect(meshes(ceiling).some(({ name }) => name === 'Ceiling light')).toBe(true);
    expect(setup.surfaces).toBeUndefined();
    expect(DEFAULT_SURFACES.floor).toBe('carpet-grey');
    // Until its texture loads, the floor shows its material's average color: a mid-gray carpet.
    expect((floor.material as MeshBasicMaterial).color.r).toBeCloseTo(0.29);
  });

  it('builds an L-shaped room of cinderblock with an acoustic-tile ceiling', () => {
    const polygon: [number, number][] = [[-2, -2], [0, -2], [0, 0], [2, 0], [2, 2], [-2, 2]];
    const room: RoomSetup = {
      version: 1, scanId: 'l-room', ceilingHeight: 2.5, floor: { polygon }, originals: [],
      walls: polygon.map((start, i) => {
        const end = polygon[(i + 1) % polygon.length];
        const [dx, dz] = [end[0] - start[0], end[1] - start[1]];
        const length = Math.hypot(dx, dz);
        return { id: `wl_${i + 1}`, name: `Wall ${i + 1}`, start, end, normal: [-dz / length, dx / length], height: 2.5 };
      }),
      openings: [{ id: 'op_1', kind: 'window', wallId: 'wl_1', offset: 0.5, width: 1, bottom: 0.9, height: 1.2 }],
      surfaces: { ...DEFAULT_SURFACES, walls: 'cinderblock', ceiling: 'acoustic-tile' },
    };
    const { walls } = buildRoom(room);
    expect(Object.keys(walls)).toHaveLength(6);
    for (const node of Object.values(walls)) expect(meshes(node).every((mesh) => mesh.geometry.getAttribute('position').count > 0)).toBe(true);
  });
});
