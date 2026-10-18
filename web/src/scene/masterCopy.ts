// Master Copies (ADR-0009, lounge-v2 spec §3): one cleaned-up file per kind of furniture, drawn in the
// place of every Original of that kind. Its top-level nodes are its Parts, plus a soft `shadow`.
import type { Object3D } from 'three';
import { create } from 'zustand';
import type { PartDef } from '@shared/types';

/** The node every Master Copy carries for its soft shadow: it moves with the item, and isn't a Part. */
export const SHADOW_NODE = 'shadow';

/** A Master Copy's Parts: its top-level node names, in file order, except the shadow (spec §4). */
export function masterCopyParts(scene: Object3D): PartDef[] {
  return scene.children
    .filter(({ name }) => name !== SHADOW_NODE)
    .map(({ name }) => ({ id: name, name: name[0].toUpperCase() + name.slice(1) }));
}

/** Each loaded Master Copy's Parts, by its file ("models/chair.glb"), for the Inspector: MasterCopies fills it in. */
export const useMasterCopyParts = create<Record<string, PartDef[]>>()(() => ({}));
