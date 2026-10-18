// A room with no Capture, drawn from its Room Setup alone (ADR-0010): walls with real thickness,
// door and window frames, baseboards and a ceiling light, each Surface with the detail of what
// it's made of (RoomSurfaces) and the light computed for the room (bakeLight). Everything is
// unlit, like a Scan: the light comes from each Surface's light map, so paint and Finishes, which
// change only the color, keep it.
import {
  BoxGeometry, BufferAttribute, BufferGeometry, ClampToEdgeWrapping, Color, CylinderGeometry, DataTexture,
  DataUtils, DoubleSide, Group, HalfFloatType, type IUniform, LinearFilter, type Material, Matrix4, Mesh,
  MeshBasicMaterial, Path, RGBAFormat, RepeatWrapping, Shape, ShapeGeometry, SRGBColorSpace, type Texture,
  TextureLoader, Vector2, Vector3, type WebGLProgramParametersWithUniforms,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Hex, Opening, RoomSetup, RoomSurfaces, Wall } from '@shared/types';
import { luminance } from '../../setup/geometry/color';
import { floorGeometry } from '../floorPlan';
import { loadMaterialLibrary } from '../materials/triplanar';
import { bakeRoomLight, lampPositions, type LightGrid, type RGB, type RoomLight } from './bakeLight';
import { BUILT_FLOORS, surfaceTexture, VIEW_HORIZON, windowViewTexture } from './textures';

/** What a room is made of when its setup doesn't say: painted drywall, gray carpet, rubber base. */
export const DEFAULT_SURFACES: RoomSurfaces = {
  walls: 'drywall', wallColor: '#ebe7df', floor: 'carpet-grey', ceiling: 'drywall', baseboard: 'rubber',
};

/** How thick the walls are. */
const WALL_THICKNESS = 0.15;
/** The wall tops stand this far under the ceiling, clear of the Dollhouse view's clip (ScanMesh). */
const CAP_DROP = 0.06;
/** Walls shorter than this are drawn without a top or an outside (wallNode). */
const MIN_SOLID_WALL = 0.8;
const TRIM: Hex = '#f3f2ee';
const CAP: Hex = '#5a544d';
const OUTSIDE: Hex = '#d4cec4';
const RUBBER_BASE: Hex = '#46413c';
const HANDLE: Hex = '#a7a49e';
const CEILING: Hex = '#f4f2ed';

/**
 * Each floor material's color in linear light, for the light it bounces and as its color until its
 * texture loads. Measured from the Material Library's textures; anything else counts as mid gray.
 */
const FLOOR_ALBEDO: Record<string, RGB> = {
  'carpet-grey': [0.29, 0.28, 0.26], 'carpet-beige': [0.52, 0.49, 0.45], 'carpet-navy': [0.04, 0.04, 0.07],
  oak: [0.36, 0.21, 0.1], walnut: [0.34, 0.2, 0.12], maple: [0.77, 0.66, 0.48], cherry: [0.03, 0.01, 0],
  'tile-white': [0.94, 0.94, 0.94], 'tile-terracotta': [0.25, 0.16, 0.09], concrete: [0.48, 0.48, 0.48], marble: [0.78, 0.81, 0.83],
  vct: [0.36, 0.33, 0.27],
};
const isBuiltFloor = (id: string): id is (typeof BUILT_FLOORS)[number] => (BUILT_FLOORS as readonly string[]).includes(id);
const floorAlbedo = (id: string): RGB => FLOOR_ALBEDO[id] ?? [0.25, 0.25, 0.25];
const isBrowser = typeof document !== 'undefined';

/* ───────────── Light ───────────── */

const lightOf = new WeakMap<RoomSetup, RoomLight>();

/** The room's light, computed once per setup. */
function roomLight(setup: RoomSetup, surfaces: RoomSurfaces): RoomLight {
  let light = lightOf.get(setup);
  if (!light) {
    const paint = new Color(surfaces.wallColor);
    const mean = surfaceTexture(surfaces.walls).mean;
    light = bakeRoomLight(setup, {
      albedo: { walls: [paint.r * mean, paint.g * mean, paint.b * mean], floor: floorAlbedo(surfaces.floor), ceiling: [0.8, 0.8, 0.79] },
      sun: true,
    });
    lightOf.set(setup, light);
  }
  return light;
}

