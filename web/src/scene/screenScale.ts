import { useFrame } from '@react-three/fiber';
import type { RefObject } from 'react';
import { type Camera, MathUtils, type Object3D, type OrthographicCamera, type PerspectiveCamera, Vector3 } from 'three';

/** A fingertip's target: 44 CSS px, the smallest a touch control should be. A mouse needs less. */
export const touchTargetPx = () => (matchMedia('(pointer: coarse)').matches ? 44 : 24);

/** Whether the Mover asked for less motion: the camera then cuts where it would glide. */
export const prefersReducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

const point = new Vector3();
const inView = new Vector3();

/** How many meters one CSS pixel spans at a point in the view, given the view's height in CSS pixels. */
export function metersPerPixel(camera: Camera, at: Vector3, viewHeight: number) {
  if ((camera as OrthographicCamera).isOrthographicCamera) {
    const { top, bottom, zoom } = camera as OrthographicCamera;
    return (top - bottom) / zoom / viewHeight;
  }
  // The depth along the view, not the distance: off-center, a handle is no smaller on screen.
  const depth = -inView.copy(at).applyMatrix4(camera.matrixWorldInverse).z;
  return (2 * Math.max(depth, 0.01) * Math.tan(MathUtils.degToRad((camera as PerspectiveCamera).fov) / 2)) / viewHeight;
}

/**
 * Scales an object each frame so that one of its units spans `px` CSS pixels on screen, whatever the
 * zoom: for handles that must stay the same size to grab. Its parents must not be scaled.
 */
export function useScreenScale(ref: RefObject<Object3D | null>, px: number) {
  useFrame(({ camera, size }) => {
    const object = ref.current;
    if (!object) return;
    object.scale.setScalar(px * metersPerPixel(camera, object.getWorldPosition(point), size.height));
  });
}
