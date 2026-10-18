import type { Intersection, Material, Mesh, Object3D } from 'three';

/**
 * How far, in pixels, a press may move and still be a click rather than a drag. A fingertip rolls a
 * few pixels on a tap that a mouse never moves; a mouse keeps R3F's own 2 px (its onPointerMissed).
 */
const CLICK_TOLERANCE_PX: Record<string, number> = { mouse: 2, pen: 6, touch: 10 };
let pressedWith = 'mouse';
// Captured before anything else sees the press, so a click handler reads the pointer that made it.
// (Optional: tests import this module where there is no window.)
globalThis.addEventListener?.('pointerdown', (event) => void (pressedWith = (event as PointerEvent).pointerType), { capture: true, passive: true });

/** The click tolerance, in pixels, for the pointer of the latest press. */
export const clickTolerancePx = () => CLICK_TOLERANCE_PX[pressedWith] ?? CLICK_TOLERANCE_PX.mouse;

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
