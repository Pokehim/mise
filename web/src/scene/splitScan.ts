// Load-time split of the Scan mesh (spec §9.4): one node each for the Shell, Floor and Ceiling, and
// one per Wall and per Original, so walls can be painted and Originals hidden or moved.
import {
  Box3, BufferAttribute, BufferGeometry, Group, type Material, Matrix3, Matrix4, Mesh, MeshBasicMaterial,
  type MeshStandardMaterial, type Object3D, Sphere, type Texture, Vector2, Vector3,
} from 'three';
import type { RoomSetup, ScanManifest } from '@shared/types';
import { type SplitGroup, triangleClassifier } from '../setup/geometry/classify';
import { type Pixels, luminance, luminanceAt } from '../setup/geometry/color';
import { type TriangleMesh, newTriangleInfo, triangleInfo } from '../setup/geometry/mesh';
import { meshTriangles, toFrame } from '../setup/sceneTriangles';

export interface SplitScan {
  shell: Object3D;
  floor: Object3D;
  ceiling: Object3D;
  walls: Record<string, Object3D>;      // by Wall id
  originals: Record<string, Object3D>;  // by Original id
}

/** The userData of every node splitScan returns. */
export interface SplitNodeData {
  kind: SplitGroup['kind'];
  id?: string;                          // the Wall or Original id
  /** Average linear-light luminance of the node's texture, for recolor's relLum (spec §10.6). */
  avgLuminance: number;
}

/** Spec §9.4: sample the texture at the UV centroids of up to this many random triangles per node. */
const LUMINANCE_SAMPLES = 2000;
/** Spec §16 risk 4: the luminance to use when a texture can't be read back. */
const FALLBACK_LUMINANCE = 0.5;

/**
 * Splits a loaded Scan mesh by the rules of spec §9.4.
 *
 * - `gltfScene` is `GLTF.scene` as loaded, in the capture's frame; its own transform is ignored.
 *   It isn't changed, and can be split again (for example after the setup changes).
 * - Every node is in the room frame (meshTransform applied), so add the nodes to the scene as they are.
 * - Each node is a Group with one unlit mesh per source primitive, reusing that primitive's texture.
 *   Every Wall and Original gets a node, even when no triangles matched it.
 * - An Original's node has its origin at the box's bottom-center and its rotationY, so a Placement
 *   can be applied to its position and rotation directly to move it.
 * - Each node's userData is a SplitNodeData.
 */
export function splitScan(gltfScene: Object3D, setup: RoomSetup, manifest: ScanManifest): SplitScan {
  const started = performance.now();
  const { groups, classify } = triangleClassifier(setup);
  const primitives = roomFramePrimitives(gltfScene, manifest);
  const slices: Slice[][] = groups.map(() => []);
  const info = newTriangleInfo();
  let total = 0;

  for (const primitive of primitives) {
    const { index } = primitive.mesh;
    const count = index.length / 3;
    const assigned = new Uint16Array(count);
    const counts = new Uint32Array(groups.length);
    for (let t = 0; t < count; t++) {
      const group = classify(triangleInfo(primitive.mesh, t, info));
      assigned[t] = group;
      counts[group]++;
    }
    const lists = Array.from(counts, (n) => new Uint32Array(n * 3));
    const filled = new Uint32Array(groups.length);
    for (let t = 0; t < count; t++) {
      const list = lists[assigned[t]];
      const f = filled[assigned[t]];
      list[f] = index[3 * t];
      list[f + 1] = index[3 * t + 1];
      list[f + 2] = index[3 * t + 2];
      filled[assigned[t]] = f + 3;
    }
    lists.forEach((list, group) => {
      if (list.length > 0) slices[group].push({ primitive, index: list });
    });
    total += count;
  }

  const random = mulberry32(1);
  const nodes = groups.map((group, g) => {
    const { node, content } = emptyNode(group, setup);
    for (const slice of slices[g]) content.add(sliceMesh(slice));
    const data: SplitNodeData = {
      kind: group.kind,
      ...('id' in group && { id: group.id }),
      avgLuminance: averageLuminance(slices[g], random),
    };
    node.userData = data;
    return node;
  });

  const ms = performance.now() - started;
  console.info(`splitScan: ${total.toLocaleString('en-US')} triangles → ${nodes.length} nodes in ${Math.round(ms)} ms`);

  const byId = (kind: 'wall' | 'original') => Object.fromEntries(groups.flatMap((group, g) =>
    group.kind === kind ? [[group.id, nodes[g]]] : []));
  return { shell: nodes[0], floor: nodes[1], ceiling: nodes[2], walls: byId('wall'), originals: byId('original') };
}

