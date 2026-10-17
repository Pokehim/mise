import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// Catalog models and Scan meshes both come out of gltf-transform optimize, which applies
// meshopt compression, so every GLTFLoader needs the decoder (spec §8.1).
export const withMeshopt = (loader: GLTFLoader) => {
  loader.setMeshoptDecoder(MeshoptDecoder);
};

export { GLTFLoader };
