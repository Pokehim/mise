import { useFrame } from '@react-three/fiber';
import { useLayoutEffect } from 'react';
import type { Object3D } from 'three';
import type { Wall } from '@shared/types';
import { faces } from './floorPlan';
import { forEachMaterial } from './objects';

const FADE_SECONDS = 0.15;

/**
 * Each frame, fades out every Wall node whose inside faces away from the camera, so the Dollhouse
 * view sees into the room (spec §10.2). A faded-out wall is hidden, so it doesn't catch clicks.
 */
export function WallFader({ walls, nodes }: { walls: Wall[]; nodes: Record<string, Object3D> }) {
  useLayoutEffect(() => {
    // splitScan gives every node materials of its own, so fading one wall fades nothing else.
    for (const node of Object.values(nodes)) {
      forEachMaterial(node, (material) => {
        material.transparent = true;
      });
    }
  }, [nodes]);

  useFrame(({ camera }, delta) => {
    for (const wall of walls) {
      const node = nodes[wall.id];
      if (!node) continue;
      const target = faces(wall, [camera.position.x, camera.position.z]) ? 1 : 0;
      const opacity: number = node.userData.opacity ?? 1;
      if (opacity === target) continue;
      const step = delta / FADE_SECONDS;
      const next = target > opacity ? Math.min(target, opacity + step) : Math.max(target, opacity - step);
      node.userData.opacity = next;
      node.visible = next > 0;
      forEachMaterial(node, (material) => {
        material.opacity = next;
      });
    }
  });
  return null;
}
