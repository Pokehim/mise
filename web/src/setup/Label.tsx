import { useFrame } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CanvasTexture, MathUtils, type OrthographicCamera, type PerspectiveCamera, SRGBColorSpace, type Sprite, Vector3 } from 'three';
import type { Vec3 } from '@shared/types';
import { tone } from './ui';

const FONT_PX = 12;
const PAD_X = 6;
const HEIGHT_PX = 20;
/** The longest a label gets, in CSS pixels: longer names are cut with an ellipsis. */
const MAX_WIDTH_PX = 160;
const RATIO = 2;   // drawn at twice the size, for sharp text on high-density screens
/** The space kept clear between two labels, in CSS pixels. */
const GAP_PX = 2;
/** The selected label's priority, over any other. */
const SELECTED = 1000;

interface LabelProps {
  position: Vec3;
  text: string;
  /** The chosen thing's label: in the wash, and placed before every other. */
  selected?: boolean;
  /** Which labels win a spot when two would overlap: the higher, then the nearer. */
  priority?: number;
  /** How far above `position` the label's bottom edge sits, in CSS pixels; by default it is centered on it. */
  lift?: number;
  /** Numbers in mono, as the sketch style sets them. */
  mono?: boolean;
}

/**
 * A text label at a point in the scene, the same size on screen at any distance or zoom: a slip of
 * paper with a pencil edge, like the editor's dimension labels. A sprite, not drei's <Html>: each
 * <Html> mounts its own React root, which React 19 flags when the page unmounts. Labels never overlap
 * (LabelLayout): where two would, the one with the lower priority, or the farther one, is left out.
 */
export function Label({ position, text, selected = false, priority = 0, lift, mono = false }: LabelProps) {
  const ref = useRef<Sprite>(null);
  const fonts = useFontsReady();
  const texture = useMemo(() => labelTexture(text, selected, mono), [text, selected, mono, fonts]);
  useEffect(() => () => texture.dispose(), [texture]);

  // One entry in the layout while mounted; its size and priority follow the props.
  const { width, height } = texture.image as HTMLCanvasElement;
  const entry = useRef<Placed | null>(null);
  useLayoutEffect(() => {
    const placed = { sprite: ref.current!, width: 0, height: 0, priority: 0 };
    entry.current = placed;
    labels.add(placed);
    return () => { labels.delete(placed); };
  }, []);
  useLayoutEffect(() => {
    Object.assign(entry.current!, { width: width / RATIO, height: height / RATIO, priority: selected ? SELECTED : priority });
  });

  useFrame(({ camera, size }) => {
    // The world size of one screen pixel at the sprite, with sizeAttenuation off: perspective
    // sprites are scaled by their distance in the shader, orthographic ones are not.
    const pixel = (camera as OrthographicCamera).isOrthographicCamera
      ? 1 / camera.zoom
      : (2 * Math.tan(MathUtils.degToRad((camera as PerspectiveCamera).fov) / 2)) / size.height;
    ref.current?.scale.set((width / RATIO) * pixel, (height / RATIO) * pixel, 1);
  });

  const centerY = lift === undefined ? 0.5 : -lift / HEIGHT_PX;
  return (
    <sprite ref={ref} position={position} center={[0.5, centerY]} renderOrder={30}>
      <spriteMaterial map={texture} sizeAttenuation={false} depthTest={false} transparent toneMapped={false} />
    </sprite>
  );
}

interface Placed { sprite: Sprite; width: number; height: number; priority: number }

/** Every label in the scene, for LabelLayout. There is one Room Setup canvas at a time. */
const labels = new Set<Placed>();
const at = new Vector3();

/**
 * Lays the labels out once a frame: each, from the selected one down, shows only where it overlaps
 * none shown before it. Mount it once in the canvas.
 */
export function LabelLayout() {
  useFrame(({ camera, size }) => {
    camera.updateMatrixWorld();
    const placed = [...labels].map((label) => {
      const { x, y, z } = label.sprite.getWorldPosition(at).project(camera);
      const left = ((x + 1) / 2) * size.width - label.sprite.center.x * label.width;
      const bottom = ((1 - y) / 2) * size.height + label.sprite.center.y * label.height;
      return { label, z, left, right: left + label.width, top: bottom - label.height, bottom };
    }).sort((a, b) => b.label.priority - a.label.priority || a.z - b.z);
    const shown: typeof placed = [];
    for (const box of placed) {
      const free = box.z < 1 && shown.every((other) => box.right + GAP_PX <= other.left || other.right + GAP_PX <= box.left
        || box.bottom + GAP_PX <= other.top || other.bottom + GAP_PX <= box.top);
      box.label.sprite.visible = free;
      if (free) shown.push(box);
    }
  });
  return null;
}

/** Labels are drawn on a canvas, which won't wait for the page's fonts: draw them again once Work Sans is in. */
function useFontsReady() {
  const [ready, setReady] = useState(fontsReady);
  useEffect(() => {
    if (ready) return;
    let live = true;
    Promise.all([document.fonts.load(`500 ${FONT_PX}px "Work Sans"`), document.fonts.load(`500 ${FONT_PX}px "JetBrains Mono"`)])
      .then(() => {
        fontsReady = true;
        if (live) setReady(true);
      }, () => {});
    return () => { live = false; };
  }, [ready]);
  return ready;
}
let fontsReady = false;

function labelTexture(text: string, selected: boolean, mono: boolean): CanvasTexture {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d')!;
  const font = `500 ${(mono ? 11 : FONT_PX) * RATIO}px ${mono ? '"JetBrains Mono", ui-monospace, monospace' : '"Work Sans", system-ui, sans-serif'}`;
  context.font = font;
  const shown = fit(context, text, (MAX_WIDTH_PX - 2 * PAD_X) * RATIO);
  canvas.width = Math.ceil(context.measureText(shown).width + 2 * PAD_X * RATIO);
  canvas.height = HEIGHT_PX * RATIO;
  context.font = font;   // resizing the canvas resets its state
  // Paper with a pencil edge; the chosen one in the wash.
  const line = (selected ? 1.5 : 1) * RATIO;
  context.fillStyle = tone(selected ? '--wash-tint' : '--paper-raised');
  context.strokeStyle = tone(selected ? '--wash' : '--pencil-strong');
  context.lineWidth = line;
  context.beginPath();
  context.roundRect(line / 2, line / 2, canvas.width - line, canvas.height - line, 2 * RATIO);
  context.fill();
  context.stroke();
  context.fillStyle = tone('--ink');
  context.textBaseline = 'middle';
  context.fillText(shown, PAD_X * RATIO, canvas.height / 2 + RATIO / 2);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/** The text, cut with an ellipsis to fit `width`. */
function fit(context: CanvasRenderingContext2D, text: string, width: number) {
  if (context.measureText(text).width <= width) return text;
  let cut = text;
  while (cut.length > 1 && context.measureText(`${cut}…`).width > width) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}