/** A light grid as a light map: linear half floats, filtered, on the second set of UVs. */
function lightMap({ width, height, data }: LightGrid): DataTexture {
  const half = new Uint16Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    for (let c = 0; c < 3; c++) half[i * 4 + c] = DataUtils.toHalfFloat(data[i * 3 + c]);
    half[i * 4 + 3] = DataUtils.toHalfFloat(1);
  }
  const texture = new DataTexture(half, width, height, RGBAFormat, HalfFloatType);
  texture.magFilter = texture.minFilter = LinearFilter;
  texture.wrapS = texture.wrapT = ClampToEdgeWrapping;
  texture.channel = 1;
  texture.needsUpdate = true;
  return texture;
}

/**
 * An unlit material whose light comes from a light map. three.js divides the light map by π, so
 * its intensity is π: a light of 1 then shows the surface in its own color.
 */
function lit(color: Hex, map: LightGrid | DataTexture | null, extra: Partial<MeshBasicMaterial> = {}) {
  const material = new MeshBasicMaterial({ color, ...extra });
  if (map) {
    material.lightMap = map instanceof DataTexture ? map : lightMap(map);
    material.lightMapIntensity = Math.PI;
  }
  return material;
}

/** A material for something fixed to a Surface (trim, a door, glass), which paint and Finishes leave alone. */
function fixture<T extends MeshBasicMaterial>(material: T): T {
  material.userData.fixture = true;
  return material;
}

/* ───────────── Geometry in a wall's frame ───────────── */
// x runs along the wall from its start, y up from the floor, and z out of the wall into the room.

type Point3 = [number, number, number];

const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): BufferGeometry =>
  new BoxGeometry(x1 - x0, y1 - y0, z1 - z0).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2).toNonIndexed();

/** A flat quad through four corners, turned to face `facing`. */
function quad(corners: [Point3, Point3, Point3, Point3], facing: Point3): BufferGeometry {
  const [a, b, c, d] = corners;
  const ab = new Vector3(...b).sub(new Vector3(...a));
  const ac = new Vector3(...c).sub(new Vector3(...a));
  const order = ab.cross(ac).dot(new Vector3(...facing)) >= 0 ? [a, b, c, a, c, d] : [a, c, b, a, d, c];
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(order.flat()), 3));
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Gives a geometry in a wall's frame its UVs: `uv` in repeats of a texture `meters` across, laid on
 * whichever plane each face is most nearly in, and `uv1` for the wall's light map, 0–1 along it and up it.
 */
function wallUvs(geometry: BufferGeometry, meters: number, length: number, height: number) {
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  const uv = new Float32Array(position.count * 2);
  const uv1 = new Float32Array(position.count * 2);
  for (let i = 0; i < position.count; i++) {
    const [x, y, z] = [position.getX(i), position.getY(i), position.getZ(i)];
    const [nx, ny] = [Math.abs(normal.getX(i)), Math.abs(normal.getY(i))];
    const [u, v] = nx > 0.5 ? [z, y] : ny > 0.5 ? [x, z] : [x, y];
    uv.set([u / meters, v / meters], i * 2);
    uv1.set([Math.min(1, Math.max(0, x / length)), Math.min(1, Math.max(0, y / height))], i * 2);
  }
  geometry.setAttribute('uv', new BufferAttribute(uv, 2));
  geometry.setAttribute('uv1', new BufferAttribute(uv1, 2));
  return geometry;
}

/** Reverses each triangle, for a frame that mirrors, so faces still face where their normals point. */
function flipWinding(geometry: BufferGeometry) {
  for (const attribute of Object.values(geometry.attributes)) {
    const { array, itemSize } = attribute as BufferAttribute;
    for (let t = 0; t < attribute.count; t += 3) {
      for (let k = 0; k < itemSize; k++) {
        const [b, c] = [(t + 1) * itemSize + k, (t + 2) * itemSize + k];
        [array[b], array[c]] = [array[c], array[b]];
      }
    }
  }
}

