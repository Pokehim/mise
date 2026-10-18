import { useFrame } from '@react-three/fiber';
import { memo, useRef } from 'react';
import { type Group, Vector3 } from 'three';
import type { Vec3 } from '@shared/types';
import { useEditor } from '../../state/store';
import { Label, Z_CALLOUT } from './Label';
import { screenBox, toScreen } from './screen';

const at = new Vector3();
/**
 * Past this far right of the view's center (in normalized device coordinates), the callout goes left;
 * it comes back right only short of FLIP_BACK_X, so an item near the line doesn't make it flap.
 */
const FLIP_X = 0.3;
const FLIP_BACK_X = 0.2;
/** The leader's rise, in pixels: at least this, and far enough that the label clears the item. */
const MIN_RISE = 44;
/** Half the label's height, plus the gap left between it and the item. */
const CLEAR = 40;

interface CalloutProps {
  /** The item's size: the leader starts at the middle of its top, and its label clears it. */
  size: Vec3;
  /** The item's name, hand-lettered. */
  title: string;
  /** A price or a length, or a word such as "Original". */
  detail: string;
  /** Whether `detail` is a number, set in mono. */
  mono?: boolean;
}

/**
 * A hand-lettered label on a leader line from the top of the selected item, rising past the item as
 * it appears on screen and out to the side of the view with more room, so it never covers the item.
 * Put it in a group at the item's placement. The leader draws on as it mounts (key it to the
 * selection), then the label fades in.
 */
export const Callout = memo(function Callout({ size, title, detail, mono }: CalloutProps) {
  const anchor = useRef<Group>(null!);
  const callout = useRef<HTMLDivElement>(null);
  const shape = useRef('');

  useFrame(({ camera, size: view }) => {
    const element = callout.current;
    if (!element) return;
    const item = anchor.current.parent!;
    item.updateWorldMatrix(true, true);
    const top = toScreen(at.set(0, 0, 0), anchor.current, camera, view);
    const x = (top.x / view.width) * 2 - 1;
    const was = element.dataset.side;
    // A dragged item keeps its callout's side until it's let go, so the label doesn't jump across the view mid-drag.
    const side = useEditor.getState().preview ? was : was === 'left' ? (x < FLIP_BACK_X ? 'right' : 'left') : (x > FLIP_X ? 'left' : 'right');
    const box = screenBox(item, size, top, camera, view);
    const rise = box.behind ? MIN_RISE : Math.max(MIN_RISE, Math.round(CLEAR - box.top));
    if (shape.current === `${side}${rise}`) return;
    shape.current = `${side}${rise}`;
    // A flip redraws the label on its new side rather than teleporting it there.
    if (side !== was) element.querySelector('.callout-label')?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 120, easing: 'ease-out' });
    element.dataset.side = side;
    element.style.setProperty('--rise', `${rise}px`);
    const path = `M4 ${rise} 38 10h24`;
    for (const line of element.querySelectorAll('.callout-leader path')) line.setAttribute('d', path);
    element.querySelector('.callout-leader circle')!.setAttribute('cy', String(rise));
    element.querySelector('.callout-leader')!.setAttribute('viewBox', `0 0 64 ${rise + 4}`);
  });

  return (
    <group ref={anchor} position-y={size[1]}>
      <Label zIndexRange={Z_CALLOUT} pointerEvents="none">
        <div className="callout" ref={callout} data-side="right">
          <svg className="callout-leader" width="64" aria-hidden="true">
            <path className="halo" />
            <path className="ink" pathLength={1} />
            <circle cx="4" r="2.5" />
          </svg>
          <p className="callout-label">
            <span className="callout-title">{title}</span>
            <span className={mono ? 'callout-detail mono' : 'callout-detail'}>{detail}</span>
          </p>
        </div>
      </Label>
    </group>
  );
});
