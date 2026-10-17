import type { Intersection, Material, Mesh, Object3D } from 'three';

/** How far, in pixels, a press may move and still be a click rather than a drag. R3F uses the same. */
export const CLICK_TOLERANCE_PX = 2;

/** A raycast for helper meshes, such as blob shadows, that must never catch the pointer. */
export const ignoreRaycast = () => null;

/**
 * Whether a raycast hit is on something actually drawn. three.js raycasts also hit hidden objects
 * (faded walls, replaced Originals) and parts cut away by clipping (the Dollhouse view's ceiling).
 */
export function isDrawn({ object, point, face }: Intersection) {
  for (let o: Object3D | null = object; o; o = o.parent) if (!o.visible) return false;
  const { material } = object as Mesh;
  const hitMaterial = Array.isArray(material) ? material[face?.materialIndex ?? 0] : material;
  return (hitMaterial?.clippingPlanes ?? []).every((plane) => plane.distanceToPoint(point) >= 0);
}

/** Calls visit on every material under root; a material that visit returns replaces the one visited. */
export function forEachMaterial(root: Object3D, visit: (material: Material) => Material | void) {
  root.traverse((object) => {
    const mesh = object as Mesh;
    if (!mesh.isMesh) return;
    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map((material) => visit(material) ?? material)
      : visit(mesh.material) ?? mesh.material;
  });
}
