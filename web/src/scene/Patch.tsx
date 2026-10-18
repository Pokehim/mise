import { useEffect, useMemo, useState } from 'react';
import { Color, type Object3D, ShaderMaterial, SRGBColorSpace, type Texture, TextureLoader, Vector2 } from 'three';
import { useShallow } from 'zustand/react/shallow';
import { wallPoint } from '@shared/geometry';
import type { Original, Wall } from '@shared/types';
import { scanFileUrl } from '../api';
import { useEditor } from '../state/store';
import { wallRotationY } from './floorPlan';
import { ignoreRaycast } from './objects';
import { floorFrame, wallFrame } from './patchFrames';

/**
 * How far past the footprint a Patch reaches on every side (spec §10.6), as §11.2 measures margins.
 * It fades out over its outer FEATHER, so it stays solid over the Original's contact shadow, which
 * §11.2 puts within 5 cm of the footprint.
 */
const MARGIN = 0.1;
/** How far in from its edge a Patch fades from clear to solid. */
const FEATHER = 0.05;
const CORNER_RADIUS = 0.08;
/** Just above the floor (spec §10.6), and below a Piece's blob shadow at 5 mm. */
const HEIGHT = 0.002;
/** How far in front of its wall a baked wall image hangs (spec §11.2). */
const WALL_OFFSET = 0.002;

// A rounded rectangle in the floor color, its alpha feathered by its signed distance to the edge.
// The plane is centered and in meters, so a vertex's position is its point on the Patch.
const vertexShader = /* glsl */ `
varying vec2 vPoint;
void main() {
  vPoint = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const fragmentShader = /* glsl */ `
