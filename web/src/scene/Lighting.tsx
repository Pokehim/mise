import { useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import {
  AdditiveBlending, CubeCamera, Group, HalfFloatType, HemisphereLight, Mesh, MeshBasicMaterial, type Object3D,
  PlaneGeometry, PMREMGenerator, type Scene, Vector3, WebGLCubeRenderTarget, type WebGLRenderer,
  type WebGLRenderTarget,
} from 'three';
import { useShallow } from 'zustand/react/shallow';
import type { Edit, RoomSetup } from '@shared/types';
import { useEditor } from '../state/store';
import { openingCenter, roomBounds, wallRotationY } from './floorPlan';
import { useMaterialLibrary } from './materials/triplanar';
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

/** The Quick level's soft fill light (spec §10.6): a HemisphereLight's sky color, ground color and intensity. */
export const FILL_LIGHT: [sky: string, ground: string, intensity: number] = ['#ffffff', '#d9cfbf', 0.6];

/** Whether an Edit changes how the Scan looks: a Finish, or anything done to an Original. */
function changesScan(edit: Edit, setup: RoomSetup) {
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
  const material = new MeshBasicMaterial({ blending: AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false });
  material.color.setScalar(DAYLIGHT);
  for (const opening of setup.openings) {
    const wall = setup.walls.find(({ id }) => id === opening.wallId);
    if (opening.kind !== 'window' || !wall) continue;
    const panel = new Mesh(new PlaneGeometry(opening.width, opening.height), material);
    panel.position.copy(openingCenter(opening, wall, 0.01));
    panel.rotation.y = wallRotationY(wall);
    // After the Scan, which would otherwise draw over it where the window has a surface.
    panel.renderOrder = 1;
    extras.add(panel);
  }
  return { extras, material };
}

/**
 * Draws the scene as the Scan alone, but all of it, plus `extras`: the Pieces and the editor's
 * helpers hidden, and the Ceiling and the walls the Dollhouse view hides shown, as they light the
 * room too.
 */
function drawScanOnly(gl: WebGLRenderer, scene: Scene, extras: Object3D, draw: () => void) {
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
    draw();
  } finally {
    restore.reverse().forEach((undo) => undo());
  }
}

/** The Scan's light, seen from the room's center, as an environment map for Pieces (spec §12). */
function scanLight(gl: WebGLRenderer, setup: RoomSetup) {
  const cube = new WebGLCubeRenderTarget(CUBE_SIZE, { type: HalfFloatType });
  const camera = new CubeCamera(0.05, 100, cube);
  camera.position.copy(roomBounds(setup).getCenter(new Vector3())).setY(VIEW_HEIGHT);
  const pmrem = new PMREMGenerator(gl);
  const { extras, material } = cubeCameraExtras(setup);
  let environment: WebGLRenderTarget | null = null;
  return {
    /** Renders the Scan as the scene shows it now, and returns it as a PMREM environment map. */
    update(scene: Scene) {
      drawScanOnly(gl, scene, extras, () => camera.update(gl, scene));
      environment = pmrem.fromCubemap(cube.texture, environment);
      return environment.texture;
    },
    dispose() {
      cube.dispose();
      pmrem.dispose();
      environment?.dispose();
      extras.traverse((object) => {
        if (object instanceof Mesh) object.geometry.dispose();
      });
      material.dispose();
    },
  };
}

/**
 * The Real and Max levels' light for Pieces (spec §12): the Scan itself, seen by a CubeCamera at the
 * room's center with the Pieces hidden, as the scene's environment. The Scan's nodes are unlit, so
 * only Pieces take it, and a stand-in room's lit surfaces. It is rendered again after every Edit
 * that changes the Scan's look, so a sage wall tints the Pieces near it, and once the Material
 * Library arrives, for material Finishes. Mount it after ScanMesh and ScanColors, in the same
 * Suspense boundary, so the Scan is there, in its colors, when it first renders.
 */
export function RoomLighting() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const setup = useEditor((s) => s.setup!);
  const manifest = useEditor((s) => s.manifest!);
  const scanEdits = useEditor(useShallow((s) => s.design!.edits.filter((edit) => changesScan(edit, s.setup!))));
  // ScanColors applies material Finishes only once it has the Material Library.
  const library = useMaterialLibrary();

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
  const shown = useRef({ scanEdits, library });
  useEffect(() => {
    if (scanEdits === shown.current.scanEdits && library === shown.current.library) return;
    shown.current = { scanEdits, library };
    const timer = setTimeout(() => {
      scene.environment = light.update(scene);
    }, REFRESH_MS);
    return () => clearTimeout(timer);
  }, [scene, light, scanEdits, library]);

  return null;
}
