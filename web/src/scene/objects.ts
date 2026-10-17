import type { Material, Mesh, Object3D } from 'three';

/** Whether an object and all its parents are visible. Raycasts in three.js include hidden objects. */
export function isShown(object: Object3D | null) {
  for (; object; object = object.parent) if (!object.visible) return false;
  return true;
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
