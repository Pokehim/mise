import { useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import {
  AdditiveBlending, CubeCamera, Group, HalfFloatType, HemisphereLight, Mesh, MeshBasicMaterial, type Object3D,
  PlaneGeometry, PMREMGenerator, type Scene, WebGLCubeRenderTarget, type WebGLRenderer,
  type WebGLRenderTarget,
} from 'three';
import { useShallow } from 'zustand/react/shallow';
import type { Edit, RoomSetup } from '@shared/types';
import { useEditor } from '../state/store';
import { openingCenter, roomCenter, wallRotationY } from './floorPlan';
import { useLoadedTextureCount } from './materials/triplanar';
import { forEachMaterial } from './objects';
import type { SplitNodeData } from './splitScan';

/** How high above the floor, at the room's center, the CubeCamera sees the Scan from (spec §12). */
const VIEW_HEIGHT = 1.2;
/** Each face of the CubeCamera's cube, in pixels: Pieces only show its light and blurred reflections. */
const CUBE_SIZE = 256;
/** How long after the last change to the Scan's look to render its light again. */
const REFRESH_MS = 300;
/**
 * The daylight added at each window for the CubeCamera, in linear units where a white wall is about
 * 1. A Scan's texture can't hold anything brighter than white, so without it a window would light a
 * Piece no more than a white wall does.
 */
const DAYLIGHT = 10;

/**
 * The soft fill light (spec §10.6), as a HemisphereLight's sky color, ground color and intensity: it
 * lights Pieces at the Quick level, and a stand-in room for the CubeCamera.
 */
export const FILL_LIGHT: [sky: string, ground: string, intensity: number] = ['#ffffff', '#d9cfbf', 0.6];

/** Whether an Edit changes how the Scan looks: a Finish, or anything done to an Original. */
function changesScanLook(edit: Edit, setup: RoomSetup) {
  if (edit.type === 'finish' || edit.type === 'replace') return true;
  return 'targetId' in edit && setup.originals.some(({ id }) => id === edit.targetId);
}

/**
 * What only the CubeCamera sees: a bright panel over each window, facing into the room, and a soft
 * light for a stand-in room (a Scan without a mesh file), whose surfaces are lit rather than
 * holding the room's light.
 */
function cubeCameraExtras(setup: RoomSetup) {
  const extras = new Group();
  extras.add(new HemisphereLight(...FILL_LIGHT));
  const geometry = new PlaneGeometry();
  const material = new MeshBasicMaterial({ blending: AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false });
  material.color.setScalar(DAYLIGHT);
  for (const opening of setup.openings) {
    const wall = setup.walls.find(({ id }) => id === opening.wallId);
    if (opening.kind !== 'window' || !wall) continue;
    const panel = new Mesh(geometry, material);
    panel.scale.set(opening.width, opening.height, 1);
    // Clear of the window's frame and the scanned wall's noise.
    panel.position.copy(openingCenter(opening, wall, 0.05));
    panel.rotation.y = wallRotationY(wall);
    // After the Scan, which would otherwise draw over it where the window has a surface.
    panel.renderOrder = 1;
    extras.add(panel);
  }
  return { extras, geometry, material };
}

/**
 * Renders the scene into the CubeCamera as the Scan alone, but all of it, plus `extras`: the Pieces
 * and the editor's helpers hidden, and the Ceiling and the walls the Dollhouse view hides shown, as
 * they light the room too.
 */
function renderScanOnly(gl: WebGLRenderer, scene: Scene, extras: Object3D, camera: CubeCamera) {
  const restore: (() => void)[] = [];
  const set = <T extends object, K extends keyof T>(target: T, key: K, value: T[K]) => {
    const old = target[key];
    target[key] = value;
    restore.push(() => {
      target[key] = old;
    });
  };
  const scan = scene.getObjectByName('scan');
  for (const child of scene.children) if (child !== scan) set(child, 'visible', false);
  scan?.traverse((node) => {
    const { kind } = node.userData as Partial<SplitNodeData>;
    if (kind !== 'ceiling' && kind !== 'wall') return;
    set(node, 'visible', true);
    forEachMaterial(node, (material) => set(material, 'opacity', 1));
  });
  set(gl, 'localClippingEnabled', false);   // the Dollhouse view's ceiling clip
  set(scene, 'environment', null);          // so a stand-in room isn't lit by its own last environment
  scene.add(extras);
  restore.push(() => scene.remove(extras));
  try {
    camera.update(gl, scene);
  } finally {
    restore.reverse().forEach((undo) => undo());
  }
}

/** The Scan's light, seen from the room's center, as an environment map for Pieces (spec §12). */
function scanLight(gl: WebGLRenderer, setup: RoomSetup) {
  const cube = new WebGLCubeRenderTarget(CUBE_SIZE, { type: HalfFloatType });
  const camera = new CubeCamera(0.05, 100, cube);
  const [x, z] = roomCenter(setup);
  camera.position.set(x, VIEW_HEIGHT, z);
  const pmrem = new PMREMGenerator(gl);
  const { extras, geometry, material } = cubeCameraExtras(setup);
  let environment: WebGLRenderTarget | null = null;
  return {
    /** Renders the Scan as the scene shows it now, and returns it as a PMREM environment map. */
    update(scene: Scene) {
      renderScanOnly(gl, scene, extras, camera);
      environment = pmrem.fromCubemap(cube.texture, environment);
      return environment.texture;
    },
    dispose() {
      cube.dispose();
      pmrem.dispose();
      environment?.dispose();
      geometry.dispose();
      material.dispose();
    },
  };
}

/**
 * The Real and Max levels' light for Pieces (spec §12): the Scan itself, seen by a CubeCamera at the
 * room's center with the Pieces hidden, as the scene's environment. The Scan's nodes are unlit, so
 * only Pieces take it, and a stand-in room's lit surfaces. It is rendered again after every Edit
 * that changes the Scan's look, so a sage wall tints the side of each Piece that faces it, and
 * when a material Finish's texture loads. Mount it after ScanMesh and ScanColors, in the same
 * Suspense boundary, so the Scan is there, in its colors, when it first renders.
 */
export function RoomLighting() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const setup = useEditor((s) => s.setup!);
  const manifest = useEditor((s) => s.manifest!);
  const scanEdits = useEditor(useShallow((s) => s.design!.edits.filter((edit) => changesScanLook(edit, s.setup!))));
  // A material Finish shows once its texture loads, which can be after its Edit.
  const texturesLoaded = useLoadedTextureCount();

  const light = useMemo(() => scanLight(gl, setup), [gl, setup]);
  useEffect(() => () => light.dispose(), [light]);

  // At once, and again when ScanMesh splits the Scan again, on a new setup or manifest. A layout
  // effect, so that switching back to Quick clears the environment before Quick's Environment sets its own.
  useLayoutEffect(() => {
    scene.environment = light.update(scene);
    return () => {
      scene.environment = null;
    };
  }, [scene, light, manifest]);

  // Then once changes to the Scan's look settle.
  const shown = useRef({ scanEdits, texturesLoaded });
  useEffect(() => {
    if (scanEdits === shown.current.scanEdits && texturesLoaded === shown.current.texturesLoaded) return;
    shown.current = { scanEdits, texturesLoaded };
    const timer = setTimeout(() => {
      scene.environment = light.update(scene);
    }, REFRESH_MS);
    return () => clearTimeout(timer);
  }, [scene, light, scanEdits, texturesLoaded]);

  return null;
}
