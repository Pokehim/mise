import { Hud } from '@react-three/drei';
import { useMemo } from 'react';
import { wallPoint } from '@shared/geometry';
import type { Placement, Vec3 } from '@shared/types';
import { useResize } from '../../state/resize';
import { type Preview, type Selection, useEditor } from '../../state/store';
import { priceEstimate } from '../../ui/format';
import { wallLength, wallRotationY } from '../floorPlan';
import { type SwapContext, swapPlacement, targetBox } from '../swapResize';
import { Callout } from './Callout';
import { Dimensions } from './Dimensions';
import { InkBox } from './InkBox';

/** What the sketch draws around: where it stands, its size, and what the callout says. */
interface Sketched {
  placement: Placement;
  size: Vec3;
  title: string;
  detail: string;
  mono: boolean;
}

/** A Catalog title cut to its name, for a hand-lettered callout: "Rivet Campbell Mid-Century Coffee Table". */
const shortTitle = (title: string) => title.split(/,| with | - | – /)[0].trim();

/** A Piece, Original or Wall where it is shown now (a dragged one follows the pointer), or null when it's gone. */
function sketch({ kind, id }: Selection, context: SwapContext, preview: Preview | null): Sketched | null {
  if (kind === 'wall') {
    const wall = context.setup.walls.find((it) => it.id === id);
    if (!wall) return null;
    const length = wallLength(wall);
    const [x, z] = wallPoint(wall, length / 2, 0);
    return {
      placement: { position: [x, 0, z], rotationY: wallRotationY(wall), mount: 'wall' },
      size: [length, wall.height, 0.02],
      title: wall.name,
      detail: `${length.toFixed(2)} m`,
      mono: true,
    };
  }
  const box = targetBox(context, { kind, id });
  if (!box) return null;
  const placement = preview?.pieceId === id ? preview.placement : box.placement;
  if (kind === 'piece') {
    const item = context.catalog.items.find((it) => it.id === context.roomState.pieces[id].catalogId)!;
    return { placement, size: box.size, title: shortTitle(item.title), detail: priceEstimate(item.priceEstimateUsd), mono: true };
  }
  const original = context.setup.originals.find((it) => it.id === id)!;
  return { placement, size: box.size, title: original.label, detail: original.kept ? 'Kept Original' : 'Original', mono: false };
}

/** A Piece's, Original's or Wall's key and wobble seed: its sketch draws on afresh for each. */
const keyOf = ({ kind, id }: Selection) => `${kind}:${id}`;

/**
 * The sketch over the selection (docs/design/sketch-style.md): an ink box around it, its dimensions
 * on the floor, and a callout with its name. A History row's item, while hovered (#11), gets an ink
 * box too. During a Resize the dimensions show the size being drawn, where the new item will stand.
 *
 * It is drawn over the scene (a Hud, always mounted so rendering never changes), because the
 * selection touches the floor and the walls, which would otherwise hide most of its lines. As the
 * first Hud (priority 1), it is also the one that draws the scene itself.
 */
export function SketchSelection() {
  const selection = useEditor((s) => s.selection);
  const highlight = useEditor((s) => s.highlight);
  const setup = useEditor((s) => s.setup!);
  const catalog = useEditor((s) => s.catalog!);
  const roomState = useEditor((s) => s.roomState!);
  const preview = useEditor((s) => s.preview);
  const resize = useResize((s) => s.session);
  const context = useMemo<SwapContext>(() => ({ setup, catalog, roomState }), [setup, catalog, roomState]);
  // A hovered History row's item, unless it is the selection itself (as right after clicking its row).
  const hovered = highlight && (highlight.kind !== selection?.kind || highlight.id !== selection.id) ? highlight : null;
  const selected = useMemo(() => selection && sketch(selection, context, preview), [selection, context, preview]);
  const outlined = useMemo(() => hovered && sketch(hovered, context, preview), [hovered, context, preview]);
  // Where a resized item will stand, its back-center kept, as the Resize box shows (ResizeHandles).
  const resizing = selection && resize?.target.id === selection.id ? swapPlacement(context, resize.target, resize.size[2]) : undefined;
  const measured = resizing ?? selected?.placement;

  return (
    <Hud>
      {selection && selected && (
        <group position={selected.placement.position} rotation-y={selected.placement.rotationY}>
          {/* While it is being resized, the Resize box's guide stands in for it. */}
          {/* Siblings need keys of their own: with one key, React kept each old box drawn over the next selection. */}
          {!resizing && <InkBox key={`box:${keyOf(selection)}`} size={selected.size} seed={keyOf(selection)} />}
          <Callout key={`callout:${keyOf(selection)}`} size={selected.size} title={selected.title} detail={selected.detail} mono={selected.mono} />
        </group>
      )}
      {selection && selected && measured && selection.kind !== 'wall' && (
        <group position={measured.position} rotation-y={measured.rotationY}>
          <Dimensions size={resizing ? resize!.size : selected.size} mount={selected.placement.mount} />
        </group>
      )}
      {hovered && outlined && (
        <group position={outlined.placement.position} rotation-y={outlined.placement.rotationY}>
          <InkBox key={keyOf(hovered)} size={outlined.size} seed={keyOf(hovered)} />
        </group>
      )}
    </Hud>
  );
}
