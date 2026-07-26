"use client";

import { useEffect, useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, ContactShadows } from "@react-three/drei";
import * as THREE from "three";

/*
 * Procedural 3D bouquet preview for the flower designer — real Three.js scene
 * (React Three Fiber) with 360° orbit, zoom, pan, auto-rotate and day/night/
 * studio lighting. Fully self-contained: flowers are spheres on a dome, the wrap
 * is a cone and the ribbon a torus, all coloured from the live configuration.
 * No external 3D assets or HDR fetches, so it works offline and inside the app.
 */

export type Bouquet3DFlower = { hex: string; qty: number };
type Lighting = "day" | "night" | "studio";

/** Fibonacci-distributed points on the upper dome for a natural bouquet spread. */
function domePositions(n: number, radius: number): [number, number, number][] {
  const out: [number, number, number][] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = (i + 0.5) / n; // 0 (edge) → 1 (top)
    const r = Math.sqrt(1 - y * y);
    const theta = golden * i;
    out.push([Math.cos(theta) * r * radius, y * radius * 0.85 + 0.12, Math.sin(theta) * r * radius]);
  }
  return out;
}

function Flowers({ flowers }: { flowers: Bouquet3DFlower[] }) {
  const colors = useMemo(
    () => flowers.flatMap((f) => Array.from({ length: Math.min(f.qty, 10) }, () => f.hex)).slice(0, 48),
    [flowers],
  );
  const positions = useMemo(() => domePositions(Math.max(colors.length, 1), 1.15), [colors.length]);
  return (
    <group>
      {colors.map((hex, i) => (
        <mesh key={i} position={positions[i]} castShadow>
          <sphereGeometry args={[0.17, 18, 18]} />
          <meshStandardMaterial color={hex} roughness={0.5} metalness={0.05} />
        </mesh>
      ))}
    </group>
  );
}

function Bouquet({ flowers, wrapHex, ribbonHex }: { flowers: Bouquet3DFlower[]; wrapHex: string; ribbonHex: string }) {
  return (
    <group position={[0, 0.1, 0]}>
      <Flowers flowers={flowers} />
      {/* Wrapping cone */}
      <mesh position={[0, -1.0, 0]} castShadow>
        <coneGeometry args={[1.15, 1.9, 36, 1, true]} />
        <meshStandardMaterial color={wrapHex} roughness={0.65} metalness={0.05} side={THREE.DoubleSide} />
      </mesh>
      {/* Ribbon bow */}
      <mesh position={[0, -1.35, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.55, 0.1, 16, 44]} />
        <meshStandardMaterial color={ribbonHex} roughness={0.3} metalness={0.25} />
      </mesh>
    </group>
  );
}

export default function Bouquet3D({
  flowers, wrapHex, ribbonHex, lighting = "day", autoRotate = true,
}: {
  flowers: Bouquet3DFlower[];
  wrapHex: string;
  ribbonHex: string;
  lighting?: Lighting;
  autoRotate?: boolean;
}) {
  // WebGL only exists in the browser — never render the canvas during SSR.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) {
    return <div className="grid h-full place-items-center text-sm text-neutral-500">جارٍ تحميل المعاينة ثلاثية الأبعاد…</div>;
  }

  const bg = lighting === "night" ? "#0b0a12" : lighting === "studio" ? "#101013" : "#1b1420";
  const ambient = lighting === "night" ? 0.3 : lighting === "studio" ? 0.75 : 0.6;
  const keyIntensity = lighting === "night" ? 0.55 : lighting === "studio" ? 1.3 : 1.1;

  return (
    <Canvas shadows dpr={[1, 1.8]} camera={{ position: [0, 0.5, 4.4], fov: 42 }} style={{ background: bg }}>
      <hemisphereLight intensity={ambient} color="#ffffff" groundColor="#3b2a34" />
      <directionalLight position={[3.5, 6, 4]} intensity={keyIntensity} castShadow shadow-mapSize={[1024, 1024]} />
      <directionalLight position={[-4, 2, -3]} intensity={keyIntensity * 0.4} color={lighting === "night" ? "#f472b6" : "#ffd9e6"} />
      {lighting === "night" && <pointLight position={[-2, 1.5, 2]} intensity={3} color="#ec4899" distance={8} />}
      {lighting === "studio" && <pointLight position={[0, 3, 3]} intensity={1.5} color="#ffffff" distance={10} />}

      <Bouquet flowers={flowers} wrapHex={wrapHex} ribbonHex={ribbonHex} />

      <ContactShadows position={[0, -2.0, 0]} opacity={0.45} scale={7} blur={2.6} far={4} />
      <OrbitControls
        enablePan
        enableZoom
        enableDamping
        autoRotate={autoRotate}
        autoRotateSpeed={1.4}
        minDistance={2.6}
        maxDistance={7.5}
        minPolarAngle={0.2}
        maxPolarAngle={Math.PI / 1.8}
      />
    </Canvas>
  );
}
