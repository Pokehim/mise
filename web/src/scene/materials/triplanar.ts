// Finishes with a material from the Material Library (spec §11.1), drawn through the same shader
// patch as Recolor and Paint (spec §10.6): the Walls, the Floor and the Parts of Originals.
import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  Color, type IUniform, type Material, MeshBasicMaterial, RepeatWrapping, SRGBColorSpace, type Texture, TextureLoader,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import type { Finish, LibraryMaterial, Vec3 } from '@shared/types';
import { recolor, recolorTexel } from './recolor';

type RGB = [r: number, g: number, b: number];
type Vec2 = [u: number, v: number];

/** How sharply the three planes' samples blend: the weights are |normal| to this power. */
const BLEND_SHARPNESS = 4;

/**
 * How much each of the three planes (YZ, XZ, XY) counts on a surface with this normal: the
 * normal's components to BLEND_SHARPNESS, scaled to add up to 1. A surface facing along an axis
 * takes all of its color from the plane across that axis.
 */
export function triplanarWeights(normal: Vec3): Vec3 {
  const [x, y, z] = normal.map((c) => Math.abs(c) ** BLEND_SHARPNESS);
  const sum = x + y + z;
  return [x / sum, y / sum, z / sum];
}

/**
 * Where a world position falls in the texture on each of the three planes, in repeats: a surface
 * facing along X reads the texture at (z, y), along Y at (x, z), along Z at (x, y), so the texture
 * stands upright on a Wall. `tileSize` is the meters one repeat is wide, and `aspect` the texture's
 * width over its height, so a texture that isn't square isn't stretched.
 */
export function triplanarUvs([x, y, z]: Vec3, tileSize: number, aspect = 1): [Vec2, Vec2, Vec2] {
  const uv = (u: number, v: number): Vec2 => [u / tileSize, (v / tileSize) * aspect];
  return [uv(z, y), uv(x, z), uv(x, y)];
}

/**
 * The color a Finish with a material draws for a texel of the Scan, in linear light: the material's
 * texel (times the tint, if any), scaled by how much brighter or darker the Scan's texel is than its
 * Wall's, Floor's or Part's average, as in recolor. The shader does the same math on the GPU.
 */
export function finishTexel(scanTexel: RGB, materialTexel: RGB, avgLuminance: number, tint: RGB = [1, 1, 1]): RGB {
  return recolorTexel(scanTexel, materialTexel.map((channel, i) => channel * tint[i]) as RGB, avgLuminance);
}

/* ───────────── The shader patch ───────────── */

interface FinishUniforms {
  uMatEnabled: IUniform<boolean>;
  uMatMap: IUniform<Texture | null>;
  /** The meters one repeat of the texture is wide. */
  uMatTile: IUniform<number>;
  uMatTint: IUniform<Color>;
  /**
   * How much of the surface's own texture shows through the material: 1 for a Scan, whose texture
   * holds its light, 0 for a room with no Capture (ADR-0010), whose light is in a light map instead.
   */
  uMatDetail: IUniform<number>;
}

// The world position and normal of each fragment. The normal is the mesh's, when it has one, and the
// face's otherwise, from the screen-space derivatives of the position.
const VERTEX_DECLARATIONS = 'varying vec3 vFinishPos;\nvarying vec3 vFinishNormal;\n';
const BEGIN_VERTEX = '#include <begin_vertex>';
const VERTEX = `${BEGIN_VERTEX}
vFinishPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
vFinishNormal = mat3( modelMatrix ) * normal;`;

