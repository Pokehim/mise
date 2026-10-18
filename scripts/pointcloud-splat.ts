// Polycam point cloud PLY → a stand-in Splat PLY, for building Phase 3 before a real splat exists. Run with --help for usage.
//
// Each occupied voxel becomes one round Gaussian with the voxel's average position and color. It is no photoreal
// trained splat: a point cloud has no view-dependent color, opacity, or shape to learn from. It does load anywhere a
// Splat PLY does (Spark, SuperSplat, splat-transform), in the mesh's own coordinates.
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

/** 1 cm voxels keep a Polycam room scan under spec §2's 1.5M splats. */
const VOXEL = 0.01;
/** Gaussian standard deviation per voxel size: enough overlap that a wall reads as solid, not as dots. */
const SIGMA_PER_VOXEL = 0.5;
const OPACITY = 0.95;
/** The zeroth spherical-harmonic basis constant: a splat's color is 0.5 + SH_C0 × f_dc. */
const SH_C0 = 0.28209479177387814;
/** The standard 3DGS fields, with spherical harmonics of degree 0 only and no normals. All float32. */
const SPLAT_PROPERTIES = [
  'x', 'y', 'z', 'f_dc_0', 'f_dc_1', 'f_dc_2', 'opacity', 'scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3',
];

const HELP = `
Turns a Polycam point cloud PLY into a stand-in Splat PLY: one round Gaussian per occupied voxel.

Usage:
  npx tsx scripts/pointcloud-splat.ts <points.ply> <splat.ply> [--voxel 0.01]

Arguments:
  <points.ply>  A binary point cloud with x, y, z and red, green, blue per vertex, Z up, as Polycam exports it.
  <splat.ply>   Where to write the Splat PLY. It is Y up, like the GLB export, so it lines up with the mesh.

Options:
  --voxel <m>   Voxel size in meters. Defaults to ${VOXEL}. Halving it roughly triples the splat count.
  -h, --help    Show this help.

Example:
  npx tsx scripts/pointcloud-splat.ts data/scans/real-scans/POLYCAM_ROOM_PLY_1.ply data/scans/real-scans/POLYCAM_ROOM_SPLAT_1.ply
`.trim();

export interface PointCloud {
  count: number;
  /** x, y, z per point, in the file's frame. */
  positions: Float64Array;
  /** red, green, blue per point, 0–255. */
  colors: Uint8Array;
}

const PLY_TYPES: Record<string, { size: number; read: (view: DataView, offset: number) => number }> = {
  char: { size: 1, read: (v, o) => v.getInt8(o) },
  uchar: { size: 1, read: (v, o) => v.getUint8(o) },
  short: { size: 2, read: (v, o) => v.getInt16(o, true) },
  ushort: { size: 2, read: (v, o) => v.getUint16(o, true) },
  int: { size: 4, read: (v, o) => v.getInt32(o, true) },
  uint: { size: 4, read: (v, o) => v.getUint32(o, true) },
  float: { size: 4, read: (v, o) => v.getFloat32(o, true) },
  double: { size: 8, read: (v, o) => v.getFloat64(o, true) },
};
const PLY_ALIASES: Record<string, string> = {
  int8: 'char', uint8: 'uchar', int16: 'short', uint16: 'ushort', int32: 'int', uint32: 'uint', float32: 'float', float64: 'double',
};

/** Reads the vertex element of a binary little-endian PLY. It must be the file's first element. */
export function parsePointCloud(file: Buffer): PointCloud {
  const headerEnd = file.indexOf('end_header\n');
  if (!file.subarray(0, 4).equals(Buffer.from('ply\n')) || headerEnd < 0) throw new Error('Not a PLY file');
  const lines = file.subarray(0, headerEnd).toString('latin1').split('\n').map((line) => line.trim());
  if (!lines.includes('format binary_little_endian 1.0')) throw new Error('Only binary little-endian PLY files are supported');

  let count = -1;
  const properties: { name: string; type: (typeof PLY_TYPES)[string]; offset: number }[] = [];
  let stride = 0;
  for (const line of lines) {
    const [keyword, ...rest] = line.split(/\s+/);
    if (keyword === 'element') {
      if (count >= 0) break; // the vertex element is done
      if (rest[0] !== 'vertex') throw new Error(`Expected the vertex element first, found "${rest[0]}"`);
      count = Number(rest[1]);
    } else if (keyword === 'property' && count >= 0) {
      if (rest[0] === 'list') throw new Error('The vertex element has a list property');
      const type = PLY_TYPES[PLY_ALIASES[rest[0]] ?? rest[0]];
      if (!type) throw new Error(`Unknown PLY property type "${rest[0]}"`);
      properties.push({ name: rest[1], type, offset: stride });
      stride += type.size;
    }
  }
  const field = (name: string) => {
    const property = properties.find((p) => p.name === name);
    if (!property) throw new Error(`The vertex element has no "${name}" property`);
    return property;
  };
  const [x, y, z, red, green, blue] = ['x', 'y', 'z', 'red', 'green', 'blue'].map(field);
  const body = headerEnd + 'end_header\n'.length;
  if (file.length < body + count * stride) throw new Error(`The file is too short for ${count} vertices`);

  const view = new DataView(file.buffer, file.byteOffset + body, count * stride);
  const positions = new Float64Array(count * 3);
  const colors = new Uint8Array(count * 3);
  for (let i = 0, o = 0; i < count; i++, o += stride) {
    positions[i * 3] = x.type.read(view, o + x.offset);
    positions[i * 3 + 1] = y.type.read(view, o + y.offset);
    positions[i * 3 + 2] = z.type.read(view, o + z.offset);
    colors[i * 3] = red.type.read(view, o + red.offset);
    colors[i * 3 + 1] = green.type.read(view, o + green.offset);
    colors[i * 3 + 2] = blue.type.read(view, o + blue.offset);
  }
  return { count, positions, colors };
}

