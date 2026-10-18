// The light of a room with no Capture (ADR-0010): daylight through its windows, the sun through the
// largest one, a ceiling light, and the light all of that bounces off the walls, floor and ceiling.
// It is computed once, when the room loads, as a grid of light per Surface. The room's meshes take
// each grid as a light map, so paint and Finishes, which change only a surface's color, keep it.
import type { Opening, RoomSetup, Vec2 } from '@shared/types';
import { pointInPolygon } from '@shared/geometry';
import { mulberry32 } from '../materials/luminance';

export type RGB = [r: number, g: number, b: number];

/** A Surface's light: RGB per texel, row by row from v = 0, where 1 shows the surface in its own color. */
export interface LightGrid {
  /** Texels along u. */
  width: number;
  /** Texels along v. */
  height: number;
  data: Float32Array;
}

/** The light of every Surface of the room. */
export interface RoomLight {
  /** u runs along +X and v along +Z, over the floor polygon's bounds. */
  floor: LightGrid;
  /** The floor's grid, at the ceiling. */
  ceiling: LightGrid;
  /** By Wall id: u runs from the wall's start to its end, and v up from the floor to the ceiling. */
  walls: Record<string, LightGrid>;
}

export interface BakeOptions {
  /** Each Surface's color in linear light, which sets how much light it bounces. */
  albedo: { walls: RGB; floor: RGB; ceiling: RGB };
  /** Meters per texel of the light grids. */
  texel?: number;
  /** Sun through the largest window. */
  sun?: boolean;
}

/* ───────────── The lights ───────────── */

/** An overcast sky seen straight up, in linear light. A window shows the sky above the horizon and the ground below it. */
const SKY: RGB = [0.82, 0.9, 1];
const GROUND: RGB = [0.3, 0.28, 0.24];
/**
 * The sun's light on a surface square to it: a sunlit patch about twice as bright as its
 * surroundings. A real one is brighter, but the floor under it would wash out to white, and a
 * Mover choosing a floor needs to see it.
 */
const SUN: RGB = [0.5, 0.44, 0.36];
/** A ceiling light: warm white, mostly downward. */
const LAMP: RGB = [0.52, 0.47, 0.4];
/** How much light a door bounces. */
const DOOR_ALBEDO: RGB = [0.38, 0.28, 0.19];

/**
 * Window light is sampled on a grid of SAMPLES × SAMPLES points per window, the same points for
 * every texel, so neighboring texels get smoothly different light rather than noise.
 */
const SAMPLES = 6;
/** The sun's disc, as directions this far apart (radians): it softens the edge of a sun patch. */
const SUN_SPREAD = 0.03;
/** Bounced light is gathered on a coarser grid, with this many rays per texel, then smoothed. */
const BOUNCE_TEXEL = 0.15;
const BOUNCE_RAYS = 144;
/** The floor's and ceiling's texels, finer than the walls', for the sharp edge of a sun patch. */
const PLAN_TEXEL = 0.03;
/** Sample points stand this far off their surface, so their rays don't hit it. */
const LIFT = 0.006;
/** The median wall texel's light, after exposure: the wall shows a little under its own color. */
const EXPOSURE = 0.9;

/** Where the room's ceiling lights hang: over the middle of the room, one per 12 m² or so, along its long side. */
export function lampPositions(setup: RoomSetup): Vec2[] {
  const xs = setup.floor.polygon.map(([x]) => x);
  const zs = setup.floor.polygon.map(([, z]) => z);
  const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
  const [w, d] = [x1 - x0, z1 - z0];
  const count = Math.max(1, Math.min(3, Math.round((w * d) / 12)));
  const lamps: Vec2[] = [];
  for (let i = 0; i < count; i++) {
    const f = (i + 0.5) / count;
    // Across the room's short side, at this point along its long side: the middle of the floor there,
    // which in an L-shaped room isn't the middle of its bounds.
    const across = Array.from({ length: 101 }, (_, k): Vec2 => (w >= d ? [x0 + w * f, z0 + (d * k) / 100] : [x0 + (w * k) / 100, z0 + d * f]))
      .filter((point) => pointInPolygon(point, setup.floor.polygon));
    if (across.length) lamps.push(across[Math.floor(across.length / 2)]);
  }
  // A room shaped so that none of those points is inside it: its first corner, moved inward.
  if (!lamps.length) {
    const [cx, cz] = setup.floor.polygon[0];
    const wall = setup.walls[0];
    lamps.push([cx + wall.normal[0] * 0.8, cz + wall.normal[1] * 0.8]);
  }
  return lamps;
}

