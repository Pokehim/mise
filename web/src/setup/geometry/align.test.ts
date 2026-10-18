import { describe, expect, it } from 'vitest';
import type { Vec2, Vec3, YawTransform } from '@shared/types';
import {
  type ScaledYaw, applyYaw, composeYaw, fitCorners, fitSimilar, invertYaw, refineAlignment, refineScaled, registerDetail,
  registerMoved, surfaceSamples, transformMesh, triangleSamples,
} from './align';
import { mergeMeshes } from './mesh';
import { box, degrees } from './testShapes';
import { wallsFromPolygon } from './walls';

const close = (a: number[], b: number[], digits: number) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], digits));
const point = (t: YawTransform, p: Vec3) => applyYaw(t, p);

describe('YawTransform algebra', () => {
  const a: YawTransform = { position: [1, -0.5, 2], rotationY: 0.4 };
  const b: YawTransform = { position: [-0.3, 0.2, 0.7], rotationY: -1.1 };
  const p: Vec3 = [0.6, 1.2, -2.3];

  it('composes so that a ∘ b applies b first', () => {
    close(point(composeYaw(a, b), p), point(a, point(b, p)), 9);
  });

  it('inverts', () => {
    close(point(composeYaw(invertYaw(a), a), p), p, 9);
  });

  it('composes and inverts with a scale, as a Detail Capture transform has, scaling first', () => {
    const scaled: ScaledYaw = { ...b, scale: 1.3 };
    close(point(scaled, p), point(b, p.map((v) => v * 1.3) as Vec3), 9);
    close(point(composeYaw(a, scaled), p), point(a, point(scaled, p)), 9);
    close(point(composeYaw(invertYaw(scaled), scaled), p), p, 9);
    expect(composeYaw(a, b)).not.toHaveProperty('scale');
  });

  it('turns +Z toward +X for a positive angle, as three.js does', () => {
    close(point({ position: [0, 0, 0], rotationY: Math.PI / 2 }, [0, 0, 1]), [1, 0, 0], 9);
  });
});

describe('fitCorners', () => {
  const truth: YawTransform = { position: [1.2, 0, -0.6], rotationY: 0.37 };
  const room: Vec2[] = [[-2.7, -3], [2.7, -3], [2.7, 3], [-2.7, 3]];
  // The same corners as a Fill Capture sees them, in its own frame.
  const fill: Vec2[] = room.map(([x, z]) => {
    const [fx, , fz] = applyYaw(invertYaw(truth), [x, 0, z]);
    return [fx, fz];
  });

  it('finds the turn and floor position that carry the clicked corners onto the room\'s', () => {
    const { rotationY, offset } = fitCorners(fill, room);
    expect(rotationY).toBeCloseTo(0.37, 9);
    close(offset, [1.2, -0.6], 9);
  });

  it('stays within a centimeter when the clicks are a centimeter off', () => {
    const wobbly = fill.map(([x, z], i): Vec2 => [x + (i % 2 ? 0.01 : -0.01), z + (i < 2 ? 0.01 : -0.01)]);
    const { rotationY, offset } = fitCorners(wobbly, room);
    expect(Math.abs(rotationY - 0.37)).toBeLessThan(degrees(0.5));
    close(offset, [1.2, -0.6], 1);
  });
});

/** A 5.4 × 2.7 × 6 m room's shell, facing in: 10 cm cells, like a scan. */
const shell = box([-2.7, 0, -3], [2.7, 2.7, 3], true, 30);
const polygon: Vec2[] = [[-2.7, -3], [2.7, -3], [2.7, 3], [-2.7, 3]];
const walls = wallsFromPolygon(polygon, 2.7);

describe('refineAlignment', () => {
  it('pulls a Fill Capture that is a few centimeters and degrees off back onto the room', () => {
    const truth: YawTransform = { position: [1.2, -0.8, -0.6], rotationY: 0.37 };
    const fill = transformMesh(shell, invertYaw(truth));   // the room as a Fill Capture sees it
    const start = composeYaw({ position: [0.05, 0.03, -0.04], rotationY: degrees(3) }, truth);

    const { transform, residual } = refineAlignment(
      triangleSamples(fill), surfaceSamples(shell, walls, polygon), start,
    );

    expect(Math.abs(transform.rotationY - truth.rotationY)).toBeLessThan(degrees(0.1));
    close(transform.position, truth.position, 2);
    expect(residual).toBeLessThan(0.005);
  });
});

