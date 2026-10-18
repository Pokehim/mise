import { useEffect, useState } from 'react';
import { footprint, rectCorners, wallPoint } from '@shared/geometry';
import type { RoomSetup, Vec2 } from '@shared/types';
import { loadSetup } from '../api';
import { roomBounds } from '../scene/floorPlan';
import { doorSwing } from '../scene/sketch/door';

/** The plan's square, in pixels: its viewBox, drawn at the size of its grid column (home.css). */
const SIZE = 132;
/** Room around the plan for its dimension lines, in pixels. */
const PAD = 22;
/** How far out from the walls the dimension lines run, and their labels. */
const DIM_OUT = 10;
const LABEL_OUT = 14;
/** Half a tick: a 45° slash across each end of a dimension line. */
const TICK = 3;

/** A tick at (x, y), as an SVG subpath. */
const tick = (x: number, y: number) => `M${x - TICK} ${y + TICK}l${2 * TICK} ${-2 * TICK}`;

/** A Scan's Room Setup, or null when it has none yet (or it can't be read). */
function useSetup(scanId: string) {
  const [setup, setSetup] = useState<RoomSetup | null>();
  useEffect(() => {
    loadSetup(scanId).then(setSetup, () => setSetup(null));
  }, [scanId]);
  return setup;
}

const path = (points: Vec2[], close = false) => `M${points.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join('L')}${close ? 'Z' : ''}`;

/**
 * A Scan's plan, drawn like an architect's: walls in ink, windows as thin lines across their gap,
 * doors with their swing, the Originals in pencil, and the room's overall width and depth.
 */
function Plan({ setup }: { setup: RoomSetup }) {
  const { min: { x: minX, z: minZ }, max: { x: maxX, z: maxZ } } = roomBounds(setup);
  const scale = (SIZE - 2 * PAD) / Math.max(maxX - minX, maxZ - minZ);
  // Centered in the square, north (−Z) up.
  const [ox, oy] = [(SIZE - (maxX - minX) * scale) / 2, (SIZE - (maxZ - minZ) * scale) / 2];
  const at = ([x, z]: Vec2): Vec2 => [ox + (x - minX) * scale, oy + (z - minZ) * scale];
  const [left, top] = at([minX, minZ]);
  const [right, bottom] = at([maxX, maxZ]);
  const meters = (m: number) => `${m.toFixed(1)} m`;

  return (
    <svg className="plan-drawing" viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true">
      {setup.originals.map(({ id, box }) => (
        <path key={id} className="plan-original" d={path(rectCorners(footprint(box, box.size)).map(at), true)} />
      ))}
      {setup.walls.map(({ id, start, end }) => <path key={id} className="plan-wall" d={path([at(start), at(end)])} />)}
      {setup.openings.map((opening) => {
        const wall = setup.walls.find(({ id }) => id === opening.wallId);
        if (!wall) return null;
        const gap = [wallPoint(wall, opening.offset), wallPoint(wall, opening.offset + opening.width)].map(at);
        const swing = opening.kind === 'door' ? doorSwing(opening, wall) : null;
        return (
          <g key={opening.id}>
            <path className="plan-gap" d={path(gap)} />
            {opening.kind === 'window' && <path className="plan-window" d={path(gap)} />}
            {swing && <path className="plan-swing" d={path([...swing.arc.map(at), at(swing.hinge)])} />}
          </g>
        );
      })}
      {/* Overall dimensions: the width above the plan, the depth to its right, with tick ends. */}
      <g className="plan-dims">
        <path d={`M${left} ${top - DIM_OUT}H${right}${tick(left, top - DIM_OUT)}${tick(right, top - DIM_OUT)}`} />
        <path d={`M${right + DIM_OUT} ${top}V${bottom}${tick(right + DIM_OUT, top)}${tick(right + DIM_OUT, bottom)}`} />
        <text x={(left + right) / 2} y={top - LABEL_OUT} textAnchor="middle">{meters(maxX - minX)}</text>
        <text x={right + LABEL_OUT} y={(top + bottom) / 2} textAnchor="middle" transform={`rotate(90 ${right + LABEL_OUT} ${(top + bottom) / 2})`}>{meters(maxZ - minZ)}</text>
      </g>
    </svg>
  );
}

/** The plan of a Scan for Home, or a hatched square while it loads or when it has no Room Setup yet. */
export function ScanPlan({ scanId }: { scanId: string }) {
  const setup = useSetup(scanId);
  return (
    <figure className="plan" aria-hidden="true">
      {setup ? <Plan setup={setup} /> : <figcaption>{setup === null ? 'No Room Setup yet' : ''}</figcaption>}
    </figure>
  );
}