/* ───────────── The room as rays see it ───────────── */

interface WallInfo {
  id: string;
  sx: number; sz: number;
  /** Unit vector along the wall, and its inward normal. */
  ex: number; ez: number; nx: number; nz: number;
  length: number;
  openings: { kind: Opening['kind']; a0: number; a1: number; b0: number; b1: number }[];
}

const NONE = 0, FLOOR = 1, CEILING = 2, WALL = 3;

/** What a ray hit: reused by every cast, so casting allocates nothing. */
interface Hit {
  kind: number;
  t: number;
  /** The wall's index, and where on it: meters along it, and height. */
  wall: number;
  along: number;
  y: number;
  /** 'window', 'door', or null for the wall itself. */
  opening: Opening['kind'] | null;
}

class Room {
  readonly walls: WallInfo[];
  readonly height: number;
  readonly bounds: { x0: number; z0: number; w: number; d: number };
  readonly convex: boolean;
  readonly hit: Hit = { kind: NONE, t: 0, wall: -1, along: 0, y: 0, opening: null };

  constructor(readonly setup: RoomSetup) {
    this.height = setup.ceilingHeight;
    this.walls = setup.walls.map((wall) => {
      const [sx, sz] = wall.start;
      const length = Math.hypot(wall.end[0] - sx, wall.end[1] - sz);
      return {
        id: wall.id, sx, sz, length,
        ex: (wall.end[0] - sx) / length, ez: (wall.end[1] - sz) / length,
        nx: wall.normal[0], nz: wall.normal[1],
        openings: setup.openings.filter((o) => o.wallId === wall.id).map((o) => ({
          kind: o.kind, a0: o.offset, a1: o.offset + o.width, b0: o.bottom, b1: o.bottom + o.height,
        })),
      };
    });
    const xs = setup.floor.polygon.map(([x]) => x);
    const zs = setup.floor.polygon.map(([, z]) => z);
    const [x0, z0] = [Math.min(...xs), Math.min(...zs)];
    this.bounds = { x0, z0, w: Math.max(...xs) - x0, d: Math.max(...zs) - z0 };
    // Convex when every corner is on the inside of every wall: then nothing inside can hide anything else.
    this.convex = this.walls.every((w) => setup.floor.polygon.every(([x, z]) => (x - w.sx) * w.nx + (z - w.sz) * w.nz > -1e-6));
  }

  /** Casts a ray from inside the room; the result is in `this.hit`. */
  cast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): Hit {
    const hit = this.hit;
    hit.kind = NONE;
    hit.t = Infinity;
    hit.opening = null;
    if (dy < -1e-9) {
      hit.kind = FLOOR;
      hit.t = -oy / dy;
    } else if (dy > 1e-9) {
      hit.kind = CEILING;
      hit.t = (this.height - oy) / dy;
    }
    for (let i = 0; i < this.walls.length; i++) {
      const w = this.walls[i];
      // Only a wall the ray is heading out through: from inside the room, that is the first one it meets.
      const toward = dx * w.nx + dz * w.nz;
      if (toward > -1e-9) continue;
      const t = ((ox - w.sx) * w.nx + (oz - w.sz) * w.nz) / -toward;
      if (t >= hit.t || t < 0) continue;
      const along = (ox + dx * t - w.sx) * w.ex + (oz + dz * t - w.sz) * w.ez;
      if (along < -1e-4 || along > w.length + 1e-4) continue;
      hit.kind = WALL;
      hit.t = t;
      hit.wall = i;
      hit.along = along;
    }
    if (hit.kind === WALL) {
      const w = this.walls[hit.wall];
      hit.y = oy + dy * hit.t;
      for (const o of w.openings) {
        if (hit.along > o.a0 && hit.along < o.a1 && hit.y > o.b0 && hit.y < o.b1) hit.opening = o.kind;
      }
    }
    return hit;
  }
}