uniform vec3 uColor;
uniform vec2 uHalfSize;
varying vec2 vPoint;
const float RADIUS = ${CORNER_RADIUS.toFixed(3)};
void main() {
  vec2 q = abs(vPoint) - uHalfSize + RADIUS;
  float outside = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - RADIUS;
  gl_FragColor = vec4(uColor, 1.0 - smoothstep(-${FEATHER.toFixed(3)}, 0.0, outside));
  #include <colorspace_fragment>
}`;

/**
 * The simple Patch (spec §10.6): a rounded rectangle on the floor, in the Original's floorColor,
 * covering the footprint it left plus MARGIN, with a feathered edge.
 */
function Patch({ original: { box, floorColor } }: { original: Original }) {
  const [width, depth] = [box.size[0] + 2 * MARGIN, box.size[2] + 2 * MARGIN];
  const material = useMemo(() => new ShaderMaterial({
    uniforms: {
      uColor: { value: new Color(floorColor) },
      uHalfSize: { value: new Vector2(width / 2, depth / 2) },
    },
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  }), [floorColor, width, depth]);
  useEffect(() => () => material.dispose(), [material]);

  const [x, , z] = box.position;
  return (
    <group position={[x, HEIGHT, z]} rotation-y={box.rotationY}>
      {/* Drawn first of the see-through things, so the blob shadow of a Piece standing on it shows. */}
      <mesh rotation-x={-Math.PI / 2} material={material} renderOrder={-1} raycast={ignoreRaycast}>
        <planeGeometry args={[width, depth]} />
      </mesh>
    </group>
  );
}

/** The baked Patch images (spec §11.2) of one Original, as textures. */
interface BakedImages { floor?: Texture; walls: Record<string, Texture> }
const NO_IMAGES: BakedImages = { walls: {} };

/**
 * Loads the images `original.patch` names, without suspending: none until they are loaded, and a
 * file that isn't there is left out, as if it had never been baked. So the simple Patch can stand in.
 */
function useBakedImages(scanId: string, patch: Original['patch']): BakedImages {
  const [images, setImages] = useState<BakedImages>(NO_IMAGES);
  useEffect(() => {
    if (!patch) {
      setImages(NO_IMAGES);
      return;
    }
    let cancelled = false;
    const textures: Texture[] = [];
    const load = (path: string | undefined) => new Promise<Texture | undefined>((resolve) => {
      if (!path) return resolve(undefined);
      const texture = new TextureLoader().load(scanFileUrl(scanId, path), () => resolve(texture), undefined, () => resolve(undefined));
      texture.colorSpace = SRGBColorSpace;
      textures.push(texture);
    });
    setImages(NO_IMAGES);
    Promise.all([
      load(patch.floor),
      ...Object.entries(patch.walls ?? {}).map(async ([wallId, path]) => [wallId, await load(path)] as const),
    ]).then(([floor, ...walls]) => {
      if (!cancelled) setImages({ floor, walls: Object.fromEntries(walls.filter(([, texture]) => texture)) as Record<string, Texture> });
    });
    return () => {
      cancelled = true;
      textures.forEach((texture) => texture.dispose());
    };
  }, [scanId, patch]);
  return images;
}

// A baked image carries its own feathered edge in its alpha, and its seen pixels match what they lie on.
// So a captured Patch drawn over it hides its middle, and nothing shows a seam.
const decal = { transparent: true, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 } as const;

/** The baked floor image: a square on the floor, North up (patchFrames.ts). */
function FloorDecal({ original: { box }, texture }: { original: Original; texture: Texture }) {
  const frame = floorFrame(box);
  if (!frame) return null;
  return (
    <mesh position={[frame.center[0], HEIGHT, frame.center[1]]} rotation-x={-Math.PI / 2} renderOrder={-1} raycast={ignoreRaycast}>
      <planeGeometry args={[frame.side, frame.side]} />
      <meshBasicMaterial map={texture} {...decal} />
    </mesh>
  );
}

/** A baked wall image, WALL_OFFSET in front of its Wall and facing into the room, so a Wall that fades takes it along. */
function WallDecal({ original: { box }, wall, texture }: { original: Original; wall: Wall; texture: Texture }) {
  const frame = wallFrame(box, wall);
  if (!frame) return null;
  const [width, height] = [frame.along[1] - frame.along[0], frame.up[1] - frame.up[0]];
  const [x, z] = wallPoint(wall, (frame.along[0] + frame.along[1]) / 2, WALL_OFFSET);
  return (
    <mesh position={[x, (frame.up[0] + frame.up[1]) / 2, z]} rotation-y={wallRotationY(wall)} renderOrder={-1} raycast={ignoreRaycast}>
      <planeGeometry args={[width, height]} />
      <meshBasicMaterial map={texture} {...decal} />
    </mesh>
  );
}

/**
 * What covers the spot of one Original that was moved, replaced or removed: the baked images where
 * Patch v2 filled the gaps no Capture saw (under the captured Patch, which ScanMesh shows), and else,
 * when it has neither a captured Patch nor a baked image, the simple Patch.
 */
function OriginalPatch({ original, captured }: { original: Original; captured: boolean }) {
  const scanId = useEditor((s) => s.manifest!.id);
  const walls = useEditor((s) => s.setup!.walls);
  const { floor, walls: wallImages } = useBakedImages(scanId, original.patch);
  const baked = !!floor || Object.keys(wallImages).length > 0;
  return (
    <>
      {floor && <FloorDecal original={original} texture={floor} />}
      {walls.filter(({ id }) => wallImages[id]).map((wall) => <WallDecal key={wall.id} original={original} wall={wall} texture={wallImages[wall.id]} />)}
      {/* While a baked image loads, or if its file is missing, the simple Patch holds the spot. */}
      {!captured && !baked && <Patch original={original} />}
    </>
  );
}

/**
 * The Patch of every Original that was moved, replaced or removed (spec §10.6, §11.2): the baked
 * images, and a simple Patch as the fallback when it has no Patch from a Fill Capture in `captured`
 * and no baked image.
 */
export function Patches({ captured }: { captured: Record<string, Object3D> }) {
  const ids = useEditor(useShallow((s) => s.roomState!.patches));
  const originals = useEditor((s) => s.setup!.originals);
  return (
    <group name="patches">
      {originals.filter(({ id }) => ids.includes(id)).map((original) => (
        <OriginalPatch key={original.id} original={original} captured={!!captured[original.id]} />
      ))}
    </group>
  );
}