/** Moves a geometry (not indexed) from a frame to the room, keeping its faces facing out. */
function toRoom(geometry: BufferGeometry, frame: Matrix4) {
  geometry.applyMatrix4(frame);
  if (frame.determinant() < 0) flipWinding(geometry);
  return geometry;
}

/** One mesh of several geometries, all in a wall's frame, moved to the room. */
function merged(parts: BufferGeometry[], frame: Matrix4, material: MeshBasicMaterial, name: string) {
  const geometry = toRoom(mergeGeometries(parts.map((part) => (part.index ? part.toNonIndexed() : part)))!, frame);
  parts.forEach((part) => part.dispose());
  const mesh = new Mesh(geometry, material);
  mesh.name = name;
  return mesh;
}

/** The rectangle a wall's shape is cut by for an Opening. Doors are lifted off the bottom edge, which wouldn't triangulate. */
const openingHole = ({ offset, width, bottom, height }: Opening, mirror = false) => {
  const [x0, x1] = mirror ? [-(offset + width), -offset] : [offset, offset + width];
  const y0 = Math.max(bottom, 0.001);
  return new Path([new Vector2(x0, y0), new Vector2(x1, y0), new Vector2(x1, bottom + height), new Vector2(x0, bottom + height)]);
};

/** Where each wall's outer face starts and ends along it, past its ends, so the walls meet at mitred corners. */
function outerEnds(wall: Wall, walls: Wall[]): { start: number; end: number } {
  const e = new Vector2(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]);
  const length = e.length();
  e.divideScalar(length);
  const offsetLine = (w: Wall) => ({
    point: new Vector2(w.start[0] - w.normal[0] * WALL_THICKNESS, w.start[1] - w.normal[1] * WALL_THICKNESS),
    dir: new Vector2(w.end[0] - w.start[0], w.end[1] - w.start[1]).normalize(),
  });
  const near = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.02;
  // How far along this wall's offset line it meets the neighbor's, or null when they're parallel.
  const meet = (other: Wall | undefined) => {
    if (!other) return null;
    const a = offsetLine(wall), b = offsetLine(other);
    const denom = a.dir.x * b.dir.y - a.dir.y * b.dir.x;
    if (Math.abs(denom) < 1e-6) return null;
    const diff = b.point.clone().sub(a.point);
    return (diff.x * b.dir.y - diff.y * b.dir.x) / denom;
  };
  const start = meet(walls.find((w) => w !== wall && near(w.end, wall.start)));
  const end = meet(walls.find((w) => w !== wall && near(w.start, wall.end)));
  return { start: start ?? 0, end: end ?? length };
}

/* ───────────── A wall ───────────── */

interface WallLook {
  surfaces: RoomSurfaces;
  light: LightGrid;
  height: number;
  walls: Wall[];
}

/**
 * A Wall's node: its paintable face (with the returns into its Openings), the frames, door and
 * glass of its Openings, its baseboard, and its top and outside, which make it read as solid from
 * the Dollhouse view.
 */
