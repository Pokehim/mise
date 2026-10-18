import {
  BackSide, BoxGeometry, DoubleSide, Group, Matrix4, Mesh, MeshStandardMaterial, type Object3D, Path, Shape,
  ShapeGeometry, type Side, Vector2, Vector3,
} from 'three';
import type { RoomSetup, Wall } from '@shared/types';
import { luminance } from '../setup/geometry/color';
import { floorGeometry } from './floorPlan';
import type { SplitNodeData, SplitScan } from './splitScan';

const matte = (color: string, side: Side) => new MeshStandardMaterial({ color, side, roughness: 0.9 });

/**
 * Gives a stand-in node the userData splitScan gives its own. Its flat color's luminance stands in
 * for a texture's average; the empty Shell has no color, so it takes splitScan's fallback, 0.5.
 */
function withData<T extends Object3D>(node: T, kind: SplitNodeData['kind'], id?: string): T {
  const color = node instanceof Mesh ? (node.material as MeshStandardMaterial).color : null;
  node.userData = { kind, ...(id && { id }), avgLuminance: color ? luminance(color.r, color.g, color.b) : 0.5 } satisfies SplitNodeData;
  return node;
}

/**
 * A plain room drawn from the Room Setup, for a Scan with no mesh file yet, such as the fixture.
 * Unlike a real Scan it has no baked lighting, so it keeps lit materials. Otherwise it keeps
 * splitScan's contract, userData included, so the editor treats both the same way.
 */
export function setupRoomNodes(setup: RoomSetup): SplitScan {
  const plan = floorGeometry(setup);
  const floor = withData(new Mesh(plan, matte('#cbbfa9', DoubleSide)), 'floor');
  const ceiling = withData(new Mesh(plan, matte('#f2efe9', BackSide)), 'ceiling');
  ceiling.position.y = setup.ceilingHeight;

  const walls = Object.fromEntries(setup.walls.map((wall) => [wall.id, wallMesh(wall, setup)]));
  const originals = Object.fromEntries(setup.originals.map(({ id, label, box }) => {
    const [width, height, depth] = box.size;
    const mesh = new Mesh(new BoxGeometry(width, height, depth).translate(0, height / 2, 0), matte('#a8957c', DoubleSide));
    mesh.name = label;
    mesh.position.set(...box.position);
    mesh.rotation.y = box.rotationY;
    return [id, withData(mesh, 'original', id)];
  }));
  return { shell: withData(new Group(), 'shell'), floor, ceiling, walls, originals };
}

/** A Wall as a flat panel with its Openings cut out. Double-sided, so WallFader has something to fade. */
function wallMesh(wall: Wall, setup: RoomSetup) {
  const [sx, sz] = wall.start;
  const along = new Vector3(wall.end[0] - sx, 0, wall.end[1] - sz);
  const length = along.length();
  const outline = new Shape([new Vector2(0, 0), new Vector2(length, 0), new Vector2(length, wall.height), new Vector2(0, wall.height)]);
  for (const opening of setup.openings.filter((o) => o.wallId === wall.id)) {
    // Lift doors off the bottom edge: a cutout that touches the outline doesn't triangulate.
    const bottom = Math.max(opening.bottom, 0.001);
    const [left, right, top] = [opening.offset, opening.offset + opening.width, opening.bottom + opening.height];
    outline.holes.push(new Path([new Vector2(left, bottom), new Vector2(right, bottom), new Vector2(right, top), new Vector2(left, top)]));
  }
  // Shape x runs from start to end and y is up.
  const x = along.normalize();
  const y = new Vector3(0, 1, 0);
  const toRoom = new Matrix4().makeBasis(x, y, new Vector3().crossVectors(x, y)).setPosition(sx, 0, sz);
  const mesh = new Mesh(new ShapeGeometry(outline).applyMatrix4(toRoom), matte('#e9e4da', DoubleSide));
  mesh.name = wall.name;
  return withData(mesh, 'wall', wall.id);
}
