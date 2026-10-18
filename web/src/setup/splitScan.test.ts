import {
  Box3, BufferAttribute, BufferGeometry, DataTexture, Group, Matrix4, Mesh, MeshStandardMaterial, type Object3D, Vector3,
} from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { RoomSetup, ScanManifest } from '@shared/types';
import { splitScan } from '../scene/splitScan';
import type { TriangleMesh } from './geometry/mesh';
import { box, horizontal } from './geometry/testShapes';

const setup: RoomSetup = {
  version: 1,
  scanId: 'test',
  ceilingHeight: 2.6,
  floor: { polygon: [[-2, -1.5], [2, -1.5], [2, 1.5], [-2, 1.5]] },
  walls: [
    { id: 'wl_1', name: 'North wall', start: [-2, -1.5], end: [2, -1.5], normal: [0, 1], height: 2.6 },
    { id: 'wl_2', name: 'East wall', start: [2, -1.5], end: [2, 1.5], normal: [-1, 0], height: 2.6 },
    { id: 'wl_3', name: 'South wall', start: [2, 1.5], end: [-2, 1.5], normal: [0, -1], height: 2.6 },
    { id: 'wl_4', name: 'West wall', start: [-2, 1.5], end: [-2, -1.5], normal: [1, 0], height: 2.6 },
  ],
  openings: [],
  originals: [
    // In the North-West corner: x from −2 to −1.01, z from −1.5 to 0.53.
    { id: 'og_bed', label: 'Bed', category: 'bed', kept: true, floorColor: '#a89f91',
      box: { position: [-1.505, 0, -0.485], size: [0.99, 0.6, 2.03], rotationY: 0 } },
    { id: 'og_lamp', label: 'Lamp', category: 'lamp', kept: false, floorColor: '#a89f91',
      box: { position: [1, 0, 1], size: [0.3, 1.5, 0.3], rotationY: 0 } },
  ],
};

// The capture's frame differs from the room's: Room Setup step 1 found this transform.
const manifest: ScanManifest = {
  version: 1, id: 'test', name: 'Test', mesh: 'room.glb', meshTransform: { position: [1, -0.5, 2], rotationY: 0.3 },
};

/** A one-color 2 × 2 sRGB texture. */
function texture(gray: number) {
  const t = new DataTexture(new Uint8Array(16).fill(gray), 2, 2);
  t.flipY = false;
  return t;
}

/** A glTF-like primitive: the room-frame triangles moved into the capture's frame, with a texture. */
function primitive(mesh: TriangleMesh, map: DataTexture) {
  const roomToCapture = new Matrix4()
    .makeRotationY(manifest.meshTransform.rotationY)
    .setPosition(...manifest.meshTransform.position)
    .invert();
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(mesh.positions.slice(), 3).applyMatrix4(roomToCapture));
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array((mesh.positions.length / 3) * 2).fill(0.5), 2));
  geometry.setIndex(new BufferAttribute(mesh.index, 1));
  return new Mesh(geometry, new MeshStandardMaterial({ map }));
}

const gray = texture(128);
const white = texture(255);
const room = primitive(box([-2, 0, -1.5], [2, 2.6, 1.5], true), gray);
const bed = primitive(box([-2, 0, -1.5], [-1.01, 0.6, 0.53]), white);
// glTF nodes can carry their own transforms: this one shifts its mesh by +0.5 m along X.
bed.geometry.translate(-0.5, 0, 0);
const node = new Group();
node.position.set(0.5, 0, 0);
node.add(bed);
const gltfScene = new Group().add(room, node);

/** Each mesh under a node, with its triangle count. */
const meshes = (object: Object3D) => {
  const found: { mesh: Mesh; triangles: number }[] = [];
  object.traverse((child) => {
    if (child instanceof Mesh) found.push({ mesh: child, triangles: child.geometry.index!.count / 3 });
  });
  return found;
};
const triangles = (object: Object3D) => meshes(object).reduce((sum, m) => sum + m.triangles, 0);
const rounded = (v: Vector3) => v.toArray().map((x) => +x.toFixed(4) + 0);

