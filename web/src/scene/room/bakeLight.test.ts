import { describe, expect, it } from 'vitest';
import type { RoomSetup } from '@shared/types';
import { setup } from '@shared/test-room';
import { bakeRoomLight, type LightGrid, lampPositions } from './bakeLight';

const albedo = { walls: [0.8, 0.78, 0.74], floor: [0.2, 0.2, 0.22], ceiling: [0.85, 0.85, 0.85] } as const;
const bake = (room: RoomSetup, sun = false) => bakeRoomLight(room, { albedo: { ...albedo } as never, sun });

/** A grid's luminance at a point, 0–1 along u and v. */
function at({ width, height, data }: LightGrid, fu: number, fv: number) {
  const index = (Math.min(height - 1, Math.floor(fv * height)) * width + Math.min(width - 1, Math.floor(fu * width))) * 3;
  return 0.2126 * data[index] + 0.7152 * data[index + 1] + 0.0722 * data[index + 2];
}

describe('bakeRoomLight', () => {
  it('lights every Surface, the same way every time', () => {
    const started = performance.now();
    const light = bake(setup);
    console.log(`bakeRoomLight: ${Math.round(performance.now() - started)} ms for a 4 × 3 m room`);
    for (const grid of [light.floor, light.ceiling, ...Object.values(light.walls)]) {
      expect(grid.data.every((v) => Number.isFinite(v) && v >= 0)).toBe(true);
      expect(Math.max(...grid.data)).toBeGreaterThan(0.05);
    }
    expect(Object.keys(light.walls)).toEqual(setup.walls.map((wall) => wall.id));
    expect(bake(setup).floor.data).toEqual(light.floor.data);
  });

  it('lights the floor most near the window', () => {
    // The window is in the North wall (z = −1.5, v = 0) at x −0.6 to 0.6 (u = 0.35–0.65).
    const { floor } = bake(setup);
    expect(at(floor, 0.5, 0.1)).toBeGreaterThan(at(floor, 0.5, 0.9) * 1.3);
  });

  it('darkens the corners, where less light reaches', () => {
    const { walls } = bake(setup);
    const east = walls.wl_east;
    // Halfway up the East wall: its middle against the corner it shares with the South wall.
    expect(at(east, 0.5, 0.5)).toBeGreaterThan(at(east, 0.99, 0.5));
  });

  it('puts a sun patch on the floor, past the sill', () => {
    // The sun is 30° up, so through a sill 0.9 m high it lands 1.5–3 m from the window: z 0 to 1.5, v 0.5–1.
    const plain = bake(setup).floor;
    const sunny = bake(setup, true).floor;
    const gain = Array.from({ length: 30 }, (_, i) => at(sunny, 0.2 + i * 0.02, 0.75) / at(plain, 0.2 + i * 0.02, 0.75));
    expect(Math.max(...gain)).toBeGreaterThan(1.5);
  });

  it('keeps light in an L-shaped room from passing through its walls', () => {
    // An L: 4 × 4 m with the north-east 2 × 2 m quarter taken out. The window is in the west leg's North wall.
    const polygon: [number, number][] = [[-2, -2], [0, -2], [0, 0], [2, 0], [2, 2], [-2, 2]];
    const walls = polygon.map((start, i) => {
      const end = polygon[(i + 1) % polygon.length];
      const [dx, dz] = [end[0] - start[0], end[1] - start[1]];
      const length = Math.hypot(dx, dz);
      return { id: `wl_${i + 1}`, name: `Wall ${i + 1}`, start, end, normal: [-dz / length, dx / length] as [number, number], height: 2.5 };
    });
    const room: RoomSetup = {
      version: 1, scanId: 'l-room', ceilingHeight: 2.5, floor: { polygon }, walls, originals: [],
      openings: [{ id: 'op_1', kind: 'window', wallId: 'wl_1', offset: 0.5, width: 1, bottom: 0.9, height: 1.2 }],
    };
    const { floor } = bake(room);
    // In front of the window (x −1, z −1.5), and in the far east leg (x 1.5, z 1.5), round the corner.
    expect(at(floor, 0.25, 0.125)).toBeGreaterThan(at(floor, 0.875, 0.875) * 2);
    expect(lampPositions(room).every(([x, z]) => !(x > 0 && z < 0))).toBe(true);
  });
});
