'use client';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { Suspense, useEffect, useState, useMemo, useRef } from 'react';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';

interface MiniSTLViewerProps {
  url: string;
  autoRotate?: boolean;
}

/**
 * A lightweight version of STLViewer for thumbnail previews.
 * Auto-rotates by default and has minimal UI.
 */
export function MiniSTLViewer({ url, autoRotate = true }: MiniSTLViewerProps) {
  return (
    <Canvas
      style={{ width: '100%', height: '100%', background: 'transparent' }}
      gl={{ antialias: true, alpha: true, powerPreference: 'low-power' }}
      camera={{ position: [40, 40, 40], fov: 35, near: 0.1, far: 1000 }}
      frameloop="demand" // Only render when needed (saves GPU)
    >
      <ambientLight intensity={0.5} />
      <directionalLight position={[50, 50, 25]} intensity={1.0} color="#88f5ff" />
      <directionalLight position={[-25, 40, -25]} intensity={0.5} color="#ff8c00" />

      <Suspense fallback={null}>
        <AutoRotatingSTLMesh url={url} autoRotate={autoRotate} />
      </Suspense>

      {/* Simple controls - disabled for auto-rotate mode */}
      <OrbitControls
        enablePan={false}
        enableZoom={false}
        enableRotate={!autoRotate}
        autoRotate={autoRotate}
        autoRotateSpeed={4}
        target={[0, 0, 0]}
      />
    </Canvas>
  );
}

function AutoRotatingSTLMesh({ url, autoRotate }: { url: string; autoRotate: boolean }) {
  const [arrayBuf, setArrayBuf] = useState<ArrayBuffer | null>(null);
  const meshRef = useRef<THREE.Mesh>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.arrayBuffer();
      })
      .then((buf) => { if (!cancelled) setArrayBuf(buf); })
      .catch((e) => { console.warn('[MiniSTL] load failed', e); });
    return () => { cancelled = true; };
  }, [url]);

  const geometry = useMemo(() => {
    if (!arrayBuf) return null;
    try {
      const loader = new STLLoader();
      const geom = loader.parse(arrayBuf);
      // Center the mesh on the origin
      geom.computeBoundingBox();
      const box = geom.boundingBox!;
      const center = box.getCenter(new THREE.Vector3());
      geom.translate(-center.x, -center.y, -center.z); // Center on all axes for rotation
      geom.computeVertexNormals();
      return geom;
    } catch (e) {
      console.warn('[MiniSTL] parse failed', e);
      return null;
    }
  }, [arrayBuf]);

  // Auto-rotate the mesh itself (smoother than OrbitControls for small views)
  useFrame((state, delta) => {
    if (meshRef.current && autoRotate) {
      meshRef.current.rotation.y += delta * 0.8;
      // Request re-render since we're using demand mode
      state.invalidate();
    }
  });

  if (!geometry) return null;

  return (
    <mesh ref={meshRef} geometry={geometry}>
      <meshStandardMaterial
        color="#00e5ff"
        emissive="#002233"
        roughness={0.4}
        metalness={0.5}
        flatShading={false}
      />
    </mesh>
  );
}