// triplanarWeights, triplanarUvs and finishTexel in GLSL. It follows recolor's block, whose uAvgLum
// and luminance of diffuseColor (the texel times the material's color) it uses.
const FRAGMENT_DECLARATIONS = `varying vec3 vFinishPos;
varying vec3 vFinishNormal;
uniform bool uMatEnabled;
uniform sampler2D uMatMap;
uniform float uMatTile;
uniform vec3 uMatTint;
uniform float uMatDetail;
`;
const COLOR_CHUNK = '#include <color_fragment>';
const FRAGMENT = `${COLOR_CHUNK}
if ( uMatEnabled ) {
  vec3 faceNormal = normalize( cross( dFdx( vFinishPos ), dFdy( vFinishPos ) ) );
  vec3 finishNormal = dot( vFinishNormal, vFinishNormal ) > 0.01 ? normalize( vFinishNormal ) : faceNormal;
  vec3 w = pow( abs( finishNormal ), vec3( ${BLEND_SHARPNESS.toFixed(1)} ) );
  w /= w.x + w.y + w.z;
  vec2 size = vec2( textureSize( uMatMap, 0 ) );
  vec2 tiles = vec2( 1.0, size.x / size.y ) / uMatTile;
  vec3 finishColor =
    texture2D( uMatMap, vFinishPos.zy * tiles ).rgb * w.x +
    texture2D( uMatMap, vFinishPos.xz * tiles ).rgb * w.y +
    texture2D( uMatMap, vFinishPos.xy * tiles ).rgb * w.z;
  diffuseColor.rgb = finishColor * uMatTint * mix( 1.0, clamp( luminance( diffuseColor.rgb ) / uAvgLum, 0.0, 2.0 ), uMatDetail );
}`;

// recolor.ts keeps its patch to itself, so this takes it from a material it has patched. It is the
// same function for every material, which is what lets them share one compiled program.
const recolorPatch = (() => {
  const probe = new MeshBasicMaterial();
  recolor(probe, null, 1);
  probe.dispose();
  return probe.onBeforeCompile;
})();

const uniformsOf = new WeakMap<Material, FinishUniforms>();

// One function for every patched material, so they all share one compiled program, whatever they draw.
// It adds this file's code after recolor's, which then adds its own after the same chunk: the Finish
// with a material, the paint and the scanned look are each only a uniform apart.
function patchShader(this: Material, shader: WebGLProgramParametersWithUniforms) {
  Object.assign(shader.uniforms, uniformsOf.get(this));
  shader.vertexShader = VERTEX_DECLARATIONS + shader.vertexShader.replace(BEGIN_VERTEX, VERTEX);
  shader.fragmentShader = FRAGMENT_DECLARATIONS + shader.fragmentShader.replace(COLOR_CHUNK, FRAGMENT);
  recolorPatch.call(this, shader, null as never);
}

/**
 * Draws a MeshBasicMaterial or MeshStandardMaterial with a Finish, keeping the light and shadow of
 * its texture: a material of the library, a paint color (as recolor draws it), or, when `finish` is
 * undefined or none, as it was. `library` is null until the Material Library has loaded: a material waits for it,
 * and shows as scanned. `avgLuminance` is the average luminance of the Part, Wall or Floor it
 * draws (spec §9.4). The first call patches the shader, so call it when the material is loaded: it
 * then compiles once, with the patch, and choosing a Finish later only sets uniforms.
 */
export function applyFinish(
  material: Material, finish: Finish | undefined, avgLuminance: number, library: ReadonlyMap<string, LibraryMaterial> | null,
) {
  let uniforms = uniformsOf.get(material);
  if (!uniforms) {
    uniforms = {
      uMatEnabled: { value: false }, uMatMap: { value: null }, uMatTile: { value: 1 }, uMatTint: { value: new Color(1, 1, 1) },
      uMatDetail: { value: material.userData.finishDetail ?? 1 },
    };
    uniformsOf.set(material, uniforms);
    recolor(material, null, avgLuminance);   // its uniforms, and the patch ours chains to
    material.onBeforeCompile = patchShader;
    material.needsUpdate = true;
  }
  recolor(material, finish?.kind === 'paint' ? finish.color : null, avgLuminance);

  const libraryMaterial = finish?.kind === 'material' ? library?.get(finish.materialId) : undefined;
  if (finish?.kind === 'material' && library && !libraryMaterial) console.warn(`No material "${finish.materialId}" in the Material Library`);
  // The surface stays as scanned until the texture is there, instead of drawing black.
  const texture = libraryMaterial && textureFor(libraryMaterial.maps.color);
  uniforms.uMatEnabled.value = false;
  uniforms.uMatMap.value = texture ?? null;
  if (finish?.kind === 'material' && libraryMaterial && texture) {
    uniforms.uMatTile.value = libraryMaterial.tileSize;
    uniforms.uMatTint.value.set(finish.tint ?? '#ffffff');
    // Unless another Finish has been chosen in the meantime.
    whenLoaded(libraryMaterial.maps.color, () => { if (uniforms.uMatMap.value === texture) uniforms.uMatEnabled.value = true; });
  }
}

