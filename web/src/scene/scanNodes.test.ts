import { type Material, Mesh, type MeshStandardMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { setup } from '@shared/test-room';
import { luminance } from '../setup/geometry/color';
import { setupRoomNodes } from './scanNodes';

/** The materials of a stand-in node, which is one mesh. */
const materialsOf = (node: unknown) => {
  const { material } = node as Mesh;
  return (Array.isArray(material) ? material : [material]) as MeshStandardMaterial[];
};

describe('setupRoomNodes', () => {
  it("splits each stand-in Original into its category's Parts", () => {
    const { originals } = setupRoomNodes(setup);
    const partIds = (id: string) => materialsOf(originals[id]).map((material) => material.userData.partId);
    expect(partIds('og_desk')).toEqual(['top', 'legs']);
    expect(partIds('og_bed')).toEqual(['frame', 'bedding']);

    for (const [id, node] of Object.entries(originals)) {
      // ScanColors still finds it by its SplitNodeData.
      expect(node.userData).toMatchObject({ kind: 'original', id });
      // No texture, so each Part's average luminance is its flat color's.
      for (const { color, userData } of materialsOf(node)) expect(userData.avgLuminance).toBeCloseTo(luminance(color.r, color.g, color.b));
    }
  });

  it("keeps the Walls' and Floor's SplitNodeData", () => {
    const { walls, floor } = setupRoomNodes(setup);
    expect(Object.keys(walls)).toEqual(setup.walls.map((wall) => wall.id));
    for (const [id, node] of Object.entries(walls)) {
      expect(node.userData).toEqual({ kind: 'wall', id, avgLuminance: expect.any(Number) });
    }
    expect(floor.userData).toEqual({ kind: 'floor', avgLuminance: expect.any(Number) });
    // Painted as one Surface, so not split into Parts: one material that takes paint, beside its fixtures.
    for (const node of [...Object.values(walls), floor]) {
      const paintable = new Set<Material>();
      node.traverse((mesh) => {
        if (!(mesh instanceof Mesh)) return;
        expect(Array.isArray(mesh.material)).toBe(false);
        const material = mesh.material as Material;
        expect(material.userData.partId).toBeUndefined();
        if (!material.userData.fixture) paintable.add(material);
      });
      expect(paintable.size).toBe(1);
    }
  });
});
