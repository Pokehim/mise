// Small hand-built meshes for the geometry tests.
import type { Vec3 } from '@shared/types';
import { type TriangleMesh, meshOf } from './mesh';

type Tri = [Vec3, Vec3, Vec3];

/** Triangles a-b-c and a-c-d, counter-clockwise seen from the front, or a grid of n × n such pairs. */
function quad(a: Vec3, b: Vec3, c: Vec3, d: Vec3, n = 1): Tri[] {
  // The point at (i, j) / n across the quad, from a toward b (i) and toward d (j).
  const at = (i: number, j: number): Vec3 => [0, 1, 2].map((k) =>
    a[k] + (i / n) * (b[k] - a[k]) + (j / n) * (d[k] - a[k]) + (i / n) * (j / n) * (a[k] - b[k] + c[k] - d[k])) as Vec3;
  const tris: Tri[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) tris.push([at(i, j), at(i + 1, j), at(i + 1, j + 1)], [at(i, j), at(i + 1, j + 1), at(i, j + 1)]);
  }
  return tris;
}

/** A horizontal rectangle at height y, facing up, or down when `down` is set. */
export function horizontal([x0, z0]: [number, number], [x1, z1]: [number, number], y: number, down = false) {
  const tris = quad([x0, y, z0], [x0, y, z1], [x1, y, z1], [x1, y, z0]);
  return meshOf(down ? flip(tris) : tris);
}

/**
 * An axis-aligned box with its faces pointing out, or into the box when `inward` is set. Each face
 * is a grid of `segments` × `segments` quads.
 */
export function box([x0, y0, z0]: Vec3, [x1, y1, z1]: Vec3, inward = false, segments = 1): TriangleMesh {
  const n = segments;
  const tris = [
    ...quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], n), // +y
    ...quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], n), // -y
    ...quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], n), // +x
    ...quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], n), // -x
    ...quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], n), // +z
    ...quad([x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0], n), // -z
  ];
  return meshOf(inward ? flip(tris) : tris);
}

/** The mesh rotated about +Y by `angle` radians, as three.js rotates an object. */
export function rotateY(mesh: TriangleMesh, angle: number): TriangleMesh {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const positions = mesh.positions.slice();
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i];
    const z = positions[i + 2];
    positions[i] = c * x + s * z;
    positions[i + 2] = -s * x + c * z;
  }
  return { positions, index: mesh.index };
}

const flip = (tris: Tri[]): Tri[] => tris.map(([a, b, c]) => [a, c, b]);

export const degrees = (d: number) => (d * Math.PI) / 180;