function wallNode(wall: Wall, openings: Opening[], { surfaces, light, height: H, walls }: WallLook) {
  const [sx, sz] = wall.start;
  const along = new Vector3(wall.end[0] - sx, 0, wall.end[1] - sz);
  const L = along.length();
  along.normalize();
  const inward = new Vector3(wall.normal[0], 0, wall.normal[1]);
  const frame = new Matrix4().makeBasis(along, new Vector3(0, 1, 0), inward).setPosition(sx, 0, sz);
  const T = WALL_THICKNESS;
  const detail = surfaceTexture(surfaces.walls);
  const map = lightMap(light);
  const node = new Group();
  node.name = wall.name;

  // The face and its returns, in one material, so paint covers both.
  const face = lit(surfaces.wallColor, map, { map: detail.texture });
  face.userData.finishDetail = 0;
  const outline = new Shape([new Vector2(0, 0), new Vector2(L, 0), new Vector2(L, H), new Vector2(0, H)]);
  outline.holes.push(...openings.map((opening) => openingHole(opening)));
  const faceParts: BufferGeometry[] = [new ShapeGeometry(outline).toNonIndexed()];
  for (const { kind, offset: a0, width, bottom: b0, height } of openings) {
    const [a1, b1] = [a0 + width, b0 + height];
    faceParts.push(
      quad([[a0, b0, 0], [a0, b1, 0], [a0, b1, -T], [a0, b0, -T]], [1, 0, 0]),
      quad([[a1, b0, 0], [a1, b1, 0], [a1, b1, -T], [a1, b0, -T]], [-1, 0, 0]),
      quad([[a0, b1, 0], [a1, b1, 0], [a1, b1, -T], [a0, b1, -T]], [0, -1, 0]),
    );
    if (kind === 'window') faceParts.push(quad([[a0, b0, 0], [a1, b0, 0], [a1, b0, -T], [a0, b0, -T]], [0, 1, 0]));
  }
  node.add(merged(faceParts.map((part) => wallUvs(part, detail.meters, L, H)), frame, face, `${wall.name} face`));

  // Trim: door frames and casings, window frames, stools and aprons.
  const trim: BufferGeometry[] = [];
  const doors: BufferGeometry[] = [];
  const handles: BufferGeometry[] = [];
  const glass: { part: BufferGeometry; opening: Opening }[] = [];
  const right = new Vector3().crossVectors(inward.clone().negate(), new Vector3(0, 1, 0));
  const rightIsAlong = right.dot(along) > 0;
  for (const opening of openings) {
    const { kind, offset: a0, width, bottom: b0, height, swing } = opening;
    const [a1, b1] = [a0 + width, b0 + height];
    if (kind === 'door') {
      const [jamb, casing] = [0.035, 0.065];
      trim.push(
        box(a0, a0 + jamb, 0, b1, -T, 0), box(a1 - jamb, a1, 0, b1, -T, 0), box(a0, a1, b1 - jamb, b1, -T, 0),
        box(a0 - casing, a0, 0, b1 + casing, 0, 0.014), box(a1, a1 + casing, 0, b1 + casing, 0, 0.014),
        box(a0 - casing, a1 + casing, b1, b1 + casing, 0, 0.014),
      );
      doors.push(box(a0 + jamb + 0.003, a1 - jamb - 0.003, 0.012, b1 - jamb - 0.003, -0.06, -0.016));
      // The handle is on the side away from the hinges, as seen from inside.
      const latchOnRight = swing !== 'in-right';
      const latchAtEnd = latchOnRight === rightIsAlong;
      const latch = latchAtEnd ? a1 - jamb - 0.07 : a0 + jamb + 0.07;
      const toHinge = latchAtEnd ? -1 : 1;
      handles.push(
        box(latch - 0.03, latch + 0.03, 0.94, 1.0, -0.016, -0.004),
        box(Math.min(latch, latch + toHinge * 0.13), Math.max(latch, latch + toHinge * 0.13), 0.96, 0.982, 0.012, 0.034),
        box(latch - 0.011, latch + 0.011, 0.96, 0.982, -0.004, 0.034),
      );
    } else {
      const [bar, mid] = [0.05, -T / 2];
      trim.push(
        box(a0, a0 + bar, b0, b1, mid - 0.03, mid + 0.03), box(a1 - bar, a1, b0, b1, mid - 0.03, mid + 0.03),
        box(a0, a1, b0, b0 + bar, mid - 0.03, mid + 0.03), box(a0, a1, b1 - bar, b1, mid - 0.03, mid + 0.03),
      );
      // A sliding window's meeting rail, down the middle of a wide one.
      if (width > 1) trim.push(box((a0 + a1) / 2 - 0.025, (a0 + a1) / 2 + 0.025, b0, b1, mid - 0.04, mid + 0.04));
      // The stool and apron under a window that has a sill.
      if (b0 > 0.2) {
        trim.push(box(a0 - 0.05, a1 + 0.05, b0 - 0.025, b0, mid + 0.03, 0.035), box(a0 - 0.03, a1 + 0.03, b0 - 0.1, b0 - 0.025, 0, 0.012));
      }
      const pane = quad([[a0 + bar, b0 + bar, mid], [a1 - bar, b0 + bar, mid], [a1 - bar, b1 - bar, mid], [a0 + bar, b1 - bar, mid]], [0, 0, 1]);
      glass.push({ part: pane, opening });
    }
  }

  // The baseboard, broken at each door's casing.
  const [baseHeight, baseDepth] = surfaces.baseboard === 'wood' ? [0.11, 0.015] : [0.1, 0.007];
  const gaps = openings.filter(({ kind }) => kind === 'door').map(({ offset, width }) => [offset - 0.065, offset + width + 0.065]).sort((a, b) => a[0] - b[0]);
  const base: BufferGeometry[] = [];
  let from = 0;
  for (const [g0, g1] of [...gaps, [L, L]]) {
    if (g0 - from > 0.02) base.push(box(from, Math.min(g0, L), 0, baseHeight, 0, baseDepth));
    from = Math.max(from, g1);
  }

  const withUvs = (parts: BufferGeometry[], meters = 1) => parts.map((part) => wallUvs(part, meters, L, H));
  if (trim.length) node.add(merged(withUvs(trim), frame, fixture(lit(TRIM, map)), `${wall.name} trim`));
  if (base.length) {
    const color = surfaces.baseboard === 'wood' ? TRIM : RUBBER_BASE;
    node.add(merged(withUvs(base), frame, fixture(lit(color, map)), `${wall.name} baseboard`));
  }
  if (doors.length) {
    const door = fixture(lit('#b98d5f', map));
    doorVeneer(door);
    node.add(merged(withUvs(doors, 1.83), frame, door, `${wall.name} door`));
    node.add(merged(withUvs(handles), frame, fixture(lit(HANDLE, map)), `${wall.name} door handle`));
  }
  for (const { part, opening } of glass) node.add(windowGlass(part, frame, wall, opening, `${wall.name} glass`));

  // The wall's top, under the clip, and its outside. A short jog in the wall, such as the side of a
  // closet, has neither: the Dollhouse view fades the walls it joins, which would leave its top
  // floating on its own.
  if (L >= MIN_SOLID_WALL) {
    const ends = outerEnds(wall, walls);
    // Between two inside corners, the mitres of a short wall would cross.
    if (ends.end < ends.start) ends.start = ends.end = (ends.start + ends.end) / 2;
    const top = H - CAP_DROP;
    const cap = quad([[0, top, 0], [L, top, 0], [ends.end, top, -T], [ends.start, top, -T]], [0, 1, 0]);
    node.add(merged(withUvs([cap]), frame, fixture(new MeshBasicMaterial({ color: CAP })), `${wall.name} top`));
    const outside = new Shape([new Vector2(-ends.end, 0), new Vector2(-ends.start, 0), new Vector2(-ends.start, top), new Vector2(-ends.end, top)]);
    outside.holes.push(...openings.filter(({ bottom, height }) => bottom + height < top).map((opening) => openingHole(opening, true)));
    const outsideGeometry = new ShapeGeometry(outside).rotateY(Math.PI).translate(0, 0, -T).toNonIndexed();
    node.add(merged(withUvs([outsideGeometry]), frame, fixture(new MeshBasicMaterial({ color: OUTSIDE })), `${wall.name} outside`));
  }

  node.userData = { kind: 'wall', id: wall.id, avgLuminance: luminance(face.color.r, face.color.g, face.color.b) * detail.mean };
  return node;
}

