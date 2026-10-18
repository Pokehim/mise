import type { Vec3 } from '@shared/types';

/** Triangles in one frame: x, y, z per vertex, and three vertex indices per triangle. */
export interface TriangleMesh {
  positions: Float32Array;
  index: Uint32Array;
}

/** A mesh from a list of triangles, each given as its three corners. */
export function meshOf(triangles: [Vec3, Vec3, Vec3][]): TriangleMesh {
  const positions = new Float32Array(triangles.flat(2));
  return { positions, index: Uint32Array.from(positions.subarray(0, positions.length / 3), (_, i) => i) };
}

/** Several meshes as one. */
export function mergeMeshes(meshes: TriangleMesh[]): TriangleMesh {
  const positions = new Float32Array(meshes.reduce((n, m) => n + m.positions.length, 0));
  const index = new Uint32Array(meshes.reduce((n, m) => n + m.index.length, 0));
  let p = 0;
  let i = 0;
  for (const mesh of meshes) {
    const base = p / 3;
    positions.set(mesh.positions, p);
    for (let k = 0; k < mesh.index.length; k++) index[i + k] = mesh.index[k] + base;
    p += mesh.positions.length;
    i += mesh.index.length;
  }
  return { positions, index };
}

/** The centroid, unit normal and area of one triangle, written into `out` to avoid allocating. */
export interface TriangleInfo { cx: number; cy: number; cz: number; nx: number; ny: number; nz: number; area: number }

export function triangleInfo(mesh: TriangleMesh, t: number, out: TriangleInfo): TriangleInfo {
  const { positions: p, index } = mesh;
  const a = index[3 * t] * 3;
  const b = index[3 * t + 1] * 3;
  const c = index[3 * t + 2] * 3;
  const abx = p[b] - p[a], aby = p[b + 1] - p[a + 1], abz = p[b + 2] - p[a + 2];
  const acx = p[c] - p[a], acy = p[c + 1] - p[a + 1], acz = p[c + 2] - p[a + 2];
  const nx = aby * acz - abz * acy;
  const ny = abz * acx - abx * acz;
  const nz = abx * acy - aby * acx;
  const len = Math.hypot(nx, ny, nz);
  out.cx = (p[a] + p[b] + p[c]) / 3;
  out.cy = (p[a + 1] + p[b + 1] + p[c + 1]) / 3;
  out.cz = (p[a + 2] + p[b + 2] + p[c + 2]) / 3;
  out.nx = len > 0 ? nx / len : 0;
  out.ny = len > 0 ? ny / len : 0;
  out.nz = len > 0 ? nz / len : 0;
  out.area = len / 2;
  return out;
}

export const newTriangleInfo = (): TriangleInfo => ({ cx: 0, cy: 0, cz: 0, nx: 0, ny: 0, nz: 0, area: 0 });

/** Meters rounded to millimeters (and −0 to 0), which keeps float noise such as 0.4000000059604645 out of setup.json. */
export const mm = (v: number) => Math.round(v * 1000) / 1000 + 0;
