import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { CanvasTexture, type OrthographicCamera, type PerspectiveCamera, SRGBColorSpace, type Sprite } from 'three';
import type { Vec3 } from '@shared/types';

const FONT_PX = 12;
const PAD_X = 6;
const HEIGHT_PX = 20;
const RATIO = 2;   // drawn at twice the size, for sharp text on high-density screens

/**
 * A text label at a point in the scene, the same size on screen at any distance or zoom. A sprite,
 * not drei's <Html>: each <Html> mounts its own React root, which React 19 flags when the page unmounts.
 */
export function Label({ position, text, selected = false }: { position: Vec3; text: string; selected?: boolean }) {
  const ref = useRef<Sprite>(null);
  const texture = useMemo(() => labelTexture(text, selected), [text, selected]);
  useEffect(() => () => texture.dispose(), [texture]);

  useFrame(({ camera, size }) => {
    // The world size of one screen pixel at the sprite, with sizeAttenuation off: perspective
    // sprites are scaled by their distance in the shader, orthographic ones are not.
    const pixel = (camera as OrthographicCamera).isOrthographicCamera
      ? 1 / camera.zoom
      : (2 * Math.tan(((camera as PerspectiveCamera).fov * Math.PI) / 360)) / size.height;
    const { width, height } = texture.image as HTMLCanvasElement;
    ref.current?.scale.set((width / RATIO) * pixel, (height / RATIO) * pixel, 1);
  });

  return (
    <sprite ref={ref} position={position} renderOrder={30}>
      <spriteMaterial map={texture} sizeAttenuation={false} depthTest={false} transparent />
    </sprite>
  );
}

function labelTexture(text: string, selected: boolean): CanvasTexture {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d')!;
  const font = `${FONT_PX * RATIO}px system-ui, sans-serif`;
  context.font = font;
  canvas.width = Math.ceil(context.measureText(text).width + 2 * PAD_X * RATIO);
  canvas.height = HEIGHT_PX * RATIO;
  context.font = font;   // resizing the canvas resets its state
  context.fillStyle = selected ? 'rgb(229 181 103 / 0.95)' : 'rgb(0 0 0 / 0.6)';
  context.beginPath();
  context.roundRect(0, 0, canvas.width, canvas.height, 4 * RATIO);
  context.fill();
  context.fillStyle = selected ? '#1b1b1b' : '#ffffff';
  context.textBaseline = 'middle';
  context.fillText(text, PAD_X * RATIO, canvas.height / 2 + RATIO);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}
