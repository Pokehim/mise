import {
  Color, type Material, MeshBasicMaterial, MeshStandardMaterial, ShaderLib, type ShaderLibShader, Texture, UniformsUtils,
  type WebGLProgramParametersWithUniforms, type WebGLRenderer,
} from 'three';
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';
import type { LibraryMaterial } from '@shared/types';
import { applyFinish, finishTexel, loadedTextureCount, textureSource, triplanarUvs, triplanarWeights } from './triplanar';

const oak: LibraryMaterial = { id: 'oak', name: 'Oak', kind: 'wood', maps: { color: '/data/materials/oak.jpg' }, tileSize: 1.83, source: 'Poly Haven oak_veneer_01 (CC0)' };
const carpet: LibraryMaterial = { id: 'carpet-grey', name: 'Grey carpet', kind: 'carpet', maps: { color: '/data/materials/carpet-grey.jpg' }, tileSize: 1, source: 'ambientCG Carpet001 (CC0)' };
// Only the tests of loading use these two: textures are loaded once, so their URLs are never loaded before.
const marble: LibraryMaterial = { id: 'marble', name: 'Marble', kind: 'stone', maps: { color: '/data/materials/marble.jpg' }, tileSize: 1.5, source: 'ambientCG Marble005 (CC0)' };
const leather: LibraryMaterial = { id: 'leather', name: 'Leather', kind: 'fabric', maps: { color: '/data/materials/leather.jpg' }, tileSize: 0.4, source: 'Poly Haven brown_leather (CC0)' };
const library = new Map([oak, carpet, marble, leather].map((material) => [material.id, material]));

describe('triplanarWeights', () => {
  it('takes the color of a surface facing along an axis from the plane across that axis', () => {
    expect(triplanarWeights([0, 1, 0])).toEqual([0, 1, 0]);
    expect(triplanarWeights([-1, 0, 0])).toEqual([1, 0, 0]);
  });

  it('blends the planes at a corner, to a total of 1', () => {
    const weights = triplanarWeights([1, 1, 1].map((c) => c / Math.sqrt(3)) as [number, number, number]);
    expect(weights.map((w) => +w.toFixed(4))).toEqual([0.3333, 0.3333, 0.3333]);
    const [x, y, z] = triplanarWeights([0.6, 0.8, 0]);
    expect(x + y + z).toBeCloseTo(1);
    expect(y).toBeGreaterThan(x);
  });
});

describe('triplanarUvs', () => {
  it('reads the texture at tileSize meters per repeat, upright on a wall', () => {
    const [onX, onY, onZ] = triplanarUvs([2, 1, 3], 2);
    expect(onX).toEqual([1.5, 0.5]);   // a wall facing along X: (z, y)
    expect(onY).toEqual([1, 1.5]);     // a floor: (x, z)
    expect(onZ).toEqual([1, 0.5]);     // a wall facing along Z: (x, y)
  });

  it("doesn't stretch a texture that isn't square: one repeat is tileSize wide and as tall as the texture is", () => {
    const [onX] = triplanarUvs([0, 1, 1], 1, 2);   // twice as wide as it is tall
    expect(onX).toEqual([1, 2]);
  });
});

describe('finishTexel', () => {
  const wood: [number, number, number] = [0.4, 0.25, 0.12];

  it("draws a texel as bright as its surface's average in exactly the material's color", () => {
    expect(finishTexel([0.2, 0.2, 0.2], wood, 0.2)).toEqual(wood);
  });

  it('keeps light and shadow: a texel in shadow at half the average draws the material half as bright', () => {
    const [r, g, b] = finishTexel([0.1, 0.1, 0.1], wood, 0.2);
    expect([r, g, b].map((v) => +v.toFixed(4))).toEqual([0.2, 0.125, 0.06]);
  });

  it('brightens a highlight at most to twice the material', () => {
    const [r, g, b] = finishTexel([0.9, 0.9, 0.9], wood, 0.2);
    expect([r, g, b].map((v) => +v.toFixed(4))).toEqual([0.8, 0.5, 0.24]);
  });

  it('multiplies by the tint', () => {
    expect(finishTexel([0.2, 0.2, 0.2], [1, 1, 1], 0.2, [0.5, 0.25, 1])).toEqual([0.5, 0.25, 1]);
  });
});

/** What three.js does when it compiles a material's program: hands onBeforeCompile the shader. */
function compile(material: Material, { uniforms, vertexShader, fragmentShader }: ShaderLibShader) {
  const shader = { uniforms: UniformsUtils.clone(uniforms), vertexShader, fragmentShader };
  material.onBeforeCompile(shader as WebGLProgramParametersWithUniforms, null as unknown as WebGLRenderer);
  return shader;
}