/* ───────────── The Surfaces ───────────── */

interface Surface {
  /** The point at u = v = 0, the unit vectors along u and v, and the normal into the room. */
  ox: number; oy: number; oz: number;
  ux: number; uy: number; uz: number;
  vx: number; vy: number; vz: number;
  nx: number; ny: number; nz: number;
  uLength: number;
  vLength: number;
  albedo: RGB;
  grid: LightGrid;
  /** Whether each texel's center is on the Surface: a floor texel outside the polygon isn't. */
  valid: Uint8Array;
}

function surface(
  origin: [number, number, number], u: [number, number, number], v: [number, number, number],
  normal: [number, number, number], uLength: number, vLength: number, texel: number, albedo: RGB,
): Surface {
  const width = Math.max(2, Math.ceil(uLength / texel));
  const height = Math.max(2, Math.ceil(vLength / texel));
  return {
    ox: origin[0], oy: origin[1], oz: origin[2],
    ux: u[0], uy: u[1], uz: u[2], vx: v[0], vy: v[1], vz: v[2], nx: normal[0], ny: normal[1], nz: normal[2],
    uLength, vLength, albedo,
    grid: { width, height, data: new Float32Array(width * height * 3) },
    valid: new Uint8Array(width * height).fill(1),
  };
}

/** The room's Surfaces, at `texel` meters per texel: the floor, the ceiling, then each wall. */
function surfaces(room: Room, texel: number, albedo: BakeOptions['albedo'], planTexel = texel) {
  const { x0, z0, w, d } = room.bounds;
  const H = room.height;
  const floor = surface([x0, 0, z0], [1, 0, 0], [0, 0, 1], [0, 1, 0], w, d, planTexel, albedo.floor);
  const ceiling = surface([x0, H, z0], [1, 0, 0], [0, 0, 1], [0, -1, 0], w, d, planTexel, albedo.ceiling);
  for (const s of [floor, ceiling]) {
    const { width, height } = s.grid;
    for (let j = 0; j < height; j++) {
      for (let i = 0; i < width; i++) {
        const point: Vec2 = [x0 + ((i + 0.5) / width) * w, z0 + ((j + 0.5) / height) * d];
        s.valid[j * width + i] = pointInPolygon(point, room.setup.floor.polygon) ? 1 : 0;
      }
    }
  }
  const walls = room.walls.map((wall) =>
    surface([wall.sx, 0, wall.sz], [wall.ex, 0, wall.ez], [0, 1, 0], [wall.nx, 0, wall.nz], wall.length, H, texel, albedo.walls));
  return { floor, ceiling, walls };
}

/** The point of a texel's center, lifted off the Surface, kept clear of its edges. */
function texelPoint(s: Surface, i: number, j: number, out: number[]) {
  const margin = 0.012;
  const u = Math.min(Math.max(((i + 0.5) / s.grid.width) * s.uLength, margin), s.uLength - margin);
  const v = Math.min(Math.max(((j + 0.5) / s.grid.height) * s.vLength, margin), s.vLength - margin);
  out[0] = s.ox + s.ux * u + s.vx * v + s.nx * LIFT;
  out[1] = s.oy + s.uy * u + s.vy * v + s.ny * LIFT;
  out[2] = s.oz + s.uz * u + s.vz * v + s.nz * LIFT;
}

