import { type PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { type DraftPoint, type DraftRoom, draftScale, emptyDraft, type FloorPlanDraft, formatFeet, parseLength } from '@shared/floor-plan';
import type { RoomSurfaces, ScanManifest } from '@shared/types';
import {
  createDesign, loadFloorPlanDraft, loadSetup, readFloorPlanAgain, saveFloorPlanDraft, saveManifest, saveSetup, scanFileUrl,
} from '../api';
import { DEFAULT_SURFACES } from '../scene/room/buildRoom';
import { DEFAULT_CEILING, planToSetup } from './planToSetup';
import './plan.css';

/** What a click on the plan does: move corners, trace a room's corners one by one, or mark a length to scale by. */
type Tool = { kind: 'edit' } | { kind: 'trace' } | { kind: 'scale'; points: DraftPoint[] };

const FLOORS: [id: string, name: string][] = [
  ['carpet-grey', 'Gray carpet'], ['carpet-beige', 'Beige carpet'], ['carpet-navy', 'Navy carpet'], ['vct', 'Vinyl tile'],
  ['oak', 'Oak'], ['maple', 'Maple'], ['walnut', 'Walnut'], ['concrete', 'Concrete'],
];

const distance = (a: DraftPoint, b: DraftPoint) => Math.hypot(b.x - a.x, b.y - a.y);

/**
 * Room Setup for a Floor Plan Scan (ADR-0011): Claude's reading of the plan, drawn over it, for the
 * Mover to correct, then built as the Scan's Room Setup, an empty room to furnish. With no reading,
 * the Mover traces the room.
 */
export function FloorPlanSetup({ manifest: loaded }: { manifest: ScanManifest }) {
  const [, navigate] = useLocation();
  const [manifest, setManifest] = useState(loaded);
  const [draft, setDraft] = useState<FloorPlanDraft>();
  const [roomIndex, setRoomIndex] = useState(0);
  const [scale, setScale] = useState<number | null>(loaded.floorPlan!.metersPerPixel || null);
  const [ceiling, setCeiling] = useState(DEFAULT_CEILING);
  const [ceilingText, setCeilingText] = useState(formatFeet(DEFAULT_CEILING));
  const [surfaces, setSurfaces] = useState<RoomSurfaces>(DEFAULT_SURFACES);
  const [tool, setTool] = useState<Tool>({ kind: 'edit' });
  const [selected, setSelected] = useState<number | null>(null);
  const [lengthText, setLengthText] = useState('');
  const [status, setStatus] = useState<{ busy?: 'reading' | 'building'; error?: string; note?: string }>({});
  const [size, setSize] = useState<{ width: number; height: number }>();

  // The draft, and what an earlier Build chose: the ceiling and the surfaces.
  useEffect(() => {
    loadFloorPlanDraft(loaded).then((read) => {
      setDraft(read);
      if (!loaded.floorPlan!.metersPerPixel) setScale(draftScale(read, read.rooms[0]));
      if (read.ceilingHeight) {
        setCeiling(read.ceilingHeight);
        setCeilingText(formatFeet(read.ceilingHeight));
      }
    }, () => setDraft(emptyDraft()));
    loadSetup(loaded.id).then((setup) => {
      setCeiling(setup.ceilingHeight);
      setCeilingText(formatFeet(setup.ceilingHeight));
      if (setup.surfaces) setSurfaces(setup.surfaces);
    }, () => {});
  }, [loaded]);

  const room = draft?.rooms[roomIndex];
  const updateRoom = (change: (room: DraftRoom) => DraftRoom) =>
    setDraft((d) => d && { ...d, rooms: d.rooms.map((r, i) => (i === roomIndex ? change(r) : r)) });
  const setCorners = (change: (corners: DraftPoint[]) => DraftPoint[]) => updateRoom((r) => ({ ...r, corners: change(r.corners) }));

  // Delete or Backspace removes the selected corner, while the room keeps at least 3.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (selected === null || (event.target as HTMLElement).closest('input, select, textarea')) return;
      if (event.key !== 'Delete' && event.key !== 'Backspace') return;
      if ((room?.corners.length ?? 0) <= 3) return;
      setCorners((corners) => corners.filter((_, i) => i !== selected));
      setSelected(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  /* ───────────── The plan and its overlay ───────────── */

  const svg = useRef<SVGSVGElement>(null);
  const dragging = useRef<number | null>(null);
  /** Where a pointer is on the plan, in its pixels. */
  const planPoint = (event: { clientX: number; clientY: number }): DraftPoint => {
    const point = svg.current!.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const { x, y } = point.matrixTransform(svg.current!.getScreenCTM()!.inverse());
    return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
  };
  /** How many plan pixels a few screen pixels are, so handles stay a constant size however big the plan is. */
  const unit = size ? size.width / 900 : 1;

  function onPlanPointerDown(event: ReactPointerEvent<SVGSVGElement>) {
    const at = planPoint(event);
    if (tool.kind === 'scale') {
      const points = tool.points.length >= 2 ? [at] : [...tool.points, at];
      setTool({ kind: 'scale', points });
      return;
    }
    if (tool.kind === 'trace') {
      const corners = room?.corners ?? [];
      // A click on the first corner closes the room.
      if (corners.length >= 3 && distance(at, corners[0]) < 12 * unit) {
        setTool({ kind: 'edit' });
        return;
      }
      if (!room) {
        setDraft((d) => ({ ...(d ?? emptyDraft()), rooms: [...(d?.rooms ?? []), { label: 'Room', corners: [at], openings: [] }] }));
        setRoomIndex(draft?.rooms.length ?? 0);
      } else {
        setCorners((c) => [...c, at]);
      }
      return;
    }
    setSelected(null);
  }

  function startDrag(index: number, event: ReactPointerEvent) {
    if (tool.kind !== 'edit') return;
    event.stopPropagation();
    setSelected(index);
    dragging.current = index;
    svg.current!.setPointerCapture(event.pointerId);
  }

  function onPlanPointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    const index = dragging.current;
    if (index === null) return;
    const at = planPoint(event);
    setCorners((corners) => corners.map((c, i) => (i === index ? at : c)));
  }

  /** A new corner at the middle of an edge, dragged from there. */
  function insertCorner(after: number, event: ReactPointerEvent) {
    const corners = room!.corners;
    const [a, b] = [corners[after], corners[(after + 1) % corners.length]];
    setCorners((c) => [...c.slice(0, after + 1), { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, ...c.slice(after + 1)]);
    startDrag(after + 1, event);
  }

  /* ───────────── Scale ───────────── */

  const hint = useMemo(() => draft?.scaleHints.find((h) => scale && Math.abs(h.meters / distance(h.from, h.to) - scale) < 1e-6), [draft, scale]);
  const scaleLength = tool.kind === 'scale' && tool.points.length === 2 ? distance(tool.points[0], tool.points[1]) : 0;
  function applyScale() {
    const meters = parseLength(lengthText);
    if (tool.kind !== 'scale' || !meters || !scaleLength) return;
    setScale(meters / scaleLength);
    const [from, to] = tool.points;
    setDraft((d) => d && { ...d, scaleHints: [{ text: lengthText.trim(), meters, from, to }, ...d.scaleHints] });
    setTool({ kind: 'edit' });
    setLengthText('');
  }

  /* ───────────── Reading and building ───────────── */

  async function readAgain() {
    setStatus({ busy: 'reading' });
    try {
      const result = await readFloorPlanAgain(manifest.id);
      if (result.read === 'ok') {
        setDraft(result.draft);
        setRoomIndex(0);
        setScale(draftScale(result.draft, result.draft.rooms[0]));
      }
      setStatus({
        note: result.read === 'ok' ? `Read in ${result.seconds} s.` : result.read === 'skipped'
          ? "AI isn't set up on this server, so trace the room by hand." : `The AI couldn't read the plan (${result.error}). Trace the room by hand.`,
      });
    } catch (err) {
      setStatus({ error: (err as Error).message });
    }
  }

  const canBuild = Boolean(draft && room && room.corners.length >= 3 && scale);
  async function build() {
    if (!draft || !room || !scale) return;
    setStatus({ busy: 'building' });
    try {
      const setup = planToSetup(manifest.id, room, { metersPerPixel: scale, ceilingHeight: ceiling, surfaces });
      const saved = { ...manifest, floorPlan: { ...manifest.floorPlan!, metersPerPixel: scale } };
      await saveFloorPlanDraft(manifest.id, draft);
      await saveSetup(setup);
      await saveManifest(saved);
      setManifest(saved);
      navigate(`/d/${(await createDesign({ scanId: manifest.id })).id}`);
    } catch (err) {
      setStatus({ error: `Could not build the room (${(err as Error).message}).` });
    }
  }

  /* ───────────── The page ───────────── */

  const image = scanFileUrl(manifest.id, manifest.floorPlan!.image);
  const corners = room?.corners ?? [];
  return (
    <div className="fp-setup">
      <header className="fp-header">
        <Link href="/">← Scans</Link>
        <h1>Room Setup <span>· {manifest.name}</span></h1>
        <span className="fp-status" role="status">
          {status.busy === 'reading' ? 'Reading the floor plan… usually under a minute' : status.busy === 'building' ? 'Building the room…' : ''}
        </span>
        <button type="button" className="primary" disabled={!canBuild || Boolean(status.busy)} onClick={build}>Build room</button>
      </header>

      <main className="fp-plan">
        <div className="fp-sheet">
          <img src={image} alt={`The floor plan of ${manifest.name}`} onLoad={(e) => setSize({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })} />
          {size && (
            <svg
              ref={svg}
              viewBox={`0 0 ${size.width} ${size.height}`}
              className={`fp-overlay fp-tool-${tool.kind}`}
              onPointerDown={onPlanPointerDown}
              onPointerMove={onPlanPointerMove}
              onPointerUp={() => (dragging.current = null)}
            >
              {corners.length >= 2 && (
                <polygon className={tool.kind === 'trace' ? 'fp-room fp-room-open' : 'fp-room'} points={corners.map(({ x, y }) => `${x},${y}`).join(' ')} />
              )}
              {room?.openings.map((opening, i) => (
                <line key={`o${i}`} className={`fp-opening fp-${opening.kind}`} x1={opening.from.x} y1={opening.from.y} x2={opening.to.x} y2={opening.to.y} />
              ))}
              {tool.kind === 'edit' && corners.length >= 3 && corners.map((a, i) => {
                const b = corners[(i + 1) % corners.length];
                return (
                  <g key={`m${i}`} className="fp-insert" onPointerDown={(e) => insertCorner(i, e)} transform={`translate(${(a.x + b.x) / 2} ${(a.y + b.y) / 2})`}>
                    <title>Add a corner here</title>
                    <circle r={7 * unit} />
                    <path d={`M${-3.5 * unit} 0H${3.5 * unit}M0 ${-3.5 * unit}V${3.5 * unit}`} />
                  </g>
                );
              })}
              {corners.map(({ x, y }, i) => (
                <circle
                  key={`c${i}`}
                  className={i === selected ? 'fp-corner fp-corner-on' : 'fp-corner'}
                  cx={x} cy={y} r={(i === 0 && tool.kind === 'trace' ? 9 : 6) * unit}
                  onPointerDown={(e) => startDrag(i, e)}
                />
              ))}
              {tool.kind === 'scale' && tool.points.map(({ x, y }, i) => <circle key={`s${i}`} className="fp-scale-point" cx={x} cy={y} r={5 * unit} />)}
              {tool.kind === 'scale' && tool.points.length === 2 && (
                <line className="fp-scale-line" x1={tool.points[0].x} y1={tool.points[0].y} x2={tool.points[1].x} y2={tool.points[1].y} />
              )}
            </svg>
          )}
        </div>
      </main>

      <aside className="fp-sidebar">
        {status.error && <p className="error" role="alert">{status.error}</p>}
        {status.note && <p className="fp-note">{status.note}</p>}
        {draft && !room && (
          <div className="empty">
            <b>Trace the room.</b> Choose Trace, then click each corner of the room on the plan, and its first corner again to close it.
          </div>
        )}
        {draft?.notes && <p className="fp-note"><b>Notes from the AI:</b> {draft.notes}</p>}

        {(draft?.rooms.length ?? 0) > 1 && (
          <section>
            <h2>Room</h2>
            <div className="fp-chips">
              {draft!.rooms.map((r, i) => (
                <button key={i} type="button" aria-pressed={i === roomIndex} onClick={() => setRoomIndex(i)}>{r.label}</button>
              ))}
            </div>
          </section>
        )}

        <section>
          <h2>Walls</h2>
          <p className="muted">
            {corners.length >= 3 ? `${corners.length} corners. Drag one to move it, + to add one, Delete to remove the selected one.` : 'No room yet.'}
          </p>
          <div className="fp-row">
            <button type="button" aria-pressed={tool.kind === 'trace'} onClick={() => {
              if (tool.kind === 'trace') return setTool({ kind: 'edit' });
              setCorners(() => []);
              setTool({ kind: 'trace' });
            }}>{tool.kind === 'trace' ? 'Done tracing' : room ? 'Trace again' : 'Trace'}</button>
            <button type="button" disabled={Boolean(status.busy)} onClick={readAgain}>Read with AI again</button>
          </div>
        </section>

        <section>
          <h2>Scale</h2>
          <p className="muted">
            {scale
              ? <>1 m is {Math.round(1 / scale)} px on the plan{hint ? <>, from the printed <b>{hint.text}</b></> : ''}.</>
              : 'No scale yet: mark a length you know, such as a printed dimension or a door.'}
          </p>
          {tool.kind === 'scale' ? (
            <div className="fp-row">
              {tool.points.length < 2 ? <span className="muted">Click both ends of the length on the plan.</span> : (
                <>
                  <input aria-label="Its real length" placeholder={`13'-3", or 4.04 m`} value={lengthText} onChange={(e) => setLengthText(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && applyScale()} autoFocus />
                  <button type="button" className="primary" disabled={!parseLength(lengthText)} onClick={applyScale}>Set</button>
                </>
              )}
              <button type="button" onClick={() => setTool({ kind: 'edit' })}>Cancel</button>
            </div>
          ) : (
            <button type="button" onClick={() => setTool({ kind: 'scale', points: [] })}>Set scale</button>
          )}
        </section>

        <section>
          <h2>The room</h2>
          <label className="fp-field">
            <span>Ceiling</span>
            <input value={ceilingText} onChange={(e) => {
              setCeilingText(e.target.value);
              const parsed = parseLength(e.target.value);
              if (parsed && parsed > 1.8 && parsed < 6) setCeiling(parsed);
            }} />
            <span className="muted">{ceiling.toFixed(2)} m</span>
          </label>
          <label className="fp-field">
            <span>Floor</span>
            <select value={surfaces.floor} onChange={(e) => setSurfaces({ ...surfaces, floor: e.target.value, baseboard: /oak|maple|walnut/.test(e.target.value) ? 'wood' : 'rubber' })}>
              {FLOORS.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          </label>
          <label className="fp-field">
            <span>Walls</span>
            <select value={surfaces.walls} onChange={(e) => setSurfaces({ ...surfaces, walls: e.target.value as RoomSurfaces['walls'] })}>
              <option value="drywall">Painted drywall</option>
              <option value="cinderblock">Painted cinderblock</option>
            </select>
            <input type="color" aria-label="Wall paint" value={surfaces.wallColor} onChange={(e) => setSurfaces({ ...surfaces, wallColor: e.target.value as RoomSurfaces['wallColor'] })} />
          </label>
        </section>

      </aside>
    </div>
  );
}