/** Every node of a split: Shell, Floor, Ceiling, the Walls, then the Originals. */
export const splitNodes = (split: SplitScan): Object3D[] =>
  [split.shell, split.floor, split.ceiling, ...Object.values(split.walls), ...Object.values(split.originals)];

/** Frees the split's geometries and materials. The textures belong to the glTF and are kept. */
export function disposeSplit(split: SplitScan) {
  for (const node of splitNodes(split)) {
    node.traverse((child) => {
      if (child instanceof Mesh) {
        child.geometry.dispose();
        (child.material as Material).dispose();
      }
    });
  }
}

/** One source primitive, moved into the room frame. */
interface Primitive {
  mesh: TriangleMesh;
  material: Material;
  /** Room-frame attributes, shared by every slice cut from this primitive. */
  attributes: Record<string, BufferAttribute>;
}

/** The triangles of one primitive that went to one node. */
interface Slice { primitive: Primitive; index: Uint32Array }

function roomFramePrimitives(gltfScene: Object3D, { meshTransform }: ScanManifest): Primitive[] {
  const matrixOf = toFrame(gltfScene, meshTransform);
  const primitives: Primitive[] = [];

  gltfScene.traverse((object) => {
    if (!(object instanceof Mesh) || !object.geometry.attributes.position) return;
    const geometry = object.geometry as BufferGeometry;
    const matrix = matrixOf(object);
    const { positions, index } = meshTriangles(object, matrix);

    const attributes: Record<string, BufferAttribute> = { position: new BufferAttribute(positions, 3) };
    const normal = geometry.attributes.normal;
    if (normal) {
      const normals = new Float32Array(normal.count * 3);
      const normalMatrix = new Matrix3().getNormalMatrix(matrix);
      const v = new Vector3();
      for (let i = 0; i < normal.count; i++) v.fromBufferAttribute(normal, i).applyMatrix3(normalMatrix).normalize().toArray(normals, 3 * i);
      attributes.normal = new BufferAttribute(normals, 3);
    }
    // Copied rather than shared, so disposing a split never frees the glTF's own GPU buffers.
    for (const name of ['uv', 'color']) {
      const source = geometry.attributes[name];
      if (!source) continue;
      const copy = new Float32Array(source.count * source.itemSize);
      for (let i = 0; i < source.count; i++) {
        for (let k = 0; k < source.itemSize; k++) copy[i * source.itemSize + k] = source.getComponent(i, k);
      }
      attributes[name] = new BufferAttribute(copy, source.itemSize);
    }

    // A mesh with an array of materials draws each geometry group with its own material.
    const ranges = Array.isArray(object.material)
      ? geometry.groups.map((g) => ({ start: g.start, count: g.count, material: object.material[g.materialIndex ?? 0] }))
      : [{ start: 0, count: index.length, material: object.material as Material }];
    for (const { start, count, material } of ranges) {
      primitives.push({ mesh: { positions, index: index.subarray(start, start + count - (count % 3)) }, material, attributes });
    }
  });
  return primitives;
}

/** The node for one group, and the object its meshes go into. */
function emptyNode(group: SplitGroup, setup: RoomSetup): { node: Object3D; content: Object3D } {
  const node = new Group();
  if (group.kind === 'wall') {
    node.name = setup.walls.find((w) => w.id === group.id)!.name;
    return { node, content: node };
  }
  if (group.kind === 'original') {
    // The node sits at the box's bottom-center; its content undoes that, so the triangles stay put
    // until the node is moved.
    const { label, box } = setup.originals.find((o) => o.id === group.id)!;
    node.name = label;
    node.position.set(...box.position);
    node.rotation.y = box.rotationY;
    node.updateMatrix();
    const content = new Group();
    new Matrix4().copy(node.matrix).invert().decompose(content.position, content.quaternion, content.scale);
    node.add(content);
    return { node, content };
  }
  node.name = group.kind[0].toUpperCase() + group.kind.slice(1);
  return { node, content: node };
}

function sliceMesh({ primitive, index }: Slice): Mesh {
  const geometry = new BufferGeometry();
  for (const [name, attribute] of Object.entries(primitive.attributes)) geometry.setAttribute(name, attribute);
  geometry.setIndex(new BufferAttribute(index, 1));
  // Bounds of this slice only; computeBoundingBox would measure every vertex of the shared attribute.
  const p = primitive.mesh.positions;
  const min = new Vector3(Infinity, Infinity, Infinity);
  const max = new Vector3(-Infinity, -Infinity, -Infinity);
  for (let i = 0; i < index.length; i++) {
    const v = 3 * index[i];
    min.set(Math.min(min.x, p[v]), Math.min(min.y, p[v + 1]), Math.min(min.z, p[v + 2]));
    max.set(Math.max(max.x, p[v]), Math.max(max.y, p[v + 1]), Math.max(max.z, p[v + 2]));
  }
  geometry.boundingBox = new Box3(min, max);
  geometry.boundingSphere = geometry.boundingBox.getBoundingSphere(new Sphere());
  return new Mesh(geometry, unlit(primitive.material, 'color' in primitive.attributes));
}