/** Wood veneer on a door, from the Material Library's oak, once it loads. */
function doorVeneer(material: MeshBasicMaterial) {
  if (!isBrowser) return;
  new TextureLoader().load('/data/materials/oak.jpg', (texture) => {
    texture.colorSpace = SRGBColorSpace;
    texture.wrapS = texture.wrapT = RepeatWrapping;
    material.map = texture;
    material.color.set('#ffffff');
    material.needsUpdate = true;
  });
}

/** How far beyond the glass the view out of a window is drawn, and how big it is there (windowViewTexture). */
const VIEW_DISTANCE = 45;
const VIEW_SIZE: [width: number, height: number] = [150, 75];
/** How much brighter than white the view is: daylight, which tone mapping brings back into range. */
const VIEW_GAIN = 1.45;

interface WindowUniforms {
  uViewMap: IUniform<Texture>;
  uViewCenter: IUniform<Vector3>;
  uViewRight: IUniform<Vector3>;
  uViewOut: IUniform<Vector3>;
}
const windowUniforms = new WeakMap<Material, WindowUniforms>();

// The view through the glass, as if on a wall VIEW_DISTANCE beyond it: each fragment looks along the
// ray from the camera, so the view shifts sideways as the camera moves, like a real window's. Its
// horizon stays at the eye's height, as a real one does.
function patchWindow(this: Material, shader: WebGLProgramParametersWithUniforms) {
  Object.assign(shader.uniforms, windowUniforms.get(this));
  shader.vertexShader = `varying vec3 vViewPos;\n${shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
vViewPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;`)}`;
  shader.fragmentShader = `varying vec3 vViewPos;
