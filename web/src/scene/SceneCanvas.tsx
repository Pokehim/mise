import { Environment, Stats } from '@react-three/drei';
import { Canvas, events } from '@react-three/fiber';
import { Component, type ReactNode, type RefObject, Suspense, useRef } from 'react';
import { type Camera, NeutralToneMapping } from 'three';
import { useShallow } from 'zustand/react/shallow';
import { useEditor } from '../state/store';
import { DollhouseCamera } from './DollhouseCamera';
import { isShown } from './objects';
import { PieceNode } from './PieceNode';
import { ScanMesh } from './ScanMesh';
import { SelectionOutline } from './SelectionOutline';
import { WalkControls } from './WalkControls';

/** Renders nothing in place of children that fail to load, so one bad asset can't blank the editor. */
class Optional extends Component<{ what: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError = () => ({ failed: true });
  componentDidCatch(error: Error) {
    console.warn(`${this.props.what} failed to load: ${error.message}`);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

function Pieces() {
  const ids = useEditor(useShallow((s) => Object.keys(s.roomState!.pieces)));
  return (
    <group name="pieces">
      {ids.map((id) => (
        <Optional key={id} what={`Piece ${id}`}>
          <Suspense fallback={null}>
            <PieceNode pieceId={id} />
          </Suspense>
        </Optional>
      ))}
    </group>
  );
}

const debug = new URLSearchParams(location.search).has('debug');

/** The 3D view: the Scan, the Pieces, and the camera for the current view, which it shares through cameraRef. */
export function SceneCanvas({ cameraRef }: { cameraRef: RefObject<Camera | null> }) {
  const view = useEditor((s) => s.view);
  const container = useRef<HTMLDivElement>(null!);
  return (
    <div className="view" ref={container}>
      <Canvas
        camera={{ fov: 55, near: 0.05, far: 100, position: [0, 5, 5] }}
        gl={{ localClippingEnabled: true, toneMapping: NeutralToneMapping }}
        // Hidden objects, such as faded walls and replaced Originals, must not catch clicks.
        events={(store) => ({ ...events(store), filter: (hits) => hits.filter((hit) => isShown(hit.object)) })}
        onPointerMissed={() => useEditor.getState().select(null)}
        onCreated={({ camera }) => {
          cameraRef.current = camera;
        }}
      >
        <color attach="background" args={['#f4f1ea']} />
        <hemisphereLight args={['#ffffff', '#d9cfbf', 0.6]} />
        <Optional what="The environment map">
          <Suspense fallback={null}>
            <Environment preset="apartment" />
          </Suspense>
        </Optional>
        <Suspense fallback={null}>
          <ScanMesh />
        </Suspense>
        <Pieces />
        <SelectionOutline />
        {view === 'dollhouse' ? <DollhouseCamera /> : <WalkControls />}
        {debug && <Stats parent={container} className="stats" />}
      </Canvas>
    </div>
  );
}
