import { useEffect, useMemo } from 'react';
import { Color, type Object3D, ShaderMaterial, Vector2 } from 'three';
import { useShallow } from 'zustand/react/shallow';
import type { Original } from '@shared/types';
import { useEditor } from '../state/store';
import { ignoreRaycast } from './objects';

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

/**
 * A simple Patch at the footprint of every Original that was lifted away, replaced or removed, and
 * has no Patch from a Fill Capture in `captured`: the simple Patch is only their fallback (§10.6).
 */
export function Patches({ captured }: { captured: Record<string, Object3D> }) {
  const ids = useEditor(useShallow((s) => s.roomState!.patches));
  const originals = useEditor((s) => s.setup!.originals);
  return (
    <group name="patches">
      {originals.filter(({ id }) => ids.includes(id) && !captured[id]).map((original) => <Patch key={original.id} original={original} />)}
    </group>
  );
}
