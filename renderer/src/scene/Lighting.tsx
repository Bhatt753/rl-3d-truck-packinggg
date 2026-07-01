// Industrial lighting: warm sun through dock door + cool overhead fluorescents.
// Deliberately mundane — no glow, no rim lights, no neon.

import { useMemo } from "react";

export function Lighting() {
  const fluorescents = useMemo(() => [
    [-1.5, 5.5, -3.0],
    [-1.5, 5.5, 0.0],
    [-1.5, 5.5, 3.0],
    [3.0, 5.5, -3.0],
    [3.0, 5.5, 0.0],
    [3.0, 5.5, 3.0],
  ] as [number, number, number][], []);

  return (
    <>
      <ambientLight intensity={0.55} color="#dfe5ed" />
      <hemisphereLight color="#dfe5ed" groundColor="#3a3633" intensity={0.35} />
      <directionalLight
        position={[-12, 9, 6]}
        intensity={1.6}
        color="#ffe6c0"
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-near={1}
        shadow-camera-far={40}
        shadow-camera-left={-15}
        shadow-camera-right={15}
        shadow-camera-top={15}
        shadow-camera-bottom={-15}
      />
      {fluorescents.map((p, i) => (
        <pointLight key={i} position={p} intensity={0.5} color="#e8eef7" distance={12} decay={1.5} />
      ))}
    </>
  );
}
