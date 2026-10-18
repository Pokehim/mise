// The sidebar panel of each Room Setup step.
import { useEffect, useMemo, useState } from 'react';
import { type Material, MathUtils, Mesh } from 'three';
import type { Category, Opening, Original } from '@shared/types';
import { scanFileUrl } from '../api';
import { bakeFloorColors } from './bake';
import { bakePatches } from './bakePatches';
import {
  detectCeilingHeight, detectFloorHeight, detectYaw, type Histogram, heightHistogram, levelTransform, wrapAngle,
} from './geometry/level';
import { mm } from './geometry/mesh';
import { wallAxis, withPolygon } from './geometry/walls';
import {
  CORNER_PAIRS, clearCorners, forgetMoved, isAligned, lineUp, openFill, refineLineUp, saveAndMerge, setFillLook, startMarking,
} from './fills';
import { CATEGORIES, CATEGORY_NAMES, UNBAKED_FLOOR_COLOR, defaultPartParams } from './originals';
import { isLeveled, loadScene, type StepId, scanTriangles, useSetup } from './store';

export function StepPanel({ step }: { step: StepId }) {
  switch (step) {
    case 'level': return <LevelPanel />;
    case 'ceiling': return <CeilingPanel />;
    case 'corners': return <CornersPanel />;
    case 'openings': return <OpeningsPanel />;
    case 'originals': return <OriginalsPanel />;
    case 'fills': return <FillsPanel />;
    case 'bake': return <BakePanel />;
  }
}


/** Step 1: the floor height and yaw, which make the meshTransform. */
function LevelPanel() {
  const scene = useSetup((s) => s.scene!);
  const manifest = useSetup((s) => s.manifest!);
  const levelSaved = useSetup((s) => s.saved.manifest === s.manifest);
  const { setMeshTransform, saveLevel } = useSetup.getState();
  const capture = scanTriangles(scene);   // the capture's frame: no meshTransform
  const histogram = useMemo(() => heightHistogram(capture, 'up'), [capture]);
  const floorHeight = -manifest.meshTransform.position[1];
  const yaw = manifest.meshTransform.rotationY;

  const apply = (floor: number, rotationY: number) => setMeshTransform(levelTransform(capture, floor, rotationY));
  const detect = () => apply(detectFloorHeight(capture) ?? 0, detectYaw(capture) ?? 0);
  useEffect(() => {
    // Once, when a Scan that was never leveled opens.
    if (!isLeveled(manifest)) detect();
  }, []);

  return (
    <>
      <p>Check that the floor sits on the grid and the walls run along its lines. Adjust if they don't.</p>
      <label className="rs-field">
        <span>Floor height in the capture <small>(m)</small></span>
        <input type="number" step={0.005} value={mm(floorHeight)} onChange={(e) => apply(Number(e.target.value), yaw)} />
      </label>
      {histogram && <HistogramChart histogram={histogram} marker={floorHeight} label="Up-facing surfaces by height" />}
      <label className="rs-field">
        <span>Yaw <small>({MathUtils.radToDeg(yaw).toFixed(1)}°)</small></span>
        <input type="range" min={-45} max={45} step={0.1} value={MathUtils.radToDeg(yaw)}
          onChange={(e) => apply(floorHeight, MathUtils.degToRad(Number(e.target.value)))} />
      </label>
      <div className="rs-row">
        <button type="button" onClick={detect}>Auto-detect</button>
        <button type="button" className="rs-primary" onClick={saveLevel}>Confirm level</button>
      </div>
      {levelSaved && isLeveled(manifest) && <p className="rs-note">Level saved to the manifest.</p>}
    </>
  );
}

/** Step 2: the ceiling height. */
function CeilingPanel() {
  const scene = useSetup((s) => s.scene!);
  const meshTransform = useSetup((s) => s.manifest!.meshTransform);
  const ceilingHeight = useSetup((s) => s.setup!.ceilingHeight);
  const updateSetup = useSetup((s) => s.updateSetup);
  const scan = scanTriangles(scene, meshTransform);
  const histogram = useMemo(() => heightHistogram(scan, 'down'), [scan]);
  const setHeight = (height: number) => updateSetup((s) => ({
    ...s, ceilingHeight: height, walls: s.walls.map((w) => ({ ...w, height })),
  }));
  const detect = () => {
    const found = detectCeilingHeight(scan);
    if (found) setHeight(mm(found));
  };
  return (
    <>
      <p>The yellow plane should sit on the ceiling.</p>
      <label className="rs-field">
        <span>Ceiling height <small>({ceilingHeight.toFixed(3)} m)</small></span>
        <input type="range" min={1.8} max={4.5} step={0.005} value={ceilingHeight} onChange={(e) => setHeight(Number(e.target.value))} />
      </label>
      {histogram && <HistogramChart histogram={histogram} marker={ceilingHeight} label="Down-facing surfaces by height" />}
      <div className="rs-row"><button type="button" onClick={detect}>Auto-detect</button></div>
    </>
  );
}

