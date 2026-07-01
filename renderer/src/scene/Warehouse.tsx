// Loading bay: outdoor ground at y=0 (where the truck wheels rest), raised
// dock floor at y=DOCK_FLOOR_Y (where the forklift operates and the trailer
// floor connects flush). Pallets, racks, dock door, leveler.

import { useMemo } from "react";

import {
  DOCK_FLOOR_Y,
  GROUND_Y,
  PALLET_HEIGHT,
  TRAILER_REAR_X,
  TRAILER_WIDTH,
} from "./constants";
import type { Trace } from "../trace/schema";
import type { Trip } from "../animation/timeline";

function Pallet({
  x,
  z,
  length,
  width,
  fragile,
}: {
  x: number;
  z: number;
  length: number;
  width: number;
  fragile: boolean;
}) {
  const palLen = Math.max(length + 0.10, 0.7);
  const palWid = Math.max(width + 0.10, 0.5);
  return (
    <group position={[x, DOCK_FLOOR_Y, z]}>
      {[-1, 0, 1].map((s) => (
        <mesh key={s} position={[s * (palLen / 2 - 0.07), 0.04, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.12, 0.08, palWid]} />
          <meshStandardMaterial color="#7a5a36" roughness={0.95} />
        </mesh>
      ))}
      {[-1, 0, 1].map((s) => (
        <mesh key={`d${s}`} position={[s * (palLen / 2 - 0.10), 0.10, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.18, 0.025, palWid]} />
          <meshStandardMaterial color="#a07a4c" roughness={0.85} />
        </mesh>
      ))}
      {[-1, 1].map((s) => (
        <mesh key={`x${s}`} position={[0, 0.10, s * (palWid / 2 - 0.10)]} castShadow receiveShadow>
          <boxGeometry args={[palLen - 0.05, 0.025, 0.18]} />
          <meshStandardMaterial color="#a07a4c" roughness={0.85} />
        </mesh>
      ))}
      {fragile && (
        <mesh position={[0, PALLET_HEIGHT + 0.005, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.10, 0.13, 16]} />
          <meshStandardMaterial color="#c54c3a" roughness={0.6} side={2} />
        </mesh>
      )}
    </group>
  );
}