/** Where a ray hit, as a Surface and a texel of it: or null for a window, which shows the sky. */
function hitTexel(hit: Hit, room: Room, all: { floor: Surface; ceiling: Surface; walls: Surface[] }, x: number, z: number) {
  let s: Surface;
  let fu: number, fv: number;
  if (hit.kind === FLOOR || hit.kind === CEILING) {
    s = hit.kind === FLOOR ? all.floor : all.ceiling;
    fu = (x - room.bounds.x0) / room.bounds.w;
    fv = (z - room.bounds.z0) / room.bounds.d;
  } else if (hit.kind === WALL && hit.opening !== 'window') {
    s = all.walls[hit.wall];
    fu = hit.along / s.uLength;
    fv = hit.y / s.vLength;
  } else {
    return null;
  }
  const i = Math.min(s.grid.width - 1, Math.max(0, Math.floor(fu * s.grid.width)));
  const j = Math.min(s.grid.height - 1, Math.max(0, Math.floor(fv * s.grid.height)));
  return { s, index: j * s.grid.width + i };
}

/* ───────────── Direct light ───────────── */

/** The sun's direction: through the largest window, from 30° up and 25° to one side. */
function sunDirection(room: Room): [number, number, number] | null {
  let best: { wall: WallInfo; area: number } | null = null;
  for (const wall of room.walls) {
    for (const o of wall.openings) {
      const area = (o.a1 - o.a0) * (o.b1 - o.b0);
      if (o.kind === 'window' && (!best || area > best.area)) best = { wall, area };
    }
  }
  if (!best) return null;
  // Toward the sun is out through the window: against the wall's inward normal, turned 25°.
  const [elevation, turn] = [(30 * Math.PI) / 180, (25 * Math.PI) / 180];
  const [ox, oz] = [-best.wall.nx, -best.wall.nz];
  const [x, z] = [ox * Math.cos(turn) - oz * Math.sin(turn), ox * Math.sin(turn) + oz * Math.cos(turn)];
  return [x * Math.cos(elevation), Math.sin(elevation), z * Math.cos(elevation)];
}

/** The same jitter for every texel: SAMPLES × SAMPLES offsets in 0–1 within each window cell, and the sun's and lamps' points. */
function samplePattern(seed: number) {
  const random = mulberry32(seed);
  const window = Array.from({ length: SAMPLES * SAMPLES }, () => [random(), random()]);
  const sun = Array.from({ length: 8 }, (_, k) => {
    const [angle, radius] = [((k + random()) / 8) * 2 * Math.PI, SUN_SPREAD * Math.sqrt((k + 0.5) / 8)];
    return [Math.cos(angle) * radius, (random() - 0.5) * SUN_SPREAD, Math.sin(angle) * radius];
  });
  const lamp = Array.from({ length: 8 }, (_, k) => {
    const [angle, radius] = [((k + 0.5) / 8) * 2 * Math.PI, 0.12];
    return [Math.cos(angle) * radius, Math.sin(angle) * radius];
  });
  return { window, sun, lamp };
}