uniform sampler2D uViewMap;
uniform vec3 uViewCenter;
uniform vec3 uViewRight;
uniform vec3 uViewOut;
${shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
vec3 ray = normalize( vViewPos - cameraPosition );
float outward = max( dot( ray, uViewOut ), 0.05 );
vec3 far = vViewPos + ray * ( ${VIEW_DISTANCE.toFixed(1)} / outward );
vec2 st = vec2(
  0.5 + dot( far - uViewCenter, uViewRight ) / ${VIEW_SIZE[0].toFixed(1)},
  ${VIEW_HORIZON.toFixed(3)} + ( far.y - cameraPosition.y ) / ${VIEW_SIZE[1].toFixed(1)}
);
vec3 outside = texture2D( uViewMap, clamp( st, vec2( -10.0, 0.002 ), vec2( 10.0, 0.998 ) ) ).rgb * ${VIEW_GAIN.toFixed(2)};
// The glass reflects the bright sky, more the more steeply it's seen (Fresnel), so it reads as glass.
float reflectance = 0.06 + 0.6 * pow( 1.0 - outward, 3.0 );
diffuseColor.rgb = mix( outside, vec3( 1.05, 1.1, 1.2 ), reflectance );`)}`;
}

/** A window's glass, showing the view out of it. Not lit by the room. */
function windowGlass(part: BufferGeometry, frame: Matrix4, wall: Wall, opening: Opening, name: string) {
  const position = part.getAttribute('position');
  part.setAttribute('uv', new BufferAttribute(new Float32Array(position.count * 2), 2));
  part.setAttribute('uv1', new BufferAttribute(new Float32Array(position.count * 2), 2));
  const material = fixture(new MeshBasicMaterial({ side: DoubleSide }));
  const [sx, sz] = wall.start;
  const along = new Vector3(wall.end[0] - sx, 0, wall.end[1] - sz).normalize();
  const center = along.clone().multiplyScalar(opening.offset + opening.width / 2).add(new Vector3(sx, 0, sz));
  const outward = new Vector3(-wall.normal[0], 0, -wall.normal[1]);
  // To the right of someone inside, looking out.
  const right = new Vector3().crossVectors(outward, new Vector3(0, 1, 0));
  windowUniforms.set(material, {
    uViewMap: { value: windowViewTexture() }, uViewCenter: { value: center }, uViewRight: { value: right }, uViewOut: { value: outward },
  });
  material.onBeforeCompile = patchWindow;
  return merged([part], frame, material, name);
}

/* ───────────── The floor and ceiling ───────────── */

