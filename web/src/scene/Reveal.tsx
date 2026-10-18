/*
 * The reveal of a Claude Design (spec §13.1, step 6): opening a Design Claude made replays its Edits one
 * at a time, about 350 ms each, so the room assembles itself; a bookcase's books come in together. Paint
 * fades in, Pieces drop in from 0.3 m above while they grow from 90% to full size, and replaced or removed
 * Originals fade out. A Refine's new Edits play the same way.
 *
 * The room is still replay(edits) (ADR-0001): while a reveal plays, the store's roomState is the replay of
 * the Edits shown so far, and the Design itself doesn't change, so nothing is saved. Any change to the
 * Edits (an Edit, undo) ends it, and the room is the whole Design again.
 *
 *   reveal(from)    Replays the open Design's Edits from `from` on; the ones before it show at once.
 *   useReveal       { run }: the reveal playing, if any: the Edits it plays and the next one to show.
 *   <Reveal ready>  In the Canvas: steps the reveal once `ready` (the Scan is drawn), and animates each step.
 */
import { useFrame, useLoader, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { Group, type Material, type Mesh, type Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { create } from 'zustand';
import { roomItems } from '@shared/fit';
import { pointInPolygon } from '@shared/geometry';
import type { Catalog, Edit, Finish, LibraryMaterial, Placement, RoomSetup, RoomState } from '@shared/types';
import { replay } from '../state/core';
import { useEditor } from '../state/store';
import { recolorParts } from './applyParts';
import { withMeshopt } from './gltf';
import { applyFinish, useMaterialLibrary } from './materials/triplanar';
import { forEachMaterial, ignoreRaycast } from './objects';
import { SHOT_NUMBER } from './shots';
import type { SplitNodeData } from './splitScan';

/** How long each Edit takes to show (spec §13.1). */
export const STEP_MS = 350;
/** The pause before the first Edit, once the room is drawn. */
const LEAD_MS = 300;
/** How far above its place a Piece drops in from, and the size it grows from. */
const DROP_M = 0.3;
const START_SCALE = 0.9;
/** How long a dropping Piece's model may take to load before it just appears. */
const SIGHT_TIMEOUT_MS = 8000;

export interface RevealRun { designId: string; edits: Edit[]; next: number }

export const useReveal = create<{ run: RevealRun | null }>()(() => ({ run: null }));

/** Replays the open Design's Edits from `from` on, one at a time. The room shows the Edits before `from` at once. */
export function reveal(from = 0) {
  const { design, setup, catalog } = useEditor.getState();
  if (!design || !setup || !catalog || from >= design.edits.length) return;
  useReveal.setState({ run: { designId: design.id, edits: design.edits, next: from } });
  useEditor.setState({ roomState: replay(setup, catalog, design.edits.slice(0, from)), selection: null });
}

// Opening a Claude Design reveals it, from before its first frame is drawn. Any change to its Edits ends a reveal.
useEditor.subscribe((state, prev) => {
  const { run } = useReveal.getState();
  if (run && state.design?.edits !== run.edits) useReveal.setState({ run: null });
  const opened = state.status === 'ready' && (prev.status !== 'ready' || prev.design?.id !== state.design?.id);
  // ?shot= is a screenshot of the finished room.
  // One made on top of another Design reveals only its own Edits: the room it started from shows at once.
  if (opened && state.design?.origin === 'claude' && !SHOT_NUMBER) reveal(state.design.startedFrom?.edits ?? 0);
});

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const easeOut = (t: number) => 1 - (1 - t) ** 3;
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

/** A copy of something as it looked before a step, fading out over what it looks like now. */
interface Ghost {
  kind: 'ghost';
  object: Object3D;
  source: Object3D;
  /** A Wall or Floor fades with its source, as WallFader fades the Wall; something removed fades on its own. */
  follow: boolean;
  materials: { material: Material; opacity: number }[];
  start: number;
}
/** A Piece dropping in, once its model has loaded and it is in the scene. */
interface Drop { kind: 'drop'; pieceId: string; created: number; start?: number }
/** A Piece or an Original gliding to where a move Edit put it. */
interface Slide { kind: 'slide'; object: Object3D; from: Placement; to: Placement; start: number }
type Effect = Ghost | Drop | Slide;

/** Steps the reveal once the Scan is drawn, and animates each step. Mount it in the Canvas. */
export function Reveal({ ready }: { ready: boolean }) {
  const scene = useThree((s) => s.scene);
  const library = useMaterialLibrary();
  const ghosts = useMemo(() => Object.assign(new Group(), { name: 'reveal' }), []);
  const effects = useRef<Effect[]>([]);
  const nextAt = useRef<{ run: RevealRun; at: number } | null>(null);
  const runEdits = useReveal((s) => s.run?.edits);

  // The Pieces' models load while the room is drawn and the first Edits play, so each drops in on time.
  useEffect(() => {
    const { catalog } = useEditor.getState();
    const models = new Set((runEdits ?? []).flatMap((edit) => ('catalogId' in edit ? [edit.catalogId] : [])));
    for (const item of catalog?.items ?? []) if (models.has(item.id)) useLoader.preload(GLTFLoader, item.model, withMeshopt);
  }, [runEdits]);

  useEffect(() => () => {
    effects.current.forEach((effect) => settle(effect, scene));
    effects.current = [];
  }, [scene]);

  useFrame(() => {
    const now = performance.now();
    const { run } = useReveal.getState();
    if (run && ready) {
      if (nextAt.current?.run !== run) nextAt.current = { run, at: now + LEAD_MS };
      if (now >= nextAt.current.at) {
        const shown = step(run, { scene, ghosts, library, now, motion: !reducedMotion() });
        effects.current.push(...shown.effects);
        nextAt.current = shown.run && { run: shown.run, at: now + STEP_MS };
        useReveal.setState({ run: shown.run });
      }
    }
    effects.current = effects.current.filter((effect) => animate(effect, scene, now));
  });

  return <primitive object={ghosts} />;
}

/** Where a step happens: the scene, the group its ghosts go in, the Material Library, the time, and whether things may move. */
interface Stage {
  scene: Object3D;
  ghosts: Group;
  library: ReadonlyMap<string, LibraryMaterial> | null;
  now: number;
  /** Under reduced motion, only fades (docs/design/sketch-style.md). */
  motion: boolean;
}

/**
 * Shows the run's next Edit, and the removals right after it, as one step: what was there before is
 * copied first, so it can fade out. Returns the step's effects, and the run left, or null once done.
 */
function step(run: RevealRun, stage: Stage) {
  const { setup, catalog, roomState: before } = useEditor.getState();
  let end = run.next + 1;
  // A remodel's removals, made by one call, go together, and so do the books put inside one shelf.
  if (run.edits[run.next].type === 'remove') while (run.edits[end]?.type === 'remove') end++;
  const shelf = shelfHolding(setup!, catalog!, before!, run.edits[run.next]);
  if (shelf) while (run.edits[end] && shelfHolding(setup!, catalog!, before!, run.edits[end]) === shelf) end++;
  const after = replay(setup!, catalog!, run.edits.slice(0, end));
  const effects = run.edits.slice(run.next, end).flatMap((edit) => effectsOf(edit, before!, after, stage));
  useEditor.setState({ roomState: after });
  return { effects, run: end < run.edits.length ? { ...run, next: end } : null };
}

/** The shelf a placed Piece rests inside, on a level below its top, if it does: its id. */
function shelfHolding(setup: RoomSetup, catalog: Catalog, state: RoomState, edit: Edit): string | undefined {
  if (edit.type !== 'place' || edit.placement.mount !== 'surface') return undefined;
  const [x, y, z] = edit.placement.position;
  return roomItems(setup, catalog, state)
    .find(({ category, corners, heights }) => category === 'shelf' && y < heights[1] - 0.01 && pointInPolygon([x, z], corners))?.id;
}

/** What one Edit looks like as it is shown. */
function effectsOf(edit: Edit, before: RoomState, after: RoomState, { scene, ghosts, library, now, motion }: Stage): Effect[] {
  if (after.skipped.some(({ editId }) => editId === edit.id)) return [];
  const drop = (pieceId: string): Effect[] => (motion ? [{ kind: 'drop', pieceId, created: now }] : []);
  const ghostOf = (source: Object3D, restyle: (copy: Object3D) => void, follow: boolean) => [ghost(ghosts, source, restyle, follow, now)];
  /** A copy of a Piece or an Original as it was, fading out where it stood. */
  const fadeOut = (id: string): Effect[] => {
    const piece = pieceObject(scene, id);
    if (piece) return ghostOf(piece, (copy) => recolorParts(copy, before.pieces[id]?.partColors ?? {}), false);
    const original = before.originals[id]?.visible && nodeOf(scene, 'original', id);
    return original ? ghostOf(original, restyleOriginal(before, id, library), false) : [];
  };
  switch (edit.type) {
    case 'place':
      return drop(edit.pieceId);
    case 'swap':
      return [...fadeOut(edit.pieceId), ...drop(edit.pieceId)];
    case 'replace':
      return [...fadeOut(edit.originalId), ...drop(edit.pieceId)];
    case 'remove':
      return fadeOut(edit.targetId);
    case 'move': {
      const object = pieceObject(scene, edit.targetId) ?? nodeOf(scene, 'original', edit.targetId);
      const from = before.pieces[edit.targetId]?.placement ?? before.originals[edit.targetId]?.placement;
      return motion && object && from ? [{ kind: 'slide', object, from, to: edit.placement, start: now }] : [];
    }
    case 'recolor': {
      const piece = pieceObject(scene, edit.targetId);
      if (piece) return ghostOf(piece, (copy) => recolorParts(copy, before.pieces[edit.targetId]?.partColors ?? {}), true);
      const original = nodeOf(scene, 'original', edit.targetId);
      return original ? ghostOf(original, restyleOriginal(before, edit.targetId, library), true) : [];
    }
    case 'finish': {
      const { target } = edit;
      if (target.kind === 'original') {
        const original = nodeOf(scene, 'original', target.originalId);
        return original ? ghostOf(original, restyleOriginal(before, target.originalId, library), true) : [];
      }
      // Paint fades in: the Wall or Floor as it was fades out over its new Finish.
      const [node, look] = target.kind === 'wall'
        ? [nodeOf(scene, 'wall', target.wallId), before.surfaces.walls[target.wallId]]
        : [nodeOf(scene, 'floor'), before.surfaces.floor];
      return node ? ghostOf(node, restyleSurface(look, node, library), true) : [];
    }
  }
}

const restyleOriginal = (before: RoomState, id: string, library: ReadonlyMap<string, LibraryMaterial> | null) => (copy: Object3D) => {
  const { partColors = {}, partFinishes = {} } = before.originals[id] ?? {};
  recolorParts(copy, partColors, { partFinishes, library });
};

/** Draws a Wall's or the Floor's copy in its Finish before the step, as ScanColors does; trim, doors and glass keep their own. */
const restyleSurface = (look: Finish | undefined, node: Object3D, library: ReadonlyMap<string, LibraryMaterial> | null) => (copy: Object3D) => {
  const { avgLuminance } = node.userData as SplitNodeData;
  forEachMaterial(copy, (material) => {
    if (!material.userData.fixture) applyFinish(material, look, avgLuminance, library);
  });
};

/** A Piece's node: the group PieceNode names by its id, under "pieces". */
const pieceObject = (scene: Object3D, pieceId: string) => scene.getObjectByName('pieces')?.children.find(({ name }) => name === pieceId);

/** A node of the split Scan, or an Original drawn from its Master Copy, by its SplitNodeData. */
function nodeOf(scene: Object3D, kind: SplitNodeData['kind'], id?: string): Object3D | undefined {
  let found: Object3D | undefined;
  scene.getObjectByName('scan')?.traverse((node) => {
    const data = node.userData as Partial<SplitNodeData>;
    if (!found && data.kind === kind && data.id === id) found = node;
  });
  return found;
}

/**
 * A copy of `source` as it looks now, with materials of its own drawn as `restyle` says, laid over it
 * in the "reveal" group to fade out. It shares the source's geometry, and never catches the pointer.
 */
function ghost(group: Group, source: Object3D, restyle: (copy: Object3D) => void, follow: boolean, now: number): Ghost {
  source.updateWorldMatrix(true, false);
  const object = source.clone(true);
  object.matrixAutoUpdate = false;
  object.matrix.copy(source.matrixWorld);
  object.visible = true;
  object.traverse((child) => {
    const mesh = child as Mesh;
    if (!mesh.isMesh) return;
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map((material) => material.clone()) : mesh.material.clone();
    mesh.raycast = ignoreRaycast;
    // Drawn after, and just in front of, what it covers.
    mesh.renderOrder = 10;
  });
  restyle(object);
  const materials: Ghost['materials'] = [];
  forEachMaterial(object, (material) => {
    materials.push({ material, opacity: follow ? 1 : material.opacity });
    Object.assign(material, { transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 });
  });
  group.add(object);
  return { kind: 'ghost', object, source, follow, materials, start: now };
}

/** Whether an object and everything it is in are drawn. */
function shown(object: Object3D) {
  for (let o: Object3D | null = object; o; o = o.parent) if (!o.visible) return false;
  return true;
}

/** Moves an effect on to `now`; false once it is done. */
function animate(effect: Effect, scene: Object3D, now: number): boolean {
  switch (effect.kind) {
    case 'ghost': {
      const t = clamp01((now - effect.start) / STEP_MS);
      // WallFader fades a Wall out when the Dollhouse camera looks at it from behind.
      const sourceOpacity = effect.follow ? (shown(effect.source) ? (effect.source.userData.opacity as number | undefined) ?? 1 : 0) : 1;
      effect.object.visible = sourceOpacity > 0;
      for (const { material, opacity } of effect.materials) material.opacity = opacity * sourceOpacity * (1 - t);
      if (t < 1) return true;
      settle(effect, scene);
      return false;
    }
    case 'drop': {
      const object = pieceObject(scene, effect.pieceId);
      const placement = useEditor.getState().roomState?.pieces[effect.pieceId]?.placement;
      if (!object || !placement) return now - effect.created < SIGHT_TIMEOUT_MS;
      effect.start ??= now;
      const t = easeOut(clamp01((now - effect.start) / STEP_MS));
      object.position.y = placement.position[1] + DROP_M * (1 - t);
      object.scale.setScalar(START_SCALE + (1 - START_SCALE) * t);
      return t < 1;
    }
    case 'slide': {
      const t = easeOut(clamp01((now - effect.start) / STEP_MS));
      const { from: { position: a, rotationY: turnFrom }, to: { position: b, rotationY: turnTo } } = effect;
      effect.object.position.set(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t);
      // The shorter way round.
      const turn = Math.atan2(Math.sin(turnTo - turnFrom), Math.cos(turnTo - turnFrom));
      effect.object.rotation.y = turnFrom + turn * t;
      return t < 1;
    }
  }
}

/** Ends an effect at once: a ghost is taken away, and a Piece stands where it belongs. */
function settle(effect: Effect, scene: Object3D) {
  if (effect.kind === 'ghost') {
    effect.object.removeFromParent();
    effect.materials.forEach(({ material }) => material.dispose());
  }
  if (effect.kind === 'drop') {
    const object = pieceObject(scene, effect.pieceId);
    const placement = useEditor.getState().roomState?.pieces[effect.pieceId]?.placement;
    if (object && placement) object.position.y = placement.position[1];
    object?.scale.setScalar(1);
  }
  if (effect.kind === 'slide') {
    effect.object.position.set(...effect.to.position);
    effect.object.rotation.y = effect.to.rotationY;
  }
}
