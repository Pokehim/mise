import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Document } from '@gltf-transform/core';
import { createDefaultPropertyResolver, dequantize } from '@gltf-transform/functions';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Box, RoomSetup, Vec3, YawTransform } from '../shared/types';
import { IDENTITY, type ScaledYaw, applyYaw, invertYaw, transformMesh } from '../web/src/setup/geometry/align';
import { triangleClassifier } from '../web/src/setup/geometry/classify';
import { mergeMeshes } from '../web/src/setup/geometry/mesh';
import { box, horizontal } from '../web/src/setup/geometry/testShapes';
import {
  type GapPiece, type Source, addPieces, captureGain, captureSources, gapFill, readCapture, registerCloseup, surfaces,
} from './capture-tools';
import { SCANS_DIR, io } from './scan-import';
import { LOUNGE_FILL_TRANSFORM } from './synthetic-room';

/** The synthetic lounge's two Captures, in the room frame: its Main Capture, and its Fill Capture, exposed 10% darker. */
describe('captureGain and gapFill on the synthetic lounge', () => {
  let dir: string;
  let setup: RoomSetup;
  let main: Source[];
  let fill: Source[];
  let gaps: GapPiece[];
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'capture-tools-'));
    await cp(join(SCANS_DIR, 'synthetic-lounge'), dir, { recursive: true });
    await addToFill(dir, [
      // Floor beyond the East wall (x = 2.7), like a hallway seen through a door: outside the room.
      [[2.8, 0, -0.5], [2.8, 0, 0.5], [3.8, 0, 0.5], [3.8, 0, -0.5]],
      // A strip of the West wall (x = −2.7) above the 2.7 m ceiling.
      [[-2.69, 2.8, 0.5], [-2.69, 2.8, -0.5], [-2.69, 3.3, -0.5], [-2.69, 3.3, 0.5]],
      // The North wall (z = −3) right of its second window, which the Main Capture saw, as this Capture
      // saw it 3.6 cm further into the room: one wall seen two ways, which gap fill must not double.
      [[1.9, 1.2, -2.964], [2.5, 1.2, -2.964], [2.5, 1.8, -2.964], [1.9, 1.8, -2.964]],
    ]);
    setup = JSON.parse(await readFile(join(dir, 'setup.json'), 'utf8'));
    const { classify } = triangleClassifier(setup);
    main = captureSources(await readCapture(join(dir, 'captures/main.glb')), IDENTITY, IDENTITY, classify);
    fill = captureSources(await readCapture(join(dir, 'captures/fill-1.glb')), LOUNGE_FILL_TRANSFORM, IDENTITY, classify);
    gaps = await gapFill(setup, main, [fill]);
  }, 60_000);
  afterAll(() => rm(dir, { recursive: true, force: true }));

  it('matches a whole Capture to another with one gain: this one was exposed 10% darker', async () => {
    const { gain, cells } = await captureGain(surfaces(main, setup), surfaces(fill, setup));
    expect(cells).toBeGreaterThan(100);
    // 10% darker in sRGB is about 20% darker in linear light, where glTF's baseColorFactor multiplies.
    for (const channel of gain) {
      expect(channel).toBeGreaterThan(1.2);
      expect(channel).toBeLessThan(1.32);
    }
  });

  it('fills gaps only with floor and wall the reference never saw, and only inside the room', () => {
    expect(gaps.map((g) => g.capture)).toEqual([0]);
    const triangles = gaps[0].triangles;
    // Inside the floor polygon (x ±2.7, z ±3) grown by 5 cm, and below the 2.7 m ceiling: not the
    // hallway floor or the wall above the ceiling that the Fill Capture also saw.
    for (const { centroid: [x, y, z] } of triangles) {
      expect(Math.abs(x)).toBeLessThan(2.75);
      expect(Math.abs(z)).toBeLessThan(3.05);
      expect(y).toBeLessThan(2.7);
    }
    // The Main Capture saw all of the floor and walls except under and behind the furniture resting
    // on the floor: the sofa against the West wall, the armchair, and the Kept bench, which stayed put
    // for the Fill Capture too. So every gap lies in the sofa's or the armchair's spot, and not on the
    // North wall the Main Capture saw, though the Fill Capture had it 3.6 cm off.
    const inSofaSpot = ([x, , z]: Vec3) => x < -2.22 + 0.45 + 0.05 && Math.abs(z) < 1.05 + 0.05;
    const inArmchairSpot = ([x, , z]: Vec3) => Math.abs(x + 0.9) < 0.45 && Math.abs(z - 1.9) < 0.45;
    expect(triangles.filter((t) => !inSofaSpot(t.centroid) && !inArmchairSpot(t.centroid))).toEqual([]);
    // And it does fill them: the floor under the sofa, and the wall behind it.
    const area = (list: typeof triangles) => list.reduce((sum, t) => sum + t.area, 0);
    expect(area(triangles.filter((t) => inSofaSpot(t.centroid) && t.normal[1] > 0.8))).toBeGreaterThan(0.9 * 2.1 * 0.9);
    expect(area(triangles.filter((t) => inSofaSpot(t.centroid) && t.normal[0] > 0.8))).toBeGreaterThan(0.9 * 2.1 * 0.8);
  });

  it("color-matches what it fills to the reference: the 10% darker Capture's gain", () => {
    for (const channel of gaps[0].gainAt([-2.5, 0, 0])) {
      expect(channel).toBeGreaterThan(1.2);
      expect(channel).toBeLessThan(1.32);
    }
  });

  it('writes the pieces with their gain per vertex, split between the vertex colors and the material', async () => {
    const out = new Document();
    out.createScene();
    const from = await readCapture(join(dir, 'captures/fill-1.glb'));
    // Sources hold the triangles; the material comes from the document they were read from.
    const sources = captureSources(from, LOUNGE_FILL_TRANSFORM, IDENTITY, triangleClassifier(setup).classify);
    const pieces = await gapFill(setup, main, [sources]);
    const gainAt = (p: Vec3): Vec3 => [1.5 + p[2] / 10, 1.2, 0.8];
    const added = addPieces(out, from, createDefaultPropertyResolver(out, from), pieces[0].triangles, gainAt, 'Gap fill', { mise: { fill: { kind: 'gap', capture: 0 } } });

    expect(added).toBe(pieces[0].triangles.length);
    for (const primitive of out.getRoot().listMeshes().flatMap((m) => m.listPrimitives())) {
      const factor = primitive.getMaterial()!.getBaseColorFactor();
      const colors = primitive.getAttribute('COLOR_0')!;
      const positions = primitive.getAttribute('POSITION')!;
      for (let i = 0; i < colors.getCount(); i += 50) {
        const color = colors.getElement(i, [] as number[]);
        const expected = gainAt(positions.getElement(i, [] as number[]) as Vec3);
        // Fill Capture positions here are in the room frame already (the synthetic lounge's meshTransform is identity).
        for (let c = 0; c < 3; c++) expect(color[c] * factor[c]).toBeCloseTo(expected[c], 4);
        expect(Math.max(...color)).toBeLessThanOrEqual(1);
      }
    }
  }, 60_000);
});

