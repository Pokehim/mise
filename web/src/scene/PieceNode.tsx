import { Bvh, Edges, Shadow, useCursor } from '@react-three/drei';
import { createPortal, useLoader } from '@react-three/fiber';
import { Fragment, memo, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import type { Mesh } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { useShallow } from 'zustand/react/shallow';
import type { CatalogItem, Hex, Vec3 } from '@shared/types';
import { useRealism } from '../state/realism';
import { pieceItem, useEditor } from '../state/store';
import { applyParts, recolorParts } from './applyParts';
import { useDragPiece } from './DragControls';
import { withMeshopt } from './gltf';
import { forEachMaterial, ignoreRaycast } from './objects';
import { liesFlat } from './placement';
import { useSketchLines } from './sketch/SketchLines';
import { token } from './sketch/tokens';

/** A soft radial-gradient plane under a floor Piece: 110% of its footprint at 35% opacity (spec §10.6). */
function BlobShadow({ size: [width, , depth] }: { size: Vec3 }) {
  return <Shadow scale={[width * 1.1, depth * 1.1, 1]} position-y={0.005} opacity={0.35} raycast={ignoreRaycast} />;
}

interface PieceModelProps { item: CatalogItem; partColors: Record<string, Hex> }

/**
 * One Catalog model, its Parts recolored, with ink edges when Sketch lines are on. Memoized, so a
 * drag doesn't re-render it. Its selection is sketched over the scene (sketch/SketchSelection).
 */
const PieceModel = memo(function PieceModel({ item, partColors }: PieceModelProps) {
  const sketchLines = useSketchLines((s) => s.on);
  const gltf = useLoader(GLTFLoader, item.model, withMeshopt);
  // Each Piece gets its own geometry, so Bvh gives each one its own raycast tree, even several
  // Pieces of the same item, and its own material per Part. Textures stay shared.
  const [model, meshes] = useMemo(() => {
    const copy = gltf.scene.clone(true);
    const found: Mesh[] = [];
    copy.traverse((object) => {
      const mesh = object as Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry = mesh.geometry.clone();
      // Shadows show only at the Max level (CastShadows). A rug casts none, and takes those of what
      // stands on it, which the Floor under it can't show.
      mesh.castShadow = !liesFlat(item);
      mesh.receiveShadow = liesFlat(item);
      found.push(mesh);
    });
    applyParts(copy, item.category, item.size, item.partParams);
    return [copy, found] as const;
  }, [gltf, item]);
  useEffect(() => () => {
    meshes.forEach((mesh) => mesh.geometry.dispose());
    forEachMaterial(model, (material) => material.dispose());
  }, [model, meshes]);
  useLayoutEffect(() => recolorParts(model, partColors), [model, partColors]);

  return (
    <>
      <Bvh>
        <primitive object={model} />
      </Bvh>
      {sketchLines && meshes.map((mesh) => (
        <Fragment key={mesh.uuid}>{createPortal(<Edges threshold={30} color={token('--ink')} raycast={ignoreRaycast} />, mesh)}</Fragment>
      ))}
    </>
  );
});

/** A Piece at its placement: its bottom-center origin at position, turned by rotationY. */
export function PieceNode({ pieceId }: { pieceId: string }) {
  const placement = useEditor((s) =>
    s.preview?.pieceId === pieceId ? s.preview.placement : s.roomState!.pieces[pieceId]?.placement);
  const item = useEditor((s) => pieceItem(s, pieceId));
  // Shallow, as replay makes a new partColors object for every Piece on every Edit.
  const partColors = useEditor(useShallow((s) => s.roomState!.pieces[pieceId]?.partColors));
  // Max draws the shadows Pieces really cast instead.
  const showBlobShadow = useRealism() !== 'max';
  const onPointerDown = useDragPiece(pieceId);
  const [hovered, setHovered] = useState(false);
  useCursor(hovered, 'grab');
  if (!placement || !item || !partColors) return null;

  return (
    <group
      name={pieceId}
      position={placement.position}
      rotation-y={placement.rotationY}
      onPointerDown={onPointerDown}
      // Selecting happened on pointerdown; keep the click from reaching the Scan behind.
      onClick={(event) => event.stopPropagation()}
      onPointerOver={(event) => {
        event.stopPropagation();
        setHovered(true);
      }}
      onPointerOut={() => setHovered(false)}
    >
      <PieceModel item={item} partColors={partColors} />
      {showBlobShadow && placement.mount === 'floor' && !liesFlat(item) && <BlobShadow size={item.size} />}
    </group>
  );
}
