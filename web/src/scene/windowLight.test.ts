import { describe, expect, it } from 'vitest';
import { Box3, Vector3 } from 'three';
import { setup } from '@shared/test-room';
import type { Opening, RoomSetup } from '@shared/types';
import { roomBounds } from './floorPlan';
import { windowLight } from './windowLight';

/** The room's corners as the light's shadow camera sees them: inside its view box when they're in [-1, 1]. */
function cornersInShadowCamera(room: RoomSetup) {
  const light = windowLight(room);
  const { camera } = light.shadow;
  const { min, max } = roomBounds(room);
  return [min.x, max.x].flatMap((x) => [min.y, max.y].flatMap((y) => [min.z, max.z].map((z) =>
    new Vector3(x, y, z).project(camera))));
}

describe('windowLight', () => {
  it('shines from the window, through it, at the middle of the floor', () => {
    // The test room's window is in the North wall (z = −1.5), at x −0.6 to 0.6, 0.9 to 2.1 m up.
    const light = windowLight(setup);
    expect(light.target.position.toArray()).toEqual([0, 0, 0]);
    expect(light.position.z).toBeLessThan(-1.5);
    expect(light.position.x).toBeCloseTo(0);
    // On the line from the floor's center through the window's center.
    const through = light.position.clone().normalize();
    expect(through.distanceTo(new Vector3(0, 1.5, -1.5).normalize())).toBeCloseTo(0);
    expect(light.castShadow).toBe(true);
    expect(light.shadow.mapSize.toArray()).toEqual([2048, 2048]);
  });

  it('comes from the largest window', () => {
    const wide: Opening = { id: 'op_wide', kind: 'window', wallId: 'wl_east', offset: 0.5, width: 2, bottom: 0.8, height: 1.4 };
    const light = windowLight({ ...setup, openings: [...setup.openings, wide] });
    expect(light.position.x).toBeGreaterThan(2);
  });

  it('comes from the ceiling when the room has no window', () => {
    const light = windowLight({ ...setup, openings: setup.openings.filter(({ kind }) => kind !== 'window') });
    expect(light.position.x).toBeCloseTo(0);
    expect(light.position.z).toBeCloseTo(0);
    expect(light.position.y).toBeGreaterThan(setup.ceilingHeight);
  });

  it('fits its shadow camera to the whole room', () => {
    for (const room of [setup, { ...setup, openings: [] }]) {
      const corners = cornersInShadowCamera(room);
      const box = new Box3().setFromPoints(corners);
      expect(box.min.toArray().every((v) => v >= -1 - 1e-9)).toBe(true);
      expect(box.max.toArray().every((v) => v <= 1 + 1e-9)).toBe(true);
      // Fitted, not just big enough: the room touches the edges of the view box.
      expect(box.min.x).toBeCloseTo(-1);
      expect(box.max.x).toBeCloseTo(1);
    }
  });
});
