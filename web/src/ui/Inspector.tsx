import { useEffect, useMemo, useState } from 'react';
import type { CatalogItem, Category, Vec3 } from '@shared/types';
import { wallLength } from '../scene/floorPlan';
import { removePiece, rotatePiece } from '../scene/pieceEdits';
import { useResize } from '../scene/ResizeHandles';
import { type Room, resizeCandidates, swapCandidates, swapEdit, type SwapTarget } from '../scene/swapResize';
import { pieceItem, useEditor } from '../state/store';
import './inspector.css';

// The Inspector (spec §10.4): what is selected, and what can be done with it. The disabled
// buttons are the slots where #9's Recolor, Paint and Replace controls go.

const inches = (meters: number) => (meters / 0.0254).toFixed(1);
const cm = (meters: number) => Math.round(meters * 100);
const categoryName = (category: Category) => category[0].toUpperCase() + category.slice(1).replace('_', ' ');

/** A real size as width × depth × height, in inches and in centimeters. */
function Size({ size: [width, height, depth] }: { size: Vec3 }) {
  return (
    <p>
      {inches(width)}″ W × {inches(depth)}″ D × {inches(height)}″ H
      <br />
      <span className="muted">{cm(width)} × {cm(depth)} × {cm(height)} cm</span>
    </p>
  );
}

const Slot = ({ name, issue }: { name: string; issue: string }) => (
  <button disabled title={`Coming in ${issue}`}>{name}</button>
);

/** The editor's state as a swap reads it. */
function currentRoom(): Room {
  const { setup, catalog, roomState } = useEditor.getState();
  return { setup: setup!, catalog: catalog!, roomState: roomState! };
}

/** Puts a Catalog item in place of a Piece or an Original (spec §10.4, §10.5), and selects what now stands there. */
function putInPlace(target: SwapTarget, item: CatalogItem, targetSize?: Vec3) {
  const edit = swapEdit(currentRoom(), target, item, targetSize);
  const { applyEdit, select } = useEditor.getState();
  applyEdit(edit);
  if (edit.type === 'replace') select({ kind: 'piece', id: edit.pieceId });
}

const LABELS = { fits: 'Fits', closest: 'Closest available' } as const;

