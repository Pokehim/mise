import { Line } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { type ComponentRef, useLayoutEffect, useRef, useState } from 'react';
import type { Vec3 } from '@shared/types';
import { type Token, token } from './tokens';

/** A construction line's dash and gap, in meters (docs/design/sketch-style.md). */
export const DASH: [number, number] = [0.05, 0.035];
/** The --ease-out token's curve, to within 1%: most of the stroke lands early. */
const easeOut = (t: number) => 1 - (1 - t) ** 5;
/** How far the paper halo under a line reaches past each side of it, in pixels. */
const HALO = 1.25;
/** drei builds a Line's geometry from its points; InkLine fills that geometry itself (below). */
const PLACEHOLDER: Vec3[] = [[0, 0, 0], [0, 0, 0]];
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

interface InkLineProps {
  /** Line segments, as pairs of points. */
  segments: Vec3[];
  /** Its color, a token such as '--ink' or '--red-pencil'. */
  color?: Token;
  /** In pixels. */
  width?: number;
  /** Draws on over --draw when it mounts (key it to restart), given the segments' total length in meters. */
  drawOn?: number;
  /** A dashed construction line: dash and gap, in meters. */
  dash?: [number, number];
}

/**
 * Ink on tracing paper: line segments drawn over everything (no depth test), each on a paper halo
 * so it reads on a dark floor as well as on a light wall. Mount it where the scene is already drawn,
 * such as in a Hud.
 */
export function InkLine({ segments, color = '--ink', width = 1, drawOn, dash }: InkLineProps) {
  const lines = useRef<(ComponentRef<typeof Line> | null)[]>([]);
  const start = useRef<number | null>(null);
  const [drawMs] = useState(() => (drawOn === undefined || reducedMotion.matches ? 0 : parseFloat(token('--draw'))));
  const drawing = useRef(drawMs > 0);

  // New segments go into the lines' own geometry. A new geometry would make drei dispose the
  // material too, and recompile its shader on every move of a Resize drag.
  useLayoutEffect(() => {
    const positions = segments.flat();
    for (const line of lines.current) {
      if (!line) continue;
      line.geometry.dispose();   // frees the old buffers; the new ones upload on the next frame
      line.geometry.setPositions(positions);
      line.computeLineDistances();
    }
  }, [segments]);

  // Drawing on: one dash as long as the part drawn so far, then a gap longer than the whole line.
  useFrame(() => {
    if (!drawing.current || drawOn === undefined) return;
    start.current ??= performance.now();
    const t = Math.min(1, (performance.now() - start.current) / drawMs);
    for (const line of lines.current) if (line) line.material.dashSize = t < 1 ? easeOut(t) * drawOn : 2 * drawOn + 1;
    if (t === 1) drawing.current = false;
  });

  if (!segments.length) return null;
  // A drawn-on line stays dashed once drawn, with one dash longer than itself: turning the dash off
  // would recompile the shader.
  const gap = 2 * (drawOn ?? 0) + 1;
  const common = {
    segments: true,
    points: PLACEHOLDER,
    dashed: drawOn !== undefined || Boolean(dash),
    dashSize: dash?.[0] ?? (drawing.current ? 0 : gap),
    gapSize: dash?.[1] ?? gap,
    depthTest: false,
    depthWrite: false,
    transparent: true,
    // Not tone-mapped: overlays show the tokens' colors exactly, whatever the room's exposure.
    toneMapped: false,
  } as const;
  return (
    <>
      <Line {...common} ref={(line) => { lines.current[0] = line; }} renderOrder={10}
        color={token('--paper-raised')} opacity={0.55} lineWidth={width + 2 * HALO} />
      <Line {...common} ref={(line) => { lines.current[1] = line; }} renderOrder={11} color={token(color)} lineWidth={width} />
    </>
  );
}