/** Sets the floor's or ceiling's UVs: `uv` in meters, and `uv1` 0–1 over the floor's bounds, like its light grid. */
function planUvs(geometry: BufferGeometry, setup: RoomSetup, meters: number) {
  const xs = setup.floor.polygon.map(([x]) => x);
  const zs = setup.floor.polygon.map(([, z]) => z);
  const [x0, z0] = [Math.min(...xs), Math.min(...zs)];
  const [w, d] = [Math.max(...xs) - x0, Math.max(...zs) - z0];
  const position = geometry.getAttribute('position');
  const uv = new Float32Array(position.count * 2);
  const uv1 = new Float32Array(position.count * 2);
  for (let i = 0; i < position.count; i++) {
    const [x, z] = [position.getX(i), position.getZ(i)];
    uv.set([x / meters, z / meters], i * 2);
    uv1.set([(x - x0) / w, (z - z0) / d], i * 2);
  }
  geometry.setAttribute('uv', new BufferAttribute(uv, 2));
  geometry.setAttribute('uv1', new BufferAttribute(uv1, 2));
  return geometry;
}

/**
 * The floor's material: a floor built in (vinyl tile), or its Material Library texture, once it
 * loads, tiled at the library's size.
 */
function floorMaterial(id: string, light: LightGrid) {
  const [r, g, b] = floorAlbedo(id);
  const material = lit('#ffffff', light);
  material.userData.finishDetail = 0;
  if (isBuiltFloor(id)) {
    material.map = surfaceTexture(id).texture;
    return material;
  }
  material.color.setRGB(r, g, b);
  if (isBrowser) {
    const texture: Texture = new TextureLoader().load(`/data/materials/${id}.jpg`, () => {
      material.map = texture;
      material.color.set('#ffffff');
      material.needsUpdate = true;
    });
    texture.colorSpace = SRGBColorSpace;
    texture.wrapS = texture.wrapT = RepeatWrapping;
    texture.anisotropy = 8;
    loadMaterialLibrary().then((library) => {
      const tile = library.get(id)?.tileSize;
      if (tile) texture.repeat.setScalar(1 / tile);
    }, () => {});
  }
  return material;
}

export interface BuiltRoom {
  floor: Mesh;
  ceiling: Mesh;
  walls: Record<string, Group>;
}

/** The room's floor, ceiling and walls, drawn as RoomSurfaces says, with its light. */
export function buildRoom(setup: RoomSetup): BuiltRoom {
  const surfaces = setup.surfaces ?? DEFAULT_SURFACES;
  const light = roomLight(setup, surfaces);
  const H = setup.ceilingHeight;

  const floorMat = floorMaterial(surfaces.floor, light.floor);
  const floorMeters = isBuiltFloor(surfaces.floor) ? surfaceTexture(surfaces.floor).meters : 1;
  const floor = new Mesh(planUvs(floorGeometry(setup), setup, floorMeters), floorMat);
  floor.name = 'Floor';
  floor.userData = { kind: 'floor', avgLuminance: luminance(...floorAlbedo(surfaces.floor)) };

  // The floor's shape, turned to face down, at the ceiling.
  const ceilingDetail = surfaceTexture(surfaces.ceiling);
  const ceilingGeometry = floorGeometry(setup).toNonIndexed().translate(0, H, 0);
  flipWinding(ceilingGeometry);
  ceilingGeometry.computeVertexNormals();
  const ceiling = new Mesh(planUvs(ceilingGeometry, setup, ceilingDetail.meters), lit(CEILING, light.ceiling, { map: ceilingDetail.texture }));
  ceiling.name = 'Ceiling';
  ceiling.userData = { kind: 'ceiling', avgLuminance: 0.8 };
  // Its lights: glowing domes, brighter than white so they read as lit.
  const glow = fixture(new MeshBasicMaterial());
  glow.color.setRGB(1.8, 1.7, 1.5);
  for (const [x, z] of lampPositions(setup)) {
    const lamp = new Mesh(new CylinderGeometry(0.16, 0.18, 0.05, 40).translate(x, H - 0.025, z), glow);
    lamp.name = 'Ceiling light';
    ceiling.add(lamp);
  }

  const look = { surfaces, height: H, walls: setup.walls };
  const walls = Object.fromEntries(setup.walls.map((wall) => [
    wall.id,
    wallNode(wall, setup.openings.filter((o) => o.wallId === wall.id), { ...look, light: light.walls[wall.id] }),
  ]));
  return { floor, ceiling, walls };
}
