import { Environment, Stats } from '@react-three/drei';
import { Canvas, events } from '@react-three/fiber';
import { Component, type DragEvent, type ReactNode, type RefObject, Suspense, useRef } from 'react';
import { type Camera, NeutralToneMapping, Vector2 } from 'three';
import { useShallow } from 'zustand/react/shallow';
import { useRealism } from '../state/realism';
import { AlignPanel } from './AlignPanel';
import { useEditor } from '../state/store';
import { CATALOG_ITEM_TYPE } from '../ui/CatalogPanel';
import { CastShadows } from './CastShadows';
import { DollhouseCamera } from './DollhouseCamera';
import { FitHighlights } from './FitHighlights';
import { FILL_LIGHT, RoomLighting } from './Lighting';
import { ScanColors } from './materials/ScanColors';
import { isDrawn } from './objects';
import { PieceNode } from './PieceNode';
import { ResizeHandles } from './ResizeHandles';
import { ScanMesh } from './ScanMesh';
import { SelectionOutline } from './SelectionOutline';
import { SplatLook } from './SplatLook';
import { WalkControls } from './WalkControls';

/**
 * Loads its children in the background, and renders nothing in their place if they fail, so one
 * bad file can't blank the editor.
 */
class Optional extends Component<{ what: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError = () => ({ failed: true });
  componentDidCatch(error: Error) {
    console.warn(`${this.props.what} failed to load: ${error.message}`);
  }
  render() {
    return this.state.failed ? null : <Suspense fallback={null}>{this.props.children}</Suspense>;
  }
}

function Pieces() {
  const ids = useEditor(useShallow((s) => Object.keys(s.roomState!.pieces)));
  return (
    <group name="pieces">
      {ids.map((id) => (
        <Optional key={id} what={`Piece ${id}`}>
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
  const realism = useRealism();
  const splat = useEditor((s) => Boolean(s.manifest?.splat)) && realism !== 'quick';
  const container = useRef<HTMLDivElement>(null!);
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
        <color attach="background" args={['#f4f1ea']} />
        {realism === 'quick' && (
          <>
            <hemisphereLight args={FILL_LIGHT} />
            <Optional what="The environment map">
              <Environment preset="apartment" />
            </Optional>
          </>
        )}
        <Suspense fallback={null}>
          <ScanMesh />
          <ScanColors />
          {/* After the Scan nodes: they light Pieces from them, and shadow them (spec §12). */}
          {realism !== 'quick' && <RoomLighting />}
          {realism === 'max' && <CastShadows />}
        </Suspense>
        {splat && <Optional what="The splat"><SplatLook /></Optional>}
        <Pieces />
        <SelectionOutline />
        <FitHighlights />
        <ResizeHandles />
        {view === 'dollhouse' ? <DollhouseCamera /> : <WalkControls />}
        {debug && <Stats parent={container} className="stats" />}
      </Canvas>
      {debug && splat && <AlignPanel />}
    </div>
  );
}
