'use client';
import { Canvas, useLoader } from '@react-three/fiber';
import { OrbitControls, GizmoHelper, GizmoViewport, Grid } from '@react-three/drei';
import { Suspense, useEffect, useState, useMemo } from 'react';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import * as THREE from 'three';

interface STLViewerProps {
  url: string;
}

export function STLViewer({ url }: STLViewerProps) {
  return (
    <Canvas
      style={{ width: '100%', height: '100%', background: 'transparent' }}
      gl={{ antialias: true, alpha: true }}
      camera={{ position: [60, 60, 60], fov: 35, near: 0.1, far: 2000 }}
    >
      <ambientLight intensity={0.4} />
      <directionalLight position={[100, 100, 50]} intensity={1.2} color="#88f5ff" />
      <directionalLight position={[-50, 80, -50]} intensity={0.6} color="#ff8c00" />
      <pointLight position={[0, -50, 0]} intensity={0.3} color="#00e5ff" />

      <Suspense fallback={<LoadingMesh />}>
        <STLMesh url={url} />
      </Suspense>

      {/* Floor grid */}
      <Grid
        args={[200, 200]}
        cellColor="#0066aa"
        sectionColor="#00d4ff"
        fadeDistance={150}
        fadeStrength={1}
        cellSize={5}
        sectionSize={20}
        position={[0, -0.01, 0]}
      />

      {/* Drag/rotate controls */}
      <OrbitControls
        enablePan
        enableZoom
        enableRotate
        autoRotate={false}
        target={[0, 0, 0]}
        minDistance={5}
        maxDistance={500}
      />

      {/* Axis indicator in bottom-right */}
      <GizmoHelper alignment="bottom-right" margin={[60, 60]}>
        <GizmoViewport axisColors={['#ff5577', '#00ff9d', '#00e5ff']} labelColor="#000" />
      </GizmoHelper>
    </Canvas>
  );
}

function STLMesh({ url }: { url: string }) {
  const [arrayBuf, setArrayBuf] = useState<ArrayBuffer | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.arrayBuffer();
      })
      .then((buf) => { if (!cancelled) setArrayBuf(buf); })
      .catch((e) => { if (!cancelled) setError(String(e)); });
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
      geom.translate(-center.x, -center.y, -box.min.z); // sit on floor
      geom.computeVertexNormals();
      return geom;
    } catch (e) {
      console.warn('[STL] parse failed', e);
      return null;
    }
  }, [arrayBuf]);

  if (error) return null; // surface error in parent if needed
  if (!geometry) return <LoadingMesh />;

  return (
    <mesh geometry={geometry} castShadow receiveShadow>
      <meshStandardMaterial
        color="#00e5ff"
        emissive="#001a2a"
        roughness={0.35}
        metalness={0.6}
        flatShading={false}
      />
    </mesh>
  );
}

function LoadingMesh() {
  return (
    <mesh>
      <boxGeometry args={[10, 10, 10]} />
      <meshStandardMaterial color="#003344" wireframe />
    </mesh>
  );
}
