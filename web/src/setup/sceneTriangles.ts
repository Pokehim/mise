import { Matrix4, Mesh, type Object3D } from 'three';
import type { YawTransform } from '@shared/types';
import { type TriangleMesh, mergeMeshes } from './geometry/mesh';

/** The matrix of a meshTransform: capture frame → room frame. */
export const meshTransformMatrix = ({ position, rotationY }: YawTransform) =>
  new Matrix4().makeRotationY(rotationY).setPosition(...position);

/**
 * The matrix from each mesh of a loaded glTF scene into the room frame (or, with no meshTransform,
 * into the capture's frame), ignoring the scene's own transform.
 */
export function toFrame(gltfScene: Object3D, meshTransform?: YawTransform): (mesh: Mesh) => Matrix4 {
  gltfScene.updateMatrixWorld(true);
  const sceneToFrame = new Matrix4().copy(gltfScene.matrixWorld).invert();
  if (meshTransform) sceneToFrame.premultiply(meshTransformMatrix(meshTransform));
  return (mesh) => new Matrix4().multiplyMatrices(sceneToFrame, mesh.matrixWorld);
}

/** One mesh's triangles, moved by a matrix. Reads any attribute layout (interleaved, quantized), and indexes an unindexed mesh. */
export function meshTriangles(mesh: Mesh, matrix: Matrix4): TriangleMesh {
  const position = mesh.geometry.attributes.position;
  const positions = new Float32Array(position.count * 3);
  const e = matrix.elements;
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    positions[3 * i] = e[0] * x + e[4] * y + e[8] * z + e[12];
    positions[3 * i + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
    positions[3 * i + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
  }
  const index = mesh.geometry.index
    ? new Uint32Array(mesh.geometry.index.array)
    : Uint32Array.from({ length: position.count - (position.count % 3) }, (_, i) => i);
  return { positions, index };
}

/** Every triangle of a loaded glTF scene as one TriangleMesh, in the room frame or, with no meshTransform, the capture's. */
export function sceneTriangles(gltfScene: Object3D, meshTransform?: YawTransform): TriangleMesh {
  const matrixOf = toFrame(gltfScene, meshTransform);
  const meshes: TriangleMesh[] = [];
  gltfScene.traverse((object) => {
    if (object instanceof Mesh && object.geometry.attributes.position) meshes.push(meshTriangles(object, matrixOf(object)));
  });
  return mergeMeshes(meshes);
}
