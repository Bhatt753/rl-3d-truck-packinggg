// Trace → "trips" (one trip per box) → kinematic state per frame.
//
// A trip captures the full forklift cycle for one box:
//   prevDrop → approach pickup → engage forks → lift → travel → enter trailer
//   → drop → back out
//
// `evaluateAt(trips, t)` is the only thing the scene needs.

import {
  DOCK_FLOOR_Y,
  PALLET_TOP_Y,
  TRAILER_FLOOR_Y,
  TRAILER_REAR_X,
  TRAILER_WIDTH,
} from "../scene/constants";
import type { BoxSpec, PickEvent, PlaceEvent, Trace, Vec3 } from "../trace/schema";

// Forklift home spot — on the raised dock floor.
const HOME_POS: Vec3 = [4.5, DOCK_FLOOR_Y, -2.5];

// Forklift's WIDEST point is the upper deck at 1.10 m (half-width 0.55 m).
// We leave 10 cm clearance on each side of the trailer interior so the AGV
// can absolutely never touch the sidewalls.
const FORKLIFT_HALF_WIDTH = 0.58;
const TRAILER_INTERIOR_HALF = TRAILER_WIDTH / 2 - 0.10;
const FORKLIFT_LATERAL_LIMIT = TRAILER_INTERIOR_HALF - FORKLIFT_HALF_WIDTH;

function clampInsideTrailer(z: number): number {
  return Math.max(-FORKLIFT_LATERAL_LIMIT, Math.min(FORKLIFT_LATERAL_LIMIT, z));
}
const FORKLIFT_CHASSIS_HALF_LEN = 0.7;    // ~half of body length, forks reach beyond
const FORK_REACH_BEYOND_BODY = 0.55;      // forks stick out this far ahead of chassis center
const CARRY_HEIGHT = 0.45;                // fork height while moving with a load
const PLACE_LIFT_BUFFER = 0.05;           // forks slightly above target before lowering
const BACKOUT_DISTANCE = 1.2;             // how far forklift retreats after release

const FORK_BOX_OFFSET_Y = 0.10;           // box sits a bit above forks
const FORK_BOX_OFFSET_FORWARD = 0.40;     // box centered just forward of chassis center

export interface Trip {
  boxId: number;
  spec: BoxSpec;
  startT: number;         // moment forklift may begin moving for this trip
  approachT: number;      // moment forklift has arrived at pickup point
  pickT: number;          // moment box leaves the pallet (on forks)
  travelT: number;        // moment forklift starts moving toward trailer
  placeT: number;          // box settled at final position
  endT: number;            // forklift fully backed out, ready for next trip
  sourceWorld: Vec3;       // staging-area position (box center, world)
  targetWorld: Vec3;       // final box position (box center, world)
  size: Vec3;              // final oriented dims of the box
  pickupApproach: Vec3;    // where forklift parks to pick up (chassis center)
  trailerEntry: Vec3;      // dock-mouth point en route to trailer interior
  trailerDrop: Vec3;       // where forklift parks inside trailer to release
  backoutPos: Vec3;        // where forklift backs out to after release
}

export interface ForkliftRuntime {
  position: Vec3;
  yaw: number;
  liftHeight: number;
  hasBox: boolean;
  carriedBoxId: number | null;
}

export interface BoxRuntime {
  position: Vec3;          // box center world coords
  rotationY: number;
  visible: boolean;
  state: "staging" | "carried" | "placed";
}

export interface FrameState {
  forklift: ForkliftRuntime;
  boxes: Map<number, BoxRuntime>;
  metrics: { placedCount: number; placedVolumeMeters: number };
}

// ------------------------ Helpers ------------------------

