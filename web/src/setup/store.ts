// The Room Setup page's state: the Scan being set up, the RoomSetup being edited, and the tool's UI state.
import { MeshBasicMaterial, type MeshStandardMaterial, type Object3D, type WebGLRenderer, Mesh } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { create } from 'zustand';
import type { Category, Opening, RoomSetup, ScanManifest, Vec3, YawTransform } from '@shared/types';
import { listScans, loadSetup, saveManifest, saveSetup, scanFileUrl } from '../api';
import type { TriangleMesh } from './geometry/mesh';
import { sceneTriangles } from './sceneTriangles';

export const STEPS = [
  { id: 'level', title: 'Level' },
  { id: 'ceiling', title: 'Ceiling' },
  { id: 'corners', title: 'Corners' },
  { id: 'openings', title: 'Openings' },
  { id: 'originals', title: 'Originals' },
  { id: 'bake', title: 'Bake' },
] as const;
export type StepId = (typeof STEPS)[number]['id'];

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
  /** JSON of what's on disk, to tell whether there are unsaved changes. */
  saved: { manifest?: string; setup?: string };
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

  load(scanId: string): Promise<void>;
  setStep(step: StepId): void;
  setMeshTransform(meshTransform: YawTransform): void;
  updateSetup(change: (setup: RoomSetup) => RoomSetup): void;
  save(): Promise<void>;
  set(partial: Partial<SetupState>): void;
}

let loads = 0;

export const useSetup = create<SetupState>()((set, get) => ({
  status: 'loading',
  saved: {},
  step: 'level',
  openingDraft: { kind: 'window', swing: 'in-left' },
  tagCategory: 'bed',
  preview: false,
  hiddenOriginals: {},

  async load(scanId) {
    const token = ++loads;
    set({ status: 'loading', message: undefined, manifest: undefined, setup: undefined, scene: undefined, hiddenOriginals: {} });
    try {
      const manifest = (await listScans()).find((m) => m.id === scanId);
      if (!manifest) throw new Error(`There is no Scan "${scanId}".`);
      const [setup, scene] = await Promise.all([
        loadSetup(scanId).catch((error: Error) => {
          // A Scan that hasn't been set up yet has no setup.json; anything else is a real error.
          if (/: 404 /.test(error.message)) return emptySetup(scanId);
          throw error;
        }),
        loadScene(scanFileUrl(scanId, manifest.mesh)),
      ]);
      if (token !== loads) return;   // a later load (another Scan, or StrictMode's second run) wins
      set({
        status: 'ready', manifest, setup, scene,
        saved: { manifest: JSON.stringify(manifest), setup: JSON.stringify(setup) },
        step: setup.walls.length > 0 ? 'originals' : 'level',
      });
    } catch (error) {
      if (token === loads) set({ status: 'error', message: (error as Error).message });
    }
  },

  setStep: (step) => set({ step, selectedOriginalId: undefined, notice: undefined, openingDraft: { ...get().openingDraft, first: undefined } }),

  setMeshTransform: (meshTransform) => set({ manifest: { ...get().manifest!, meshTransform } }),

  updateSetup: (change) => set({ setup: change(get().setup!) }),

  async save() {
    const { manifest, setup, saved } = get();
    if (!manifest || !setup) return;
    set({ status: 'saving' });
    try {
      if (JSON.stringify(manifest) !== saved.manifest) await saveManifest(manifest);
      await saveSetup(setup);
      set({ status: 'ready', message: undefined, saved: { manifest: JSON.stringify(manifest), setup: JSON.stringify(setup) } });
    } catch (error) {
      set({ status: 'ready', message: `Not saved: ${(error as Error).message}` });
    }
  },

  set: (partial) => set(partial),
}));

export const hasUnsavedChanges = (s: SetupState) =>
  JSON.stringify(s.manifest) !== s.saved.manifest || JSON.stringify(s.setup) !== s.saved.setup;

const emptySetup = (scanId: string): RoomSetup => ({
  version: 1, scanId, ceilingHeight: 2.5, floor: { polygon: [] }, walls: [], openings: [], originals: [],
});

async function loadScene(url: string): Promise<Object3D> {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const { scene } = await loader.loadAsync(url);
  // Unlit, like the editor (spec §10.6): the texture already holds the room's lighting.
  scene.traverse((object) => {
    if (object instanceof Mesh && !Array.isArray(object.material)) {
      const source = object.material as MeshStandardMaterial;
      object.material = new MeshBasicMaterial({ map: source.map, color: source.color, side: source.side, name: source.name });
      source.dispose();
    }
  });
  return scene;
}

// The scan's triangles in each frame, computed once per scene and transform.
let cache: { scene?: Object3D; key?: string; mesh?: TriangleMesh } = {};

/** The scan's triangles in the room frame (or the capture's frame, with no transform). */
export function scanTriangles(scene: Object3D, meshTransform?: YawTransform): TriangleMesh {
  const key = JSON.stringify(meshTransform ?? null);
  if (cache.scene !== scene || cache.key !== key) cache = { scene, key, mesh: sceneTriangles(scene, meshTransform) };
  return cache.mesh!;
}
