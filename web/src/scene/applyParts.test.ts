import {
  BufferAttribute, BufferGeometry, DataTexture, Group, type Material, Mesh, MeshBasicMaterial, MeshStandardMaterial, Plane,
  Vector3,
} from 'three';
import { describe, expect, it } from 'vitest';
import type { Vec3 } from '@shared/types';
import { meshOf } from '../setup/geometry/mesh';
import { applyParts } from './applyParts';

type Tri = [Vec3, Vec3, Vec3];

/** A flat triangle facing up at height y, around the floor point (x, z). */
const flat = (x: number, y: number, z: number): Tri => [[x, y, z], [x + 0.05, y, z], [x, y, z - 0.05]];

/** A 1 × 0.75 × 0.5 m desk, its Parts interleaved: legs, top, legs, top. */
const deskSize: Vec3 = [1, 0.75, 0.5];
const deskTriangles = [flat(-0.4, 0.3, 0), flat(0, 0.75, 0), flat(0.4, 0.3, 0), flat(0, 0.74, 0.1)];

/** A mesh of the triangles. With `us`, every corner of triangle t has the UV (us[t], 0.5). */
function meshOfTriangles(triangles: Tri[], material: Material = new MeshStandardMaterial(), us?: number[]) {
  const { positions, index } = meshOf(triangles);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  if (us) geometry.setAttribute('uv', new BufferAttribute(new Float32Array(us.flatMap((u) => [u, 0.5, u, 0.5, u, 0.5])), 2));
  geometry.setIndex(new BufferAttribute(index, 1));
  return new Mesh<BufferGeometry, Material | Material[]>(geometry, material);
}

/** A 2 × 1 sRGB texture: white on the left half (u < 0.5), and sRGB gray 64 on the right. */
function whiteAndDark() {
  const map = new DataTexture(new Uint8Array([255, 255, 255, 255, 64, 64, 64, 255]), 2, 1);
  map.flipY = false;
  return map;
}
// sRGB 64 is 0.0513 in linear light.
const DARK = 0.0513;

const avgLuminanceByPart = (mesh: Mesh) =>
  Object.fromEntries((mesh.material as MeshStandardMaterial[]).map(({ userData }) => [userData.partId, userData.avgLuminance]));

/** The heights of the triangles in each geometry group, by the Part of the group's material. */
function heightsByPart(mesh: Mesh) {
  const { index, attributes: { position } } = mesh.geometry;
  const materials = mesh.material as MeshStandardMaterial[];
  return Object.fromEntries(mesh.geometry.groups.map(({ start, count, materialIndex }) => {
    const heights = [];
    for (let i = start; i < start + count; i += 3) heights.push(+position.getY(index!.getX(i)).toFixed(2));
    return [materials[materialIndex!].userData.partId, heights];
  }));
}

describe('applyParts', () => {
  it("sorts a desk's triangles into one geometry group per Part, in partsFor order", () => {
    const mesh = meshOfTriangles(deskTriangles);
    applyParts(mesh, 'desk', deskSize);
    expect(heightsByPart(mesh)).toEqual({ top: [0.75, 0.74], legs: [0.3, 0.3] });
    expect(mesh.geometry.groups.map(({ start, count }) => [start, count])).toEqual([[0, 6], [6, 6]]);
  });

  it("follows the item's partParams, such as a thicker top", () => {
    const mesh = meshOfTriangles(deskTriangles);
    applyParts(mesh, 'desk', deskSize, { topThickness: 0.5 });
    expect(heightsByPart(mesh)).toEqual({ top: [0.3, 0.75, 0.3, 0.74] });
  });

  it("runs the rule in the object's own frame, as on an Original's node from splitScan", () => {
    // A 0.8 × 0.75 × 0.5 m dresser against the East wall, turned to face West. Like splitScan's
    // node, its origin is the box's bottom-center and its content holds room-frame triangles.
    const node = new Group();
    node.position.set(1.52, 0, 0);
    node.rotation.y = -Math.PI / 2;
    node.updateMatrix();
    const content = new Group();
    content.applyMatrix4(node.matrix.clone().invert());
    node.add(content);
    // In the dresser's own frame: a triangle on its front (+Z) at 0.5 m up, one on its back at 0.2 m.
    const front: Tri = [[-0.1, 0.5, 0.25], [0.1, 0.5, 0.25], [0, 0.6, 0.25]];
    const back: Tri = [[0.1, 0.2, -0.25], [-0.1, 0.2, -0.25], [0, 0.3, -0.25]];
    const toRoom = (tri: Tri) => tri.map((p) => new Vector3(...p).applyMatrix4(node.matrix).toArray()) as Tri;
    const mesh = meshOfTriangles([front, back].map(toRoom));
    content.add(mesh);

    applyParts(node, 'dresser', [0.8, 0.75, 0.5]);
    expect(heightsByPart(mesh)).toEqual({ body: [0.2], fronts: [0.5] });
  });

  it("gives each Part its own material, sharing the texture and leaving the mesh's material as it was", () => {
    const map = new DataTexture(new Uint8Array(4).fill(255), 1, 1);
    const shared = new MeshStandardMaterial({ map, color: '#808080' });
    const mesh = meshOfTriangles(deskTriangles, shared);
    applyParts(mesh, 'desk', deskSize);

    const [top, legs] = mesh.material as MeshStandardMaterial[];
    expect(top).not.toBe(legs);
    expect([top, legs]).not.toContain(shared);
    expect([top.map, legs.map]).toEqual([map, map]);
    expect(shared.userData).toEqual({});
  });

  it("keeps its Parts clipped by the mesh's clipping planes as they move, like the Dollhouse's ceiling cut", () => {
    const ceiling = new Plane(new Vector3(0, -1, 0), 2.55);
    const mesh = meshOfTriangles(deskTriangles, new MeshBasicMaterial({ clippingPlanes: [ceiling] }));
    applyParts(mesh, 'desk', deskSize);
    ceiling.constant = 1e6;   // the Walk view
    expect((mesh.material as MeshBasicMaterial[]).map((m) => m.clippingPlanes![0].constant)).toEqual([1e6, 1e6]);
  });

  it("stores each Part's average luminance, from its texture at its triangles' UVs", () => {
    // The legs are on the dark half of the texture, and the top on the white half.
    const mesh = meshOfTriangles(deskTriangles, new MeshStandardMaterial({ map: whiteAndDark() }), [0.75, 0.25, 0.75, 0.25]);
    applyParts(mesh, 'desk', deskSize);
    const averages = avgLuminanceByPart(mesh);
    expect(averages.top).toBeCloseTo(1, 3);
    expect(averages.legs).toBeCloseTo(DARK, 3);
  });

  it("averages a Part over all of the object's meshes, so a lighter mesh stays lighter once recolored", () => {
    // One half of the desk in a white part of the texture, the other half in a dark part, as when
    // a scanned Original spans two texture atlases.
    const map = whiteAndDark();
    const light = meshOfTriangles(deskTriangles, new MeshStandardMaterial({ map }), [0.25, 0.25, 0.25, 0.25]);
    const dark = meshOfTriangles(deskTriangles, new MeshStandardMaterial({ map }), [0.75, 0.75, 0.75, 0.75]);
    applyParts(new Group().add(light, dark), 'desk', deskSize);
    expect(avgLuminanceByPart(light).top).toBeCloseTo((1 + DARK) / 2, 3);
    expect(avgLuminanceByPart(dark).top).toBeCloseTo((1 + DARK) / 2, 3);
  });
});
