import { useEffect, useMemo, useState } from 'react';
import type { SearchResult } from '@shared/catalog-search';
import type { CatalogItem, Category, Vec3 } from '@shared/types';
import { wallLength } from '../scene/floorPlan';
import { removeOriginal, removePiece, rotateOriginal, rotatePiece } from '../scene/pieceEdits';
import { resizeCandidates, swapCandidates, swapEdit, type SwapTarget, targetBox } from '../scene/swapResize';
import { closeResize, openResize, setResizeSide, useResize } from '../state/resize';
import { pieceItem, useEditor } from '../state/store';
import { cm, cmSize, inches, priceEstimate } from './format';
import { GenerateItem } from './GenerateItem';
import { Lock, RotateLeft, RotateRight, Unlock } from './icons';
import { FinishPicker } from './inspector/FinishPicker';
import { OriginalReplace } from './inspector/OriginalReplace';
import { RecolorControl } from './inspector/RecolorControl';
import './inspector.css';

// The Inspector (spec §10.4): what is selected, and what can be done with it.

const categoryName = (category: Category) => category[0].toUpperCase() + category.slice(1).replace('_', ' ');

/** A real size as width × depth × height, in inches and in centimeters. */
function Size({ size }: { size: Vec3 }) {
  const [width, height, depth] = size;
  return (
    <p className="dims">
      {inches(width)}″ W × {inches(depth)}″ D × {inches(height)}″ H
      <br />
      <span className="muted">{cmSize(size)}</span>
    </p>
  );
}

/** Puts a Catalog item in place of a Piece or an Original (spec §10.4, §10.5), and selects what now stands there. */
function putInPlace(target: SwapTarget, item: CatalogItem, targetSize?: Vec3) {
  const { setup, catalog, roomState, applyEdit, select } = useEditor.getState();
  const edit = swapEdit({ setup: setup!, catalog: catalog!, roomState: roomState! }, target, item, targetSize);
  applyEdit(edit);
  if (edit.type === 'replace') select({ kind: 'piece', id: edit.pieceId });
}

const LABELS = { fits: 'Fits', closest: 'Closest available' } as const;

