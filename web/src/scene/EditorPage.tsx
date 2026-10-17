import { Grid, OrbitControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { BackSide } from 'three';
import { Link } from 'wouter';

// Placeholder until #7 builds the editor: a grid and a 4 × 3 m box room.
export function EditorPage({ params }: { params: { designId: string } }) {
  return (
    <>
      <Canvas camera={{ position: [4, 4, 5], fov: 50 }}>
        <color attach="background" args={['#f4f1ea']} />
        <ambientLight intensity={0.6} />
        <directionalLight position={[3, 5, 2]} intensity={1.5} />
        <Grid
          infiniteGrid cellSize={0.5} sectionSize={1} cellColor="#d9d2c5" sectionColor="#b3a892" position={[0, -0.001, 0]}
        />
        {/* 2.6 m high, with its floor at y = 0. BackSide shows the inside, like a dollhouse. */}
        <mesh position={[0, 1.3, 0]}>
          <boxGeometry args={[4, 2.6, 3]} />
          <meshStandardMaterial color="#e8e2d6" side={BackSide} />
        </mesh>
        <OrbitControls target={[0, 1, 0]} />
      </Canvas>
      <nav style={{ position: 'absolute', top: 12, left: 12 }}>
        <Link href="/">← Scans</Link> · Design {params.designId}
      </nav>
    </>
  );
}