export function Warehouse({ trace, trips }: { trace: Trace; trips: Trip[] }) {
  const _truckLen = trace.truck.length_m;
  const halfTrW = TRAILER_WIDTH / 2 + 0.05;

  const pallets = useMemo(() => trips.map((t) => ({
    x: t.sourceWorld[0],
    z: t.sourceWorld[2],
    l: t.size[0],
    w: t.size[1],
    fragile: t.spec.fragile,
    key: t.boxId,
  })), [trips]);

  const fluorescents = useMemo(() => [
    [-1.5, 6.5, -3.0], [-1.5, 6.5, 0.0],
    [3.0, 6.5, -3.0], [3.0, 6.5, 0.0],
    [7.5, 6.5, -3.0], [7.5, 6.5, 0.0],
    [12.0, 6.5, -3.0],
  ] as [number, number, number][], []);

  return (
    <group>
      {/* ===== Outdoor ground (y=0) — where the truck approaches ===== */}
      {/* Big outdoor pavement on the +z side of the dock */}
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[10, GROUND_Y, 15]}>
        <planeGeometry args={[60, 28]} />
        <meshStandardMaterial color="#5a5d61" roughness={0.95} />
      </mesh>
      {/* Outdoor strip directly under the trailer wheels on the dock side */}
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[7, GROUND_Y, 0]}>
        <planeGeometry args={[18, 4.0]} />
        <meshStandardMaterial color="#56595c" roughness={0.95} />
      </mesh>

      {/* ===== Raised dock platform (y=DOCK_FLOOR_Y) ===== */}
      {/* Main warehouse floor — extends in -z direction (the forklift side). */}
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[5, DOCK_FLOOR_Y, -8]}>
        <planeGeometry args={[42, 16]} />
        <meshStandardMaterial color="#9a9c9e" roughness={0.92} />
      </mesh>
      {/* Behind-trailer strip (between dock back wall and trailer rear) */}
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[-0.6, DOCK_FLOOR_Y, 0]}>
        <planeGeometry args={[1.6, 4.5]} />
        <meshStandardMaterial color="#9a9c9e" roughness={0.92} />
      </mesh>
      {/* Dock-edge fascia — visible vertical face of the raised dock */}
      <mesh receiveShadow position={[6.5, DOCK_FLOOR_Y / 2, halfTrW + 0.0]}>
        <boxGeometry args={[16, DOCK_FLOOR_Y, 0.10]} />
        <meshStandardMaterial color="#6e6e72" roughness={0.9} />
      </mesh>

      {/* Painted dock-bay alignment lines (on outdoor pavement next to dock).
          Use polygonOffset to guarantee they render above the ground without
          z-fighting at any depth. */}
      {[-(halfTrW + 0.5), halfTrW + 0.5].map((z, i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[6.5, GROUND_Y + 0.01, z]}>
          <planeGeometry args={[10, 0.12]} />
          <meshStandardMaterial
            color="#f2b733"
            roughness={0.6}
            polygonOffset
            polygonOffsetFactor={-2}
            polygonOffsetUnits={-1}
          />
        </mesh>
      ))}

      {/* ===== Dock back wall — now positioned close to the trailer rear ===== */}
      {/* Trailer rear sits at x=0.4; dock face is at x=-0.05 (just 45cm gap,
          bridged by the leveler). The wall + door opening align with the
          trailer rear opening. */}
      <mesh position={[-0.25, DOCK_FLOOR_Y + 3.0, 0]} receiveShadow castShadow>
        <boxGeometry args={[0.4, 6.0, 28]} />
        <meshStandardMaterial color="#c5c0b0" roughness={0.9} />
      </mesh>
      {/* Dock door opening — exactly matches trailer profile (interior height
          + width) so the trailer rear connects seamlessly. */}
      <mesh position={[-0.05, DOCK_FLOOR_Y + 1.25, 0]}>
        <boxGeometry args={[0.05, 2.50, TRAILER_WIDTH + 0.10]} />
        <meshStandardMaterial color="#101316" roughness={1.0} />
      </mesh>
      {/* Door header */}
      <mesh position={[-0.05, DOCK_FLOOR_Y + 2.65, 0]} castShadow>
        <boxGeometry args={[0.30, 0.30, TRAILER_WIDTH + 0.40]} />
        <meshStandardMaterial color="#7c7c80" roughness={0.6} metalness={0.5} />
      </mesh>
      {/* Dock seal cushions on either side of the opening */}
      {[-1, 1].map((s) => (
        <mesh
          key={`seal${s}`}
          position={[0.05, DOCK_FLOOR_Y + 1.25, s * (TRAILER_WIDTH / 2 + 0.10)]}
        >
          <boxGeometry args={[0.20, 2.50, 0.12]} />
          <meshStandardMaterial color="#15151a" roughness={0.9} />
        </mesh>
      ))}

      {/* ===== Dock leveler bridge (flush plate between dock and trailer) ===== */}
      <mesh position={[0.18, DOCK_FLOOR_Y + 0.02, 0]} receiveShadow>
        <boxGeometry args={[0.45, 0.04, TRAILER_WIDTH - 0.10]} />
        <meshStandardMaterial
          color="#5a5d61"
          roughness={0.50}
          metalness={0.45}
          polygonOffset
          polygonOffsetFactor={-1}
          polygonOffsetUnits={-1}
        />
      </mesh>

      {/* ===== Safety bollards (on outdoor pavement at the dock corners) ===== */}
      {[
        [-0.30, GROUND_Y, -halfTrW - 0.5],
        [-0.30, GROUND_Y, halfTrW + 0.5],
      ].map((p, i) => (
        <group key={i} position={p as [number, number, number]}>
          <mesh position={[0, 0.55, 0]} castShadow>
            <cylinderGeometry args={[0.14, 0.14, 1.10, 18]} />
            <meshStandardMaterial color="#e3a920" roughness={0.5} />
          </mesh>
          <mesh position={[0, 0.92, 0]}>
            <cylinderGeometry args={[0.145, 0.145, 0.12, 18]} />
            <meshStandardMaterial color="#f5f5f0" roughness={0.3} />
          </mesh>
        </group>
      ))}

      {/* ===== Staging pallets ===== */}
      {pallets.map((p) => (
        <Pallet key={p.key} x={p.x} z={p.z} length={p.l} width={p.w} fragile={p.fragile} />
      ))}

      {/* ===== Distant pallet racks (sense of warehouse scale) ===== */}
      {[2.0, 5.0, 8.0, 11.0, 14.0].map((x) => (
        <group key={x} position={[x, DOCK_FLOOR_Y, -10]}>
          {[-1.4, 1.4].map((dz) => (
            <mesh key={dz} position={[0, 1.7, dz]} castShadow>
              <boxGeometry args={[0.10, 3.4, 0.10]} />
              <meshStandardMaterial color="#8a4d2a" roughness={0.85} />
            </mesh>
          ))}
          {[0.9, 1.8, 2.7].map((y) => (
            <mesh key={y} position={[0, y, 0]} castShadow>
              <boxGeometry args={[2.8, 0.05, 0.7]} />
              <meshStandardMaterial color="#5e4630" roughness={0.9} />
            </mesh>
          ))}
          {[0.9, 1.8].map((y, i) => (
            <mesh key={`rb${i}`} position={[0, y + 0.25, 0]} castShadow>
              <boxGeometry args={[1.0, 0.45, 0.5]} />
              <meshStandardMaterial color={i % 2 === 0 ? "#bda076" : "#8c7150"} roughness={0.85} />
            </mesh>
          ))}
        </group>
      ))}

      {/* ===== Ceiling beams + fluorescents ===== */}
      {[-3, 0, 3].map((z) => (
        <mesh key={z} position={[6, 7.0, z]}>
          <boxGeometry args={[28, 0.20, 0.20]} />
          <meshStandardMaterial color="#3a3f44" roughness={0.7} />
        </mesh>
      ))}
      {fluorescents.map((p, i) => (
        <mesh key={`fl${i}`} position={p}>
          <boxGeometry args={[1.4, 0.06, 0.30]} />
          <meshStandardMaterial color="#e8eef7" emissive="#fffaef" emissiveIntensity={0.45} />
        </mesh>
      ))}
    </group>
  );
}