function directLight(room: Room, s: Surface, options: BakeOptions, lamps: Vec2[], seed: number) {
  const pattern = samplePattern(seed);
  const sun = options.sun === false ? null : sunDirection(room);
  const H = room.height;
  const p = [0, 0, 0];
  const windows = room.walls.flatMap((wall) => wall.openings.filter((o) => o.kind === 'window').map((o) => ({ wall, o })));
  const { width, height, data } = s.grid;
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      const index = j * width + i;
      if (!s.valid[index]) continue;
      texelPoint(s, i, j, p);
      let [r, g, b] = [0, 0, 0];

      // Each window, as a patch of sky and ground.
      for (const { wall, o } of windows) {
        const area = ((o.a1 - o.a0) * (o.b1 - o.b0)) / (SAMPLES * SAMPLES);
        for (let a = 0; a < SAMPLES; a++) {
          for (let c = 0; c < SAMPLES; c++) {
            const [ja, jc] = pattern.window[a * SAMPLES + c];
            const along = o.a0 + ((a + ja) / SAMPLES) * (o.a1 - o.a0);
            const y = o.b0 + ((c + jc) / SAMPLES) * (o.b1 - o.b0);
            const qx = wall.sx + wall.ex * along, qz = wall.sz + wall.ez * along;
            let dx = qx - p[0], dy = y - p[1], dz = qz - p[2];
            const d2 = dx * dx + dy * dy + dz * dz;
            const d = Math.sqrt(d2);
            dx /= d; dy /= d; dz /= d;
            const cosP = dx * s.nx + dy * s.ny + dz * s.nz;
            const cosQ = -(dx * wall.nx + dz * wall.nz);
            if (cosP <= 0 || cosQ <= 0) continue;
            if (!room.convex) {
              const hit = room.cast(p[0], p[1], p[2], dx, dy, dz);
              if (hit.kind !== WALL || hit.opening !== 'window' || hit.t < d - 0.02) continue;
            }
            // dy is the sine of how high the window point is, seen from here: above the horizon it's sky.
            const skyShare = Math.min(1, Math.max(0, (dy + 0.06) / 0.12));
            const zenith = (1 + 2 * Math.max(0, dy)) / 3;
            const k = (cosP * cosQ * area) / Math.max(d2, 0.03);
            r += k * (SKY[0] * zenith * skyShare + GROUND[0] * (1 - skyShare));
            g += k * (SKY[1] * zenith * skyShare + GROUND[1] * (1 - skyShare));
            b += k * (SKY[2] * zenith * skyShare + GROUND[2] * (1 - skyShare));
          }
        }
      }

      // The sun, through a window, with a softened edge.
      if (sun) {
        const cosP = sun[0] * s.nx + sun[1] * s.ny + sun[2] * s.nz;
        if (cosP > 0) {
          let lit = 0;
          for (const [jx, jy, jz] of pattern.sun) {
            const hit = room.cast(p[0], p[1], p[2], sun[0] + jx, sun[1] + jy, sun[2] + jz);
            if (hit.kind === WALL && hit.opening === 'window') lit++;
          }
          lit /= pattern.sun.length;
          r += SUN[0] * cosP * lit;
          g += SUN[1] * cosP * lit;
          b += SUN[2] * cosP * lit;
        }
      }

      // The ceiling lights: small discs just under the ceiling, brightest straight down.
      for (const [lx, lz] of lamps) {
        for (const [ox, oz] of pattern.lamp) {
          const qx = lx + ox, qz = lz + oz, qy = H - 0.06;
          let dx = qx - p[0], dy = qy - p[1], dz = qz - p[2];
          const d2 = dx * dx + dy * dy + dz * dz;
          const d = Math.sqrt(d2);
          dx /= d; dy /= d; dz /= d;
          const cosP = dx * s.nx + dy * s.ny + dz * s.nz;
          if (cosP <= 0) continue;
          if (!room.convex) {
            const hit = room.cast(p[0], p[1], p[2], dx, dy, dz);
            if (hit.t < d - 0.02) continue;
          }
          // dy is how far up the light is from here: a point straight below gets the most.
          const k2 = ((0.25 + 0.75 * Math.max(0, dy)) * cosP) / Math.max(d2, 0.04) / pattern.lamp.length;
          r += LAMP[0] * k2;
          g += LAMP[1] * k2;
          b += LAMP[2] * k2;
        }
      }
      data[index * 3] = r;
      data[index * 3 + 1] = g;
      data[index * 3 + 2] = b;
    }
  }
}

/* ───────────── Bounced light ───────────── */

/**
 * One bounce: for each texel of each coarse Surface, the light that `from` (the fine Surfaces' light)
 * reflects onto it, gathered over BOUNCE_RAYS cosine-weighted rays.
 */
