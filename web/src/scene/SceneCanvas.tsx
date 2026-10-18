import { Environment, Stats } from '@react-three/drei';
import { Canvas, events } from '@react-three/fiber';
import { Component, type DragEvent, type ReactNode, type RefObject, Suspense, useEffect, useRef, useState } from 'react';
import { type Camera, NeutralToneMapping, Vector2 } from 'three';
import { useShallow } from 'zustand/react/shallow';
import { useRealism } from '../state/realism';
import { AlignPanel } from './AlignPanel';
import { useEditor } from '../state/store';
import { CATALOG_ITEM_TYPE } from '../ui/CatalogPanel';
import { CastShadows } from './CastShadows';
import { CollisionBoxes } from './CollisionBoxes';
import { WalkHint } from './ControlsHint';
import { DollhouseCamera } from './DollhouseCamera';
import { FitHighlights } from './FitHighlights';
import { FILL_LIGHT, RoomLighting } from './Lighting';
import { ScanColors } from './materials/ScanColors';
import { isDrawn } from './objects';
import { PieceNode } from './PieceNode';
import { ResizeHandles } from './ResizeHandles';
import { Reveal } from './Reveal';
import { ScanMesh } from './ScanMesh';
import { SHOT_NUMBER, shotOf } from './shots';
import { SplatLook } from './SplatLook';
import { ReadyFlag } from './sketch/ReadyFlag';
import { SketchLinesToggle } from './sketch/SketchLines';
import { SketchSelection } from './sketch/SketchSelection';
import { token } from './sketch/tokens';
import './sketch/sketch.css';
import { WalkControls } from './WalkControls';

/**
 * Loads its children in the background, and renders nothing in their place if they fail, so one
 * bad file can't blank the editor. A new `retry` (a Piece swapped to another item) tries again.
 */
class Optional extends Component<{ what: string; retry?: string; children: ReactNode }, { failed: boolean; retry?: string }> {
  state = { failed: false, retry: this.props.retry };
  static getDerivedStateFromError = () => ({ failed: true });
  static getDerivedStateFromProps = ({ retry }: { retry?: string }, state: { retry?: string }) =>
    retry === state.retry ? null : { failed: false, retry };
  componentDidCatch(error: Error) {
    console.warn(`${this.props.what} failed to load: ${error.message}`);
  }
  render() {
    return this.state.failed ? null : <Suspense fallback={null}>{this.props.children}</Suspense>;
  }
}

function Pieces() {
  const pieces = useEditor(useShallow((s) => Object.entries(s.roomState!.pieces).map(([id, { catalogId }]) => `${id} ${catalogId}`)));
  return (
    <group name="pieces">
      {pieces.map((piece) => piece.split(' ')).map(([id, catalogId]) => (
        <Optional key={id} what={`Piece ${id}`} retry={catalogId}>
          <PieceNode pieceId={id} />
        </Optional>
      ))}
    </group>
  );
}

const debug = new URLSearchParams(location.search).has('debug');

interface SceneCanvasProps {
  cameraRef: RefObject<Camera | null>;
  /** A Catalog card dropped on the view, and where, in normalized device coordinates. */
  onDropItem: (itemId: string, at: Vector2) => void;
}

/** The 3D view: the Scan, the Pieces, and the camera for the current view, which it shares through cameraRef. */
export function SceneCanvas({ cameraRef, onDropItem }: SceneCanvasProps) {
  const view = useEditor((s) => s.view);
  // ?shot= places the camera once; changing the View lets it go.
  const [shot, setShot] = useState(() => (SHOT_NUMBER ? shotOf(SHOT_NUMBER, useEditor.getState().setup!) : null));
  useEffect(() => {
    if (shot && view !== shot.view) setShot(null);
  }, [shot, view]);
  const realism = useRealism();
  const splat = useEditor((s) => Boolean(s.manifest?.splat)) && realism !== 'quick';
  const container = useRef<HTMLDivElement>(null!);
  const [scanDrawn, setScanDrawn] = useState(false);
  const onDrop = (event: DragEvent) => {
    const itemId = event.dataTransfer.getData(CATALOG_ITEM_TYPE);
    if (!itemId) return;
    const { left, top, width, height } = container.current.getBoundingClientRect();
    onDropItem(itemId, new Vector2(((event.clientX - left) / width) * 2 - 1, -((event.clientY - top) / height) * 2 + 1));
  };
  return (
    <div
      className="view"
      ref={container}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes(CATALOG_ITEM_TYPE)) event.preventDefault();
      }}
      onDrop={onDrop}
    >
      <Canvas
        camera={{ fov: 55, near: 0.05, far: 100, position: [0, 5, 5] }}
        // The stencil keeps overlapping shadow receivers from darkening a shadow twice (CastShadows).
        gl={{ localClippingEnabled: true, toneMapping: NeutralToneMapping, stencil: true }}
        // Only the Max level has a light that casts shadows; without one, the shadow map costs nothing.
        shadows="percentage"
        // Faded walls, replaced Originals and the clipped ceiling must not catch the pointer.
        events={(store) => ({ ...events(store), filter: (hits) => hits.filter(isDrawn) })}
        onPointerMissed={() => useEditor.getState().select(null)}
        onCreated={({ camera }) => {
          cameraRef.current = camera;
        }}
      >
        {/* The desk under the sketchbook's sheets; the room itself is drawn exactly as scanned. */}
        <color attach="background" args={[token('--desk')]} />
        {realism === 'quick' && (
          <>
            <hemisphereLight args={FILL_LIGHT} />
            <Optional what="The environment map">
              {/* drei's "apartment" preset (Poly Haven's Lebombo, CC0), served here so a venue's Wi-Fi can't leave Pieces unlit. */}
              <Environment files="/hdri/lebombo_1k.hdr" />
            </Optional>
          </>
        )}
        <Suspense fallback={null}>
          <ScanMesh />
          <ScanColors />
          {/* After the Scan nodes: they light Pieces from them, and shadow them (spec §12). */}
          {realism !== 'quick' && <RoomLighting />}
          {realism === 'max' && <CastShadows />}
          <ReadyFlag onReady={() => setScanDrawn(true)} />
        </Suspense>
        {splat && <Optional what="The splat"><SplatLook /></Optional>}
        <Pieces />
        <Reveal ready={scanDrawn} />
        <SketchSelection />
        <FitHighlights />
        <CollisionBoxes />
        <ResizeHandles />
        {view === 'dollhouse' ? <DollhouseCamera start={shot ?? undefined} /> : <WalkControls start={shot?.pose} />}
        {debug && <Stats parent={container} className="stats" />}
      </Canvas>
      {debug && splat && <AlignPanel />}
      {!scanDrawn && <p className="view-loading" role="status">Loading the Scan…</p>}
      <SketchLinesToggle />
      {/* Not in a ?shot= view, which is a picture of the room. */}
      {view === 'walk' && !shot && scanDrawn && <WalkHint />}
    </div>
  );
}
