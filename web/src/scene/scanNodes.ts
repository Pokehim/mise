import { BoxGeometry, DoubleSide, Group, Mesh, MeshStandardMaterial, type Object3D, type Side } from 'three';
import type { RoomSetup } from '@shared/types';
import type { SplitGroup } from '../setup/geometry/classify';
import { luminance } from '../setup/geometry/color';
import { applyParts } from './applyParts';
import { buildRoom } from './room/buildRoom';
import type { SplitNodeData, SplitScan } from './splitScan';

const matte = (color: string, side: Side) => new MeshStandardMaterial({ color, side, roughness: 0.9 });

/**
 * Gives a stand-in node the userData splitScan gives its own. Its flat color's luminance stands in
 * for a texture's average; the empty Shell has no color, so it takes splitScan's fallback, 0.5.
 */
function withNodeData<T extends Object3D>(node: T, group: SplitGroup): T {
  const color = node instanceof Mesh ? (node.material as MeshStandardMaterial).color : null;
  node.userData = { ...group, avgLuminance: color ? luminance(color.r, color.g, color.b) : 0.5 } satisfies SplitNodeData;
  return node;
}

/**
 * The room drawn from the Room Setup, for a Scan with no mesh file: the fixture, or a room with no
 * Capture (ADR-0010). Its walls, floor and ceiling come from buildRoom, with the room's computed
 * light, and each Original is a box. It returns what splitScan returns, with the same userData, so
 * the editor treats both the same way: each Original's mesh has its origin at the box's
 * bottom-center and is split into its Parts by applyParts.
 */
export function setupRoomNodes(setup: RoomSetup): SplitScan {
  const { floor, ceiling, walls } = buildRoom(setup);
  const originals = Object.fromEntries(setup.originals.map(({ id, label, category, box, partParams }) => {
    const [width, height, depth] = box.size;
    const mesh = new Mesh(new BoxGeometry(width, height, depth).translate(0, height / 2, 0), matte('#a8957c', DoubleSide));
    mesh.name = label;
    mesh.position.set(...box.position);
    mesh.rotation.y = box.rotationY;
    // Before applyParts, which gives the mesh one material per Part in place of its own.
    withNodeData(mesh, { kind: 'original', id });
    applyParts(mesh, category, box.size, partParams);
    return [id, mesh];
  }));
  // No mesh, so no Fill Capture to take Patches from.
  return { shell: withNodeData(new Group(), { kind: 'shell' }), floor, ceiling, walls, originals, patches: {} };
}