function gather(
  room: Room, coarse: Surface[], from: { floor: Surface; ceiling: Surface; walls: Surface[] },
  light: (s: Surface) => Float32Array, seed: number,
) {
  const random = mulberry32(seed);
  const side = Math.round(Math.sqrt(BOUNCE_RAYS));
  const p = [0, 0, 0];
  const out = coarse.map((s) => new Float32Array(s.grid.width * s.grid.height * 3));
  coarse.forEach((s, n) => {
    // A tangent frame around the normal.
    const [nx, ny, nz] = [s.nx, s.ny, s.nz];
    const [ax, ay, az] = Math.abs(ny) > 0.9 ? [1, 0, 0] : [0, 1, 0];
    let [tx, ty, tz] = [ay * nz - az * ny, az * nx - ax * nz, ax * ny - ay * nx];
    const tl = Math.hypot(tx, ty, tz);
    tx /= tl; ty /= tl; tz /= tl;
    const [bx, by, bz] = [ny * tz - nz * ty, nz * tx - nx * tz, nx * ty - ny * tx];
    const { width, height } = s.grid;
    for (let j = 0; j < height; j++) {
      for (let i = 0; i < width; i++) {
        const index = j * width + i;
        if (!s.valid[index]) continue;
        texelPoint(s, i, j, p);
        let [r, g, b] = [0, 0, 0];
        for (let a = 0; a < side; a++) {
          for (let c = 0; c < side; c++) {
            const phi = (2 * Math.PI * (a + random())) / side;
            const r2 = (c + random()) / side;
            const sinT = Math.sqrt(r2), cosT = Math.sqrt(1 - r2);
            const lx = Math.cos(phi) * sinT, ly = Math.sin(phi) * sinT;
            const dx = tx * lx + bx * ly + nx * cosT;
            const dy = ty * lx + by * ly + ny * cosT;
            const dz = tz * lx + bz * ly + nz * cosT;
            const hit = room.cast(p[0], p[1], p[2], dx, dy, dz);
            const at = hitTexel(hit, room, from, p[0] + dx * hit.t, p[2] + dz * hit.t);
            if (!at) continue;
            const source = light(at.s);
            const albedo = hit.kind === WALL && hit.opening === 'door' ? DOOR_ALBEDO : at.s.albedo;
            r += albedo[0] * source[at.index * 3];
            g += albedo[1] * source[at.index * 3 + 1];
            b += albedo[2] * source[at.index * 3 + 2];
          }
        }
        const rays = side * side;
        out[n][index * 3] = r / rays;
        out[n][index * 3 + 1] = g / rays;
        out[n][index * 3 + 2] = b / rays;
      }
    }
  });
  return out;
}

/** Averages each texel of a coarse grid with its neighbors on the Surface, which smooths away the gather's noise. */
function smooth(s: Surface, data: Float32Array) {
  const { width, height } = s.grid;
  const out = new Float32Array(data.length);
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      const sum = [0, 0, 0];
      let weight = 0;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const [x, y] = [i + di, j + dj];
          if (x < 0 || y < 0 || x >= width || y >= height || !s.valid[y * width + x]) continue;
          const w = di === 0 && dj === 0 ? 2 : 1;
          for (let c = 0; c < 3; c++) sum[c] += data[(y * width + x) * 3 + c] * w;
          weight += w;
        }
      }
      if (weight) for (let c = 0; c < 3; c++) out[(j * width + i) * 3 + c] = sum[c] / weight;
    }
  }
  return out;
}

/** A coarse grid's value at a point (0–1 along u and v), interpolated between its texel centers. */
function sampleCoarse(s: Surface, data: Float32Array, fu: number, fv: number, out: number[]) {
  const { width, height } = s.grid;
  const x = Math.min(Math.max(fu * width - 0.5, 0), width - 1);
  const y = Math.min(Math.max(fv * height - 0.5, 0), height - 1);
  const [x0, y0] = [Math.floor(x), Math.floor(y)];
  const [x1, y1] = [Math.min(x0 + 1, width - 1), Math.min(y0 + 1, height - 1)];
  const [fx, fy] = [x - x0, y - y0];
  for (let c = 0; c < 3; c++) {
    const v00 = data[(y0 * width + x0) * 3 + c], v10 = data[(y0 * width + x1) * 3 + c];
    const v01 = data[(y1 * width + x0) * 3 + c], v11 = data[(y1 * width + x1) * 3 + c];
    out[c] = (v00 * (1 - fx) + v10 * fx) * (1 - fy) + (v01 * (1 - fx) + v11 * fx) * fy;
  }
}