/** Step 3: the room's corners, which make the floor polygon and the Walls. */
function CornersPanel() {
  const { floor: { polygon }, walls } = useSetup((s) => s.setup!);
  const updateSetup = useSetup((s) => s.updateSetup);
  return (
    <>
      <p>Click each corner of the room on the floor, in order around the room. A corner snaps square to the last one; hold <kbd>Alt</kbd> to place it freely.</p>
      <p className="rs-note">{polygon.length} corner{polygon.length === 1 ? '' : 's'}{polygon.length > 0 && polygon.length < 3 ? ' · at least 3 make a room' : ''}</p>
      <div className="rs-row">
        <button type="button" disabled={polygon.length === 0} onClick={() => updateSetup((s) => withPolygon(s, s.floor.polygon.slice(0, -1)))}>Undo corner</button>
        <button type="button" disabled={polygon.length === 0} onClick={() => updateSetup((s) => withPolygon(s, []))}>Clear</button>
      </div>
      {walls.length > 0 && (
        <ul className="rs-list">
          {walls.map((wall) => (
            <li key={wall.id}>
              <input value={wall.name} aria-label={`Name of ${wall.id}`}
                onChange={(e) => updateSetup((s) => ({ ...s, walls: s.walls.map((w) => (w.id === wall.id ? { ...w, name: e.target.value } : w)) }))} />
              <small>{wallAxis(wall).length.toFixed(2)} m</small>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

type Swing = NonNullable<Opening['swing']>;

const SWINGS: { value: Swing; label: string }[] = [
  { value: 'in-left', label: 'Opens in, hinge on the left' },
  { value: 'in-right', label: 'Opens in, hinge on the right' },
  { value: 'none', label: 'No swing (sliding, or opens out)' },
];

function SwingSelect({ value, onChange }: { value: Swing; onChange: (swing: Swing) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as Swing)}>
      {SWINGS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
    </select>
  );
}

/** Step 4: doors and windows. */
function OpeningsPanel() {
  const { walls, openings } = useSetup((s) => s.setup!);
  const selectedWallId = useSetup((s) => s.selectedWallId);
  const draft = useSetup((s) => s.openingDraft);
  const { selectWall, updateOpening, updateSetup } = useSetup.getState();
  const setDraft = (change: Partial<typeof draft>) => useSetup.setState({ openingDraft: { ...draft, ...change } });
  if (walls.length === 0) return <p>Mark the corners first (step 3).</p>;
  return (
    <>
      <p>Pick a wall, then click two opposite corners of a door or window on it. Hinge sides are as seen from inside the room.</p>
      <div className="rs-chips">
        {walls.map((wall) => (
          <button type="button" key={wall.id} className={wall.id === selectedWallId ? 'rs-chip rs-chip-on' : 'rs-chip'}
            onClick={() => selectWall(wall.id)}>
            {wall.name}
          </button>
        ))}
      </div>
      <div className="rs-row">
        <label><input type="radio" checked={draft.kind === 'door'} onChange={() => setDraft({ kind: 'door' })} /> Door</label>
        <label><input type="radio" checked={draft.kind === 'window'} onChange={() => setDraft({ kind: 'window' })} /> Window</label>
      </div>
      {draft.kind === 'door' && <SwingSelect value={draft.swing} onChange={(swing) => setDraft({ swing })} />}
      <p className="rs-note">
        {!selectedWallId ? 'Pick a wall.' : draft.first ? 'Now click the opposite corner.' : `Click a corner of the ${draft.kind}.`}
      </p>
      <ul className="rs-list">
        {openings.map((opening) => (
          <li key={opening.id} className="rs-item">
            <div className="rs-row">
              <select value={opening.kind} onChange={(e) => {
                const kind = e.target.value as Opening['kind'];
                // A door starts at the floor.
                updateOpening(opening.id, kind === 'door'
                  ? { kind, bottom: 0, height: mm(opening.bottom + opening.height), swing: opening.swing ?? 'in-left' }
                  : { kind, swing: undefined });
              }}>
                <option value="door">Door</option>
                <option value="window">Window</option>
              </select>
              <span>on {walls.find((w) => w.id === opening.wallId)?.name}</span>
              <button type="button" className="rs-link" onClick={() => updateSetup((s) => ({ ...s, openings: s.openings.filter((o) => o.id !== opening.id) }))}>Delete</button>
            </div>
            {opening.kind === 'door' && (
              <SwingSelect value={opening.swing ?? 'none'} onChange={(swing) => updateOpening(opening.id, { swing })} />
            )}
            <small>{opening.width.toFixed(2)} × {opening.height.toFixed(2)} m, {opening.offset.toFixed(2)} m along, {opening.bottom.toFixed(2)} m up</small>
          </li>
        ))}
      </ul>
    </>
  );
}

/** Step 5: Originals. */
function OriginalsPanel() {
  const originals = useSetup((s) => s.setup!.originals);
  const selectedId = useSetup((s) => s.selectedOriginalId);
  const tagCategory = useSetup((s) => s.tagCategory);
  const notice = useSetup((s) => s.notice);
  const { updateOriginal, updateSetup } = useSetup.getState();
  const selected = originals.find((o) => o.id === selectedId);
  const update = (change: Partial<Original>) => updateOriginal(selectedId!, change);
  return (
    <>
      <p>Choose what you're tagging, then click it in the room. Click a box to select it.</p>
      <label className="rs-field">
        <span>Next click tags a</span>
        <CategorySelect value={tagCategory} onChange={(category) => useSetup.setState({ tagCategory: category })} />
      </label>
      {notice && <p className="rs-note rs-warn">{notice}</p>}
      {selected && (
        <div className="rs-card">
          <label className="rs-field"><span>Label</span><input value={selected.label} onChange={(e) => update({ label: e.target.value })} /></label>
          <label className="rs-field">
            <span>Category</span>
            <CategorySelect value={selected.category} onChange={(category) => update({ category, partParams: defaultPartParams(category) })} />
          </label>
          <label className="rs-check">
            <input type="checkbox" checked={selected.kept} onChange={(e) => update({ kept: e.target.checked })} />
            Kept <small>(stays in the room: can be recolored, never moved or replaced)</small>
          </label>
          <div className="rs-size">
            {(['Width', 'Height', 'Depth'] as const).map((name, axis) => (
              <label key={name}>
                <small>{name}</small>
                <input type="number" step={0.01} min={0.01} value={selected.box.size[axis]} onChange={(e) => {
                  const size = [...selected.box.size] as Original['box']['size'];
                  size[axis] = Math.max(0.01, Number(e.target.value));
                  update({ box: { ...selected.box, size } });
                }} />
              </label>
            ))}
          </div>
          <div className="rs-row">
            <button type="button" title="Turn the front 90° left" onClick={() => update({ box: turned(selected.box, 1) })}>⟲ 90°</button>
            <button type="button" title="Turn the front 90° right" onClick={() => update({ box: turned(selected.box, -1) })}>⟳ 90°</button>
            <button type="button" className="rs-link" onClick={() => {
              updateSetup((s) => ({ ...s, originals: s.originals.filter((o) => o.id !== selected.id) }));
              useSetup.setState({ selectedOriginalId: undefined });
            }}>Delete</button>
          </div>
          <small>The thick edge on the floor is the front.</small>
        </div>
      )}
      <ul className="rs-list">
        {originals.map((o) => (
          <li key={o.id}>
            <button type="button" className={o.id === selectedId ? 'rs-chip rs-chip-on' : 'rs-chip'} onClick={() => useSetup.setState({ selectedOriginalId: o.id })}>
              {o.label}
            </button>
            <small>{CATEGORY_NAMES[o.category]}{o.kept ? ' · Kept' : ''}</small>
          </li>
        ))}
      </ul>
    </>
  );
}

/** The box turned a quarter turn about its center, keeping its footprint on the floor: width and depth swap. */
function turned(box: Original['box'], direction: 1 | -1): Original['box'] {
  const [w, h, d] = box.size;
  const turns = box.rotationY / (Math.PI / 2) + direction;
  // Whole quarter turns stay exact (π, not 3.141592…).
  const quarters = Math.abs(turns - Math.round(turns)) < 1e-6 ? Math.round(turns) : turns;
  return { ...box, size: [d, h, w], rotationY: wrapAngle(quarters * (Math.PI / 2)) };
}

function CategorySelect({ value, onChange }: { value: Category; onChange: (category: Category) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as Category)}>
      {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_NAMES[c]}</option>)}
    </select>
  );
}

/** Step 6 (ADR-0007): line up each Fill Capture, mark the pieces it saw somewhere else, and rebuild room.glb. */
function FillsPanel() {
  const manifest = useSetup((s) => s.manifest!);
  const originals = useSetup((s) => s.setup!.originals);
  const draft = useSetup((s) => s.fill);
  const fills = manifest.captures?.fills ?? [];
  useEffect(() => {
    if (fills.length > 0 && !useSetup.getState().fill) openFill(0);
  }, []);

  if (fills.length === 0) {
    return (
      <>
        <p>A Fill Capture is a Capture taken after moving the furniture. It gives a removed or moved Original the real floor and wall it hid, and a moved one its real back.</p>
        <p className="rs-note">This Scan has none. Import one with <code>npx tsx scripts/scan-import.ts &lt;export&gt; {manifest.id} --fill</code>, then reload.</p>
      </>
    );
  }
  const fill = draft && fills[draft.index];
  const pairs = draft ? Math.min(draft.roomCorners.length, draft.fillCorners.length) : 0;
  let next = 'All corners are clicked: line up.';
  if (draft && draft.roomCorners.length > draft.fillCorners.length) next = `Click corner ${draft.roomCorners.length} on the Fill Capture.`;
  else if (draft && draft.roomCorners.length < CORNER_PAIRS) next = `Click corner ${draft.roomCorners.length + 1} on the room.`;
  return (
    <>
      <p>Line up each Fill Capture with the room, then mark where it saw the furniture that moved. Saving rebuilds room.glb with the Patches and completed Originals they give.</p>
      <label className="rs-field">
        <span>Fill Capture</span>
        <select value={draft?.index ?? 0} onChange={(e) => openFill(Number(e.target.value))}>
          {fills.map((f, i) => <option key={f.mesh} value={i}>{`${i + 1}. ${f.mesh}${isAligned(f) ? ' (lined up)' : ''}`}</option>)}
        </select>
      </label>
      {!draft?.scene || !fill ? <p className="rs-note">Loading the Fill Capture…</p> : (
        <>
          <h3>Line up</h3>
          <p className="rs-note">Click floor-level corners in pairs, first on the room, then the same one on the Fill Capture. {next} ({pairs} of {CORNER_PAIRS} pairs)</p>
          <div className="rs-row">
            <button type="button" onClick={clearCorners} disabled={draft.roomCorners.length === 0}>Clear corners</button>
            <button type="button" className="rs-primary" onClick={lineUp} disabled={pairs < 3}>Line up</button>
            <button type="button" onClick={refineLineUp} disabled={!isAligned(fill)}>Refine</button>
          </div>
          {draft.residual !== undefined && (
            <p className="rs-note">Its floor and walls are within {(draft.residual * 100).toFixed(1)} cm of the room's (median).</p>
          )}
          {isAligned(fill) && (
            <label className="rs-field">
              <span>Show the Fill Capture</span>
              <select value={draft.look} onChange={(e) => setFillLook(e.target.value as typeof draft.look)}>
                <option value="solid">Solid, over the room</option>
                <option value="wireframe">As a wireframe, to compare</option>
                <option value="hidden">Hidden</option>
              </select>
            </label>
          )}
          <h3>Moved Originals</h3>
          <p className="rs-note">For each Original that stood somewhere else in this Capture, press Mark, then click it in the Fill Capture.</p>
          <ul className="rs-list">
            {originals.filter((o) => !o.kept).map((o) => {
              const moved = fill.moved.some((m) => m.originalId === o.id);
              const copy = draft.copies[o.id];
              const marking = draft.markingId === o.id;
              const status = marking ? 'click it in the Fill Capture'
                : moved ? `marked${copy ? `, within ${(copy.residual * 100).toFixed(1)} cm` : ''}` : 'not moved';
              return (
                <li key={o.id}>
                  {o.label}
                  <small>{status}</small>
                  <button type="button" disabled={!isAligned(fill)} onClick={() => startMarking(marking ? undefined : o.id)}>
                    {marking ? 'Cancel' : moved ? 'Mark again' : 'Mark'}
                  </button>
                  {moved && <button type="button" onClick={() => forgetMoved(o.id)}>Clear</button>}
                </li>
              );
            })}
          </ul>
          <div className="rs-row">
            <button type="button" className="rs-primary" disabled={!isAligned(fill)} onClick={saveAndMerge}>Save and rebuild room.glb</button>
          </div>
          {draft.merged && <p className="rs-note">{draft.merged} To see a Patch, remove or move an Original in a Design.</p>}
        </>
      )}
    </>
  );
}

/** "floor + 2 walls": the images a baked Patch holds. */
function patchSummary({ floor, walls }: NonNullable<Original['patch']>) {
  const count = Object.keys(walls ?? {}).length;
  return [floor && 'floor', count > 0 && `${count} wall${count > 1 ? 's' : ''}`].filter(Boolean).join(' + ');
}

/** Step 7: each Original's floorColor, and the Patch images for the spots no Capture saw (spec §11.2). */
function BakePanel() {
  const originals = useSetup((s) => s.setup!.originals);
  const [result, setResult] = useState<string>();
  const [busy, setBusy] = useState(false);
  const bake = async () => {
    const { renderer, scene, setup, manifest, updateSetup } = useSetup.getState();
    if (!renderer || !scene || !setup || !manifest) return;
    if (setup.floor.polygon.length < 3) {
      setResult('Mark the corners first (step 3).');
      return;
    }
    setBusy(true);
    setResult(undefined);
    // Patch v2 draws the Fill Captures' Patches, which only the merged room.glb holds. Without Fill Captures the loaded scene is it.
    let merged = scene;
    try {
      const started = performance.now();
      const colors = bakeFloorColors(renderer, scene, setup, manifest);
      if (manifest.captures) merged = await loadScene(scanFileUrl(manifest.id, manifest.mesh));
      const { patches, images } = await bakePatches(renderer, merged, setup, manifest);
      updateSetup((s) => ({
        ...s,
        originals: s.originals.map((o) => ({ ...o, floorColor: colors[o.id] ?? o.floorColor, patch: patches[o.id] })),
      }));
      const ms = Math.round(performance.now() - started);
      const missing = setup.originals.filter((o) => !colors[o.id]).length;
      setResult(`Baked ${setup.originals.length - missing} floor colors and ${images} Patch images in ${ms} ms.${missing ? ` No floor was seen around ${missing}.` : ''} Save to keep them.`);
    } catch (error) {
      setResult(`Bake failed: ${(error as Error).message}`);
    } finally {
      if (merged !== scene) {
        merged.traverse((object) => {
          if (!(object instanceof Mesh)) return;
          object.geometry.dispose();
          const material = object.material as Material & { map?: { dispose(): void } | null };
          material.map?.dispose();
          material.dispose();
        });
      }
      setBusy(false);
    }
  };
  return (
    <>
      <p>
        Bake measures the floor's color around each Original, so a replaced Original's spot is patched with it. It also fills,
        for each Original that is not Kept, the floor and wall that no Capture saw (Patch v2), and saves them as images.
      </p>
      <div className="rs-row"><button type="button" className="rs-primary" disabled={busy} onClick={bake}>{busy ? 'Baking…' : 'Bake'}</button></div>
      {result && <p className="rs-note">{result}</p>}
      <ul className="rs-list">
        {originals.map((o) => (
          <li key={o.id}>
            <span className="rs-swatch" style={{ background: o.floorColor }} />
            {o.label}
            <small>
              {o.floorColor === UNBAKED_FLOOR_COLOR ? 'not baked' : o.floorColor}
              {o.kept ? ', Kept' : o.patch ? `, Patch: ${patchSummary(o.patch)}` : ''}
            </small>
          </li>
        ))}
      </ul>
    </>
  );
}

/** A small bar chart of a height histogram, with a line at the chosen height. */
function HistogramChart({ histogram, marker, label }: { histogram: Histogram; marker: number; label: string }) {
  const { start, binSize, weights } = histogram;
  const width = 260;
  const height = 60;
  const max = Math.max(...weights);
  const x = (y: number) => ((y - start) / (binSize * weights.length)) * width;
  return (
    <figure className="rs-histogram">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
        {Array.from(weights, (w, i) => (
          <rect key={i} x={(i / weights.length) * width} width={Math.max(1, width / weights.length)} y={height - (w / max) * height} height={(w / max) * height} />
        ))}
        <line x1={x(marker)} x2={x(marker)} y1={0} y2={height} />
      </svg>
      <figcaption>{label}: {start.toFixed(2)} to {(start + binSize * weights.length).toFixed(2)} m</figcaption>
    </figure>
  );
}
