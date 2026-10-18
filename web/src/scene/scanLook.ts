// How a Scan's surfaces look: the captured photo, as sharp as the GPU can sample it.
import { useThree } from '@react-three/fiber';
import { useLayoutEffect } from 'react';
import { LinearFilter, LinearMipmapLinearFilter, type MeshBasicMaterial, SRGBColorSpace, type Texture } from 'three';
import { forEachMaterial } from './objects';
import { type SplitScan, splitNodes } from './splitScan';

/**
 * Sets up every scan node's texture once the Scan is split: sRGB, so its colors decode as they were
 * photographed, and mipmapped, filtered trilinearly, and with the GPU's maximum anisotropy, so the
 * floor and walls stay sharp at the grazing angles the Dollhouse and Walk views see them at. (The
 * materials are already unlit and not tone-mapped: splitScan's `unlit`.)
 */
export function useScanLook(split: SplitScan) {
  const renderer = useThree((s) => s.gl);
  useLayoutEffect(() => {
    const look: Partial<Texture> = {
      colorSpace: SRGBColorSpace, anisotropy: renderer.capabilities.getMaxAnisotropy(), generateMipmaps: true,
      minFilter: LinearMipmapLinearFilter, magFilter: LinearFilter,
    };
    for (const node of splitNodes(split)) {
      forEachMaterial(node, (material) => {
        const map = (material as MeshBasicMaterial).map;
        // The textures belong to the glTF and every split shares them, so only a real change re-uploads one.
        if (!map || Object.entries(look).every(([key, value]) => map[key as keyof Texture] === value)) return;
        Object.assign(map, look);
        map.needsUpdate = true;
      });
    }
  }, [split, renderer]);
}
