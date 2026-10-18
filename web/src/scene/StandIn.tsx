import { useLoader } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo } from 'react';
import type { Mesh, Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { useShallow } from 'zustand/react/shallow';
import type { CatalogItem, Vec3 } from '@shared/types';
import { useEditor } from '../state/store';
import { applyParts, recolorParts } from './applyParts';
import { withMeshopt } from './gltf';
import { useMaterialLibrary } from './materials/triplanar';
import { forEachMaterial } from './objects';

/**
 * An Original's Stand-in (ADR-0011): the Catalog model drawn in place of geometry no Capture saw,
 * scaled to the Original's box. It's a child of the Original's node, whose own box stays the thing
 * you click and drag, but isn't drawn (OriginalNode). Its Parts take the Original's Recolors and
 * Finishes, like a Piece's.
 */
export function StandIn({ originalId, item, size }: { originalId: string; item: CatalogItem; size: Vec3 }) {
  const gltf = useLoader(GLTFLoader, item.model, withMeshopt);
  const model = useMemo(() => {
    const copy = gltf.scene.clone(true);
    copy.traverse((object) => {
      const mesh = object as Mesh;
      if (mesh.isMesh) mesh.geometry = mesh.geometry.clone();
    });
    // In the item's own frame and size, as the Part rules expect, then scaled to the Original's box.
    applyParts(copy, item.category, item.size, item.partParams);
    copy.scale.set(size[0] / item.size[0], size[1] / item.size[1], size[2] / item.size[2]);
    return copy;
  }, [gltf, item, size]);
  useEffect(() => () => {
    model.traverse((object) => (object as Mesh).isMesh && (object as Mesh).geometry.dispose());
    forEachMaterial(model, (material) => material.dispose());
  }, [model]);

  const partColors = useEditor(useShallow((s) => s.roomState!.originals[originalId]?.partColors ?? {}));
  const partFinishes = useEditor(useShallow((s) => s.roomState!.originals[originalId]?.partFinishes ?? {}));
  const library = useMaterialLibrary();
  useLayoutEffect(() => recolorParts(model, partColors, { partFinishes, library }), [model, partColors, partFinishes, library]);

  return <primitive object={model} />;
}

/** Hides an Original's own box while its Stand-in draws it; the box still catches the pointer. */
export function hideBox(node: Object3D, hidden: boolean) {
  const mesh = node as Mesh;
  if (!mesh.isMesh) return;
  for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) material.visible = !hidden;
}
