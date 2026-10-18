import { describe, expect, it } from 'vitest';
import type { Vec2, Vec3, YawTransform } from '@shared/types';
import {
  applyYaw, composeYaw, fitCorners, invertYaw, refineAlignment, registerMoved, surfaceSamples, transformMesh, triangleSamples,
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
