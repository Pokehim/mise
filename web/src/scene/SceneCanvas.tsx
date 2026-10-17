import { Environment, OrbitControls, Stats } from '@react-three/drei';
import { Canvas, events } from '@react-three/fiber';
import { Component, type ReactNode, Suspense, useRef } from 'react';
import { NeutralToneMapping, type Object3D } from 'three';
import { useShallow } from 'zustand/react/shallow';
import { useEditor } from '../state/store';
import { PieceNode } from './PieceNode';
import { ScanMesh } from './ScanMesh';

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

/** Whether an object and all its parents are visible. Raycasts in three.js include hidden objects. */
export function isShown(object: Object3D | null) {
  for (; object; object = object.parent) if (!object.visible) return false;
  return true;
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

/** The 3D view: the Scan, the Pieces, and the camera for the current view. */
export function SceneCanvas() {
  const view = useRef<HTMLDivElement>(null!);
  return (
    <div className="view" ref={view}>
      <Canvas
        camera={{ fov: 55, near: 0.05, far: 100, position: [0, 5, 5] }}
        gl={{ localClippingEnabled: true, toneMapping: NeutralToneMapping }}
        // Hidden objects, such as faded walls and replaced Originals, must not catch clicks.
        events={(store) => ({ ...events(store), filter: (hits) => hits.filter((hit) => isShown(hit.object)) })}
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
        <OrbitControls target={[0, 0.5, 0]} />
        {debug && <Stats parent={view} className="stats" />}
      </Canvas>
    </div>
  );
}
