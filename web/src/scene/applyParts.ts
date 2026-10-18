// Parts at load time (spec §7, ADR-0006): each mesh's triangles sorted by Part, one geometry group
// and one material per Part, so a Part can be recolored without the others.
import { BufferAttribute, type Material, Mesh, type Object3D } from 'three';
import { assignPart, partsFor } from '@shared/parts';
import type { Category, Finish, Hex, LibraryMaterial, PartParams, Vec3 } from '@shared/types';
import { newTriangleInfo, triangleInfo } from '../setup/geometry/mesh';
import { meshTriangles, toFrame } from '../setup/sceneTriangles';
import { averageLuminance } from './materials/luminance';
import { recolor } from './materials/recolor';
import { applyFinish } from './materials/triplanar';
import { forEachMaterial } from './objects';

/** The userData of each Part's material. */
interface PartMaterialData {
  partId: string;
  /** The Part's average luminance over all the object's meshes, for recolor's relLum (spec §10.6). */
  avgLuminance: number;
}

/**
 * Splits every mesh under `object` into its Parts, by the category's rule (spec §7). The rule runs in
 * the object's own frame: bottom-center origin, +Z front, `size` its box's [w, h, d].
 *
 * Each mesh's index is sorted by Part, in `partsFor` order, with one geometry group per Part. Each
 * group gets its own clone of the mesh's material, sharing its texture; the mesh's own material is
 * left as it was. Each clone's userData is a PartMaterialData. Meshes with an array of materials
 * are left out: glTF primitives and splitScan's meshes have one.
 */
export function applyParts(object: Object3D, category: Category, size: Vec3, partParams?: PartParams) {
  const parts = partsFor(category).map(({ id }) => id);
  const meshes = sortByPart(object, parts, (centroid, normal) => assignPart(category, size, partParams, centroid, normal));
  const averages = parts.map((_, p) => averageLuminance(meshes.map(({ mesh, byPart }) =>
    ({ material: mesh.material as Material, uv: mesh.geometry.attributes.uv, index: byPart[p] }))));

  for (const { mesh, byPart } of meshes) {
    const source = mesh.material as Material;
    const materials: Material[] = [];
    let start = 0;
    byPart.forEach((index, p) => {
      if (index.length === 0) return;
      mesh.geometry.addGroup(start, index.length, materials.length);
      start += index.length;
      const material = source.clone();
      // The same planes, not copies, so the Parts stay clipped where the mesh is when a plane moves.
      material.clippingPlanes = source.clippingPlanes;
      Object.assign(material.userData, { partId: parts[p], avgLuminance: averages[p] } satisfies PartMaterialData);
      materials.push(material);
    });
    mesh.material = materials;
  }
}

/**
 * Draws each Part of an object that applyParts split in its color, or as it was when it has none.
 * With `finishes` (an Original's), a Part's Finish is drawn instead of its color (spec §11.1). A Master
 * Copy's Original may have a '*' color or Finish for the whole item (replay), which a Part's own replaces.
 */
export function recolorParts(
  object: Object3D, partColors: Record<string, Hex>,
  finishes?: { partFinishes: Record<string, Finish>; library: ReadonlyMap<string, LibraryMaterial> | null },
) {
  forEachMaterial(object, (material) => {
    const { partId, avgLuminance } = material.userData as Partial<PartMaterialData>;
    if (partId === undefined) return;
    const { partFinishes = {}, library = null } = finishes ?? {};
    const finish = partFinishes[partId] ?? paintOf(partColors[partId]) ?? partFinishes['*'] ?? paintOf(partColors['*']);
    if (finishes) applyFinish(material, finish, avgLuminance!, library);
    else recolor(material, partColors[partId] ?? partColors['*'] ?? null, avgLuminance!);
  });
}

const paintOf = (color?: Hex): Finish | undefined => (color ? { kind: 'paint', color } : undefined);

/**
 * Gives each mesh under the object a new index, its triangles sorted by Part in their original
 * order within each Part, and returns each Part's range of it.
 */
function sortByPart(object: Object3D, parts: string[], partOf: (centroid: Vec3, normal: Vec3) => string) {
  const matrixOf = toFrame(object);
  const info = newTriangleInfo();
  const meshes: { mesh: Mesh; byPart: Uint32Array[] }[] = [];

  object.traverse((mesh) => {
    if (!(mesh instanceof Mesh) || Array.isArray(mesh.material)) return;
    const triangles = meshTriangles(mesh, matrixOf(mesh));
    const { index } = triangles;
    const count = index.length / 3;
    const part = new Uint8Array(count);   // all Part 0 when the category has one
    const counts = new Uint32Array(parts.length);
    for (let t = 0; t < count; t++) {
      if (parts.length > 1) {
        const { cx, cy, cz, nx, ny, nz } = triangleInfo(triangles, t, info);
        part[t] = parts.indexOf(partOf([cx, cy, cz], [nx, ny, nz]));
      }
      counts[part[t]]++;
    }

    const sorted = new Uint32Array(index.length);
    let start = 0;
    const byPart = Array.from(counts, (n) => sorted.subarray(start, (start += 3 * n)));
    const filled = new Uint32Array(parts.length);
    for (let t = 0; t < count; t++) {
      const p = part[t];
      for (let v = 0; v < 3; v++) byPart[p][filled[p] + v] = index[3 * t + v];
      filled[p] += 3;
    }
    mesh.geometry.setIndex(new BufferAttribute(sorted, 1));
    mesh.geometry.clearGroups();
    meshes.push({ mesh, byPart });
  });
  return meshes;
}