describe('registerCloseup', () => {
  // A chair, its feet on the floor: a seat, a back along −Z, and four legs.
  const chair = mergeMeshes([
    box([-0.24, 0.42, -0.22], [0.24, 0.47, 0.24], false, 6),
    box([-0.24, 0.47, -0.25], [0.24, 0.85, -0.2], false, 6),
    ...[[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]].map(([x, z]) => box([x - 0.02, 0, z - 0.02], [x + 0.02, 0.42, z + 0.02], false, 3)),
  ]);
  // Where it stands in the room, and how a close-up's frame lines up with the room: turned, moved,
  // and scaled, because the close-up's app got the chair's size 30% wrong.
  const inRoom: YawTransform = { position: [-0.47, 0, 2.18], rotationY: Math.PI };
  const closeupToRoom: ScaledYaw = { position: [-0.6, 0, 1.9], rotationY: 2.4, scale: 1.3 };
  const floor = horizontal([-1.5, 1], [0.5, 3.4], 0);
  const room = mergeMeshes([transformMesh(chair, inRoom), floor]);
  // The close-up: the same chair and some floor, in its own frame.
  const closeup = transformMesh(room, invertYaw(closeupToRoom));
  const chairBox: Box = { position: [-0.47, 0, 2.18], size: [0.5, 0.86, 0.52], rotationY: Math.PI };

  it("finds a close-up's size, turn and place from its copy in the room scan", () => {
    const { transform, heightScale, residual } = registerCloseup(closeup, room, chairBox);

    expect(heightScale).toBeCloseTo(1.3, 1);
    expect(transform.scale).toBeCloseTo(1.3, 2);
    // The top of the chair's back, carried from the close-up to where the chair stands.
    const corner = applyYaw(inRoom, [0.24, 0.85, -0.25]);
    applyYaw(transform, applyYaw(invertYaw(closeupToRoom), corner)).forEach((v, a) => expect(v).toBeCloseTo(corner[a], 2));
    expect(residual).toBeLessThan(0.005);
  });
});

/** Adds quads (corners in the room frame, counter-clockwise seen from the front) to the lounge's Fill Capture, with its texture. */
async function addToFill(dir: string, quads: Vec3[][]) {
  const path = join(dir, 'captures/fill-1.glb');
  const fill = await io.read(path);
  await fill.transform(dequantize());
  const toFill = invertYaw(LOUNGE_FILL_TRANSFORM);
  const positions = new Float32Array(quads.flatMap((quad) => quad.flatMap((corner) => applyYaw(toFill, corner))));
  const uvs = new Float32Array(quads.flatMap(() => [0.1, 0.1, 0.1, 0.9, 0.9, 0.9, 0.9, 0.1]));
  const index = new Uint32Array(quads.flatMap((_, q) => [0, 1, 2, 0, 2, 3].map((k) => 4 * q + k)));
  const buffer = fill.getRoot().listBuffers()[0];
  const primitive = fill.createPrimitive()
    .setAttribute('POSITION', fill.createAccessor().setType('VEC3').setArray(positions).setBuffer(buffer))
    .setAttribute('TEXCOORD_0', fill.createAccessor().setType('VEC2').setArray(uvs).setBuffer(buffer))
    .setIndices(fill.createAccessor().setType('SCALAR').setArray(index).setBuffer(buffer))
    .setMaterial(fill.getRoot().listMaterials()[0]);
  fill.getRoot().listScenes()[0].addChild(fill.createNode('outside').setMesh(fill.createMesh().addPrimitive(primitive)));
  await io.write(path, fill);
}
