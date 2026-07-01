// Realistic articulated semi-truck: tractor unit + 13.6 m dry-van trailer.
//
// Geometry rules:
//   - Wheels rest on ground (y=0). Wheel radius = WHEEL_RADIUS (0.50 m).
//   - Trailer floor at y = TRAILER_FLOOR_Y (1.10 m) — clears the wheel tops.
//   - Cargo region is the rear `truck.length_m` of the trailer (matches the
//     RL env's packing volume). Trailer exterior is longer (TRAILER_LENGTH).
//   - The trailer rear edge sits at world x = TRAILER_REAR_X when parked.
//   - Tractor sits in +x direction, coupled to the trailer via a 5th wheel.
//
// Approach animation (drives in along +x lane, stops past the dock,
// reverses with a slight arc until the trailer rear kisses the dock).

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

import {
  TRACTOR_CAB_HEIGHT,
  TRACTOR_LENGTH,
  TRAILER_FLOOR_Y,
  TRAILER_HEIGHT_INTERIOR,
  TRAILER_LENGTH,
  TRAILER_REAR_X,
  TRAILER_ROOF_THICKNESS,
  TRAILER_WIDTH,
  WHEEL_RADIUS,
  WHEEL_WIDTH,
} from "./constants";
import type { TruckInfo } from "../trace/schema";

// ---------- Approach timeline (seconds since simulation start) ----------
const T0 = 0.0;
const T_PASS_END = 3.5;     // truck has driven past the dock, slows to a stop
const T_PAUSE_END = 4.5;    // wheels still, dust settles
const T_PARK = 7.0;         // backing complete; trailer rear at dock

function smoothstep(t: number) {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

interface PoseCurve {
  posX: (t: number) => number;
  posZ: (t: number) => number;
  yaw: (t: number) => number;
  wheelSpin: (t: number) => number;
  reverseLight: (t: number) => number;
}

// Tractor + trailer is rendered as one Group whose origin is at the trailer
// rear edge when parked. So `groupX = TRAILER_REAR_X` ⇒ trailer rear at dock.
function buildCurve(): PoseCurve {
  const parkedX = TRAILER_REAR_X;
  const passEndX = parkedX + 4.0;   // truck stops 4 m past the dock
  const passEndZ = 2.4;             // .. and slightly off the dock lane
  const startX = parkedX + 24.0;    // enters from far down the lane
  const startZ = 6.0;

  return {
    posX: (t: number) => {
      if (t < T0) return startX;
      if (t < T_PASS_END) {
        const k = smoothstep((t - T0) / (T_PASS_END - T0));
        return startX + (passEndX - startX) * k;
      }
      if (t < T_PAUSE_END) return passEndX;
      if (t < T_PARK) {
        const k = smoothstep((t - T_PAUSE_END) / (T_PARK - T_PAUSE_END));
        return passEndX + (parkedX - passEndX) * k;
      }
      return parkedX;
    },
    posZ: (t: number) => {
      if (t < T0) return startZ;
      if (t < T_PASS_END) {
        const k = smoothstep((t - T0) / (T_PASS_END - T0));
        return startZ + (passEndZ - startZ) * k;
      }
      if (t < T_PAUSE_END) return passEndZ;
      if (t < T_PARK) {
        const k = smoothstep((t - T_PAUSE_END) / (T_PARK - T_PAUSE_END));
        // Smooth arc inward — driver swings the trailer toward the dock.
        return passEndZ * (1 - k);
      }
      return 0;
    },
    yaw: (t: number) => {
      if (t < T_PASS_END) return 0;
      if (t < T_PAUSE_END) return 0.06;
      if (t < T_PARK) {
        const k = smoothstep((t - T_PAUSE_END) / (T_PARK - T_PAUSE_END));
        return 0.06 - 0.06 * k;
      }
      return 0;
    },
    wheelSpin: (t: number) => {
      if (t < T0) return 0;
      if (t < T_PASS_END) {
        return -((t - T0) / (T_PASS_END - T0)) * 7.0;
      }
      if (t < T_PAUSE_END) return -7.0;
      if (t < T_PARK) {
        const k = (t - T_PAUSE_END) / (T_PARK - T_PAUSE_END);
        return -7.0 + k * 4.5; // reversal
      }
      return -2.5;
    },
    reverseLight: (t: number) => {
      // White reverse lights on during the reversing maneuver.
      if (t < T_PAUSE_END) return 0.0;
      if (t < T_PARK + 0.5) return 1.0;
      return 0.0;
    },
  };
}

// ---------------------- Sub-components ----------------------

function Wheel({
  position,
  spinRef,
  radius = WHEEL_RADIUS,
  width = WHEEL_WIDTH,
}: {
  position: [number, number, number];
  spinRef?: (m: THREE.Mesh | null) => void;
  radius?: number;
  width?: number;
}) {
  return (
    <group position={position}>
      {/* Tire */}
      <mesh ref={spinRef} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[radius, radius, width, 28]} />
        <meshStandardMaterial color="#15151a" roughness={0.95} />
      </mesh>
      {/* Steel rim */}
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[radius * 0.55, radius * 0.55, width + 0.005, 16]} />
        <meshStandardMaterial color="#3d4046" roughness={0.5} metalness={0.6} />
      </mesh>
      {/* Hub cap */}
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, width / 2 + 0.005]}>
        <cylinderGeometry args={[radius * 0.18, radius * 0.18, 0.02, 12]} />
        <meshStandardMaterial color="#c0c4c8" roughness={0.4} metalness={0.85} />
      </mesh>
    </group>
  );
}