export function easeInOut(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

export function lerpVec3(a: Vec3, b: Vec3, t: number): Vec3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function lerpAngle(a: number, b: number, t: number): number {
  // shortest-arc lerp
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return a + d * t;
}

function distXZ(a: Vec3, b: Vec3): number {
  const dx = a[0] - b[0];
  const dz = a[2] - b[2];
  return Math.hypot(dx, dz);
}

// Truck-local target → world (box CENTER).
export function truckLocalCenterToWorld(corner: Vec3, size: Vec3, truckWidth: number): Vec3 {
  return [
    TRAILER_REAR_X + corner[0] + size[0] / 2,
    TRAILER_FLOOR_Y + corner[2] + size[2] / 2,
    corner[1] + size[1] / 2 - truckWidth / 2,
  ];
}

// ------------------------ Trip building ------------------------

export function buildTrips(trace: Trace): Trip[] {
  const boxesById = new Map<number, BoxSpec>();
  for (const b of trace.boxes) boxesById.set(b.id, b);

  const picks = new Map<number, PickEvent>();
  const places = new Map<number, PlaceEvent>();
  for (const e of trace.events) {
    if (e.type === "pick") picks.set(e.box_id, e as PickEvent);
    else if (e.type === "place") places.set(e.box_id, e as PlaceEvent);
  }

  const orderedBoxIds = [...places.keys()].sort(
    (a, b) => (places.get(a)!.t) - (places.get(b)!.t),
  );

  const trips: Trip[] = [];
  for (let i = 0; i < orderedBoxIds.length; i++) {
    const boxId = orderedBoxIds[i];
    const spec = boxesById.get(boxId);
    const pick = picks.get(boxId);
    const place = places.get(boxId);
    if (!spec || !pick || !place) continue;

    const size: Vec3 = place.size;
    // Staging boxes rest on their pallet on the dock floor; ignore the
    // recorder's fixed z=0.4 hack and use the actual pallet-top height.
    const sourceWorld: Vec3 = [
      pick.source[0],
      PALLET_TOP_Y + size[2] / 2,
      pick.source[1],
    ];
    const targetWorld = truckLocalCenterToWorld(place.target, size, trace.truck.width_m);

    // Pickup approach: forklift parks on the dock floor with forks reaching
    // toward the pallet at staging row z (faces -z).
    const pickupApproach: Vec3 = [
      sourceWorld[0],
      DOCK_FLOOR_Y,
      sourceWorld[2] + FORK_REACH_BEYOND_BODY + 0.05,
    ];
    // Forklift z stays inside the safe corridor so it cannot clip the
    // trailer walls. The box itself is slid laterally onto its true target
    // during the lower-forks phase.
    const safeZ = clampInsideTrailer(targetWorld[2]);
    // Trailer entry: just outside trailer rear, on the centerline approach.
    const trailerEntry: Vec3 = [TRAILER_REAR_X - 0.6, DOCK_FLOOR_Y, 0];
    // Trailer drop: forklift drives in so its forks reach the target x. Z is
    // clamped to the safe corridor — never against the sidewalls.
    const trailerDrop: Vec3 = [
      targetWorld[0] - FORK_REACH_BEYOND_BODY - size[0] / 2,
      DOCK_FLOOR_Y,
      safeZ,
    ];
    // Back-out: retreat back toward trailer entry (along center if needed).
    const backoutPos: Vec3 = [trailerDrop[0] - BACKOUT_DISTANCE, DOCK_FLOOR_Y, safeZ * 0.5];

    const startT = i === 0 ? 7.5 : trips[i - 1].endT;
    const approachT = pick.t - 0.4;     // arrives at pallet
    const travelT = pick.t + 0.2;       // forks fully lifted, begins moving
    const endT = place.t + 0.6;         // backed out, ready for next

    trips.push({
      boxId,
      spec,
      startT,
      approachT,
      pickT: pick.t,
      travelT,
      placeT: place.t,
      endT,
      sourceWorld,
      targetWorld,
      size,
      pickupApproach,
      trailerEntry,
      trailerDrop,
      backoutPos,
    });
  }
  return trips;
}

// ------------------------ Frame evaluation ------------------------

function carriedBoxCenter(forkliftPos: Vec3, yaw: number, liftHeight: number, boxSize: Vec3): Vec3 {
  // Box rides forward of chassis center along the facing direction.
  const fwd = FORK_BOX_OFFSET_FORWARD;
  const cx = forkliftPos[0] + Math.cos(yaw) * fwd;
  const cz = forkliftPos[2] + Math.sin(yaw) * fwd;
  const cy = liftHeight + FORK_BOX_OFFSET_Y + boxSize[2] / 2;
  return [cx, cy, cz];
}

// Single global state machine. Continuous across all trips so the forklift
// never teleports between drop and next pickup.
function evalForkliftGlobal(trips: Trip[], t: number): { state: ForkliftRuntime; activeIdx: number } {
  const facingTruck = 0;            // yaw 0 = +x axis (into trailer)
  const facingStaging = -Math.PI / 2; // yaw -π/2 = -z (toward staging row)
  const FORKLIFT_WAKE_T = 7.5;

  if (trips.length === 0) {
    return {
      state: { position: HOME_POS, yaw: 0, liftHeight: 0, hasBox: false, carriedBoxId: null },
      activeIdx: -1,
    };
  }

  // Identify the current trip: smallest i with t < trips[i].placeT.
  let i = trips.length;
  for (let k = 0; k < trips.length; k++) {
    if (t < trips[k].placeT) { i = k; break; }
  }

  // Case A: before first pickup — travel from home to pickupApproach[0].
  if (i === 0 && t < trips[0].pickT - 0.2) {
    const T0 = FORKLIFT_WAKE_T;
    const T1 = trips[0].pickT - 0.2;
    const k = easeInOut(Math.min(1, Math.max(0, (t - T0) / Math.max(0.001, T1 - T0))));
    const pos = lerpVec3(HOME_POS, trips[0].pickupApproach, k);
    const yaw = lerpAngle(0, facingStaging, k);
    return {
      state: { position: pos, yaw, liftHeight: 0, hasBox: false, carriedBoxId: null },
      activeIdx: 0,
    };
  }

  // Case B: all trips placed — back out + return home.
  if (i === trips.length) {
    const last = trips[trips.length - 1];
    const backoutPos: Vec3 = [last.trailerDrop[0] - 1.2, DOCK_FLOOR_Y, last.trailerDrop[2]];
    const T0 = last.placeT;
    const T1 = T0 + 1.6;
    const k = easeInOut(Math.min(1, Math.max(0, (t - T0) / (T1 - T0))));
    if (k < 0.5) {
      const u = easeInOut(k / 0.5);
      const pos = lerpVec3(last.trailerDrop, backoutPos, u);
      return {
        state: { position: pos, yaw: facingTruck, liftHeight: 0.15 * (1 - u), hasBox: false, carriedBoxId: null },
        activeIdx: trips.length - 1,
      };
    }
    const u = easeInOut((k - 0.5) / 0.5);
    const pos = lerpVec3(backoutPos, HOME_POS, u);
    const yaw = lerpAngle(facingTruck, 0, u);
    return {
      state: { position: pos, yaw, liftHeight: 0, hasBox: false, carriedBoxId: null },
      activeIdx: trips.length - 1,
    };
  }

  const trip = trips[i];
  const prevTrip = i > 0 ? trips[i - 1] : null;

  // Case C: lift at pickup [pickT - 0.2, pickT]
  if (t < trip.pickT) {
    const k = easeInOut((t - (trip.pickT - 0.2)) / 0.2);
    return {
      state: {
        position: trip.pickupApproach,
        yaw: facingStaging,
        liftHeight: 0.15 * k,
        hasBox: false,
        carriedBoxId: null,
      },
      activeIdx: i,
    };
  }

  // Case D: back-away from staging + lift to carry height [pickT, pickT + 0.3]
  if (t < trip.pickT + 0.3) {
    const k = easeInOut((t - trip.pickT) / 0.3);
    const lift = 0.15 + (CARRY_HEIGHT - 0.15) * k;
    const pos: Vec3 = [
      trip.pickupApproach[0],
      DOCK_FLOOR_Y,
      trip.pickupApproach[2] + 0.4 * k,
    ];
    return {
      state: { position: pos, yaw: facingStaging, liftHeight: lift, hasBox: true, carriedBoxId: trip.boxId },
      activeIdx: i,
    };
  }

  // Case E: travel pickup → trailer drop [pickT + 0.3, placeT - 0.15]
  if (t < trip.placeT - 0.15) {
    const T0 = trip.pickT + 0.3;
    const T1 = trip.placeT - 0.15;
    const k = easeInOut(Math.min(1, Math.max(0, (t - T0) / Math.max(0.001, T1 - T0))));
    const startPos: Vec3 = [trip.pickupApproach[0], DOCK_FLOOR_Y, trip.pickupApproach[2] + 0.4];
    const turnPoint: Vec3 = [trip.pickupApproach[0] + 0.5, DOCK_FLOOR_Y, trip.pickupApproach[2] + 0.8];
    let pos: Vec3;
    let yaw: number;
    if (k < 0.30) {
      const u = easeInOut(k / 0.30);
      pos = lerpVec3(startPos, turnPoint, u);
      yaw = lerpAngle(facingStaging, facingTruck, u);
    } else if (k < 0.65) {
      const u = easeInOut((k - 0.30) / 0.35);
      pos = lerpVec3(turnPoint, trip.trailerEntry, u);
      yaw = facingTruck;
    } else {
      const u = easeInOut((k - 0.65) / 0.35);
      pos = lerpVec3(trip.trailerEntry, trip.trailerDrop, u);
      yaw = facingTruck;
    }
    return {
      state: { position: pos, yaw, liftHeight: CARRY_HEIGHT, hasBox: true, carriedBoxId: trip.boxId },
      activeIdx: i,
    };
  }

  // Case F: lower forks [placeT - 0.15, placeT]
  if (t < trip.placeT) {
    const k = easeInOut((t - (trip.placeT - 0.15)) / 0.15);
    const targetBottomY = trip.targetWorld[1] - trip.size[2] / 2;
    const startLift = CARRY_HEIGHT;
    const endLift = Math.max(0.05, targetBottomY - FORK_BOX_OFFSET_Y + PLACE_LIFT_BUFFER);
    const lift = startLift + (endLift - startLift) * k;
    return {
      state: { position: trip.trailerDrop, yaw: facingTruck, liftHeight: lift, hasBox: true, carriedBoxId: trip.boxId },
      activeIdx: i,
    };
  }

  // Unreachable — t < placeT guaranteed by the i search. Safe fallback.
  return {
    state: { position: trip.trailerDrop, yaw: facingTruck, liftHeight: 0, hasBox: false, carriedBoxId: null },
    activeIdx: i,
  };
}

// Inter-trip travel handler: between placeT[i] and pickT[i+1] - 0.2, the
// forklift backs out of the trailer, turns, and drives to the next pickup.
// This is called from evaluateAt when the global search lands "between" trips.
function evalInterTrip(
  fromTrip: Trip,
  toTrip: Trip,
  t: number,
): ForkliftRuntime {
  const facingTruck = 0;
  const facingStaging = -Math.PI / 2;
  const backoutPos: Vec3 = [fromTrip.trailerDrop[0] - 1.2, DOCK_FLOOR_Y, fromTrip.trailerDrop[2]];
  const T0 = fromTrip.placeT;
  const T1 = toTrip.pickT - 0.2;
  const k = easeInOut(Math.min(1, Math.max(0, (t - T0) / Math.max(0.001, T1 - T0))));

  // Three sub-phases: back-out, swing to via-point, approach next pickup.
  if (k < 0.30) {
    const u = easeInOut(k / 0.30);
    const pos = lerpVec3(fromTrip.trailerDrop, backoutPos, u);
    return { position: pos, yaw: facingTruck, liftHeight: 0.15 * (1 - u), hasBox: false, carriedBoxId: null };
  }
  const viaPoint: Vec3 = [
    (backoutPos[0] + toTrip.pickupApproach[0]) / 2,
    DOCK_FLOOR_Y,
    Math.min(-1.8, (backoutPos[2] + toTrip.pickupApproach[2]) / 2),
  ];
  if (k < 0.70) {
    const u = easeInOut((k - 0.30) / 0.40);
    const pos = lerpVec3(backoutPos, viaPoint, u);
    const yaw = lerpAngle(facingTruck, facingStaging, u);
    return { position: pos, yaw, liftHeight: 0, hasBox: false, carriedBoxId: null };
  }
  const u = easeInOut((k - 0.70) / 0.30);
  const pos = lerpVec3(viaPoint, toTrip.pickupApproach, u);
  return { position: pos, yaw: facingStaging, liftHeight: 0, hasBox: false, carriedBoxId: null };
}

export function evaluateAt(trips: Trip[], t: number, _truckWidth: number): FrameState {
  const boxes = new Map<number, BoxRuntime>();
  let placedCount = 0;
  let placedVolume = 0;

  for (const trip of trips) {
    const size = trip.size;
    if (t >= trip.placeT) {
      boxes.set(trip.boxId, {
        position: trip.targetWorld,
        rotationY: 0,
        visible: true,
        state: "placed",
      });
      placedCount++;
      placedVolume += size[0] * size[1] * size[2];
    } else if (t >= trip.pickT) {
      // Carried — position overwritten below.
      boxes.set(trip.boxId, {
        position: trip.sourceWorld,
        rotationY: 0,
        visible: true,
        state: "carried",
      });
    } else {
      boxes.set(trip.boxId, {
        position: trip.sourceWorld,
        rotationY: 0,
        visible: true,
        state: "staging",
      });
    }
  }

  // Decide if we're inside a trip's pickup→drop window or in the inter-trip
  // gap between two trips. The global eval handles all in-trip phases; the
  // inter-trip helper covers the placeT[i] → pickT[i+1] - 0.2 transit.
  let forklift: ForkliftRuntime;
  let activeIdx = -1;

  // Inter-trip search: is there a (fromTrip, toTrip) such that
  // placeT[from] <= t < pickT[to] - 0.2?
  let interFrom = -1;
  for (let k = 0; k + 1 < trips.length; k++) {
    if (t >= trips[k].placeT && t < trips[k + 1].pickT - 0.2) {
      interFrom = k;
      break;
    }
  }

  if (interFrom >= 0) {
    forklift = evalInterTrip(trips[interFrom], trips[interFrom + 1], t);
    activeIdx = interFrom + 1;
  } else {
    const r = evalForkliftGlobal(trips, t);
    forklift = r.state;
    activeIdx = r.activeIdx;
  }

  // Snap carried box onto the forks. During the final 0.15s before placeT
  // (the lower-forks phase), smoothly lerp from forklift position to the
  // true target so the box ends up at its real target z even though the
  // forklift stayed in the safe corridor.
  if (forklift.carriedBoxId !== null && activeIdx >= 0) {
    const trip = trips[activeIdx];
    const onForks = carriedBoxCenter(forklift.position, forklift.yaw, forklift.liftHeight, trip.size);
    const placeBlendStart = trip.placeT - 0.15;
    let position: Vec3 = onForks;
    if (t >= placeBlendStart) {
      const k = easeInOut(Math.min(1, Math.max(0, (t - placeBlendStart) / 0.15)));
      position = lerpVec3(onForks, trip.targetWorld, k);
    }
    boxes.set(trip.boxId, {
      position,
      rotationY: forklift.yaw,
      visible: true,
      state: "carried",
    });
  }

  return { forklift, boxes, metrics: { placedCount, placedVolumeMeters: placedVolume } };
}
