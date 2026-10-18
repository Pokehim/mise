// The Room Setup page's state: the Scan being set up, the RoomSetup being edited, and the tool's UI state.
import { type Material, Mesh, type Object3D, type WebGLRenderer } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { create } from 'zustand';
import type { Category, Opening, Original, RoomSetup, ScanManifest, Vec2, Vec3, YawTransform } from '@shared/types';
import { listScans, loadSetup, saveManifest, savePatchImage, saveSetup, scanFileUrl } from '../api';
import { unlit } from '../scene/splitScan';
import type { TriangleMesh } from './geometry/mesh';
import { sceneTriangles } from './sceneTriangles';

export const STEPS = [
  { id: 'level', title: 'Level' },
  { id: 'ceiling', title: 'Ceiling' },
  { id: 'corners', title: 'Corners' },
  { id: 'openings', title: 'Openings' },
  { id: 'originals', title: 'Originals' },
  { id: 'fills', title: 'Fill Captures' },
  { id: 'bake', title: 'Bake' },
] as const;
export type StepId = (typeof STEPS)[number]['id'];

/** A new setup's ceiling height, in meters: step 2 is done once it changes, or once there are Walls. */
export const DEFAULT_CEILING_HEIGHT = 2.5;

interface SetupState {
  status: 'loading' | 'ready' | 'saving' | 'error';
  /** A load or save error. */
  message?: string;
  /** A hint from the current step, such as auto-box finding nothing. */
  notice?: string;
  manifest?: ScanManifest;
  setup?: RoomSetup;
  /** The glTF scene as loaded, in the capture's frame, with unlit materials. */
  scene?: Object3D;
  /** The manifest and setup as last loaded or saved; anything else is an unsaved change. */
  saved: { manifest?: ScanManifest; setup?: RoomSetup };
  step: StepId;
  selectedWallId?: string;
  selectedOriginalId?: string;
  /** Step 4: the kind for the next Opening, and the first of its two clicks. */
  openingDraft: { kind: Opening['kind']; swing: NonNullable<Opening['swing']>; first?: Vec3 };
  /** Step 5: the category the next click tags. */
  tagCategory: Category;
  /** "Preview split": show splitScan's nodes, tinted, instead of the raw mesh. */
  preview: boolean;
  hiddenOriginals: Record<string, boolean>;
  /** How long the preview's last splitScan took, in ms. */
  lastSplitMs?: number;
  renderer?: WebGLRenderer;
  /** Step 6: the Fill Capture being lined up (ADR-0007). */
  fill?: FillDraft;
  /** Step 7: the last Bake's Patch images by file name, which Save uploads to patches/ before the setup. */
  patchImages: Map<string, Blob>;

  load(scanId: string): Promise<void>;
  setStep(step: StepId): void;
  setMeshTransform(meshTransform: YawTransform): void;
  /** Step 1's "Confirm level": saves the manifest alone. */
  saveLevel(): Promise<void>;
  updateSetup(change: (setup: RoomSetup) => RoomSetup): void;
  updateOriginal(id: string, change: Partial<Original>): void;
  updateOpening(id: string, change: Partial<Opening>): void;
  selectWall(id: string): void;
  save(): Promise<void>;
}

/**
 * Step 6's work on one Fill Capture. Its transform and moved Originals live in the manifest
 * (captures.fills), so Save keeps them; this holds what the step needs while you click.
 */
export interface FillDraft {
  /** Index in manifest.captures.fills. */
  index: number;
  /** The Fill Capture's mesh, in its own frame, once loaded. */
  scene?: Object3D;
  /** Its frame → the room frame, as shown now: beside the room until it is lined up, then on it. */
  transform: YawTransform;
  /** Its floor height in its own frame, which step 1's histogram finds. */
  floorHeight: number;
  /** Corners clicked in pairs: on the room (room frame), then on the Fill Capture (its frame). */
  roomCorners: Vec2[];
  fillCorners: Vec2[];
  /** The last line-up's median distance between the two shells, in meters. */
  residual?: number;
  /** The Original whose moved copy the next click on the Fill Capture marks. */
  markingId?: string;
  /** Where each moved copy was found, in the room frame, to draw it. */
  copies: Record<string, { box: Original['box']; residual: number }>;
  /** What the last merge added. */
  merged?: string;
  /** How it is drawn: solid over the room, as a wireframe to compare the two, or hidden. */
  look: 'solid' | 'wireframe' | 'hidden';
}

let latestLoad = 0;

