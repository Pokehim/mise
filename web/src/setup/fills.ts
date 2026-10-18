// Room Setup step 6 (ADR-0007): line each Fill Capture up with the room, mark the Originals it saw
// somewhere else, then rebuild room.glb with the Patches and completions they give.
import type { Material, Mesh } from 'three';
import type { Box, FillCapture, MovedOriginal, ScanManifest, Vec2, Vec3, YawTransform } from '@shared/types';
import { mergeScan, scanFileUrl } from '../api';
import {
  IDENTITY, applyYaw, composeYaw, fitCorners, inGrownBox, invertYaw, moveSamples, refineAlignment, registerMoved,
  surfaceSamples, transformMesh, triangleSamples,
} from './geometry/align';
import { autoBox } from './geometry/autoBox';
import { detectFloorHeight, detectYaw, levelTransform } from './geometry/level';
import { mm } from './geometry/mesh';
import { polygonBounds } from './geometry/walls';
import { sceneTriangles } from './sceneTriangles';
import { type FillDraft, loadScene, scanTriangles, useSetup } from './store';

/** Corner pairs to click before lining up: three fix the turn, a fourth checks it. */
export const CORNER_PAIRS = 4;

const isIdentity = ({ position, rotationY }: YawTransform) => rotationY === 0 && position.every((v) => v === 0);

/** True once a Fill Capture has been lined up: scan-import gives it an identity transform. */
export const isAligned = (fill: FillCapture) => !isIdentity(fill.transform);

/** A YawTransform rounded the way setup.json is (mm, and 1e-6 rad), so saves make small diffs. */
const rounded = ({ position, rotationY }: YawTransform): YawTransform =>
  ({ position: position.map(mm) as Vec3, rotationY: Math.round(rotationY * 1e6) / 1e6 + 0 });

