import { Matrix4, Mesh, type Object3D, Quaternion, Vector3 } from 'three';
import type { YawTransform } from '@shared/types';
import { type TriangleMesh, mergeMeshes } from './geometry/mesh';

/**
 * Every triangle of a loaded glTF scene as one TriangleMesh, in the capture's frame, or in the
 * room frame when a meshTransform is given. The scene's own transform is ignored, as splitScan does.
 */
export function sceneTriangles(gltfScene: Object3D, meshTransform?: YawTransform): TriangleMesh {
  gltfScene.updateMatrixWorld(true);
  const toFrame = new Matrix4().copy(gltfScene.matrixWorld).invert();
  if (meshTransform) {
    toFrame.premultiply(new Matrix4().compose(
      new Vector3(...meshTransform.position),
      new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), meshTransform.rotationY),
      new Vector3(1, 1, 1),
    ));
  }
  const meshes: TriangleMesh[] = [];
  const v = new Vector3();
  gltfScene.traverse((object) => {
    if (!(object instanceof Mesh) || !object.geometry.attributes.position) return;
    const matrix = new Matrix4().multiplyMatrices(toFrame, object.matrixWorld);
    const position = object.geometry.attributes.position;
    const positions = new Float32Array(position.count * 3);
    for (let i = 0; i < position.count; i++) v.fromBufferAttribute(position, i).applyMatrix4(matrix).toArray(positions, 3 * i);
    const index = object.geometry.index
      ? new Uint32Array(object.geometry.index.array)
      : Uint32Array.from({ length: position.count - (position.count % 3) }, (_, i) => i);
    meshes.push({ positions, index });
  });
  return mergeMeshes(meshes);
}
