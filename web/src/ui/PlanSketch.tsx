import { type CSSProperties, useId, useMemo } from 'react';
import { COLOR_NAMES } from '@shared/describe';
import { roomItems, type Item } from '@shared/fit';
import { rectCorners, wallLength, wallPoint } from '@shared/geometry';
import type { Catalog, CatalogItem, Edit, Hex, Opening, RoomSetup, RoomState, Vec2, Wall } from '@shared/types';
import { roomBounds, wallRotationY } from '../scene/floorPlan';
import { doorSwing } from '../scene/sketch/door';
import { replay } from '../state/core';

/** The paper around the room, in meters. */
const MARGIN = 0.3;
/** How far into the room a painted wall's color band reaches, in meters. */
const PAINT_BAND = 0.16;
/** How deep wall art draws, in meters: deeper than it is, so a frame reads as a bar on the wall. */
const ON_WALL_DEPTH = 0.1;
/** The smallest radius a small thing on a top draws at, in meters. */
const DOT = 0.06;
/** How thick a window draws in its wall, in meters. */
const WINDOW_DEPTH = 0.08;

/**
 * A Design seen from above, drawn like an architect's plan: walls and openings in ink, your furniture
 * in pencil, and what the Design adds in its own colors. Rugs are hatched, wall art is a bar on its
 * wall, and lamps and things on tops are dots. Each Piece settles in as it arrives, so a take can be watched as
 * Claude makes it; `latest` is outlined in the wash.
 */
export function PlanSketch({ setup, catalog, edits, latest }: { setup: RoomSetup; catalog: Catalog; edits: Edit[]; latest?: string }) {
  const state = useMemo(() => replay(setup, catalog, edits), [setup, catalog, edits]);
  const items = useMemo(() => roomItems(setup, catalog, state), [setup, catalog, state]);
  const colors = useMemo(() => new Map(catalog.items.map((item) => [item.id, itemColor(item)])), [catalog]);
  // One hatch pattern per plan, as the three takes' plans share a page.
  const hatch = `plan-hatch-${useId().replace(/[^\w-]/g, '')}`;

  const { min, max } = roomBounds(setup);
  const viewBox = `${min.x - MARGIN} ${min.z - MARGIN} ${max.x - min.x + 2 * MARGIN} ${max.z - min.z + 2 * MARGIN}`;
  // Under-floor first: rugs, then furniture, then what stands on it or hangs.
  const layer = ({ category, placement }: Item) => (category === 'rug' ? 0 : placement.mount === 'floor' ? 1 : 2);
  const ordered = items.toSorted((a, b) => layer(a) - layer(b));

  return (
    <svg className="plan-sketch" viewBox={viewBox} preserveAspectRatio="xMidYMid meet" role="img" aria-label="The Design from above">
      <defs>
        <pattern id={hatch} width="0.08" height="0.08" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
          <line x1="0" y1="0" x2="0" y2="0.08" className="hatch" />
        </pattern>
      </defs>
      <polygon className="floor" points={points(setup.floor.polygon)} />
      {setup.walls.map((wall) => {
        const finish = state.surfaces.walls[wall.id];
        if (finish?.kind !== 'paint') return null;
        const [a, b] = [wallPoint(wall, 0, PAINT_BAND / 2), wallPoint(wall, wallLength(wall), PAINT_BAND / 2)];
        return <line key={`paint-${wall.id}`} className="paint" x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={finish.color} strokeWidth={PAINT_BAND} />;
      })}
      {setup.walls.flatMap((wall) => wallSegments(wall, setup.openings).map(([from, to]) => {
        const [a, b] = [wallPoint(wall, from), wallPoint(wall, to)];
        return <line key={`${wall.id}-${from}`} className="wall" x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} />;
      }))}
      {setup.openings.map((opening) => {
        const wall = setup.walls.find(({ id }) => id === opening.wallId);
        if (!wall) return null;
        if (opening.kind === 'window') {
          const center = wallPoint(wall, opening.offset + opening.width / 2);
          const pane = rectCorners({ center, size: [opening.width, WINDOW_DEPTH], rotationY: wallRotationY(wall) });
          return <polygon key={opening.id} className="window" points={points(pane)} />;
        }
        const swing = doorSwing(opening, wall);
        return swing && <polyline key={opening.id} className="swing" points={points([...swing.arc, swing.hinge])} />;
      })}
      {ordered.map((item) => {
        const piece = state.pieces[item.id];
        if (!piece) return <polygon key={item.id} className={`original ${item.category}`} points={points(item.corners)} style={fill(originalColor(state, item.id))} />;
        const color = piece.partColors['*'] ?? Object.values(piece.partColors)[0] ?? colors.get(piece.catalogId);
        const className = `piece ${item.category}${item.id === latest ? ' latest' : ''}`;
        return <g key={item.id} className={className} style={{ '--color': color } as CSSProperties}>{shape(item, hatch)}</g>;
      })}
    </svg>
  );
}

