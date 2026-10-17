// The sidebar panel of each Room Setup step.
import { useEffect, useMemo, useState } from 'react';
import type { Category, Opening, Original } from '@shared/types';
import { saveManifest } from '../api';
import { bakeFloorColors } from './bake';
import { detectCeilingHeight, detectFloorHeight, detectYaw, type Histogram, heightHistogram, levelTransform } from './geometry/level';
import { wallAxis } from './geometry/walls';
import { CATEGORIES, CATEGORY_NAMES, UNBAKED_FLOOR_COLOR, defaultPartParams } from './originals';
import { withPolygon } from './overlays';
import { type StepId, scanTriangles, useSetup } from './store';

export function StepPanel({ step }: { step: StepId }) {
  switch (step) {
    case 'level': return <LevelPanel />;
    case 'ceiling': return <CeilingPanel />;
    case 'corners': return <CornersPanel />;
    case 'openings': return <OpeningsPanel />;
    case 'originals': return <OriginalsPanel />;
    case 'bake': return <BakePanel />;
  }
}

const isIdentity = ({ position, rotationY }: { position: number[]; rotationY: number }) =>
  rotationY === 0 && position.every((v) => v === 0);
const degrees = (radians: number) => (radians * 180) / Math.PI;
const round = (v: number, places = 3) => Math.round(v * 10 ** places) / 10 ** places;

/** Step 1: the floor height and yaw, which make the meshTransform. */
function LevelPanel() {
  const scene = useSetup((s) => s.scene!);
  const manifest = useSetup((s) => s.manifest!);
  const setMeshTransform = useSetup((s) => s.setMeshTransform);
  const [saving, setSaving] = useState<string>();
  const capture = scanTriangles(scene);   // the capture's frame: no meshTransform
  const histogram = useMemo(() => heightHistogram(capture, 'up'), [capture]);
  const floorHeight = -manifest.meshTransform.position[1];
  const yaw = manifest.meshTransform.rotationY;

  const apply = (floor: number, rotationY: number) => setMeshTransform(levelTransform(capture, floor, rotationY));
  const detect = () => apply(detectFloorHeight(capture) ?? 0, detectYaw(capture) ?? 0);
  useEffect(() => {
    // Once, when a Scan that was never leveled opens.
    if (isIdentity(manifest.meshTransform)) detect();
  }, []);

  const save = async () => {
    setSaving('Saving…');
    try {
      await saveManifest(manifest);
      useSetup.setState((s) => ({ saved: { ...s.saved, manifest: JSON.stringify(manifest) } }));
      setSaving('Level saved to the manifest.');
    } catch (error) {
      setSaving(`Not saved: ${(error as Error).message}`);
    }
  };

  return (
    <>
      <p>Check that the floor sits on the grid and the walls run along its lines. Adjust if they don't.</p>
      <label className="rs-field">
        <span>Floor height in the capture <small>(m)</small></span>
        <input type="number" step={0.005} value={round(floorHeight)} onChange={(e) => apply(Number(e.target.value), yaw)} />
      </label>
      {histogram && <HistogramChart histogram={histogram} marker={floorHeight} label="Up-facing surfaces by height" />}
      <label className="rs-field">
        <span>Yaw <small>({round(degrees(yaw), 1)}°)</small></span>
        <input type="range" min={-45} max={45} step={0.1} value={degrees(yaw)}
          onChange={(e) => apply(floorHeight, (Number(e.target.value) * Math.PI) / 180)} />
      </label>
      <div className="rs-row">
        <button type="button" onClick={detect}>Auto-detect</button>
        <button type="button" className="rs-primary" onClick={save}>Confirm level</button>
      </div>
      {saving && <p className="rs-note">{saving}</p>}
    </>
  );
}