function Tractor({
  trailerKingpinX,
  wheelRefs,
  headlightRefs,
}: {
  trailerKingpinX: number;
  wheelRefs: (i: number) => (m: THREE.Mesh | null) => void;
  headlightRefs: (i: number) => (m: THREE.MeshStandardMaterial | null) => void;
}) {
  // Tractor extends in +x direction from the trailer.
  // Wheelbase ~ 3.5m. Front axle near nose, drive tandem near 5th-wheel.
  const cabX = trailerKingpinX + 0.6;          // 5th wheel sits at trailerKingpinX
  const noseX = cabX + TRACTOR_LENGTH - 1.0;   // bumper end
  const cabY = TRAILER_FLOOR_Y;                // cab floor matches trailer-floor height
  const driveAxleX = cabX + 0.2;
  const frontAxleX = noseX - 1.0;

  return (
    <group>
      {/* === Chassis frame === */}
      <mesh position={[(cabX + noseX) / 2, WHEEL_RADIUS + 0.10, 0]} castShadow>
        <boxGeometry args={[noseX - cabX, 0.20, TRAILER_WIDTH - 0.45]} />
        <meshStandardMaterial color="#1d1d1f" roughness={0.5} metalness={0.55} />
      </mesh>

      {/* === Sleeper cab (the bulky structure behind/around the driver) === */}
      <mesh position={[cabX + 0.5, cabY + 1.05, 0]} castShadow receiveShadow>
        <boxGeometry args={[2.20, 2.10, TRAILER_WIDTH - 0.10]} />
        <meshStandardMaterial color="#1f4ea8" roughness={0.40} metalness={0.30} />
      </mesh>
      {/* Cab roof fairing */}
      <mesh position={[cabX + 0.5, cabY + 2.30, 0]} castShadow>
        <boxGeometry args={[2.10, 0.35, TRAILER_WIDTH - 0.25]} />
        <meshStandardMaterial color="#1a3f8a" roughness={0.45} metalness={0.30} />
      </mesh>
      {/* Roof spoiler fairing tapering toward trailer top */}
      <mesh position={[cabX + 1.50, cabY + 2.40, 0]} rotation={[0, 0, 0.10]} castShadow>
        <boxGeometry args={[0.80, 0.25, TRAILER_WIDTH - 0.35]} />
        <meshStandardMaterial color="#1a3f8a" roughness={0.45} metalness={0.30} />
      </mesh>

      {/* === Driver section (in front of sleeper) === */}
      <mesh position={[cabX + 2.30, cabY + 0.85, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.20, 1.70, TRAILER_WIDTH - 0.10]} />
        <meshStandardMaterial color="#1f4ea8" roughness={0.40} metalness={0.30} />
      </mesh>
      {/* Windshield — angled, dark glass */}
      <mesh position={[cabX + 2.95, cabY + 1.40, 0]} rotation={[0, 0, -0.18]} castShadow>
        <boxGeometry args={[0.05, 1.10, TRAILER_WIDTH - 0.30]} />
        <meshStandardMaterial color="#0c121d" roughness={0.10} metalness={0.7} />
      </mesh>
      {/* Side windows on the cab */}
      {[-1, 1].map((s) => (
        <mesh
          key={`win${s}`}
          position={[cabX + 2.30, cabY + 1.20, s * (TRAILER_WIDTH / 2 - 0.04)]}
        >
          <boxGeometry args={[1.10, 0.85, 0.04]} />
          <meshStandardMaterial color="#0c121d" roughness={0.2} metalness={0.5} />
        </mesh>
      ))}

      {/* === Hood / nose (engine cover) === */}
      <mesh position={[cabX + 3.60, cabY + 0.50, 0]} castShadow>
        <boxGeometry args={[1.30, 1.00, TRAILER_WIDTH - 0.30]} />
        <meshStandardMaterial color="#1a3f8a" roughness={0.45} metalness={0.30} />
      </mesh>
      {/* Front bumper */}
      <mesh position={[noseX - 0.10, WHEEL_RADIUS + 0.20, 0]} castShadow>
        <boxGeometry args={[0.30, 0.55, TRAILER_WIDTH - 0.10]} />
        <meshStandardMaterial color="#15151a" roughness={0.55} metalness={0.60} />
      </mesh>
      {/* Grille */}
      <mesh position={[noseX - 0.04, cabY + 0.15, 0]} castShadow>
        <boxGeometry args={[0.06, 0.85, TRAILER_WIDTH - 0.50]} />
        <meshStandardMaterial color="#101012" roughness={0.6} metalness={0.7} />
      </mesh>
      {/* Headlights */}
      {[-1, 1].map((s, i) => (
        <mesh
          key={`hl${s}`}
          position={[noseX - 0.04, cabY + 0.30, s * (TRAILER_WIDTH / 2 - 0.30)]}
        >
          <boxGeometry args={[0.05, 0.22, 0.36]} />
          <meshStandardMaterial
            ref={headlightRefs(i)}
            color="#fff8e0"
            emissive="#ffeec0"
            emissiveIntensity={0.7}
            roughness={0.15}
          />
        </mesh>
      ))}

      {/* === Exhaust stacks (vertical chrome) === */}
      {[-1, 1].map((s) => (
        <mesh
          key={`ex${s}`}
          position={[cabX + 0.40, cabY + 2.30, s * (TRAILER_WIDTH / 2 + 0.05)]}
          castShadow
        >
          <cylinderGeometry args={[0.07, 0.07, 2.30, 18]} />
          <meshStandardMaterial color="#a1a4a8" roughness={0.35} metalness={0.90} />
        </mesh>
      ))}

      {/* === Fuel tanks (cylindrical, mid-chassis) === */}
      {[-1, 1].map((s) => (
        <mesh
          key={`ft${s}`}
          position={[cabX + 1.40, WHEEL_RADIUS + 0.10, s * (TRAILER_WIDTH / 2 + 0.10)]}
          rotation={[0, 0, Math.PI / 2]}
          castShadow
        >
          <cylinderGeometry args={[0.32, 0.32, 1.20, 18]} />
          <meshStandardMaterial color="#b6babe" roughness={0.35} metalness={0.85} />
        </mesh>
      ))}

      {/* === 5th wheel coupling (above the drive axle) === */}
      <mesh position={[trailerKingpinX, WHEEL_RADIUS + 0.45, 0]} castShadow>
        <boxGeometry args={[0.80, 0.18, 1.60]} />
        <meshStandardMaterial color="#5a5d61" roughness={0.55} metalness={0.55} />
      </mesh>
      {/* Kingpin (small vertical pin connecting to trailer) */}
      <mesh position={[trailerKingpinX, WHEEL_RADIUS + 0.62, 0]}>
        <cylinderGeometry args={[0.10, 0.10, 0.18, 14]} />
        <meshStandardMaterial color="#1d1d1f" roughness={0.50} metalness={0.60} />
      </mesh>

      {/* === Wheels === */}
      {/* Front steer axle housing — visible bar connecting the two wheels */}
      <mesh position={[frontAxleX, WHEEL_RADIUS, 0]} castShadow>
        <boxGeometry args={[0.16, 0.16, TRAILER_WIDTH - 0.25]} />
        <meshStandardMaterial color="#2d2d30" roughness={0.55} metalness={0.55} />
      </mesh>
      {/* Drive tandem axle housings */}
      {[0, 1].map((ax) => (
        <mesh
          key={`dax${ax}`}
          position={[driveAxleX + ax * 1.30, WHEEL_RADIUS, 0]}
          castShadow
        >
          <boxGeometry args={[0.18, 0.18, TRAILER_WIDTH - 0.20]} />
          <meshStandardMaterial color="#2d2d30" roughness={0.50} metalness={0.55} />
        </mesh>
      ))}
      {/* Wheel fenders above each axle on both sides */}
      {[-1, 1].flatMap((s) =>
        [frontAxleX, driveAxleX, driveAxleX + 1.30].map((ax, fi) => (
          <mesh
            key={`fendT${s}-${fi}`}
            position={[ax, WHEEL_RADIUS + 0.32, s * (TRAILER_WIDTH / 2 - 0.05)]}
          >
            <boxGeometry args={[0.85, 0.20, 0.34]} />
            <meshStandardMaterial color="#1d1d1f" roughness={0.55} metalness={0.40} />
          </mesh>
        )),
      )}
      {/* Front steer axle: 1 wheel per side */}
      {[-1, 1].map((s, i) => (
        <Wheel
          key={`fw${s}`}
          position={[frontAxleX, WHEEL_RADIUS, s * (TRAILER_WIDTH / 2 - 0.05)]}
          spinRef={wheelRefs(i)}
        />
      ))}
      {/* Drive tandem axles: 2 axles, 1 wheel per side per axle */}
      {[-1, 1].map((s, i) =>
        [0, 1].map((ax) => (
          <Wheel
            key={`dw${s}-${ax}`}
            position={[driveAxleX + ax * 1.30, WHEEL_RADIUS, s * (TRAILER_WIDTH / 2 - 0.05)]}
            spinRef={wheelRefs(2 + i * 2 + ax)}
          />
        )),
      )}

      {/* === Side mirrors === */}
      {[-1, 1].map((s) => (
        <group key={`mir${s}`} position={[cabX + 1.65, cabY + 1.85, s * (TRAILER_WIDTH / 2 + 0.18)]}>
          <mesh castShadow>
            <boxGeometry args={[0.10, 0.40, 0.20]} />
            <meshStandardMaterial color="#1f4ea8" roughness={0.4} metalness={0.4} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function Trailer({
  logoTexture,
  wheelRefs,
  taillightRefs,
  reverseLightRef,
}: {
  logoTexture: THREE.Texture | null;
  wheelRefs: (i: number) => (m: THREE.Mesh | null) => void;
  taillightRefs: (i: number) => (m: THREE.MeshStandardMaterial | null) => void;
  reverseLightRef: (m: THREE.MeshStandardMaterial | null) => void;
}) {
  const halfLen = TRAILER_LENGTH / 2;
  const halfWid = TRAILER_WIDTH / 2;
  const wallY = TRAILER_FLOOR_Y + TRAILER_HEIGHT_INTERIOR / 2;
  const roofY = TRAILER_FLOOR_Y + TRAILER_HEIGHT_INTERIOR;

  // Tandem axle location: ~3 m forward of the trailer rear is typical.
  const axleBackX = TRAILER_REAR_X + 2.5;
  const axleForwardX = TRAILER_REAR_X + 3.7;

  return (
    <group>
      {/* === Floor (extends the full external length) === */}
      <mesh
        position={[TRAILER_REAR_X + halfLen, TRAILER_FLOOR_Y - 0.05, 0]}
        castShadow
        receiveShadow
      >
        <boxGeometry args={[TRAILER_LENGTH, 0.10, TRAILER_WIDTH]} />
        <meshStandardMaterial color="#3a3633" roughness={0.85} />
      </mesh>

      {/* === Trailer undercarriage chassis — visible structural frame
            connecting the trailer floor to the wheels. Beams + axle housings
            + suspension hangers + wheel fenders so wheels look anchored. === */}
      {/* Longitudinal main I-beams (centerline) */}
      {[-0.55, 0.55].map((zOff) => (
        <mesh
          key={`beam${zOff}`}
          position={[TRAILER_REAR_X + halfLen, TRAILER_FLOOR_Y - 0.20, zOff]}
          castShadow
        >
          <boxGeometry args={[TRAILER_LENGTH - 0.20, 0.18, 0.10]} />
          <meshStandardMaterial color="#2d2d30" roughness={0.55} metalness={0.55} />
        </mesh>
      ))}
      {/* Suspension cross-rails spanning to the wheels at each axle */}
      {[axleBackX, axleForwardX].map((ax) => (
        <mesh
          key={`cross${ax}`}
          position={[ax, TRAILER_FLOOR_Y - 0.18, 0]}
          castShadow
        >
          <boxGeometry args={[0.20, 0.14, TRAILER_WIDTH - 0.15]} />
          <meshStandardMaterial color="#2d2d30" roughness={0.55} metalness={0.55} />
        </mesh>
      ))}
      {/* Axle housings at wheel-center height connecting both sides */}
      {[axleBackX, axleForwardX].map((ax) => (
        <mesh key={`ax${ax}`} position={[ax, WHEEL_RADIUS, 0]} castShadow>
          <boxGeometry args={[0.18, 0.18, TRAILER_WIDTH - 0.20]} />
          <meshStandardMaterial color="#2d2d30" roughness={0.5} metalness={0.55} />
        </mesh>
      ))}
      {/* Suspension hangers (vertical struts from cross-rail down to axle) */}
      {[axleBackX, axleForwardX].flatMap((ax) =>
        [-0.85, -0.30, 0.30, 0.85].map((zOff) => (
          <mesh
            key={`susp${ax}-${zOff}`}
            position={[ax, (TRAILER_FLOOR_Y - 0.18 + WHEEL_RADIUS) / 2, zOff]}
          >
            <boxGeometry args={[0.08, TRAILER_FLOOR_Y - 0.28 - WHEEL_RADIUS, 0.08]} />
            <meshStandardMaterial color="#3a3a3d" roughness={0.55} metalness={0.50} />
          </mesh>
        )),
      )}
      {/* Wheel fenders — curved panels above each wheel pair on both sides */}
      {[-1, 1].map((s) =>
        [axleBackX, axleForwardX].map((ax) => (
          <mesh
            key={`fender${s}-${ax}`}
            position={[ax, WHEEL_RADIUS + 0.32, s * (TRAILER_WIDTH / 2 - 0.05)]}
          >
            <boxGeometry args={[0.85, 0.20, 0.34]} />
            <meshStandardMaterial color="#1d1d1f" roughness={0.55} metalness={0.40} />
          </mesh>
        )),
      )}

      {/* === Side walls === */}
      {/* The wall whose normal points TOWARD the forklift's working side
          (which is -z, the staging side) gets put on render layer 2 so the
          close-up dynamic camera can hide it and see straight into the
          trailer interior. The +z wall stays on the default layer because
          it's always away from the forklift. */}
      {[-1, 1].map((side) => (
        <group key={`sw${side}`}>
          <mesh
            position={[TRAILER_REAR_X + halfLen, wallY, side * halfWid]}
            castShadow
            receiveShadow
            ref={(el) => {
              if (el && side === -1) el.layers.set(2);
            }}
          >
            <boxGeometry args={[TRAILER_LENGTH, TRAILER_HEIGHT_INTERIOR, 0.06]} />
            <meshStandardMaterial color="#e8e8e8" roughness={0.55} />
          </mesh>
          {/* Logo decal — applied to BOTH sides, facing outward.
              polygonOffset pushes the decal slightly toward the camera in
              depth so it can't z-fight with the wall behind it. */}
          {logoTexture && (
            <mesh
              position={[TRAILER_REAR_X + halfLen, wallY + 0.20, side * (halfWid + 0.06)]}
              rotation={[0, side === 1 ? 0 : Math.PI, 0]}
            >
              <planeGeometry args={[5.5, 1.75]} />
              <meshStandardMaterial
                map={logoTexture}
                transparent
                roughness={0.65}
                depthWrite={false}
                polygonOffset
                polygonOffsetFactor={-2}
                polygonOffsetUnits={-2}
              />
            </mesh>
          )}
          {/* Rivet band — placed outside the wall plane to avoid intersecting
              the wall mesh thickness. */}
          <mesh
            position={[TRAILER_REAR_X + halfLen, TRAILER_FLOOR_Y + 0.10, side * (halfWid + 0.045)]}
          >
            <boxGeometry args={[TRAILER_LENGTH - 0.10, 0.07, 0.015]} />
            <meshStandardMaterial color="#9a9a9a" roughness={0.6} metalness={0.45} />
          </mesh>
        </group>
      ))}

      {/* === Roof — on render layer 1 so cinematic top-down can hide it === */}
      <mesh
        position={[TRAILER_REAR_X + halfLen, roofY + TRAILER_ROOF_THICKNESS / 2, 0]}
        castShadow
        ref={(el) => { if (el) el.layers.set(1); }}
      >
        <boxGeometry args={[TRAILER_LENGTH, TRAILER_ROOF_THICKNESS, TRAILER_WIDTH]} />
        <meshStandardMaterial color="#cfcfcf" roughness={0.7} />
      </mesh>

      {/* === Front (head) wall — closer to cab === */}
      <mesh
        position={[TRAILER_REAR_X + TRAILER_LENGTH - 0.04, wallY, 0]}
        castShadow
      >
        <boxGeometry args={[0.08, TRAILER_HEIGHT_INTERIOR, TRAILER_WIDTH]} />
        <meshStandardMaterial color="#dcdcdc" roughness={0.65} />
      </mesh>

      {/* === Rear doors — open & FLUSH against the sidewalls, hinged at the
            trailer rear corners. Each door is a slab in the XY plane sitting
            just outside the sidewall, with its rear edge at TRAILER_REAR_X
            so it visually attaches at the rear corner. === */}
      {[-1, 1].map((side) => {
        const doorLength = halfWid - 0.05;             // each covers ~half trailer width
        const doorCenterX = TRAILER_REAR_X - doorLength / 2;
        const doorZ = side * (halfWid + 0.045);        // just outside sidewall
        return (
          <group key={`door${side}`}>
            {/* Door panel */}
            <mesh position={[doorCenterX, wallY, doorZ]} castShadow receiveShadow>
              <boxGeometry args={[doorLength, TRAILER_HEIGHT_INTERIOR, 0.06]} />
              <meshStandardMaterial color="#e8e8e8" roughness={0.55} />
            </mesh>
            {/* Vertical locking-rod hardware on the inner edge of each door
                (the edge that's away from the hinge). */}
            <mesh
              position={[doorCenterX - doorLength / 2 + 0.05, wallY, doorZ + side * 0.04]}
              castShadow
            >
              <cylinderGeometry args={[0.025, 0.025, TRAILER_HEIGHT_INTERIOR - 0.10, 12]} />
              <meshStandardMaterial color="#1d1d1f" roughness={0.55} metalness={0.55} />
            </mesh>
            {/* Hinge band at the rear corner — visually connects the door to
                the trailer rear edge. */}
            {[TRAILER_FLOOR_Y + 0.25, wallY, TRAILER_FLOOR_Y + TRAILER_HEIGHT_INTERIOR - 0.25].map((hy, hi) => (
              <mesh
                key={`hinge${side}-${hi}`}
                position={[TRAILER_REAR_X, hy, doorZ - side * 0.01]}
                castShadow
              >
                <boxGeometry args={[0.07, 0.20, 0.10]} />
                <meshStandardMaterial color="#2d2d30" roughness={0.50} metalness={0.55} />
              </mesh>
            ))}
            {/* Door-edge gusset that bridges from the inner face of the door
                to the sidewall, eliminating any visible gap between them. */}
            <mesh
              position={[
                TRAILER_REAR_X - 0.02,
                wallY,
                side * (halfWid + 0.02),
              ]}
              castShadow
            >
              <boxGeometry args={[0.06, TRAILER_HEIGHT_INTERIOR, 0.06]} />
              <meshStandardMaterial color="#dcdcdc" roughness={0.55} />
            </mesh>
          </group>
        );
      })}

      {/* === Rear bumper / ICC bar === */}
      <mesh
        position={[TRAILER_REAR_X - 0.02, WHEEL_RADIUS + 0.25, 0]}
        castShadow
      >
        <boxGeometry args={[0.05, 0.12, TRAILER_WIDTH - 0.15]} />
        <meshStandardMaterial color="#9a9a9a" roughness={0.7} metalness={0.5} />
      </mesh>
      {/* ICC vertical supports */}
      {[-0.6, 0.6].map((zOff) => (
        <mesh
          key={`icc${zOff}`}
          position={[TRAILER_REAR_X - 0.02, WHEEL_RADIUS - 0.05, zOff]}
          castShadow
        >
          <boxGeometry args={[0.05, 0.55, 0.08]} />
          <meshStandardMaterial color="#9a9a9a" roughness={0.7} metalness={0.5} />
        </mesh>
      ))}

      {/* === Taillights === */}
      {[-1, 1].map((side, i) => (
        <mesh
          key={`tl${side}`}
          position={[TRAILER_REAR_X - 0.005, TRAILER_FLOOR_Y - 0.10, side * (halfWid - 0.18)]}
        >
          <boxGeometry args={[0.04, 0.22, 0.34]} />
          <meshStandardMaterial
            ref={taillightRefs(i)}
            color="#5a0606"
            emissive="#c40000"
            emissiveIntensity={0.4}
            roughness={0.4}
          />
        </mesh>
      ))}
      {/* Reverse light (white, center) */}
      <mesh position={[TRAILER_REAR_X - 0.005, TRAILER_FLOOR_Y - 0.10, 0]}>
        <boxGeometry args={[0.04, 0.18, 0.24]} />
        <meshStandardMaterial
          ref={reverseLightRef}
          color="#f1efe5"
          emissive="#ffffff"
          emissiveIntensity={0.0}
          roughness={0.3}
        />
      </mesh>

      {/* === License plate === */}
      <mesh position={[TRAILER_REAR_X - 0.01, WHEEL_RADIUS + 0.10, 0]}>
        <boxGeometry args={[0.03, 0.18, 0.42]} />
        <meshStandardMaterial color="#f1efe5" roughness={0.4} />
      </mesh>

      {/* === Trailer tandem wheels === */}
      {[-1, 1].map((s, i) =>
        [axleBackX, axleForwardX].map((ax, ai) => (
          <Wheel
            key={`trw${s}-${ai}`}
            position={[ax, WHEEL_RADIUS, s * (TRAILER_WIDTH / 2 - 0.05)]}
            spinRef={wheelRefs(8 + i * 2 + ai)}
          />
        )),
      )}

      {/* === Mud flaps === */}
      {[-1, 1].map((s) => (
        <mesh
          key={`mf${s}`}
          position={[axleForwardX + 0.50, WHEEL_RADIUS - 0.10, s * (TRAILER_WIDTH / 2 - 0.02)]}
          castShadow
        >
          <boxGeometry args={[0.03, 0.50, 0.32]} />
          <meshStandardMaterial color="#1a1a1c" roughness={0.95} />
        </mesh>
      ))}

      {/* === Landing gear (legs) under the front of the trailer === */}
      {[-1, 1].map((s) => (
        <mesh
          key={`lg${s}`}
          position={[TRAILER_REAR_X + TRAILER_LENGTH - 4.0, TRAILER_FLOOR_Y / 2, s * 0.7]}
          castShadow
        >
          <boxGeometry args={[0.10, TRAILER_FLOOR_Y, 0.10]} />
          <meshStandardMaterial color="#5a5d61" roughness={0.55} metalness={0.5} />
        </mesh>
      ))}
    </group>
  );
}

// ---------------------- Main component ----------------------

export function Truck({
  truck,
  timeRef,
}: {
  truck: TruckInfo;
  timeRef: { current: number };
}) {
  // Load the trailer logo manually (no Suspense needed).
  const [logoTexture, setLogoTexture] = useState<THREE.Texture | null>(null);
  useEffect(() => {
    const loader = new THREE.TextureLoader();
    loader.load(
      "/assets/logo.png",
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 4;
        setLogoTexture(tex);
      },
      undefined,
      (err) => console.warn("Failed to load logo:", err),
    );
  }, []);

  const root = useRef<THREE.Group>(null);
  const wheels = useRef<THREE.Mesh[]>([]);
  const taillights = useRef<THREE.MeshStandardMaterial[]>([]);
  const reverseLight = useRef<THREE.MeshStandardMaterial | null>(null);
  const headlights = useRef<THREE.MeshStandardMaterial[]>([]);

  const curve = useMemo(buildCurve, []);

  // 5th-wheel kingpin x in trailer-local coords: just behind the trailer
  // front wall. World x = TRAILER_REAR_X + (TRAILER_LENGTH - ~1.2).
  const trailerKingpinX = TRAILER_REAR_X + TRAILER_LENGTH - 1.2;

  useFrame(() => {
    const t = timeRef.current;
    if (!root.current) return;
    root.current.position.set(curve.posX(t) - TRAILER_REAR_X, 0, curve.posZ(t));
    // Subtract TRAILER_REAR_X so that this group's *trailer rear* lands
    // exactly at the world TRAILER_REAR_X when parked.
    root.current.rotation.y = curve.yaw(t);

    const spin = curve.wheelSpin(t);
    for (const w of wheels.current) {
      if (w) w.rotation.x = spin;
    }

    const revLit = curve.reverseLight(t);
    if (reverseLight.current) {
      reverseLight.current.emissiveIntensity = revLit * 1.2;
    }
    // Brake lights brighten while reversing too.
    const brakeBoost = revLit > 0 ? 1.6 : 0.4;
    for (const m of taillights.current) {
      if (m) m.emissiveIntensity = brakeBoost;
    }
  });

  const wheelRefAt = (i: number) => (m: THREE.Mesh | null) => {
    if (m) wheels.current[i] = m;
  };
  const tailRefAt = (i: number) => (mat: THREE.MeshStandardMaterial | null) => {
    if (mat) taillights.current[i] = mat;
  };
  const headRefAt = (i: number) => (mat: THREE.MeshStandardMaterial | null) => {
    if (mat) headlights.current[i] = mat;
  };
  const reverseRef = (mat: THREE.MeshStandardMaterial | null) => {
    reverseLight.current = mat;
  };

  // Suppress unused-param warning while satisfying TS.
  void truck;
  void headlights;

  return (
    <group ref={root}>
      <Trailer
        logoTexture={logoTexture}
        wheelRefs={wheelRefAt}
        taillightRefs={tailRefAt}
        reverseLightRef={reverseRef}
      />
      <Tractor
        trailerKingpinX={trailerKingpinX}
        wheelRefs={wheelRefAt}
        headlightRefs={headRefAt}
      />
    </group>
  );
}
