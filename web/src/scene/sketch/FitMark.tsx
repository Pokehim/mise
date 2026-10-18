import { useFrame } from '@react-three/fiber';
import { memo, useRef } from 'react';
import { type Group, Vector3 } from 'three';
import type { Placement, Vec3 } from '@shared/types';
import { Label, Z_FIT } from './Label';
import { pencilLoop } from './lines';
import { screenBox, toScreen } from './screen';

/** How far the loop stays out from the item's outline on screen, in pixels, and how much it is scaled past it. */
const MARGIN = 14;
const LOOP_SCALE = 1.12;
/** Room around the loop inside its SVG, for the stroke and the loop's overshoot. */
const PAD = 6;

const center = new Vector3();

interface FitMarkProps {
  id: string;
  placement: Placement;
  size: Vec3;
  messages: string[];
  /** While an item is dragged: the mark shows at once, without drawing on, as it comes and goes. */
  live?: boolean;
}

/**
 * A Fit warning (spec §10.6) in red pencil: a loop drawn by hand round the item as it appears on
 * screen, and a note beside it, such as "Blocks the door". Each frame it measures the item's box on
 * screen, and redraws the loop only when that changed.
 */
export const FitMark = memo(function FitMark({ id, placement: { position, rotationY }, size: [width, height, depth], messages, live }: FitMarkProps) {
  const group = useRef<Group>(null!);
  const loop = useRef<SVGSVGElement>(null);
  const note = useRef<HTMLDivElement>(null);
  const lastLoop = useRef('');

  useFrame(({ camera, size }) => {
    if (!loop.current || !note.current) return;
    group.current.updateWorldMatrix(true, false);
    const middle = toScreen(center.set(0, height / 2, 0), group.current, camera, size);
    // A corner behind the camera (in Walk) projects to the far side of the screen: no loop then.
    const { left, top, right, bottom, behind } = screenBox(group.current, [width, height, depth], middle, camera, size);
    // An ellipse round the box's outline, centered on it; the note at its upper right, outside it.
    const [rx, ry] = [((right - left) / 2) * LOOP_SCALE + MARGIN, ((bottom - top) / 2) * LOOP_SCALE + MARGIN];
    const [ox, oy] = [(left + right) / 2, (top + bottom) / 2];
    const key = behind ? 'behind' : [rx, ry, ox, oy].map(Math.round).join();
    if (key === lastLoop.current) return;
    lastLoop.current = key;
    loop.current.style.visibility = behind ? 'hidden' : '';
    if (behind) return;
    const [w, h] = [2 * rx * 1.1 + 2 * PAD, 2 * ry * 1.1 + 2 * PAD];
    loop.current.setAttribute('viewBox', `${-w / 2} ${-h / 2} ${w} ${h}`);
    Object.assign(loop.current.style, { width: `${w}px`, height: `${h}px`, left: `${ox - w / 2}px`, top: `${oy - h / 2}px` });
    loop.current.firstElementChild!.setAttribute('d', pencilLoop(rx, ry, id));
    Object.assign(note.current.style, { left: `${Math.round(ox + rx * 0.72)}px`, top: `${Math.round(oy - ry * 0.78)}px` });
  });

  return (
    <group ref={group} position={position} rotation-y={rotationY}>
      <Label position={[0, height / 2, 0]} zIndexRange={Z_FIT} pointerEvents="none">
        <div className={live ? 'fit-mark live' : 'fit-mark'}>
          <svg className="pencil-loop" ref={loop} aria-hidden="true">
            <path pathLength={1} />
          </svg>
          <div className="fit-note" ref={note} role="status">
            {messages.map((message) => <div key={message}>{message}</div>)}
          </div>
        </div>
      </Label>
    </group>
  );
}, (a, b) => a.id === b.id && a.placement === b.placement && a.size === b.size && a.messages.join() === b.messages.join() && a.live === b.live);