describe('registerMoved', () => {
  // A sofa, in its own frame: a seat, a back along −Z, and one arm, so no turn looks like another.
  const sofa = mergeMeshes([
    box([-1, 0, -0.45], [1, 0.45, 0.45], false, 8),
    box([-1, 0.45, -0.45], [1, 0.9, -0.25], false, 8),
    box([0.8, 0.45, -0.25], [1, 0.65, 0.45], false, 4),
  ]);
  const inMain: YawTransform = { position: [0.4, 0, -2.4], rotationY: 0 };
  const inFill: YawTransform = { position: [-1.1, 0, 0.3], rotationY: Math.PI + 0.05 };

  it('finds where a moved piece stands in the Main Capture, trying all four turns', () => {
    const main = transformMesh(sofa, inMain);
    const fill = transformMesh(sofa, inFill);

    const { transform } = registerMoved(triangleSamples(fill), triangleSamples(main), [-1.1, 0.3], [0.4, -2.4]);

    // The sofa's corner, carried from where the Fill Capture saw it to where it stands in the Main Capture.
    const corner: Vec3 = [1, 0.9, -0.45];
    close(applyYaw(transform, applyYaw(inFill, corner)), applyYaw(inMain, corner), 2);
  });
});

// A chair in its own frame, its feet on the floor: a seat, a back along −Z, and four legs, so no
// turn or size looks like another.
const chair = mergeMeshes([
  box([-0.24, 0.42, -0.22], [0.24, 0.47, 0.24], false, 6),
  box([-0.24, 0.47, -0.25], [0.24, 0.85, -0.2], false, 6),
  ...[[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]].map(([x, z]) => box([x - 0.02, 0, z - 0.02], [x + 0.02, 0.42, z + 0.02], false, 3)),
]);
// Where the Main Capture's copy stands (the room frame), and how a Detail Capture's frame lines up
// with the room: turned, moved, and scaled, because its app got the chair's size wrong.
const inRoom: YawTransform = { position: [-0.47, 0, 2.18], rotationY: Math.PI };
const detailToRoom: ScaledYaw = { position: [-0.6, 0, 1.9], rotationY: 2.4, scale: 1.3 };
/** A room-frame point as the Detail Capture has it. */
const toDetail = (p: Vec3) => applyYaw(invertYaw(detailToRoom), p);
const detailChair = (() => {
  const { positions, index } = transformMesh(chair, inRoom);
  const moved = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i += 3) moved.set(toDetail([positions[i], positions[i + 1], positions[i + 2]]), i);
  return { positions: moved, index };
})();

describe('fitSimilar', () => {
  it("finds the turn, floor position and size that carry points clicked on a Detail Capture onto the room's", () => {
    const legs = ([[-0.2, 0, -0.2], [0.2, 0, -0.2], [0.2, 0, 0.2], [-0.2, 0, 0.2]] as Vec3[]).map((p) => applyYaw(inRoom, p));
    const flat = (p: Vec3): Vec2 => [p[0], p[2]];

    const { rotationY, offset, scale } = fitSimilar(legs.map((p) => flat(toDetail(p))), legs.map(flat));

    expect(scale).toBeCloseTo(1.3, 6);
    const found: ScaledYaw = { position: [offset[0], 0, offset[1]], rotationY, scale };
    close(applyYaw(found, [0.3, 0, -0.1]), applyYaw(detailToRoom, [0.3, 0, -0.1]), 6);
  });
});

describe('refineScaled', () => {
  it("pulls a Detail Capture's copy that is a few centimeters, degrees and percent off onto the Main Capture's", () => {
    const start: ScaledYaw = { ...composeYaw({ position: [0.04, 0, -0.03], rotationY: degrees(4) }, detailToRoom), scale: 1.3 * 1.05 };

    const { transform, residual } = refineScaled(triangleSamples(detailChair), triangleSamples(transformMesh(chair, inRoom)), start);

    expect(transform.scale).toBeCloseTo(1.3, 2);
    // The top of the chair's back, carried from the Detail Capture to where the chair stands.
    const corner = applyYaw(inRoom, [0.24, 0.85, -0.25]);
    close(applyYaw(transform, toDetail(corner)), corner, 2);
    expect(residual).toBeLessThan(0.005);
  });
});

describe('registerDetail', () => {
  it('never shrinks a copy to a speck that fits a Main copy too partial to tell its size: one leg tip', () => {
    const tip = transformMesh(box([-0.22, 0, -0.22], [-0.18, 0.06, -0.18], false, 3), inRoom);
    const [mx, , mz] = applyYaw(inRoom, [0, 0, 0]);
    const [dx, , dz] = toDetail([mx, 0, mz]);

    const { transform } = registerDetail(triangleSamples(detailChair), triangleSamples(tip), [dx, dz], [mx, mz], 1.3);

    expect(transform.scale).toBeGreaterThan(1.3 / 1.1 - 1e-9);
    expect(transform.scale).toBeLessThan(1.3 * 1.1 + 1e-9);
  });

  it("finds a Detail Capture's copy at any turn, from the two copies' middles and a rough size", () => {
    const [mx, , mz] = applyYaw(inRoom, [0, 0, 0]);
    const [dx, , dz] = toDetail([mx, 0, mz]);

    const { transform } = registerDetail(triangleSamples(detailChair), triangleSamples(transformMesh(chair, inRoom)), [dx, dz], [mx, mz], 1.3 * 0.95);

    expect(transform.scale).toBeCloseTo(1.3, 2);
    const corner = applyYaw(inRoom, [0.24, 0.85, -0.25]);
    close(applyYaw(transform, toDetail(corner)), corner, 2);
  }, 30_000);
});
