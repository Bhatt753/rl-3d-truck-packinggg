// All cargo boxes — both the staging pile and the loaded trailer. Each box's
// position each frame comes from the shared FrameState ref so the carried box
// snaps to the forklift forks automatically.

import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";

import type { FrameState, Trip } from "../animation/timeline";

const PALETTE = [
  "#c5a679",
  "#b9986b",
  "#a8895f",
  "#d3b78c",
  "#8c7150",
  "#bda076",
  "#9b8362",
];

const FRAGILE_COLOR = "#c54c3a";

function pickColor(id: number, fragile: boolean) {
  return fragile ? FRAGILE_COLOR : PALETTE[id % PALETTE.length];
}

export function Boxes({
  trips,
  frameStateRef,
}: {
  trips: Trip[];
  frameStateRef: { current: FrameState };
}) {
  const refs = useRef<Map<number, THREE.Group>>(new Map());

  useFrame(() => {
    const state = frameStateRef.current;
    for (const [id, runtime] of state.boxes) {
      const grp = refs.current.get(id);
      if (!grp) continue;
      grp.visible = runtime.visible;
      grp.position.set(runtime.position[0], runtime.position[1], runtime.position[2]);
      grp.rotation.y = runtime.rotationY;
    }
  });

  return (
    <>
      {trips.map((trip) => {
        const size = trip.size;
        return (
          <group
            key={trip.boxId}
            ref={(el) => {
              if (el) refs.current.set(trip.boxId, el);
              else refs.current.delete(trip.boxId);
            }}
            position={trip.sourceWorld}
          >
            {/* Main cardboard cuboid */}
            <mesh castShadow receiveShadow>
              <boxGeometry args={[size[0], size[2], size[1]]} />
              <meshStandardMaterial
                color={pickColor(trip.spec.id, trip.spec.fragile)}
                roughness={0.9}
                metalness={0.0}
              />
            </mesh>
            {/* Tape strip across the top */}
            <mesh position={[0, size[2] / 2 + 0.001, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <planeGeometry args={[size[0] * 0.82, 0.07]} />
              <meshStandardMaterial color="#7a6748" roughness={0.45} />
            </mesh>
            {/* Faint shipping label on the largest face */}
            <mesh position={[0, 0, size[1] / 2 + 0.001]}>
              <planeGeometry args={[size[0] * 0.45, size[2] * 0.22]} />
              <meshStandardMaterial color="#f3eede" roughness={0.6} />
            </mesh>
            {/* Fragile sticker (if applicable) */}
            {trip.spec.fragile && (
              <mesh position={[0, 0, size[1] / 2 + 0.002]}>
                <planeGeometry args={[size[0] * 0.18, size[2] * 0.18]} />
                <meshStandardMaterial color="#a33b2c" roughness={0.6} />
              </mesh>
            )}
          </group>
        );
      })}
    </>
  );
}
