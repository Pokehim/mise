import {
  Color, type Material, MeshBasicMaterial, MeshStandardMaterial, ShaderLib, type ShaderLibShader, UniformsUtils,
  type WebGLProgramParametersWithUniforms, type WebGLRenderer,
} from 'three';
import { describe, expect, it } from 'vitest';
import { recolor, recolorTexel } from './recolor';

const sage: [number, number, number] = [0.3, 0.42, 0.25];

describe('recolorTexel', () => {
  it("draws a texel as bright as its Part's average in exactly the target color", () => {
    expect(recolorTexel([0.2, 0.2, 0.2], sage, 0.2)).toEqual(sage);
  });

  it('keeps light and shadow: a texel in shadow at half the average draws half as bright', () => {
    const [r, g, b] = recolorTexel([0.1, 0.1, 0.1], sage, 0.2);
    expect([r, g, b].map((v) => +v.toFixed(4))).toEqual([0.15, 0.21, 0.125]);
  });

  it('brightens a highlight at most to twice the target color', () => {
    const [r, g, b] = recolorTexel([0.9, 0.9, 0.9], sage, 0.2);
    expect([r, g, b].map((v) => +v.toFixed(4))).toEqual([0.6, 0.84, 0.5]);
  });

  it('works from dark to light: a walnut texel at its average draws white', () => {
    // A dark walnut texel, with luminance 0.2126·0.09 + 0.7152·0.04 + 0.0722·0.02 = 0.0492: its Part's average.
    const [r, g, b] = recolorTexel([0.09, 0.04, 0.02], [1, 1, 1], 0.0492);
    expect([r, g, b].map((v) => +v.toFixed(2))).toEqual([1, 1, 1]);
  });
});

/** What three.js does when it compiles a material's program: hands onBeforeCompile the shader. */
function compile(material: Material, { uniforms, vertexShader, fragmentShader }: ShaderLibShader) {
  const shader = { uniforms: UniformsUtils.clone(uniforms), vertexShader, fragmentShader };
  material.onBeforeCompile(shader as WebGLProgramParametersWithUniforms, null as unknown as WebGLRenderer);
  return shader;
}

describe('recolor', () => {
  it.each([
    ['MeshBasicMaterial', () => new MeshBasicMaterial(), ShaderLib.basic],
    ['MeshStandardMaterial', () => new MeshStandardMaterial(), ShaderLib.standard],
  ])("patches a %s's shader to draw the target color, scaled by relLum after the texture and color", (_, make, lib) => {
    const material = make();
    recolor(material, '#9caf88', 0.4);
    const { uniforms, fragmentShader } = compile(material, lib);

    expect(uniforms.uEnabled.value).toBe(true);
    expect(uniforms.uTarget.value).toEqual(new Color('#9caf88'));
    expect(uniforms.uAvgLum.value).toBe(0.4);
    const afterColor = fragmentShader.slice(fragmentShader.indexOf('#include <color_fragment>'));
    expect(afterColor).toMatch(/diffuseColor\.rgb = uTarget \* clamp\(.*\/ uAvgLum, 0\.0, 2\.0\s*\)/);
  });

  it('changes or clears the color of a compiled material without recompiling it', () => {
    const material = new MeshStandardMaterial();
    recolor(material, '#9caf88', 0.4);
    const { uniforms } = compile(material, ShaderLib.standard);
    const version = material.version;

    recolor(material, '#1a1a1a', 0.4);
    expect(uniforms.uTarget.value).toEqual(new Color('#1a1a1a'));
    recolor(material, null, 0.4);
    expect(uniforms.uEnabled.value).toBe(false);
    expect(material.version).toBe(version);
  });

  it('patches a material that has no color yet, turned off, so a color picked later needs no compile', () => {
    const material = new MeshStandardMaterial();
    recolor(material, null, 0.4);
    const { uniforms, fragmentShader } = compile(material, ShaderLib.standard);
    expect(uniforms.uEnabled.value).toBe(false);
    expect(fragmentShader).toContain('uniform bool uEnabled;');
  });
});
