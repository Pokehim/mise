import { Group, Mesh } from 'three';
import { describe, expect, it } from 'vitest';
import { masterCopyParts } from './masterCopy';

/** A loaded glTF scene with these top-level nodes, each holding a mesh of its own. */
function sceneOf(...names: string[]) {
  const scene = new Group();
  for (const name of names) {
    const node = new Group();
    node.name = name;
    const mesh = new Mesh();
    mesh.name = `${name}_mesh`;
    node.add(mesh);
    scene.add(node);
  }
  return scene;
}

describe('masterCopyParts', () => {
  it("is the file's top-level node names, in file order, except shadow", () => {
    expect(masterCopyParts(sceneOf('seat', 'back', 'shadow', 'legs'))).toEqual([
      { id: 'seat', name: 'Seat' }, { id: 'back', name: 'Back' }, { id: 'legs', name: 'Legs' },
    ]);
  });
});