/** A Piece's mark on the plan: a hatched rug, a bar on the wall, a dot on a top or for a lamp, or its footprint. */
function shape(item: Item, hatch: string) {
  const { rect, placement, category } = item;
  if (placement.mount === 'wall') {
    // Out from the wall to ON_WALL_DEPTH, whatever the frame's own depth.
    const front: Vec2 = [Math.sin(rect.rotationY), Math.cos(rect.rotationY)];
    const out = (ON_WALL_DEPTH - rect.size[1]) / 2;
    const center: Vec2 = [rect.center[0] + front[0] * out, rect.center[1] + front[1] * out];
    return <polygon points={points(rectCorners({ ...rect, center, size: [rect.size[0], ON_WALL_DEPTH] }))} />;
  }
  // A lamp is a circle as wide as its base: an arc lamp's footprint is mostly the arc, overhead.
  if (placement.mount === 'surface' || category === 'lamp') {
    return <circle cx={rect.center[0]} cy={rect.center[1]} r={Math.max(DOT, Math.min(...rect.size) / 2)} />;
  }
  if (category === 'rug') {
    return <><polygon points={points(item.corners)} /><polygon className="hatched" points={points(item.corners)} style={{ fill: `url(#${hatch})` }} /></>;
  }
  return <polygon points={points(item.corners)} />;
}

/** The stretches of a wall, in meters from its start, that its Openings leave standing. */
function wallSegments(wall: Wall, openings: Opening[]): [number, number][] {
  const segments: [number, number][] = [];
  let from = 0;
  for (const { offset, width } of openings.filter(({ wallId }) => wallId === wall.id).toSorted((a, b) => a.offset - b.offset)) {
    if (offset > from) segments.push([from, offset]);
    from = Math.max(from, offset + width);
  }
  const end = wallLength(wall);
  if (from < end) segments.push([from, end]);
  return segments;
}

const points = (corners: Vec2[]) => corners.map(([x, z]) => `${x},${z}`).join(' ');
const fill = (color: Hex | undefined) => (color ? { fill: color } : undefined);

/** An Original's color once the Design recolors it, such as its bedding. */
const originalColor = (state: RoomState, id: string): Hex | undefined => Object.values(state.originals[id]?.partColors ?? {})[0];

/** The History's color names, lowercased, and their colors. */
const HEX = new Map(COLOR_NAMES.map(([name, hex]) => [name.toLowerCase(), hex]));
// Longest first, so that "powder blue" wins over "blue".
const NAMES = [...HEX.keys()].toSorted((a, b) => b.length - a.length);
// Catalog color names the History's color names don't spell the same way.
const ALIASES: [RegExp, string][] = [
  [/grey|nickel|steel|silver|chrome/, 'gray'], [/natural|oak|bamboo|rattan|jute/, 'tan'], [/brown|espresso|bronze|walnut/, 'walnut'],
  [/gold|brass/, 'mustard'], [/taupe/, 'greige'], [/oatmeal|ivory|linen/, 'cream'],
];

/** The color an item draws in: its own, or the named color its first color's name names. */
function itemColor({ colorHex, colors, category }: CatalogItem): Hex | undefined {
  if (colorHex) return colorHex;
  const name = colors[0]?.toLowerCase() ?? '';
  const named = NAMES.find((each) => name.includes(each)) ?? ALIASES.find(([pattern]) => pattern.test(name))?.[1];
  return named ? HEX.get(named) : category === 'plant' ? HEX.get('sage') : undefined;
}