export const useSetup = create<SetupState>()((set, get) => ({
  status: 'loading',
  saved: {},
  step: 'level',
  openingDraft: { kind: 'window', swing: 'in-left' },
  tagCategory: 'bed',
  preview: false,
  hiddenOriginals: {},
  patchImages: new Map(),

  async load(scanId) {
    const token = ++latestLoad;
    const { fill } = get();
    // The open Fill Capture belongs to the Scan before: step 6 there would write it into this one's manifest.
    set({
      status: 'loading', message: undefined, manifest: undefined, setup: undefined, scene: undefined, fill: undefined,
      hiddenOriginals: {}, patchImages: new Map(),
    });
    if (fill?.scene) disposeScene(fill.scene);
    try {
      const manifest = listScans().then((scans) => scans.find((m) => m.id === scanId) ?? fail(`There is no Scan "${scanId}".`));
      const [setup, scene] = await Promise.all([
        loadSetup(scanId).catch((error: Error) => {
          // A Scan that hasn't been set up yet has no setup.json; anything else is a real error.
          if (/: 404 /.test(error.message)) return emptySetup(scanId);
          throw error;
        }),
        // Room Setup works on the Main Capture; room.glb may also hold merged Fill Capture triangles (ADR-0007).
        manifest.then((m) => loadScene(scanFileUrl(scanId, m.captures?.main ?? m.mesh))),
      ]);
      if (token !== latestLoad) return;   // a later load (another Scan, or StrictMode's second run) wins
      set({
        status: 'ready', manifest: await manifest, setup, scene,
        saved: { manifest: await manifest, setup },
        step: setup.walls.length > 0 ? 'originals' : 'level',
      });
    } catch (error) {
      if (token === latestLoad) set({ status: 'error', message: (error as Error).message });
    }
  },

  setStep: (step) => {
    const { fill } = get();
    set({
      step, selectedOriginalId: undefined, notice: undefined, openingDraft: { ...get().openingDraft, first: undefined },
      fill: step === 'fills' ? fill : undefined,
    });
    if (step !== 'fills' && fill?.scene) disposeScene(fill.scene);
  },

  setMeshTransform: (meshTransform) => set({ manifest: { ...get().manifest!, meshTransform } }),

  async saveLevel() {
    const { manifest, saved } = get();
    if (!manifest) return;
    set({ status: 'saving' });
    try {
      await saveManifest(manifest);
      set({ status: 'ready', message: undefined, saved: { ...saved, manifest } });
    } catch (error) {
      set({ status: 'ready', message: `Not saved: ${(error as Error).message}` });
    }
  },

  updateSetup: (change) => set({ setup: change(get().setup!) }),

  updateOriginal: (id, change) => get().updateSetup((s) => ({
    ...s, originals: s.originals.map((o) => (o.id === id ? { ...o, ...change } : o)),
  })),

  updateOpening: (id, change) => get().updateSetup((s) => ({
    ...s, openings: s.openings.map((o) => (o.id === id ? { ...o, ...change } : o)),
  })),

  selectWall: (id) => set({ selectedWallId: id, openingDraft: { ...get().openingDraft, first: undefined } }),

  async save() {
    const { manifest, setup, saved, patchImages } = get();
    if (!manifest || !setup) return;
    set({ status: 'saving' });
    try {
      // The images first, so setup.json never names a Patch image the server doesn't have yet.
      await Promise.all(Array.from(patchImages, ([name, png]) => savePatchImage(manifest.id, name, png)));
      await Promise.all([manifest !== saved.manifest && saveManifest(manifest), saveSetup(setup)]);
      // A Bake during the Save staged newer images; those wait for the next Save.
      set((s) => ({
        status: 'ready', message: undefined, saved: { manifest, setup },
        patchImages: s.patchImages === patchImages ? new Map() : s.patchImages,
      }));
    } catch (error) {
      set({ status: 'ready', message: `Not saved: ${(error as Error).message}` });
    }
  },
}));

export const hasUnsavedChanges = (s: SetupState) => s.manifest !== s.saved.manifest || s.setup !== s.saved.setup;

/** True once step 1 has given the Scan a meshTransform. */
export const isLeveled = ({ meshTransform: { position, rotationY } }: ScanManifest) =>
  rotationY !== 0 || position.some((v) => v !== 0);

const fail = (message: string): never => {
  throw new Error(message);
};

const emptySetup = (scanId: string): RoomSetup => ({
  version: 1, scanId, ceilingHeight: DEFAULT_CEILING_HEIGHT, floor: { polygon: [] }, walls: [], openings: [], originals: [],
});

export async function loadScene(url: string): Promise<Object3D> {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const { scene } = await loader.loadAsync(url);
  // Unlit, like the editor (spec §10.6): the texture already holds the room's lighting.
  scene.traverse((object) => {
    if (object instanceof Mesh && !Array.isArray(object.material)) {
      const source = object.material;
      object.material = unlit(source);
      source.dispose();
    }
  });
  return scene;
}

/** Frees the GPU memory of a scene that is no longer drawn: its geometries, materials and textures. */
export function disposeScene(scene: Object3D) {
  scene.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    object.geometry.dispose();
    const material = object.material as Material & { map?: { dispose(): void } | null };
    material.map?.dispose();
    material.dispose();
  });
}

// The scan's triangles, computed once per scene in the capture's frame, and once per meshTransform in the room frame.
const triangleCache = new WeakMap<Object3D, { capture?: TriangleMesh; room?: { key: string; mesh: TriangleMesh } }>();

/** The scan's triangles in the room frame, or in the capture's frame with no meshTransform. */
export function scanTriangles(scene: Object3D, meshTransform?: YawTransform): TriangleMesh {
  let cached = triangleCache.get(scene);
  if (!cached) triangleCache.set(scene, (cached = {}));
  if (!meshTransform) return (cached.capture ??= sceneTriangles(scene));
  const key = JSON.stringify(meshTransform);
  if (cached.room?.key !== key) cached.room = { key, mesh: sceneTriangles(scene, meshTransform) };
  return cached.room.mesh;
}