/** Catalog items to pick from: thumbnail, title, size and price, and how well each fits. */
function Picks({ items, onPick }: { items: { item: CatalogItem; label?: 'fits' | 'closest' }[]; onPick: (item: CatalogItem) => void }) {
  return (
    <ul className="picks">
      {items.map(({ item, label }) => (
        <li key={item.id}>
          <button className="pick" onClick={() => onPick(item)}>
            <img src={item.thumbnail} alt="" />
            <span>
              <span className="title" title={item.title}>{item.title}</span>
              <span className="muted">{cm(item.size[0])} × {cm(item.size[2])} × {cm(item.size[1])} cm · ≈ ${item.priceEstimateUsd} (est.)</span>
              {label && <span className={`fit-label ${label}`}>{LABELS[label]}</span>}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Swap (spec §10.4): the other items of the Piece's category, closest in size first. */
function SwapList({ pieceId, item }: { pieceId: string; item: CatalogItem }) {
  const catalog = useEditor((s) => s.catalog!);
  const items = useMemo(() => swapCandidates(catalog, item), [catalog, item]);
  if (!items.length) return <p className="muted">Nothing else in the Catalog is a {categoryName(item.category).toLowerCase()}.</p>;
  return <Picks items={items.map((choice) => ({ item: choice }))} onPick={(choice) => putInPlace({ kind: 'piece', id: pieceId }, choice)} />;
}

interface ResizePanelProps {
  target: SwapTarget;
  category: Category;
  /** The target's own size, which the Resize box starts at. */
  size: Vec3;
  /** A Piece's Catalog item, which isn't a candidate for it. */
  currentId?: string;
  onDone: () => void;
}

/**
 * Resize (spec §10.5): while it is open, the view shows a box with handles on the target. The
 * candidates follow the box: the 3 Catalog items closest to its size, in the category picked.
 */
function ResizePanel({ target, category: startCategory, size: startSize, currentId, onDone }: ResizePanelProps) {
  const catalog = useEditor((s) => s.catalog!);
  const size = useResize((s) => s.session?.size) ?? startSize;
  const [category, setCategory] = useState(startCategory);
  const [lockHeight, setLockHeight] = useState(false);
  const categories = useMemo(() => [...new Set(catalog.items.map((item) => item.category))], [catalog]);
  const candidates = useMemo(
    () => resizeCandidates(catalog, { category, targetSize: size, lockHeight, currentId }),
    [catalog, category, size, lockHeight, currentId],
  );
  const { kind, id } = target;

  useEffect(() => {
    useResize.setState({ session: { target: { kind, id }, size: startSize } });
    return () => useResize.setState({ session: null });
  }, [kind, id, startSize]);

  const setSide = (axis: 0 | 2, centimeters: number) => {
    const session = useResize.getState().session;
    if (!session || !(centimeters > 0)) return;
    const next: Vec3 = [...session.size];
    next[axis] = centimeters / 100;
    useResize.setState({ session: { ...session, size: next } });
  };

  return (
    <div className="tool">
      <p className="muted">Drag the box's handles, or type a size.</p>
      <div className="fields">
        <label>W <input type="number" min={1} value={cm(size[0])} onChange={(e) => setSide(0, e.target.valueAsNumber)} /> cm</label>
        <label>D <input type="number" min={1} value={cm(size[2])} onChange={(e) => setSide(2, e.target.valueAsNumber)} /> cm</label>
        <button aria-pressed={lockHeight} title="Count the height too" onClick={() => setLockHeight(!lockHeight)}>
          {lockHeight ? '🔒' : '🔓'} H {cm(size[1])} cm
        </button>
      </div>
      <label className="fields">
        Category
        <select value={category} onChange={(e) => setCategory(e.target.value as Category)}>
          {categories.map((c) => <option key={c} value={c}>{categoryName(c)}</option>)}
        </select>
      </label>
      {candidates.length
        ? <Picks items={candidates} onPick={(item) => {
            putInPlace(target, item, size);
            onDone();
          }} />
        : <p className="muted">Nothing in the Catalog is a {categoryName(category).toLowerCase()}.</p>}
    </div>
  );
}

type Tool = 'swap' | 'resize';

/** A tool's button, pressed while the tool is open. */
const ToolButton = ({ tool, name, open, setOpen }: { tool: Tool; name: string; open: Tool | null; setOpen: (tool: Tool | null) => void }) => (
  <button aria-pressed={open === tool} onClick={() => setOpen(open === tool ? null : tool)}>{name}</button>
);

function PieceInspector({ pieceId }: { pieceId: string }) {
  const item = useEditor((s) => pieceItem(s, pieceId));
  const [open, setOpen] = useState<Tool | null>(null);
  if (!item) return null;
  return (
    <>
      <h2>{item.title}</h2>
      <Size size={item.size} />
      <p>≈ ${item.priceEstimateUsd} (est.)</p>
      <p><a href={item.url} target="_blank" rel="noreferrer">View on Amazon</a></p>
      <div className="actions">
        <ToolButton tool="swap" name="Swap" open={open} setOpen={setOpen} />
        <ToolButton tool="resize" name="Resize" open={open} setOpen={setOpen} />
        <Slot name="Recolor" issue="#9" />
      </div>
      {open === 'swap' && <SwapList pieceId={pieceId} item={item} />}
      {open === 'resize' && (
        <ResizePanel
          target={{ kind: 'piece', id: pieceId }}
          category={item.category}
          size={item.size}
          currentId={item.id}
          onDone={() => setOpen(null)}
        />
      )}
      <div className="actions">
        <button title="R" onClick={() => rotatePiece(pieceId, 1)}>↺ 15°</button>
        <button title="Shift+R" onClick={() => rotatePiece(pieceId, -1)}>↻ 15°</button>
        <button title="Delete" onClick={() => removePiece(pieceId)}>Remove</button>
      </div>
    </>
  );
}

function OriginalInspector({ originalId }: { originalId: string }) {
  const original = useEditor((s) => s.setup!.originals.find(({ id }) => id === originalId));
  const [open, setOpen] = useState<Tool | null>(null);
  if (!original) return null;
  return (
    <>
      <h2>{original.label}</h2>
      <Size size={original.box.size} />
      {original.kept && <p className="badge" title="It stays in the room: it can be recolored, but not moved, replaced or removed.">Kept</p>}
      <div className="actions">
        {!original.kept && <Slot name="Replace" issue="#9" />}
        {!original.kept && <ToolButton tool="resize" name="Resize" open={open} setOpen={setOpen} />}
        <Slot name="Recolor" issue="#9" />
      </div>
      {open === 'resize' && (
        <ResizePanel
          target={{ kind: 'original', id: originalId }}
          category={original.category}
          size={original.box.size}
          onDone={() => setOpen(null)}
        />
      )}
    </>
  );
}

function WallInspector({ wallId }: { wallId: string }) {
  const wall = useEditor((s) => s.setup!.walls.find(({ id }) => id === wallId));
  if (!wall) return null;
  return (
    <>
      <h2>{wall.name}</h2>
      <p className="muted">{wallLength(wall).toFixed(2)} m long, {wall.height.toFixed(2)} m high</p>
      <div className="actions">
        <Slot name="Paint" issue="#9" />
      </div>
    </>
  );
}

/** What is selected, and what can be done with it. Each selection gets a fresh panel, with no tool open. */
export function Inspector() {
  const selection = useEditor((s) => s.selection);
  return (
    <aside className="inspector">
      {!selection && <p className="muted">Select a Piece, an Original, or a Wall.</p>}
      {selection?.kind === 'piece' && <PieceInspector key={selection.id} pieceId={selection.id} />}
      {selection?.kind === 'original' && <OriginalInspector key={selection.id} originalId={selection.id} />}
      {selection?.kind === 'wall' && <WallInspector key={selection.id} wallId={selection.id} />}
    </aside>
  );
}
