import type { Vec3 } from '@shared/types';
import { mulberry32 } from '../materials/luminance';

// The geometry of the sketch overlays: hand-drawn boxes and pencil loops. Plain numbers, no three.js,
// so a drag or a camera move only picks among shapes made once.

/** A random in [0, 1) seeded by a string (FNV-1a): the same item always gets the same wobble. */
function seeded(seed: string) {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) hash = Math.imul(hash ^ seed.charCodeAt(i), 16777619);
  return mulberry32(hash);
}

/** How far a hand-drawn edge runs past its corners, in meters: the crossing corners of a sketch. */
const OVERSHOOT = 0.035;
/** How far a hand-drawn edge bows from straight, as a share of its length. */
const BOW = 0.006;
const STEPS = 6;

/** A box's faces, as the axis and side each one faces: +x, −x, +y, −y, +z, −z. */
const FACES: [axis: 0 | 1 | 2, side: 1 | -1][] = [[0, 1], [0, -1], [1, 1], [1, -1], [2, 1], [2, -1]];

/** One edge of a box: its points as drawn, and the two faces it joins (indices into FACES). */
interface SketchEdge { points: Vec3[]; faces: [number, number] }

/**
 * The 12 edges of a box with its bottom-center at the origin, drawn by hand: each runs a little past
 * its corners and bows slightly, by a wobble seeded from `seed`. Top edges first, then the
 * uprights, then the bottom, the order a hand would draw them in.
 */
export function sketchBox([width, height, depth]: Vec3, seed: string): SketchEdge[] {
  const random = seeded(seed);
  const half = [width / 2, height / 2, depth / 2];
  const corner = (sx: number, sy: number, sz: number): Vec3 => [sx * half[0], half[1] + sy * half[1], sz * half[2]];
  const face = (axis: number, side: number) => FACES.findIndex(([a, s]) => a === axis && s === side);
  const edges: SketchEdge[] = [];
  // An edge along `axis`, at the given signs of the other two axes.
  const edge = (axis: 0 | 1 | 2, a: number, b: number) => {
    const [u, v] = [0, 1, 2].filter((other) => other !== axis) as [number, number];
    const signs = (along: number) => {
      const s = [0, 0, 0];
      s[axis] = along;
      s[u] = a;
      s[v] = b;
      return s as Vec3;
    };
    const [start, end] = [corner(...signs(-1)), corner(...signs(1))];
    const length = Math.abs(end[axis] - start[axis]);
    const over = Math.min(OVERSHOOT, length * 0.15) * (0.6 + 0.8 * random());
    // Bow toward the outside of one of the two faces the edge joins.
    const bowAxis = random() < 0.5 ? u : v;
    const bow = BOW * length * (random() < 0.5 ? -1 : 1);
    const points = Array.from({ length: STEPS + 1 }, (_, i): Vec3 => {
      const t = i / STEPS;
      const p: Vec3 = [...start];
      p[axis] = start[axis] - over + (length + 2 * over) * t;
      p[bowAxis] += bow * Math.sin(Math.PI * t);
      return p;
    });
    edges.push({ points, faces: [face(u, a), face(v, b)] });
  };
  for (const z of [1, -1]) edge(0, 1, z);                                 // top, along x
  for (const x of [1, -1]) edge(2, x, 1);                                 // top, along z
  for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) edge(1, x, z);   // uprights
  for (const z of [1, -1]) edge(0, -1, z);                                // bottom, along x
  for (const x of [1, -1]) edge(2, x, -1);                                // bottom, along z
  return edges;
}

/**
 * Which faces of a box (bottom-center at the origin) face a viewpoint, as a bit per face of FACES.
 * An edge shows when either of its faces does: the hidden lines of a sketch are left out.
 */
export function facingMask([x, y, z]: Vec3, [width, height, depth]: Vec3) {
  const outside = [x > width / 2, x < -width / 2, y > height, y < 0, z > depth / 2, z < -depth / 2];
  return outside.reduce((mask, out, i) => (out ? mask | (1 << i) : mask), 0);
}

/** The visible edges of a box, as line segments (pairs of points), and their total length. */
export function visibleSegments(edges: SketchEdge[], mask: number): { segments: Vec3[]; length: number } {
  const segments: Vec3[] = [];
  let length = 0;
  for (const { points, faces: [a, b] } of edges) {
    if (!(mask & ((1 << a) | (1 << b)))) continue;
    for (let i = 1; i < points.length; i++) {
      segments.push(points[i - 1], points[i]);
      length += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1], points[i][2] - points[i - 1][2]);
    }
  }
  return { segments, length };
}

/** The 12 edges of a box with its bottom-center at the origin, ruled straight: a guide, not a sketch. */
export function boxEdges([width, height, depth]: Vec3): Vec3[] {
  const [x, z] = [width / 2, depth / 2];
  const ring = (y: number): Vec3[] => [[-x, y, -z], [x, y, -z], [x, y, -z], [x, y, z], [x, y, z], [-x, y, z], [-x, y, z], [-x, y, -z]];
  const posts = [[-x, -z], [x, -z], [x, z], [-x, z]].flatMap(([px, pz]): Vec3[] => [[px, 0, pz], [px, height, pz]]);
  return [...ring(0), ...ring(height), ...posts];
}

/**
 * A red-pencil loop around an ellipse of radii rx, ry (pixels), as an SVG path centered on the
 * origin. Like a loop drawn by hand: it goes round once and a bit, and doesn't close on itself.
 */
export function pencilLoop(rx: number, ry: number, seed: string) {
  const random = seeded(seed);
  const start = -Math.PI * (0.55 + 0.2 * random());
  const turn = Math.PI * (2.18 + 0.1 * random());
  const phase = random() * Math.PI * 2;
  const steps = 40;
  let d = '';
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const angle = start + turn * t;
    // A slight lopsidedness, and the end of the stroke riding a little outside its start.
    const r = (1 + 0.035 * Math.sin(2 * angle + phase)) * (1 + 0.07 * t);
    d += `${i ? 'L' : 'M'}${(Math.cos(angle) * rx * r).toFixed(1)} ${(Math.sin(angle) * ry * r).toFixed(1)}`;
  }
  return d;
}
