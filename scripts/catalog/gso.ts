// scripts/catalog/gso.ts — Google Scanned Objects (CC BY 4.0) for the Catalog: scans of real household products.
//
// Each model is a zip on Gazebo Fuel holding meshes/model.obj, with one texture, materials/textures/texture.png. The
// OBJ is in meters with +Z up, as SDF has it; this file turns it into a glTF with +Y up. Which way a scan faces is
// whatever way it lay on the turntable, so a pick turns it to face +Z.

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { Document, NodeIO, type TypedArray } from '@gltf-transform/core';
import { CACHE, cachedFile } from './download';

/** Fuel's old host: fuel.gazebosim.org, its new name, answers the same requests with 502 Bad Gateway for now. */
const FUEL = 'https://fuel.ignitionrobotics.org/1.0/GoogleResearch/models';

/** The model's page, the url of its Catalog item. */
export const gsoUrl = (name: string) => `https://app.gazebosim.org/GoogleResearch/fuel/models/${name}`;

/** A triangle mesh with one vertex per distinct position/uv/normal corner of the OBJ's faces. */
export interface Mesh {
  positions: Float32Array<ArrayBuffer>;
  uvs: Float32Array<ArrayBuffer>;
  normals: Float32Array<ArrayBuffer>;
  indices: Uint32Array<ArrayBuffer>;
}

/**
 * The triangles of an OBJ whose faces all have v/vt/vn corners, as Katamari, GSO's encoder, writes them. Faces with
 * more corners are fanned into triangles. Positions turn from +Z up to +Y up: (x, y, z) → (x, z, −y).
 */
export function parseObj(text: string): Mesh {
  const v: number[][] = [];
  const vt: number[][] = [];
  const vn: number[][] = [];
  const corners = new Map<string, number>();
  const positions: number[] = [];
  const uvs: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const upright = ([x, y, z]: number[]) => [x, z, -y];
  const corner = (key: string) => {
    let index = corners.get(key);
    if (index === undefined) {
      const [p, t, n] = key.split('/').map((i) => Number(i) - 1);
      if (!v[p] || !vt[t] || !vn[n]) throw new Error(`OBJ face corner "${key}" is not v/vt/vn`);
      index = corners.size;
      corners.set(key, index);
      positions.push(...upright(v[p]));
      uvs.push(vt[t][0], 1 - vt[t][1]);          // OBJ's v runs up the image, glTF's down
      normals.push(...upright(vn[n]));
    }
    return index;
  };
  for (const line of text.split('\n')) {
    const [tag, ...fields] = line.trim().split(/\s+/);
    if (tag === 'v') v.push(fields.map(Number));
    else if (tag === 'vt') vt.push(fields.map(Number));
    else if (tag === 'vn') vn.push(fields.map(Number));
    else if (tag === 'f') {
      const face = fields.map(corner);
      for (let i = 1; i + 1 < face.length; i++) indices.push(face[0], face[i], face[i + 1]);
    }
  }
  return {
    positions: new Float32Array(positions), uvs: new Float32Array(uvs), normals: new Float32Array(normals),
    indices: new Uint32Array(indices),
  };
}

/** A glTF Document of one textured mesh, matte like the scans' Beckmann material. */
export function meshDocument(mesh: Mesh, texture: Uint8Array, mimeType: string, name: string): Document {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const accessor = (array: TypedArray, type: 'VEC2' | 'VEC3' | 'SCALAR') =>
    doc.createAccessor().setArray(array).setType(type).setBuffer(buffer);
  const material = doc.createMaterial(name).setRoughnessFactor(0.8).setMetallicFactor(0)
    .setBaseColorTexture(doc.createTexture(name).setImage(texture).setMimeType(mimeType));
  const primitive = doc.createPrimitive()
    .setAttribute('POSITION', accessor(mesh.positions, 'VEC3'))
    .setAttribute('NORMAL', accessor(mesh.normals, 'VEC3'))
    .setAttribute('TEXCOORD_0', accessor(mesh.uvs, 'VEC2'))
    .setIndices(accessor(mesh.indices, 'SCALAR'))
    .setMaterial(material);
  const node = doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(primitive));
  doc.createScene(name).addChild(node);
  return doc;
}

/** The scan named `name` (such as "Crosley_Alarm_Clock_Vintage_Metal") as a +Y-up glTF Document. */
export async function gsoDocument(name: string): Promise<Document> {
  const zip = await cachedFile(`${FUEL}/${name}/1/${name}.zip`, join('gso', `${name}.zip`));
  const dir = join(CACHE, 'gso', name);
  if (!existsSync(join(dir, 'meshes/model.obj'))) {
    await promisify(execFile)('unzip', ['-o', '-q', zip, 'meshes/*', 'materials/*', '-d', dir]);
  }
  const mesh = parseObj(await readFile(join(dir, 'meshes/model.obj'), 'utf8'));
  return meshDocument(mesh, await readFile(join(dir, 'materials/textures/texture.png')), 'image/png', name);
}

/** Writes a Document as a GLB, the form catalog-build centers and optimizes. */
export const writeGlb = (doc: Document, file: string) => new NodeIO().write(file, doc);