/** Gives each texel off the Surface its nearest neighbor's light, so filtering at the edges doesn't darken them. */
function fillInvalid({ grid: { width, height, data }, valid }: Surface) {
  const known = valid.slice();
  for (let pass = 0; pass < width + height; pass++) {
    let changed = false;
    const next = known.slice();
    for (let j = 0; j < height; j++) {
      for (let i = 0; i < width; i++) {
        const index = j * width + i;
        if (known[index]) continue;
        const neighbors = [[i - 1, j], [i + 1, j], [i, j - 1], [i, j + 1]]
          .filter(([x, y]) => x >= 0 && y >= 0 && x < width && y < height && known[y * width + x]);
        if (!neighbors.length) continue;
        for (let c = 0; c < 3; c++) {
          data[index * 3 + c] = neighbors.reduce((sum, [x, y]) => sum + data[(y * width + x) * 3 + c], 0) / neighbors.length;
        }
        next[index] = 1;
        changed = true;
      }
    }
    known.set(next);
    if (!changed) break;
  }
}

/* ───────────── The bake ───────────── */

/**
 * The room's light, from its Room Setup alone. Deterministic: the same setup always gets the same
 * light. It takes a few hundred milliseconds for a dorm room.
 */
export function bakeRoomLight(setup: RoomSetup, options: BakeOptions): RoomLight {
  const room = new Room(setup);
  const texel = options.texel ?? 0.05;
  const lamps = lampPositions(setup);
  const fine = surfaces(room, texel, options.albedo, Math.min(texel, PLAN_TEXEL));
  const coarse = surfaces(room, BOUNCE_TEXEL, options.albedo);
  const fineList = [fine.floor, fine.ceiling, ...fine.walls];
  const coarseList = [coarse.floor, coarse.ceiling, ...coarse.walls];

  fineList.forEach((s, n) => {
    directLight(room, s, options, lamps, 1 + n);
    fillInvalid(s);
  });

  // Two bounces: the first from the direct light, the second from the first.
  const direct = new Map(fineList.map((s) => [s, s.grid.data.slice()]));
  const bounce1 = gather(room, coarseList, fine, (s) => direct.get(s)!, 101).map((data, n) => smooth(coarseList[n], data));
  // The second bounce reads the first from the fine Surfaces, so spread it onto them first.
  const point = [0, 0, 0];
  const firstOnFine = new Map(fineList.map((s, n) => {
    const out = new Float32Array(s.grid.data.length);
    const { width, height } = s.grid;
    for (let j = 0; j < height; j++) {
      for (let i = 0; i < width; i++) {
        sampleCoarse(coarseList[n], bounce1[n], (i + 0.5) / width, (j + 0.5) / height, point);
        out.set(point, (j * width + i) * 3);
      }
    }
    return [s, out] as const;
  }));
  const bounce2 = gather(room, coarseList, fine, (s) => firstOnFine.get(s)!, 202).map((data, n) => smooth(coarseList[n], data));

  // Direct light, plus both bounces.
  fineList.forEach((s, n) => {
    const { width, height, data } = s.grid;
    const first = firstOnFine.get(s)!;
    for (let j = 0; j < height; j++) {
      for (let i = 0; i < width; i++) {
        const index = (j * width + i) * 3;
        sampleCoarse(coarseList[n], bounce2[n], (i + 0.5) / width, (j + 0.5) / height, point);
        for (let c = 0; c < 3; c++) data[index + c] += first[index + c] + point[c];
      }
    }
    fillInvalid(s);
  });

  // Exposure: the median wall texel shows the wall a little under its own color.
  const wallLevels = fine.walls.flatMap(({ grid: { data } }) => {
    const levels: number[] = [];
    for (let i = 0; i < data.length; i += 3) levels.push(0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]);
    return levels;
  }).sort((a, b) => a - b);
  const median = wallLevels[Math.floor(wallLevels.length / 2)] || 1;
  const scale = EXPOSURE / median;
  for (const s of fineList) for (let i = 0; i < s.grid.data.length; i++) s.grid.data[i] *= scale;

  return {
    floor: fine.floor.grid,
    ceiling: fine.ceiling.grid,
    walls: Object.fromEntries(room.walls.map((wall, i) => [wall.id, fine.walls[i].grid])),
  };
}
