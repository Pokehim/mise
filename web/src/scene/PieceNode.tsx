import { Bvh, Shadow } from '@react-three/drei';
import { useLoader } from '@react-three/fiber';
import { useMemo } from 'react';
import type { Vec3 } from '@shared/types';
import { useEditor } from '../state/store';
import { GLTFLoader, withMeshopt } from './gltf';

const ignoreRaycast = () => null;

/** A soft radial-gradient plane under a floor Piece: 110% of its footprint at 35% opacity (spec §10.6). */
function BlobShadow({ size: [width, , depth] }: { size: Vec3 }) {
  return <Shadow scale={[width * 1.1, depth * 1.1, 1]} position-y={0.005} opacity={0.35} raycast={ignoreRaycast} />;
}

/** One Catalog model. Pieces of the same item share its geometry and materials. */
function PieceModel({ url }: { url: string }) {
  const gltf = useLoader(GLTFLoader, url, withMeshopt);
  const model = useMemo(() => gltf.scene.clone(true), [gltf]);
  return (
    <Bvh>
      <primitive object={model} />
    </Bvh>
  );
}

/** A Piece at its placement: its bottom-center origin at position, turned by rotationY. */
export function PieceNode({ pieceId }: { pieceId: string }) {
  const placement = useEditor((s) =>
    s.preview?.pieceId === pieceId ? s.preview.placement : s.roomState!.pieces[pieceId]?.placement);
  const item = useEditor((s) => {
    const piece = s.roomState!.pieces[pieceId];
    return piece && s.catalog!.items.find(({ id }) => id === piece.catalogId);
  });
  if (!placement || !item) return null;

  return (
    <group name={pieceId} position={placement.position} rotation-y={placement.rotationY}>
      <PieceModel url={item.model} />
      {placement.mount === 'floor' && item.category !== 'rug' && <BlobShadow size={item.size} />}
    </group>
  );
}