/* ───────────── The library ───────────── */

/** Loads textures; tests replace `load`, since there is no image decoding outside a browser. */
export const textureSource = {
  load(url: string, onLoad: (texture: Texture) => void): Texture {
    return new TextureLoader().load(url, onLoad);
  },
};

interface TextureEntry { texture: Texture; loaded: boolean; waiting: (() => void)[] }
const textures = new Map<string, TextureEntry>();
let texturesLoaded = 0;
const onTextureLoaded = new Set<() => void>();

/** The texture at a URL: loaded once, then kept. */
function textureFor(url: string): Texture {
  let entry = textures.get(url);
  if (!entry) {
    const created: TextureEntry = { texture: undefined as unknown as Texture, loaded: false, waiting: [] };
    created.texture = textureSource.load(url, () => {
      created.loaded = true;
      created.waiting.splice(0).forEach((callback) => callback());
      texturesLoaded++;
      onTextureLoaded.forEach((listener) => listener());
    });
    created.texture.wrapS = created.texture.wrapT = RepeatWrapping;
    created.texture.colorSpace = SRGBColorSpace;   // the color map is sRGB; the shader gets it in linear light
    created.texture.anisotropy = 8;                // a floor is seen at a grazing angle
    textures.set(url, (entry = created));
  }
  return entry.texture;
}

/**
 * How many Material Library textures have loaded so far. It goes up as a material Finish starts to
 * show, which can be a moment after its Edit, so whatever draws from the Scan's look (the room
 * light) knows to look again.
 */
export const loadedTextureCount = () => texturesLoaded;

/** loadedTextureCount, kept current in a React component. */
export function useLoadedTextureCount() {
  return useSyncExternalStore((listener) => {
    onTextureLoaded.add(listener);
    return () => {
      onTextureLoaded.delete(listener);
    };
  }, loadedTextureCount);
}

/** Calls back once the texture at the URL (see textureFor) has loaded, which may be now. */
function whenLoaded(url: string, callback: () => void) {
  const entry = textures.get(url)!;
  if (entry.loaded) callback();
  else entry.waiting.push(callback);
}

/** A material's thumbnail, for the Finish picker's swatches: data/materials/thumbs/<id>.jpg (see materials-build). */
export const materialThumbnail = ({ id }: LibraryMaterial) => `/data/materials/thumbs/${id}.jpg`;

let library: Promise<ReadonlyMap<string, LibraryMaterial>> | undefined;
let loadedLibrary: ReadonlyMap<string, LibraryMaterial> | null = null;

/** The Material Library by id, fetched once. */
export function loadMaterialLibrary() {
  library ??= fetch('/data/materials/materials.json')
    .then((res) => (res.ok ? (res.json() as Promise<LibraryMaterial[]>) : Promise.reject(new Error(`GET materials.json: ${res.status}`))))
    .then((materials) => (loadedLibrary = new Map(materials.map((material) => [material.id, material] as const))))
    .catch((error) => {
      library = undefined;   // try again next time
      throw error;
    });
  return library;
}

/** The Material Library once it has loaded, and null until then: from the first render, once it has loaded before. */
export function useMaterialLibrary(): ReadonlyMap<string, LibraryMaterial> | null {
  const [loaded, setLoaded] = useState(loadedLibrary);
  useEffect(() => {
    loadMaterialLibrary().then(setLoaded, (error) => console.warn('Could not load the Material Library', error));
  }, []);
  return loaded;
}