describe('applyFinish', () => {
  let load: MockInstance<typeof textureSource.load>;
  beforeEach(() => {
    load = vi.spyOn(textureSource, 'load').mockImplementation((_, onLoad) => {
      const texture = new Texture();
      onLoad(texture);
      return texture;
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it.each([
    ['MeshBasicMaterial', () => new MeshBasicMaterial(), ShaderLib.basic],
    ['MeshStandardMaterial', () => new MeshStandardMaterial(), ShaderLib.standard],
  ])("patches a %s's shader to project the material after recolor's block, and to pass the world position", (_, make, lib) => {
    const material = make();
    applyFinish(material, { kind: 'material', materialId: 'oak', tint: '#ffffff' }, 0.4, library);
    const { uniforms, vertexShader, fragmentShader } = compile(material, lib);

    expect(uniforms.uMatEnabled.value).toBe(true);
    expect(uniforms.uMatTile.value).toBe(1.83);
    expect(uniforms.uMatMap.value).toBeInstanceOf(Texture);
    expect(uniforms.uAvgLum.value).toBe(0.4);   // recolor's, which the material block divides by
    expect(uniforms.uEnabled.value).toBe(false);
    expect(vertexShader).toMatch(/vFinishPos = \( modelMatrix \* vec4\( transformed, 1\.0 \) \)\.xyz;/);

    const afterColor = fragmentShader.slice(fragmentShader.indexOf('#include <color_fragment>'));
    expect(afterColor.indexOf('if ( uEnabled )')).toBeGreaterThan(-1);
    expect(afterColor.indexOf('if ( uMatEnabled )')).toBeGreaterThan(afterColor.indexOf('if ( uEnabled )'));
    expect(afterColor).toMatch(/diffuseColor\.rgb = finishColor \* uMatTint \* clamp\(.*\/ uAvgLum, 0\.0, 2\.0\s*\)/);
    expect(fragmentShader.match(/#include <color_fragment>/g)).toHaveLength(1);
  });

  it('gives every material the same patch function, so they all share one compiled program', () => {
    const [a, b] = [new MeshBasicMaterial(), new MeshBasicMaterial()];
    applyFinish(a, { kind: 'material', materialId: 'oak' }, 0.4, library);
    applyFinish(b, undefined, 0.2, library);
    expect(a.onBeforeCompile).toBe(b.onBeforeCompile);
    expect(a.onBeforeCompile.toString()).toBe(b.onBeforeCompile.toString());
  });

  it('switches between a material, a paint color and the scanned look without recompiling', () => {
    const material = new MeshBasicMaterial();
    applyFinish(material, undefined, 0.4, library);
    const { uniforms } = compile(material, ShaderLib.basic);
    const version = material.version;

    applyFinish(material, { kind: 'material', materialId: 'carpet-grey' }, 0.4, library);
    expect([uniforms.uMatEnabled.value, uniforms.uEnabled.value, uniforms.uMatTile.value]).toEqual([true, false, 1]);
    applyFinish(material, { kind: 'paint', color: '#9caf88' }, 0.4, library);
    expect([uniforms.uMatEnabled.value, uniforms.uEnabled.value]).toEqual([false, true]);
    expect(uniforms.uTarget.value).toEqual(new Color('#9caf88'));
    applyFinish(material, { kind: 'none' }, 0.4, library);
    expect([uniforms.uMatEnabled.value, uniforms.uEnabled.value]).toEqual([false, false]);
    expect(material.version).toBe(version);
  });

  it('tints the material', () => {
    const material = new MeshBasicMaterial();
    applyFinish(material, { kind: 'material', materialId: 'oak', tint: '#808080' }, 0.4, library);
    const { uniforms } = compile(material, ShaderLib.basic);
    expect(uniforms.uMatTint.value).toEqual(new Color('#808080'));
  });

  it('keeps the surface as scanned until the texture has loaded, then counts it as loaded', () => {
    const loaded: (() => void)[] = [];
    load.mockImplementation((_, onLoad) => {
      loaded.push(() => onLoad(new Texture()));
      return new Texture();
    });
    const material = new MeshBasicMaterial();
    applyFinish(material, { kind: 'material', materialId: 'leather' }, 0.4, library);
    const { uniforms } = compile(material, ShaderLib.basic);
    expect(uniforms.uMatEnabled.value).toBe(false);
    const before = loadedTextureCount();
    loaded[0]();
    expect(uniforms.uMatEnabled.value).toBe(true);
    expect(loadedTextureCount()).toBe(before + 1);
  });

  it('draws nothing of a material that is no longer chosen when its texture arrives', () => {
    const loaded: (() => void)[] = [];
    load.mockImplementation((_, onLoad) => {
      loaded.push(() => onLoad(new Texture()));
      return new Texture();
    });
    const material = new MeshBasicMaterial();
    applyFinish(material, { kind: 'material', materialId: 'marble' }, 0.4, library);
    const { uniforms } = compile(material, ShaderLib.basic);
    expect(uniforms.uMatEnabled.value).toBe(false);

    applyFinish(material, { kind: 'none' }, 0.4, library);   // another Finish is chosen first
    loaded[0]();
    expect(uniforms.uMatEnabled.value).toBe(false);
  });

  it('shows a material as scanned while the Material Library loads, and warns of one that is not in it', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const material = new MeshBasicMaterial();
    applyFinish(material, { kind: 'material', materialId: 'oak' }, 0.4, null);
    const { uniforms } = compile(material, ShaderLib.basic);
    expect(uniforms.uMatEnabled.value).toBe(false);
    expect(warn).not.toHaveBeenCalled();

    applyFinish(material, { kind: 'material', materialId: 'plaid' }, 0.4, library);
    expect(uniforms.uMatEnabled.value).toBe(false);
    expect(warn).toHaveBeenCalledWith('No material "plaid" in the Material Library');
  });
});