/** Opens Fill Capture `index`: loads its mesh, and shows it where it was lined up, or levelled beside the room if it wasn't yet. */
export async function openFill(index: number) {
  const { manifest, setup } = useSetup.getState();
  const fill = manifest!.captures!.fills[index];
  useSetup.setState({
    fill: { index, transform: IDENTITY, floorHeight: 0, roomCorners: [], fillCorners: [], copies: {}, look: 'solid' },
    notice: 'Loading the Fill Capture…',
  });
  const scene = await loadScene(scanFileUrl(manifest!.id, fill.mesh));
  // Once lined up it lies on the room's floor and walls: drawn over them, not fighting them.
  scene.traverse((object) => {
    const material = (object as Mesh).material as Material | undefined;
    if (material) Object.assign(material, { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  });
  const own = sceneTriangles(scene);   // its own frame
  const floorHeight = detectFloorHeight(own) ?? 0;
  let transform: YawTransform;
  if (!isIdentity(fill.transform)) {
    transform = composeYaw(manifest!.meshTransform, fill.transform);
  } else {
    // Levelled and turned square like step 1, then set down beside the room so both can be clicked.
    const level = levelTransform(own, floorHeight, detectYaw(own) ?? 0);
    const room = polygonBounds(setup!.floor.polygon);
    transform = composeYaw({ position: [room.maxX - room.minX + 1, 0, 0], rotationY: 0 }, level);
  }
  if (useSetup.getState().fill?.index !== index) return;   // another one was opened meanwhile
  useSetup.setState({ fill: { ...useSetup.getState().fill!, scene, transform, floorHeight }, notice: undefined });
}

/** A click on the room while lining up: the next corner, in the room frame. */
export function clickRoomCorner([x, , z]: Vec3) {
  updateDraft((d) => (d.roomCorners.length > d.fillCorners.length || d.roomCorners.length >= CORNER_PAIRS
    ? d : { ...d, roomCorners: [...d.roomCorners, [mm(x), mm(z)]] }));
}

/** A click on the Fill Capture: the same corner as the last room corner, in the Fill Capture's own frame; or, while marking, a moved Original. */
export function clickFill(point: Vec3) {
  const draft = useSetup.getState().fill;
  if (!draft) return;
  if (draft.markingId) {
    markMoved(draft.markingId, point);
    return;
  }
  if (draft.fillCorners.length >= draft.roomCorners.length) return;
  const [x, , z] = applyYaw(invertYaw(draft.transform), point);
  updateDraft((d) => ({ ...d, fillCorners: [...d.fillCorners, [mm(x), mm(z)]] }));
}

export const clearCorners = () => updateDraft((d) => ({ ...d, roomCorners: [], fillCorners: [] }));

/** Solves the turn and position from the clicked corners, then refines it against the room's floor and walls. */
export function lineUp() {
  const draft = useSetup.getState().fill;
  if (!draft?.scene || draft.fillCorners.length < 3) return;
  const pairs = draft.fillCorners.length;
  const { rotationY, offset } = fitCorners(draft.fillCorners, draft.roomCorners.slice(0, pairs));
  refine({ position: [offset[0], -draft.floorHeight, offset[1]], rotationY }, { roomCorners: [], fillCorners: [] });
}

/** Refines the current line-up (ICP on the floor and walls), for instance after a first rough one. */
export const refineLineUp = () => refine(useSetup.getState().fill!.transform);

function refine(start: YawTransform, change: Partial<FillDraft> = {}) {
  const { fill: draft, scene, manifest, setup } = useSetup.getState();
  if (!draft?.scene || !scene || !manifest || !setup) return;
  // Only the floor and the walls, on both sides: furniture moved between the Captures. The Fill
  // Capture's are picked where `start` puts it, with a band wide enough for clicks a few cm off.
  const placed = transformMesh(sceneTriangles(draft.scene), start);
  const band = { floor: 0.1, wall: 0.1 };
  const source = moveSamples(surfaceSamples(placed, setup.walls, setup.floor.polygon, band), invertYaw(start));
  const target = surfaceSamples(scanTriangles(scene, manifest.meshTransform), setup.walls, setup.floor.polygon);
  const fit = refineAlignment(source, target, start);
  useSetup.setState({ fill: { ...draft, ...change, transform: fit.transform, residual: fit.residual } });
  updateFillCapture({ transform: rounded(composeYaw(invertYaw(manifest.meshTransform), fit.transform)) });
}

/** How the Fill Capture is drawn over the room once lined up: solid, as a wireframe, or not at all. */
export const setFillLook = (look: FillDraft['look']) => updateDraft((d) => ({ ...d, look }));

/** Starts (or stops, with undefined) marking where an Original stood in the Fill Capture. */
export const startMarking = (originalId: string | undefined) => updateDraft((d) => ({ ...d, markingId: originalId }));

/**
 * A click on a moved Original's copy in the Fill Capture: auto-box it there, register it with the
 * Original (four starting turns, then ICP on both copies), and keep where it maps to.
 */
function markMoved(originalId: string, point: Vec3) {
  const { fill: draft, scene, manifest, setup } = useSetup.getState();
  const original = setup!.originals.find((o) => o.id === originalId);
  if (!draft?.scene || !original) return;
  const fillRoom = sceneTriangles(draft.scene, draft.transform);
  const copy = autoBox(fillRoom, point, setup!);
  if (!copy) {
    useSetup.setState({ notice: `Auto-box found no furniture there. Click on the ${original.label} itself.` });
    return;
  }
  const source = triangleSamples(fillRoom, furnitureIn(copy));
  const target = triangleSamples(scanTriangles(scene!, manifest!.meshTransform), furnitureIn(original.box));
  const center = ({ position: [x, , z] }: Box): Vec2 => [x, z];
  const fit = registerMoved(source, target, center(copy), center(original.box));
  // Saved in the Main Capture's frame, like the Fill Capture's own transform.
  const toMain = invertYaw(manifest!.meshTransform);
  const moved: MovedOriginal = { originalId, transform: rounded(composeYaw(toMain, composeYaw(fit.transform, manifest!.meshTransform))) };
  const fill = manifest!.captures!.fills[draft.index];
  updateFillCapture({ moved: [...fill.moved.filter((m) => m.originalId !== originalId), moved] });
  useSetup.setState({
    fill: { ...draft, markingId: undefined, copies: { ...draft.copies, [originalId]: { box: copy, residual: fit.residual } } },
    notice: undefined,
  });
}

export function forgetMoved(originalId: string) {
  const { fill: draft, manifest } = useSetup.getState();
  if (!draft) return;
  updateFillCapture({ moved: manifest!.captures!.fills[draft.index].moved.filter((m) => m.originalId !== originalId) });
  const { [originalId]: _, ...copies } = draft.copies;
  useSetup.setState({ fill: { ...draft, copies } });
}

/** Saves the manifest and setup (Save), then rebuilds room.glb from the Captures, and reports what it added. */
export async function saveAndMerge() {
  const { save, manifest } = useSetup.getState();
  await save();
  if (useSetup.getState().message) return;   // the save failed, and says why
  useSetup.setState({ status: 'saving' });
  try {
    const { triangles, patches, completions } = await mergeScan(manifest!.id);
    const merged = `Rebuilt room.glb (${triangles.toLocaleString('en-US')} triangles): ${patches.length} Patches, ${completions.length} completed Originals.`;
    useSetup.setState((s) => ({ status: 'ready', fill: s.fill && { ...s.fill, merged } }));
  } catch (error) {
    useSetup.setState({ status: 'ready', message: `Not merged: ${(error as Error).message}` });
  }
}

/** Changes the open Fill Capture's entry in the manifest: an unsaved change, until Save. */
function updateFillCapture(change: Partial<FillCapture>) {
  const { manifest, fill: draft } = useSetup.getState();
  if (!manifest?.captures || !draft) return;
  const fills = manifest.captures.fills.map((f, i) => (i === draft.index ? { ...f, ...change } : f));
  useSetup.setState({ manifest: { ...manifest, captures: { ...manifest.captures, fills } } });
}

function updateDraft(change: (draft: FillDraft) => FillDraft) {
  const draft = useSetup.getState().fill;
  if (draft) useSetup.setState({ fill: change(draft) });
}

/** Room-frame triangles of the furniture in a box: inside it grown by 5 cm, above the floor. */
function furnitureIn(box: Box) {
  const inside = inGrownBox(box, 0.05);
  return ({ cx, cy, cz }: { cx: number; cy: number; cz: number }) => cy > 0.03 && inside([cx, cy, cz]);
}

/** True once every Fill Capture has been lined up. */
export const fillsAligned = (manifest: ScanManifest) =>
  !!manifest.captures && manifest.captures.fills.length > 0 && manifest.captures.fills.every(isAligned);

