import { Bvh, Shadow, useCursor } from '@react-three/drei';
import { createPortal, useLoader } from '@react-three/fiber';
import { Fragment, memo, useEffect, useMemo, useState } from 'react';
import type { Mesh } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Vec3 } from '@shared/types';
import { pieceItem, useEditor } from '../state/store';
import { useDragPiece } from './DragControls';
import { withMeshopt } from './gltf';
import { ignoreRaycast } from './objects';
import { liesFlat } from './placement';
import { Outline } from './SelectionOutline';

/** A soft radial-gradient plane under a floor Piece: 110% of its footprint at 35% opacity (spec §10.6). */
function BlobShadow({ size: [width, , depth] }: { size: Vec3 }) {
  return <Shadow scale={[width * 1.1, depth * 1.1, 1]} position-y={0.005} opacity={0.35} raycast={ignoreRaycast} />;
}

/** One Catalog model, outlined when selected. Memoized, so a drag doesn't re-render it. */
const PieceModel = memo(function PieceModel({ url, selected }: { url: string; selected: boolean }) {
  const gltf = useLoader(GLTFLoader, url, withMeshopt);
  // Each Piece gets its own geometry, so Bvh gives each one its own raycast tree, even several
  // Pieces of the same item. Materials and textures stay shared.
  const [model, meshes] = useMemo(() => {
    const copy = gltf.scene.clone(true);
    const found: Mesh[] = [];
    copy.traverse((object) => {
      const mesh = object as Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry = mesh.geometry.clone();
      found.push(mesh);
    });
    return [copy, found] as const;
  }, [gltf]);
  useEffect(() => () => meshes.forEach((mesh) => mesh.geometry.dispose()), [meshes]);

  return (
    <>
      <Bvh>
        <primitive object={model} />
      </Bvh>
      {selected && meshes.map((mesh) => <Fragment key={mesh.uuid}>{createPortal(<Outline />, mesh)}</Fragment>)}
    </>
  );
});

/** A Piece at its placement: its bottom-center origin at position, turned by rotationY. */
export function PieceNode({ pieceId }: { pieceId: string }) {
  const placement = useEditor((s) =>
    s.preview?.pieceId === pieceId ? s.preview.placement : s.roomState!.pieces[pieceId]?.placement);
  const item = useEditor((s) => pieceItem(s, pieceId));
  const selected = useEditor((s) => s.selection?.kind === 'piece' && s.selection.id === pieceId);
  const onPointerDown = useDragPiece(pieceId);
  const [hovered, setHovered] = useState(false);
  useCursor(hovered, 'grab');
  if (!placement || !item) return null;

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
      <PieceModel url={item.model} selected={selected} />
      {placement.mount === 'floor' && !liesFlat(item) && <BlobShadow size={item.size} />}
    </group>
  );
}