/** Catalog items to pick from: thumbnail, title, size and price, and how well each fits. */
function Picks({ items, onPick }: { items: { item: CatalogItem; label?: SearchResult['label'] }[]; onPick: (item: CatalogItem) => void }) {
  return (
    <ul className="picks">
      {items.map(({ item, label }) => (
        <li key={item.id}>
          <button className="pick" onClick={() => onPick(item)}>
            <img src={item.thumbnail} alt="" />
            <span>
              <span className="title" title={item.title}>{item.title}</span>
              <span className="muted">{cmSize(item.size)} · {priceEstimate(item.priceEstimateUsd)}</span>
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
  if (!items.length) return <p className="muted">Nothing else in the Catalog is a {item.category.replace('_', ' ')}.</p>;
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
  // Only categories that hang where the target does, so a floor item can't become a mirror; and
  // the target's own, even when the Catalog has none of it.
  const onWall = useEditor((s) => targetBox({ setup: s.setup!, catalog, roomState: s.roomState! }, target)?.placement.mount === 'wall');
  const categories = useMemo(
    () => [...new Set([startCategory, ...catalog.items.filter((item) => (item.mount === 'wall') === onWall).map((item) => item.category)])],
    [catalog, startCategory, onWall],
  );
  const candidates = useMemo(
    () => resizeCandidates(catalog, { category, targetSize: size, lockHeight, currentId }),
    [catalog, category, size, lockHeight, currentId],
  );
  const { kind, id } = target;

  useEffect(() => {
    openResize({ kind, id }, startSize);
    return closeResize;
  }, [kind, id, startSize]);

  const setSide = (axis: 0 | 2, centimeters: number) => {
    if (centimeters > 0) setResizeSide(axis, centimeters / 100);
  };

  return (
    <div className="tool">
      <p className="muted">Drag the box's handles, or type a size.</p>
      <div className="fields">
        <label>W <input type="number" min={1} value={cm(size[0])} onChange={(e) => setSide(0, e.target.valueAsNumber)} /> cm</label>
        <label>D <input type="number" min={1} value={cm(size[2])} onChange={(e) => setSide(2, e.target.valueAsNumber)} /> cm</label>
        <button aria-pressed={lockHeight} title="Count the height too" onClick={() => setLockHeight(!lockHeight)}>
          {lockHeight ? <Lock /> : <Unlock />} H {cm(size[1])} cm
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
        : <p className="muted">Nothing {currentId && category === startCategory ? 'else ' : ''}in the Catalog is a {category.replace('_', ' ')}.</p>}
      {!candidates.length && <GenerateItem key={category} query={categoryName(category)} category={category} targetSize={size} />}
    </div>
  );
}

type Tool = 'swap' | 'resize' | 'replace';

/** A tool's button, pressed while the tool is open. */
const ToolButton = ({ tool, name, open, setOpen, disabled, title }: {
  tool: Tool; name: string; open: Tool | null; setOpen: (tool: Tool | null) => void; disabled?: boolean; title?: string;
}) => (
  <button aria-pressed={open === tool} disabled={disabled} title={title} onClick={() => setOpen(open === tool ? null : tool)}>{name}</button>
);

/** Why a Kept Original's Move, Replace and Remove are off (the Glossary's Kept). */
const KEPT_HINT = 'Kept: it stays in the room. It can be recolored, but not moved, replaced or removed.';

function PieceInspector({ pieceId }: { pieceId: string }) {
  const item = useEditor((s) => pieceItem(s, pieceId));
  const [open, setOpen] = useState<Tool | null>(null);
  if (!item) return null;
  return (
    <>
      <p className="kind">Piece · {categoryName(item.category)}</p>
      <h2 title={item.title}>{item.title}</h2>
      <Size size={item.size} />
      <p className="price">{priceEstimate(item.priceEstimateUsd)}</p>
      <p>{item.url ? <a href={item.url} target="_blank" rel="noreferrer">View on Amazon</a> : <span className="muted">Generated, so no product link</span>}</p>
      <div className="actions">
        <ToolButton tool="swap" name="Swap" open={open} setOpen={setOpen} />
        <ToolButton tool="resize" name="Resize" open={open} setOpen={setOpen} />
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
        <button title="R" aria-label="Rotate left 15°" onClick={() => rotatePiece(pieceId, 1)}><RotateLeft />15°</button>
        <button title="Shift+R" aria-label="Rotate right 15°" onClick={() => rotatePiece(pieceId, -1)}><RotateRight />15°</button>
        <button title="Delete" onClick={() => removePiece(pieceId)}>Remove</button>
      </div>
      <RecolorControl targetId={pieceId} category={item.category} />
    </>
  );
}

function OriginalInspector({ originalId }: { originalId: string }) {
  const original = useEditor((s) => s.setup!.originals.find(({ id }) => id === originalId));
  const [open, setOpen] = useState<Tool | null>(null);
  if (!original) return null;
  return (
    <>
      <p className="kind">Original · {categoryName(original.category)}</p>
      <h2>{original.label}</h2>
      <Size size={original.box.size} />
      {original.kept && <p className="badge" title={KEPT_HINT}><Lock />Kept</p>}
      <div className="actions">
        <ToolButton tool="replace" name="Replace" open={open} setOpen={setOpen} disabled={original.kept} title={original.kept ? KEPT_HINT : undefined} />
        <ToolButton tool="resize" name="Resize" open={open} setOpen={setOpen} disabled={original.kept} title={original.kept ? KEPT_HINT : undefined} />
      </div>
      <div className="actions">
        <button title={original.kept ? KEPT_HINT : 'R'} aria-label="Rotate left 15°" disabled={original.kept} onClick={() => rotateOriginal(originalId, 1)}><RotateLeft />15°</button>
        <button title={original.kept ? KEPT_HINT : 'Shift+R'} aria-label="Rotate right 15°" disabled={original.kept} onClick={() => rotateOriginal(originalId, -1)}><RotateRight />15°</button>
        <button title={original.kept ? KEPT_HINT : 'Delete'} disabled={original.kept} onClick={() => removeOriginal(originalId)}>Remove</button>
      </div>
      {open === 'replace' && <OriginalReplace original={original} onPick={(item) => putInPlace({ kind: 'original', id: originalId }, item)} />}
      {open === 'resize' && (
        <ResizePanel
          target={{ kind: 'original', id: originalId }}
          category={original.category}
          size={original.box.size}
          onDone={() => setOpen(null)}
        />
      )}
      <RecolorControl targetId={originalId} category={original.category} />
      <FinishPicker target={{ kind: 'original', originalId, category: original.category }} />
    </>
  );
}

function WallInspector({ wallId }: { wallId: string }) {
  const wall = useEditor((s) => s.setup!.walls.find(({ id }) => id === wallId));
  if (!wall) return null;
  return (
    <>
      <p className="kind">Surface</p>
      <h2>{wall.name}</h2>
      <p className="muted">{wallLength(wall).toFixed(2)} m long, {wall.height.toFixed(2)} m high</p>
      <FinishPicker target={{ kind: 'wall', wallId }} />
    </>
  );
}

/** What is selected, and what can be done with it. Each selection gets a fresh panel, with no tool open. */
export function Inspector() {
  const selection = useEditor((s) => s.selection);
  return (
    <aside className="inspector">
      {!selection && <p className="muted empty"><b>Nothing selected.</b> Select a Piece, an Original, or a Wall in the room.</p>}
      {!selection && <><p className="kind">Surface</p><h2>Floor</h2><FinishPicker target={{ kind: 'floor' }} /></>}
      {selection?.kind === 'piece' && <PieceInspector key={selection.id} pieceId={selection.id} />}
      {selection?.kind === 'original' && <OriginalInspector key={selection.id} originalId={selection.id} />}
      {selection?.kind === 'wall' && <WallInspector key={selection.id} wallId={selection.id} />}
    </aside>
  );
}
