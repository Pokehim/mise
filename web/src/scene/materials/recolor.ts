// Recolor and Paint that keep the room's real lighting (spec §10.6). Walls, Originals and the Parts
// of Pieces all draw through the same shader patch.
import { Color, type IUniform, type Material, MathUtils, type WebGLProgramParametersWithUniforms } from 'three';
import type { Hex } from '@shared/types';
import { luminance } from '../../setup/geometry/color';

type RGB = [r: number, g: number, b: number];

/** The brightest a highlight gets: this many times the target color. */
const MAX_GAIN = 2;

/**
 * The color recolor draws for a texel, in linear light: the target color, scaled by how much
 * brighter or darker the texel is than its Part's average, up to MAX_GAIN. That keeps the light
 * and shadow, and drops the old color. The shader does the same math on the GPU.
 */
export function recolorTexel(texel: RGB, target: RGB, avgLuminance: number): RGB {
  const relLum = MathUtils.clamp(luminance(...texel) / avgLuminance, 0, MAX_GAIN);
  return target.map((channel) => channel * relLum) as RGB;
}

interface RecolorUniforms {
  uEnabled: IUniform<boolean>;
  uTarget: IUniform<Color>;
  uAvgLum: IUniform<number>;
}

// recolorTexel in GLSL. diffuseColor is the texel times the material's color, which is what
// avgLuminance averages; three.js defines luminance() with the same Rec. 709 weights.
const DECLARATIONS = 'uniform bool uEnabled;\nuniform vec3 uTarget;\nuniform float uAvgLum;\n';
const COLOR_CHUNK = '#include <color_fragment>';
const RECOLOR = `${COLOR_CHUNK}
if ( uEnabled ) {
  diffuseColor.rgb = uTarget * clamp( luminance( diffuseColor.rgb ) / uAvgLum, 0.0, ${MAX_GAIN.toFixed(1)} );
}`;

const uniformsOf = new WeakMap<Material, RecolorUniforms>();

// One function for every patched material, so they all share one compiled program.
function patchShader(this: Material, shader: WebGLProgramParametersWithUniforms) {
  Object.assign(shader.uniforms, uniformsOf.get(this));
  shader.fragmentShader = DECLARATIONS + shader.fragmentShader.replace(COLOR_CHUNK, RECOLOR);
}

/**
 * Draws a MeshBasicMaterial or MeshStandardMaterial in `color`, keeping the light and shadow of
 * its texture, or as it was when `color` is null. `avgLuminance` is the average luminance of the
 * Part, Wall or Original it draws (spec §9.4). The first call patches the shader, so call it when
 * the material is loaded: it then compiles once, with the patch, and picking or clearing a color
 * later only sets uniforms.
 */
export function recolor(material: Material, color: Hex | null, avgLuminance: number) {
  let uniforms = uniformsOf.get(material);
  if (!uniforms) {
    uniforms = { uEnabled: { value: false }, uTarget: { value: new Color() }, uAvgLum: { value: 1 } };
    uniformsOf.set(material, uniforms);
    material.onBeforeCompile = patchShader;
    material.needsUpdate = true;
  }
  uniforms.uEnabled.value = color !== null;
  if (color !== null) uniforms.uTarget.value.set(color);
  uniforms.uAvgLum.value = avgLuminance;
}