describe('splitScan', () => {
  const split = splitScan(gltfScene, setup, manifest);

  it('sorts every triangle into the Shell, Floor, Ceiling, a Wall or an Original', () => {
    expect({
      shell: triangles(split.shell),
      floor: triangles(split.floor),
      ceiling: triangles(split.ceiling),
      walls: Object.fromEntries(Object.entries(split.walls).map(([id, wall]) => [id, triangles(wall)])),
      originals: Object.fromEntries(Object.entries(split.originals).map(([id, o]) => [id, triangles(o)])),
    }).toEqual({
      shell: 2,                                  // the underside of the bed
      floor: 2,                                  // including the floor under the bed
      ceiling: 2,
      walls: { wl_1: 4, wl_2: 2, wl_3: 2, wl_4: 4 }, // the bed's back and side touch the North and West walls
      originals: { og_bed: 6, og_lamp: 0 },       // an Original with no triangles still gets a node
    });
  });

  it("works in the room frame: the capture's meshTransform and node transforms are applied", () => {
    const floor = new Box3().setFromObject(split.floor);
    expect(rounded(floor.min)).toEqual([-2, 0, -1.5]);
    expect(rounded(floor.max)).toEqual([2, 0, 1.5]);
  });

  it('keeps one mesh per source primitive in each node, reusing its texture', () => {
    expect(meshes(split.walls.wl_4).map(({ mesh }) => (mesh.material as MeshStandardMaterial).map))
      .toEqual([gray, white]);
  });

  it("puts each Original's origin at its box's bottom-center, so moving the node moves the Original", () => {
    const original = split.originals.og_bed;
    expect(original.position.toArray()).toEqual([-1.505, 0, -0.485]);
    original.position.x += 1;
    const moved = new Box3().setFromObject(original);
    original.position.x -= 1;
    expect(rounded(moved.min)).toEqual([-1, 0, -1.5]);
    expect(rounded(moved.max)).toEqual([-0.01, 0.6, 0.53]);
  });

  it("stores each node's average luminance from its texture", () => {
    expect(split.floor.userData.avgLuminance).toBeCloseTo(0.2159, 3);
    expect(split.originals.og_bed.userData.avgLuminance).toBeCloseTo(1, 3);
  });

  it('splits 300k triangles in under 300 ms, and logs the time', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    // 6 faces × 2 × 158² ≈ 300k triangles.
    const big = new Group().add(primitive(box([-2, 0, -1.5], [2, 2.6, 1.5], true, 158), gray));
    splitScan(big, setup, manifest);
    const started = performance.now();
    splitScan(big, setup, manifest);
    const elapsed = performance.now() - started;
    expect(elapsed).toBeLessThan(300);
    expect(info).toHaveBeenLastCalledWith(expect.stringMatching(/^splitScan: 299,568 triangles .* in \d+ ms$/));
    info.mockRestore();
  });
});

describe('splitScan with fill from a Fill Capture (rule 0, ADR-0007)', () => {
  /** A primitive scan-merge added, tagged as it tags them. */
  const tagged = (mesh: TriangleMesh, kind: 'patch' | 'completion', originalId: string) => {
    const fill = primitive(mesh, white);
    fill.userData = { mise: { fill: { kind, originalId, capture: 0 } } };
    return fill;
  };
  // The floor under the lamp, as the Fill Capture saw it, and the back of the bed, which only the Fill Capture
  // saw. The back is within 2 cm of the North wall, where rule 1 would leave it to the wall.
  const lampPatch = tagged(horizontal([0.75, 0.75], [1.25, 1.25], 0.001), 'patch', 'og_lamp');
  const bedBack = tagged(box([-1.8, 0.1, -1.495], [-1.2, 0.5, -1.485]), 'completion', 'og_bed');
  const split = splitScan(new Group().add(room, primitive(box([-2, 0, -1.5], [-1.01, 0.6, 0.53]), white), lampPatch, bedBack), setup, manifest);

  it("puts a Patch's triangles in its own node for that Original, hidden until the Original is lifted or removed", () => {
    expect(Object.keys(split.patches)).toEqual(['og_lamp']);
    expect(triangles(split.patches.og_lamp)).toBe(2);
    expect(split.patches.og_lamp.visible).toBe(false);
    expect(split.patches.og_lamp.userData).toMatchObject({ kind: 'patch', id: 'og_lamp' });
    expect(triangles(split.floor)).toBe(2);
  });

  it('draws a Patch over the Main Capture floor and wall it lies on', () => {
    const [{ mesh }] = meshes(split.patches.og_lamp);
    expect(mesh.material).toMatchObject({ polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  });

  it("adds a completion to its Original's node, so it moves with it", () => {
    expect(triangles(split.originals.og_bed)).toBe(6 + 12);
  });
});