/** Averages the points in each occupied voxel, and turns Polycam's Z-up frame into the GLB's Y-up one: (x, y, z) → (x, z, −y). */
export function voxelize({ count, positions, colors }: PointCloud, voxel = VOXEL): PointCloud {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < count * 3; i++) {
    min[i % 3] = Math.min(min[i % 3], positions[i]);
    max[i % 3] = Math.max(max[i % 3], positions[i]);
  }
  const [nx, ny] = [0, 1].map((a) => Math.floor((max[a] - min[a]) / voxel) + 1);
  const cell = (i: number, a: number) => Math.floor((positions[i * 3 + a] - min[a]) / voxel);

  const slots = new Map<number, number>();
  const slotOf = new Uint32Array(count);
  for (let i = 0; i < count; i++) {
    const key = cell(i, 0) + nx * (cell(i, 1) + ny * cell(i, 2));
    let slot = slots.get(key);
    if (slot === undefined) slots.set(key, (slot = slots.size));
    slotOf[i] = slot;
  }

  const voxels = slots.size;
  const sums = new Float64Array(voxels * 6);
  const members = new Uint32Array(voxels);
  for (let i = 0; i < count; i++) {
    const s = slotOf[i] * 6;
    for (let a = 0; a < 3; a++) {
      sums[s + a] += positions[i * 3 + a];
      sums[s + 3 + a] += colors[i * 3 + a];
    }
    members[slotOf[i]]++;
  }
  const out = { count: voxels, positions: new Float64Array(voxels * 3), colors: new Uint8Array(voxels * 3) };
  for (let v = 0; v < voxels; v++) {
    const s = v * 6;
    const n = members[v];
    out.positions[v * 3] = sums[s] / n;
    out.positions[v * 3 + 1] = sums[s + 2] / n;
    out.positions[v * 3 + 2] = -sums[s + 1] / n;
    for (let a = 0; a < 3; a++) out.colors[v * 3 + a] = Math.round(sums[s + 3 + a] / n);
  }
  return out;
}

/** Writes one isotropic Gaussian per point, sized for points `voxel` apart. */
export function encodeSplatPly({ count, positions, colors }: PointCloud, voxel = VOXEL): Buffer {
  const header = [
    'ply', 'format binary_little_endian 1.0', 'comment Stand-in splat from a point cloud (scripts/pointcloud-splat.ts)',
    `element vertex ${count}`, ...SPLAT_PROPERTIES.map((name) => `property float ${name}`), 'end_header', '',
  ].join('\n');
  const values = new Float32Array(count * SPLAT_PROPERTIES.length);
  const logScale = Math.log(SIGMA_PER_VOXEL * voxel);
  const opacityLogit = Math.log(OPACITY / (1 - OPACITY));
  for (let i = 0; i < count; i++) {
    const o = i * SPLAT_PROPERTIES.length;
    values.set([
      positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2],
      (colors[i * 3] / 255 - 0.5) / SH_C0, (colors[i * 3 + 1] / 255 - 0.5) / SH_C0, (colors[i * 3 + 2] / 255 - 0.5) / SH_C0,
      opacityLogit, logScale, logScale, logScale,
      1, 0, 0, 0, // the identity rotation, w first
    ], o);
  }
  return Buffer.concat([Buffer.from(header, 'latin1'), Buffer.from(values.buffer)]);
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { voxel: { type: 'string' }, help: { type: 'boolean', short: 'h' } },
  });
  if (values.help) return console.log(HELP);
  if (positionals.length !== 2) {
    console.error(`Expected <points.ply> and <splat.ply>.\n\n${HELP}`);
    process.exitCode = 1;
    return;
  }
  const voxel = values.voxel === undefined ? VOXEL : Number(values.voxel);
  if (!(voxel > 0)) throw new Error(`--voxel must be a positive number of meters, not "${values.voxel}"`);
  const [input, output] = positionals;
  const points = parsePointCloud(await readFile(input));
  const splats = voxelize(points, voxel);
  await writeFile(output, encodeSplatPly(splats, voxel));
  const millions = (n: number) => `${(n / 1e6).toFixed(2)}M`;
  console.log(`Wrote ${output}: ${millions(splats.count)} splats from ${millions(points.count)} points, ${voxel * 100} cm voxels.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: Error) => {
    console.error(`pointcloud-splat: ${error.message}`);
    process.exitCode = 1;
  });
}
