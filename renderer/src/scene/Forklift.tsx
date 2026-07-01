// Autonomous loading forklift (AGV-style). Procedural geometry — industrial
// yellow/charcoal palette, hydraulic mast, sensor dome, status indicator.

import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";

import type { FrameState } from "../animation/timeline";

export function Forklift({
  frameStateRef,
}: {
  frameStateRef: { current: FrameState };
}) {
  const root = useRef<THREE.Group>(null);
  const mastCarriage = useRef<THREE.Group>(null);
  const statusLed = useRef<THREE.MeshStandardMaterial>(null);
  const wheelFL = useRef<THREE.Mesh>(null);
  const wheelFR = useRef<THREE.Mesh>(null);
  const wheelBL = useRef<THREE.Mesh>(null);
  const wheelBR = useRef<THREE.Mesh>(null);
  const prevPos = useRef<THREE.Vector3>(new THREE.Vector3());

  useFrame(() => {
    const s = frameStateRef.current.forklift;
    if (!root.current || !mastCarriage.current) return;
    root.current.position.set(s.position[0], s.position[1], s.position[2]);
    root.current.rotation.y = s.yaw;

    // Mast carriage lifts the forks (and any carried box's visual).
    mastCarriage.current.position.y = s.liftHeight;

    // Spin the wheels based on horizontal motion.
    const dx = s.position[0] - prevPos.current.x;
    const dz = s.position[2] - prevPos.current.z;
    const dist = Math.hypot(dx, dz);
    const wheelRot = dist / 0.18; // radius
    prevPos.current.set(s.position[0], s.position[1], s.position[2]);
    [wheelFL, wheelFR, wheelBL, wheelBR].forEach((w) => {
      if (w.current) w.current.rotation.x += wheelRot;
    });

    // Status LED: green when moving, amber when carrying, off when parked.
    if (statusLed.current) {
      const moving = dist > 0.001;
      const carrying = s.hasBox;
      const color = carrying ? "#ffb020" : moving ? "#3ddc84" : "#3a3a3d";
      statusLed.current.emissive.set(color);
      statusLed.current.emissiveIntensity = carrying || moving ? 0.8 : 0.0;
    }
  });

  return (
    <group ref={root}>
      {/* ---- Chassis (charcoal with safety-yellow accents) ---- */}
      {/* Lower frame */}
      <mesh position={[0, 0.20, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.45, 0.30, 0.95]} />
        <meshStandardMaterial color="#2a2c30" roughness={0.6} metalness={0.25} />
      </mesh>
      {/* Yellow upper deck (operator cage area, blank for AGV) */}
      <mesh position={[-0.05, 0.46, 0]} castShadow>
        <boxGeometry args={[1.10, 0.18, 0.82]} />
        <meshStandardMaterial color="#f0a020" roughness={0.55} metalness={0.2} />
      </mesh>
      {/* Side panels with chamfer suggestion */}
      {[-0.49, 0.49].map((z) => (
        <mesh key={z} position={[-0.05, 0.40, z]} castShadow>
          <boxGeometry args={[1.10, 0.30, 0.04]} />
          <meshStandardMaterial color="#1d1d1f" roughness={0.5} metalness={0.4} />
        </mesh>
      ))}

      {/* ---- Sensor dome (LIDAR) on top-back ---- */}
      <mesh position={[-0.45, 0.62, 0]} castShadow>
        <cylinderGeometry args={[0.11, 0.13, 0.16, 24]} />
        <meshStandardMaterial color="#1a1a1c" roughness={0.35} metalness={0.6} />
      </mesh>
      <mesh position={[-0.45, 0.71, 0]}>
        <cylinderGeometry args={[0.08, 0.10, 0.04, 24]} />
        <meshStandardMaterial color="#2a2a2c" roughness={0.2} metalness={0.7} />
      </mesh>

      {/* ---- Status indicator strip (top-rear) ---- */}
      <mesh position={[-0.45, 0.76, 0]}>
        <sphereGeometry args={[0.05, 16, 12]} />
        <meshStandardMaterial ref={statusLed} color="#222" emissive="#000" emissiveIntensity={0.0} roughness={0.3} />
      </mesh>

      {/* ---- Headlights (front, low) ---- */}
      {[-0.30, 0.30].map((z) => (
        <mesh key={z} position={[0.72, 0.30, z]} castShadow>
          <boxGeometry args={[0.05, 0.10, 0.10]} />
          <meshStandardMaterial color="#fffbe8" emissive="#fff6d0" emissiveIntensity={0.6} roughness={0.2} />
        </mesh>
      ))}

      {/* ---- Mast (vertical rails, fixed) ---- */}
      {[-0.27, 0.27].map((z) => (
        <mesh key={z} position={[0.55, 1.05, z]} castShadow>
          <boxGeometry args={[0.05, 1.7, 0.06]} />
          <meshStandardMaterial color="#3a3a3d" roughness={0.5} metalness={0.55} />
        </mesh>
      ))}
      {/* Mast top crossbar */}
      <mesh position={[0.55, 1.85, 0]} castShadow>
        <boxGeometry args={[0.10, 0.06, 0.65]} />
        <meshStandardMaterial color="#3a3a3d" roughness={0.5} metalness={0.55} />
      </mesh>
      {/* Hydraulic cylinder (suggestion) behind the mast */}
      <mesh position={[0.50, 0.95, 0]} castShadow>
        <cylinderGeometry args={[0.05, 0.05, 1.4, 14]} />
        <meshStandardMaterial color="#9aa0a6" roughness={0.3} metalness={0.85} />
      </mesh>

      {/* ---- Mast carriage (moves up/down with liftHeight) ---- */}
      <group ref={mastCarriage}>
        {/* Backplate behind the forks */}
        <mesh position={[0.58, 0.20, 0]} castShadow>
          <boxGeometry args={[0.05, 0.35, 0.70]} />
          <meshStandardMaterial color="#9aa0a6" roughness={0.4} metalness={0.6} />
        </mesh>
        {/* Forks themselves (two prongs forward of the chassis) */}
        {[-0.22, 0.22].map((z) => (
          <mesh key={z} position={[0.88, 0.08, z]} castShadow>
            <boxGeometry args={[0.65, 0.05, 0.09]} />
            <meshStandardMaterial color="#b8bcc2" roughness={0.35} metalness={0.7} />
          </mesh>
        ))}
        {/* Fork tips (tapered visual) */}
        {[-0.22, 0.22].map((z) => (
          <mesh key={`tip${z}`} position={[1.21, 0.08, z]} rotation={[0, 0, -0.06]} castShadow>
            <boxGeometry args={[0.06, 0.03, 0.09]} />
            <meshStandardMaterial color="#b8bcc2" roughness={0.35} metalness={0.7} />
          </mesh>
        ))}
      </group>

      {/* ---- Wheels (front smaller, rear larger drive wheels) ---- */}
      {/* Front wheels */}
      <mesh ref={wheelFL} position={[0.55, 0.18, -0.45]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[0.18, 0.18, 0.16, 20]} />
        <meshStandardMaterial color="#15151a" roughness={0.95} />
      </mesh>
      <mesh ref={wheelFR} position={[0.55, 0.18, 0.45]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[0.18, 0.18, 0.16, 20]} />
        <meshStandardMaterial color="#15151a" roughness={0.95} />
      </mesh>
      {/* Rear (drive) wheels */}
      <mesh ref={wheelBL} position={[-0.55, 0.20, -0.45]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[0.20, 0.20, 0.18, 20]} />
        <meshStandardMaterial color="#15151a" roughness={0.95} />
      </mesh>
      <mesh ref={wheelBR} position={[-0.55, 0.20, 0.45]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[0.20, 0.20, 0.18, 20]} />
        <meshStandardMaterial color="#15151a" roughness={0.95} />
      </mesh>
      {/* Wheel hubs (steel rims) */}
      {[
        [0.55, 0.18, -0.45],
        [0.55, 0.18, 0.45],
        [-0.55, 0.20, -0.45],
        [-0.55, 0.20, 0.45],
      ].map((p, i) => (
        <mesh key={i} position={p as [number, number, number]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.08, 0.08, 0.18, 16]} />
          <meshStandardMaterial color="#3a3a3d" roughness={0.45} metalness={0.65} />
        </mesh>
      ))}
    </group>
  );
}