/** Step 2: the ceiling height. */
function CeilingPanel() {
  const scene = useSetup((s) => s.scene!);
  const meshTransform = useSetup((s) => s.manifest!.meshTransform);
  const ceilingHeight = useSetup((s) => s.setup!.ceilingHeight);
  const updateSetup = useSetup((s) => s.updateSetup);
  const room = scanTriangles(scene, meshTransform);
  const histogram = useMemo(() => heightHistogram(room, 'down'), [room]);
  const setHeight = (height: number) => updateSetup((s) => ({
    ...s, ceilingHeight: height, walls: s.walls.map((w) => ({ ...w, height })),
  }));
  const detect = () => {
    const found = detectCeilingHeight(room);
    if (found) setHeight(round(found));
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

const SWINGS: { value: NonNullable<Opening['swing']>; label: string }[] = [
  { value: 'in-left', label: 'Opens in, hinge on the left' },
  { value: 'in-right', label: 'Opens in, hinge on the right' },
  { value: 'none', label: 'No swing (sliding, or opens out)' },
];

/** Step 4: doors and windows. */
function OpeningsPanel() {
  const { walls, openings } = useSetup((s) => s.setup!);
  const selectedWallId = useSetup((s) => s.selectedWallId);
  const draft = useSetup((s) => s.openingDraft);
  const { set, updateSetup } = useSetup.getState();
  const update = (id: string, change: Partial<Opening>) =>
    updateSetup((s) => ({ ...s, openings: s.openings.map((o) => (o.id === id ? { ...o, ...change } : o)) }));
  if (walls.length === 0) return <p>Mark the corners first (step 3).</p>;
  return (
    <>
      <p>Pick a wall, then click two opposite corners of a door or window on it. Hinge sides are as seen from inside the room.</p>
      <div className="rs-chips">
        {walls.map((wall) => (
          <button type="button" key={wall.id} className={wall.id === selectedWallId ? 'rs-chip rs-chip-on' : 'rs-chip'}
            onClick={() => set({ selectedWallId: wall.id, openingDraft: { ...draft, first: undefined } })}>
            {wall.name}
          </button>
        ))}
      </div>
      <div className="rs-row">
        <label><input type="radio" checked={draft.kind === 'door'} onChange={() => set({ openingDraft: { ...draft, kind: 'door' } })} /> Door</label>
        <label><input type="radio" checked={draft.kind === 'window'} onChange={() => set({ openingDraft: { ...draft, kind: 'window' } })} /> Window</label>
      </div>
      {draft.kind === 'door' && (
        <select value={draft.swing} onChange={(e) => set({ openingDraft: { ...draft, swing: e.target.value as NonNullable<Opening['swing']> } })}>
          {SWINGS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      )}
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
                update(opening.id, kind === 'door'
                  ? { kind, bottom: 0, height: round(opening.bottom + opening.height), swing: opening.swing ?? 'in-left' }
                  : { kind, swing: undefined });
              }}>
                <option value="door">Door</option>
                <option value="window">Window</option>
              </select>
              <span>on {walls.find((w) => w.id === opening.wallId)?.name}</span>
              <button type="button" className="rs-link" onClick={() => updateSetup((s) => ({ ...s, openings: s.openings.filter((o) => o.id !== opening.id) }))}>Delete</button>
            </div>
            {opening.kind === 'door' && (
              <select value={opening.swing ?? 'none'} onChange={(e) => update(opening.id, { swing: e.target.value as NonNullable<Opening['swing']> })}>
                {SWINGS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
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
  const { set, updateSetup } = useSetup.getState();
  const selected = originals.find((o) => o.id === selectedId);
  const update = (change: Partial<Original>) =>
    updateSetup((s) => ({ ...s, originals: s.originals.map((o) => (o.id === selectedId ? { ...o, ...change } : o)) }));
  return (
    <>
      <p>Choose what you're tagging, then click it in the room. Click a box to select it.</p>
      <label className="rs-field">
        <span>Next click tags a</span>
        <CategorySelect value={tagCategory} onChange={(category) => set({ tagCategory: category })} />
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
              set({ selectedOriginalId: undefined });
            }}>Delete</button>
          </div>
          <small>The thick edge on the floor is the front.</small>
        </div>
      )}
      <ul className="rs-list">
        {originals.map((o) => (
          <li key={o.id}>
            <button type="button" className={o.id === selectedId ? 'rs-chip rs-chip-on' : 'rs-chip'} onClick={() => set({ selectedOriginalId: o.id })}>
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
  const quarter = Math.PI / 2;
  const turns = box.rotationY / quarter + direction;
  // Whole quarter turns stay exact (π, not 3.141592…), and the angle stays in (−π, π].
  let rotationY = Math.abs(turns - Math.round(turns)) < 1e-6 ? Math.round(turns) * quarter : turns * quarter;
  if (rotationY > Math.PI) rotationY -= 2 * Math.PI;
  if (rotationY <= -Math.PI) rotationY += 2 * Math.PI;
  return { ...box, size: [d, h, w], rotationY };
}

function CategorySelect({ value, onChange }: { value: Category; onChange: (category: Category) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as Category)}>
      {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_NAMES[c]}</option>)}
    </select>
  );
}

/** Step 6: each Original's floorColor. */
function BakePanel() {
  const originals = useSetup((s) => s.setup!.originals);
  const [result, setResult] = useState<string>();
  const bake = () => {
    const { renderer, scene, setup, manifest, updateSetup } = useSetup.getState();
    if (!renderer || !scene || !setup || !manifest) return;
    if (setup.floor.polygon.length < 3) {
      setResult('Mark the corners first (step 3).');
      return;
    }
    const started = performance.now();
    const colors = bakeFloorColors(renderer, scene, setup, manifest);
    const ms = Math.round(performance.now() - started);
    updateSetup((s) => ({ ...s, originals: s.originals.map((o) => ({ ...o, floorColor: colors[o.id] ?? o.floorColor })) }));
    const missing = setup.originals.filter((o) => !colors[o.id]).length;
    setResult(`Baked ${setup.originals.length - missing} floor colors in ${ms} ms.${missing ? ` No floor was seen around ${missing}.` : ''}`);
  };
  return (
    <>
      <p>Bake measures the floor's color around each Original. A replaced Original's spot is patched with it.</p>
      <div className="rs-row"><button type="button" className="rs-primary" onClick={bake}>Bake</button></div>
      {result && <p className="rs-note">{result}</p>}
      <ul className="rs-list">
        {originals.map((o) => (
          <li key={o.id}>
            <span className="rs-swatch" style={{ background: o.floorColor }} />
            {o.label}
            <small>{o.floorColor === UNBAKED_FLOOR_COLOR ? 'not baked' : o.floorColor}</small>
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
