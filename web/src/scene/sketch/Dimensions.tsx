import { useFrame } from '@react-three/fiber';
import { memo, useMemo, useRef } from 'react';
import { type Group, Vector3 } from 'three';
import type { Placement, Vec3 } from '@shared/types';
import { cm, inches } from '../../ui/format';
import { InkLine } from './InkLine';
import { Label, Z_DIMENSIONS } from './Label';
import { toScreen } from './screen';

/** How far out from the item a dimension line runs, and how far its extension lines reach past it, in meters. */
const OFFSET = 0.16;
const PAST = 0.04;
/** The gap between the item and the start of an extension line. */
const GAP = 0.03;
/** Half the length of a tick: a 45° slash across each end of a dimension line. */
const TICK = 0.03;
/** Just above the floor, so the lines never fight it. */
const LIFT = 0.004;

/** How far a label sits off its line, on the side away from the item, in pixels. */
const LABEL_OFF = 9;
/** Past this angle on screen, a line counts as vertical: its label turns to read from the bottom up. */
const STEEP = (80 / 180) * Math.PI;

const eye = new Vector3();
const [from, to, mid, inside] = [new Vector3(), new Vector3(), new Vector3(), new Vector3()];

/** A length as the plan labels it: inches, then centimeters, as the Inspector gives them. */
const label = (meters: number) => `${inches(meters)}″ · ${cm(meters)} cm`;

interface Drawing {
  lines: Vec3[];
  ticks: Vec3[];
  extensions: Vec3[];
  /** Each label's line (its two ends), and its text. */
  labels: { from: Vec3; to: Vec3; text: string }[];
}

/**
 * A dimension line from a to b, offset from the item by `out` (a unit vector), with extension lines
 * from the item out past it and a tick across each end, drawn in the plane that `out` and a–b span.
 */
function dimension(a: Vec3, b: Vec3, out: Vec3, length: number, drawing: Drawing) {
  const along: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]].map((v) => v / length) as Vec3;
  const shift = (p: Vec3, by: number): Vec3 => [p[0] + out[0] * by, p[1] + out[1] * by, p[2] + out[2] * by];
  const [from, to] = [shift(a, OFFSET), shift(b, OFFSET)];
  drawing.lines.push(from, to);
  for (const [corner, end] of [[a, from], [b, to]]) {
    drawing.extensions.push(shift(corner, GAP), shift(corner, OFFSET + PAST));
    const slash = along.map((v, i) => (v + out[i]) * TICK) as Vec3;
    drawing.ticks.push([end[0] - slash[0], end[1] - slash[1], end[2] - slash[2]], [end[0] + slash[0], end[1] + slash[1], end[2] + slash[2]]);
  }
  drawing.labels.push({ from, to, text: label(length) });
}

/**
 * The width and depth of the item at the parent's origin (its bottom-center), as dimension lines on
 * the floor with tick ends and labels in inches and centimeters; for an item on a wall, its width and
 * height on the wall. Each frame the drawing mirrors to the sides facing the camera, so it lies in
 * front of the item rather than behind it.
 */
export const Dimensions = memo(function Dimensions({ size, mount }: { size: Vec3; mount: Placement['mount'] }) {
  const flip = useRef<Group>(null!);
  const labels = useRef<(HTMLSpanElement | null)[]>([]);
  const placed = useRef<string[]>([]);
  const onWall = mount === 'wall';
  const drawing = useMemo(() => {
    const [width, height, depth] = size;
    const [x, z] = [width / 2, depth / 2];
    const drawn: Drawing = { lines: [], ticks: [], extensions: [], labels: [] };
    if (onWall) {
      dimension([-x, 0, z], [x, 0, z], [0, -1, 0], width, drawn);
      dimension([x, 0, z], [x, height, z], [1, 0, 0], height, drawn);
    } else {
      dimension([-x, LIFT, z], [x, LIFT, z], [0, 0, 1], width, drawn);
      dimension([x, LIFT, -z], [x, LIFT, z], [1, 0, 0], depth, drawn);
    }
    return drawn;
  }, [size, onWall]);

  useFrame(({ camera, size: view }) => {
    const local = flip.current.parent!.worldToLocal(eye.copy(camera.position));
    flip.current.scale.set(local.x < 0 ? -1 : 1, 1, onWall || local.z >= 0 ? 1 : -1);
    flip.current.updateWorldMatrix(true, false);
    // Each label lies along its line on screen, upright, on the side away from the item, as on a plan.
    toScreen(inside.set(0, onWall ? size[1] / 2 : LIFT, onWall ? size[2] / 2 : 0), flip.current, camera, view);
    drawing.labels.forEach((dimension, i) => {
      const element = labels.current[i];
      if (!element) return;
      const [a, b] = [toScreen(from.set(...dimension.from), flip.current, camera, view), toScreen(to.set(...dimension.to), flip.current, camera, view)];
      // Upright, and on a line steeper than 80° read from the bottom up, as on a plan.
      let angle = Math.atan2(b.y - a.y, b.x - a.x);
      if (angle > Math.PI / 2) angle -= Math.PI;
      if (angle <= -Math.PI / 2) angle += Math.PI;
      if (angle > STEEP) angle -= Math.PI;
      const center = mid.addVectors(a, b).multiplyScalar(0.5);
      let [nx, ny] = [-Math.sin(angle), Math.cos(angle)];
      if (nx * (center.x - inside.x) + ny * (center.y - inside.y) < 0) [nx, ny] = [-nx, -ny];
      const style = `${angle.toFixed(3)}rad|${(nx * LABEL_OFF).toFixed(1)}px ${(ny * LABEL_OFF).toFixed(1)}px`;
      if (style === placed.current[i]) return;
      placed.current[i] = style;
      [element.style.rotate, element.style.translate] = style.split('|');
    });
  });

  return (
    <group ref={flip}>
      <InkLine segments={drawing.extensions} color="--graphite" dash={[0.025, 0.018]} />
      <InkLine segments={drawing.lines} />
      <InkLine segments={drawing.ticks} width={1.5} />
      {drawing.labels.map(({ from: a, to: b, text }, i) => (
        <Label key={i} position={[(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]} center zIndexRange={Z_DIMENSIONS} pointerEvents="none">
          <span className="sketch-dimension" ref={(element) => { labels.current[i] = element; }}>{text}</span>
        </Label>
      ))}
    </group>
  );
});
