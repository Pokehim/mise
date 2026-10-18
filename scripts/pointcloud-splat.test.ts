import { describe, expect, it } from 'vitest';
import { encodeSplatPly, parsePointCloud, type PointCloud, voxelize } from './pointcloud-splat';

/** A Polycam-style point cloud: double x, y, z and uchar red, green, blue per vertex. */
function polycamPly(points: [x: number, y: number, z: number, r: number, g: number, b: number][], extraHeader = '') {
  const header = [
    'ply', 'format binary_little_endian 1.0', 'comment Created by Polycam', `element vertex ${points.length}`,
    'property double x', 'property double y', 'property double z',
    'property uchar red', 'property uchar green', 'property uchar blue', extraHeader, 'end_header', '',
  ].filter((line, i, all) => line || i === all.length - 1).join('\n');
  const body = Buffer.alloc(points.length * 27);
  points.forEach(([x, y, z, r, g, b], i) => {
    body.writeDoubleLE(x, i * 27);
    body.writeDoubleLE(y, i * 27 + 8);
    body.writeDoubleLE(z, i * 27 + 16);
    body.writeUInt8(r, i * 27 + 24);
    body.writeUInt8(g, i * 27 + 25);
    body.writeUInt8(b, i * 27 + 26);
  });
  return Buffer.concat([Buffer.from(header, 'latin1'), body]);
}

/** Reads back a file that encodeSplatPly wrote: its property names and float values per splat. */
function readSplatPly(file: Buffer) {
  const end = file.indexOf('end_header\n') + 'end_header\n'.length;
  const header = file.subarray(0, end).toString('latin1').split('\n');
  const names = header.filter((line) => line.startsWith('property float ')).map((line) => line.split(' ')[2]);
  const count = Number(header.find((line) => line.startsWith('element vertex '))!.split(' ')[2]);
  const values = new Float32Array(file.buffer.slice(file.byteOffset + end, file.byteOffset + file.length));
  const splats = Array.from({ length: count }, (_, i) =>
    Object.fromEntries(names.map((name, p) => [name, values[i * names.length + p]])));
  return { names, count, splats };
}

describe('parsePointCloud', () => {
  it('reads positions and colors from a Polycam PLY', () => {
    const cloud = parsePointCloud(polycamPly([[1.5, -2, 0.25, 255, 128, 0], [0, 0, 1, 10, 20, 30]]));
    expect(cloud.count).toBe(2);
    expect([...cloud.positions]).toEqual([1.5, -2, 0.25, 0, 0, 1]);
    expect([...cloud.colors]).toEqual([255, 128, 0, 10, 20, 30]);
  });

  it('ignores elements after the vertex element', () => {
    const cloud = parsePointCloud(polycamPly([[1, 2, 3, 4, 5, 6]], 'element face 0\nproperty list uchar int vertex_indices'));
    expect([...cloud.positions]).toEqual([1, 2, 3]);
  });

  it('rejects ASCII PLYs and point clouds without colors', () => {
    expect(() => parsePointCloud(Buffer.from('ply\nformat ascii 1.0\nend_header\n'))).toThrow(/binary little-endian/);
    const noColor = Buffer.from('ply\nformat binary_little_endian 1.0\nelement vertex 0\nproperty float x\nproperty float y\nproperty float z\nend_header\n');
    expect(() => parsePointCloud(noColor)).toThrow(/no "red" property/);
  });
});

describe('voxelize', () => {
  it('averages each voxel and turns Z-up into Y-up', () => {
    const cloud: PointCloud = {
      count: 3,
      // Two points share the first 1 cm voxel; the third is in another one.
      positions: new Float64Array([0.001, 0.002, 0.003, 0.003, 0.004, 0.005, 0.5, 1, 2]),
      colors: new Uint8Array([100, 0, 50, 200, 0, 51, 7, 8, 9]),
    };
    const out = voxelize(cloud, 0.01);
    expect(out.count).toBe(2);
    // Polycam (x, y, z) → GLB (x, z, −y).
    expect([...out.positions].map((v) => +v.toFixed(6))).toEqual([0.002, 0.004, -0.003, 0.5, 2, -1]);
    expect([...out.colors]).toEqual([150, 0, 51, 7, 8, 9]);
  });
});

describe('encodeSplatPly', () => {
  it('writes standard 3DGS fields that decode back to the point color and the voxel size', () => {
    const cloud: PointCloud = { count: 1, positions: new Float64Array([1, 2, 3]), colors: new Uint8Array([255, 0, 128]) };
    const { names, count, splats: [splat] } = readSplatPly(encodeSplatPly(cloud, 0.02));
    expect(names).toEqual([
      'x', 'y', 'z', 'f_dc_0', 'f_dc_1', 'f_dc_2', 'opacity', 'scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3',
    ]);
    expect(count).toBe(1);
    expect([splat.x, splat.y, splat.z]).toEqual([1, 2, 3]);
    const SH_C0 = 0.28209479177387814;
    // Renderers clamp the decoded color to 0–1.
    const decode = (dc: number) => Math.round(Math.min(1, Math.max(0, 0.5 + SH_C0 * dc)) * 255);
    expect([splat.f_dc_0, splat.f_dc_1, splat.f_dc_2].map(decode)).toEqual([255, 0, 128]);
    expect(1 / (1 + Math.exp(-splat.opacity))).toBeCloseTo(0.95, 5);
    expect(Math.exp(splat.scale_0)).toBeCloseTo(0.01, 6); // half the voxel
    expect([splat.rot_0, splat.rot_1, splat.rot_2, splat.rot_3]).toEqual([1, 0, 0, 0]);
  });
});