/** Scan nodes are unlit (spec §10.6): the texture already holds the room's real lighting. */
export function unlit(source: Material, vertexColors = source.vertexColors): MeshBasicMaterial {
  const s = source as Partial<MeshStandardMaterial>;
  const material = new MeshBasicMaterial({
    name: source.name,
    map: s.map ?? null,
    alphaMap: s.alphaMap ?? null,
    vertexColors: vertexColors && source.vertexColors,
    side: source.side,
    transparent: source.transparent,
    opacity: source.opacity,
    alphaTest: source.alphaTest,
  });
  if (s.color) material.color.copy(s.color);
  return material;
}

/** The mean luminance at the UV centroids of up to LUMINANCE_SAMPLES random triangles of a node. */
function averageLuminance(slices: Slice[], random: () => number): number {
  // Each slice's texture pixels, and the luminance of its material's color, which multiplies the texture.
  const sources = slices.map(({ primitive }) => {
    const { map, color } = primitive.material as Partial<MeshStandardMaterial>;
    map?.updateMatrix();
    return { map, colorLuminance: color ? luminance(color.r, color.g, color.b) : 1, pixels: map ? texturePixels(map) : null };
  });
  if (sources.some((source) => source.map && !source.pixels)) return FALLBACK_LUMINANCE;
  const counts = slices.map((slice) => slice.index.length / 3);
  const total = counts.reduce((a, b) => a + b, 0);
  let sum = 0;
  let samples = 0;
  const uv = new Vector2();
  for (let k = 0; k < Math.min(LUMINANCE_SAMPLES, total); k++) {
    let t = Math.floor(random() * total);
    let p = 0;
    while (t >= counts[p]) t -= counts[p++];
    const { map, colorLuminance, pixels } = sources[p];
    const uvs = slices[p].primitive.attributes.uv;
    let sample = colorLuminance;
    if (map && pixels && uvs) {
      const { index } = slices[p];
      const [a, b, c] = [index[3 * t], index[3 * t + 1], index[3 * t + 2]];
      uv.set((uvs.getX(a) + uvs.getX(b) + uvs.getX(c)) / 3, (uvs.getY(a) + uvs.getY(b) + uvs.getY(c)) / 3);
      map.transformUv(uv);   // texture transform, wrapping, and flipY → image space, row 0 at the top
      sample *= luminanceAt(pixels, uv.x, uv.y);
    }
    sum += sample;
    samples++;
  }
  return samples > 0 ? sum / samples : FALLBACK_LUMINANCE;
}

const pixelCache = new WeakMap<Texture, Pixels | null>();

/**
 * A texture's RGBA pixels, read once per texture: drawn into an OffscreenCanvas of at most 512 px
 * (the average barely changes, and a 2K readback would cost more than the split) and read with
 * getImageData. A DataTexture's own data is used as it is. Null when it can't be read, such as a
 * compressed texture.
 */
function texturePixels(texture: Texture): Pixels | null {
  if (pixelCache.has(texture)) return pixelCache.get(texture)!;
  let pixels: Pixels | null = null;
  const image = texture.image as { width: number; height: number; data?: ArrayLike<number> } | undefined;
  try {
    if (image?.data && image.data.length === image.width * image.height * 4) {
      pixels = { width: image.width, height: image.height, data: image.data };
    } else if (image && image.width > 0 && typeof OffscreenCanvas !== 'undefined') {
      const scale = Math.min(1, 512 / Math.max(image.width, image.height));
      const width = Math.max(1, Math.round(image.width * scale));
      const height = Math.max(1, Math.round(image.height * scale));
      const context = new OffscreenCanvas(width, height).getContext('2d', { willReadFrequently: true })!;
      context.drawImage(image as CanvasImageSource, 0, 0, width, height);
      pixels = context.getImageData(0, 0, width, height);
    }
  } catch (error) {
    console.warn('splitScan: could not read a texture for avgLuminance', error);
  }
  pixelCache.set(texture, pixels);
  return pixels;
}

/** A small seeded random generator, so each load samples the same triangles. */
function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
