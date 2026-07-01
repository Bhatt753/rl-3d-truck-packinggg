// Scripted camera rig — reads the trace's camera cues and tweens between
// preset shots. Shot positions assume:
//   - Trailer rear at world x = 0.4, trailer extends in +x to ~14
//   - Dock floor (where forklift operates) at y = 1.10
//   - Outdoor ground (where truck wheels are) at y = 0
// The eight named shots fulfill the side / overhead / loading roles.

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import type { FrameState } from "../animation/timeline";
import { DOCK_FLOOR_Y, TRAILER_LENGTH, TRAILER_REAR_X } from "../scene/constants";
import type { CameraCue, TruckInfo } from "../trace/schema";

interface Shot {
  pos: THREE.Vector3;
  lookAt: THREE.Vector3;
  fov: number;
}

interface FollowState {
  forkliftPos: THREE.Vector3 | null;
}

function shotForCue(
  cue: CameraCue,
  _truck: TruckInfo,
  progress: number,
  follow: FollowState,
): Shot {
  const trailerMidX = TRAILER_REAR_X + TRAILER_LENGTH / 2;          // ~7.2
  const trailerMid = new THREE.Vector3(trailerMidX, DOCK_FLOOR_Y + 1.4, 0);
  const dockEntry = new THREE.Vector3(TRAILER_REAR_X + 0.5, DOCK_FLOOR_Y + 0.6, -0.5);

  switch (cue.shot) {
    case "establish":
      // Big wide of the whole dock + truck.
      return {
        pos: new THREE.Vector3(22, 9.5, 14),
        lookAt: new THREE.Vector3(8, 1.8, -0.5),
        fov: 40,
      };

    case "truck_approach": {
      // Stationary high camera; lookAt pans with the truck (which moves from
      // far +x toward TRAILER_REAR_X).
      const truckX = 22 - progress * 14; // ~22 → 8
      return {
        pos: new THREE.Vector3(18, 5.0, 13),
        lookAt: new THREE.Vector3(truckX, 2.0, 1.0),
        fov: 38,
      };
    }

    case "dock_align":
      // ----- SIDE VIEW shot -----
      // Direct profile of the trailer parking at the dock — covers the
      // full ~13 m length so the whole truck is visible.
      return {
        pos: new THREE.Vector3(7.0, 3.5, 14.5),
        lookAt: new THREE.Vector3(7.0, 2.0, 0),
        fov: 50,
      };

    case "forklift_close": {
      // ----- LOADING VIEW (dynamic) -----
      // Elevated chase-cam framing the forklift and its immediate action.
      // The camera is high enough to always see over the trailer roof
      // (which is at y≈3.6) so it never clips into the cargo box.
      const fp = follow.forkliftPos;
      if (fp) {
        // Stay on the staging side (-z) of the truck to avoid the trailer
        // body, and a couple meters above its roof so we look down.
        const camZ = Math.min(fp.z - 3.5, -2.5);
        return {
          pos: new THREE.Vector3(fp.x + 2.5, DOCK_FLOOR_Y + 4.2, camZ),
          lookAt: new THREE.Vector3(fp.x, DOCK_FLOOR_Y + 0.5, fp.z + 0.2),
          fov: 44,
        };
      }
      return {
        pos: new THREE.Vector3(5.5, 5.5, -5.5),
        lookAt: new THREE.Vector3(2.5, 1.4, -2.4),
        fov: 44,
      };
    }

    case "over_shoulder": {
      // Higher drone-style follow that frames the staging-to-trailer loop.
      // Always positioned on the staging side (-z) and above the trailer
      // roof so the trailer body never occludes the forklift.
      const fp = follow.forkliftPos;
      if (fp) {
        const camZ = Math.min(fp.z - 4.5, -3.5);
        return {
          pos: new THREE.Vector3(fp.x + 3.5, DOCK_FLOOR_Y + 5.0, camZ),
          lookAt: new THREE.Vector3(fp.x - 0.5, DOCK_FLOOR_Y + 0.6, fp.z + 0.5),
          fov: 46,
        };
      }
      return {
        pos: new THREE.Vector3(8.5, 5.5, -5.0),
        lookAt: new THREE.Vector3(2.0, 1.4, -1.0),
        fov: 42,
      };
    }

    case "top_down": {
      // ----- OVERHEAD VIEW shot -----
      // Drone-style pan along the trailer length looking straight down into
      // the cargo bay. (Camera renders with layer 1 disabled → roof hidden.)
      const x = TRAILER_REAR_X + 0.8 + progress * (TRAILER_LENGTH - 2.0);
      return {
        pos: new THREE.Vector3(x, 8.5, 1.6),
        lookAt: new THREE.Vector3(x, DOCK_FLOOR_Y + 0.4, -0.3),
        fov: 46,
      };
    }

    case "orbit": {
      const a = -Math.PI * 0.20 + progress * Math.PI * 0.55;
      const r = 14.0;
      return {
        pos: new THREE.Vector3(
          trailerMid.x + Math.cos(a) * r,
          5.5,
          Math.sin(a) * r,
        ),
        lookAt: trailerMid,
        fov: 36,
      };
    }

    case "final_pullback":
      return {
        pos: new THREE.Vector3(10 + progress * 9, 4.0 + progress * 3, 9 + progress * 4),
        lookAt: trailerMid,
        fov: 34,
      };
  }
  void dockEntry;
  return {
    pos: new THREE.Vector3(18, 7, 13),
    lookAt: trailerMid,
    fov: 36,
  };
}

function easeInOut(t: number) {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

export function CinematicRig({
  cues,
  truck,
  timeRef,
  frameStateRef,
}: {
  cues: CameraCue[];
  truck: TruckInfo;
  timeRef: { current: number };
  frameStateRef?: { current: FrameState };
}) {
  const { camera } = useThree();
  const persp = camera as THREE.PerspectiveCamera;
  const sorted = useMemo(() => [...cues].sort((a, b) => a.t - b.t), [cues]);
  // Smoothed forklift tracking position. Updated each frame from frameStateRef
  // but lerped, so the follow camera doesn't jitter on sudden direction
  // changes.
  const smoothedForkliftPos = useRef(new THREE.Vector3(4.5, DOCK_FLOOR_Y, -2.5));

  useEffect(() => {
    persp.up.set(0, 1, 0);
    persp.layers.enableAll();
    persp.far = 250;
    persp.updateProjectionMatrix();
  }, [persp]);

  useFrame(() => {
    const now = timeRef.current;
    let active: CameraCue = sorted[0] ?? { t: 0, shot: "establish", duration: 4 };
    let next: CameraCue | null = null;
    for (let i = 0; i < sorted.length; i++) {
      if (sorted[i].t <= now) active = sorted[i];
      else { next = sorted[i]; break; }
    }
    const localProgress = Math.max(0, Math.min(1, (now - active.t) / Math.max(0.001, active.duration)));

    // Smooth the forklift tracking position used by dynamic shots.
    const fp = frameStateRef?.current?.forklift?.position;
    if (fp) {
      smoothedForkliftPos.current.lerp(
        new THREE.Vector3(fp[0], fp[1], fp[2]),
        0.10,
      );
    }
    const follow: FollowState = {
      forkliftPos: frameStateRef ? smoothedForkliftPos.current : null,
    };
    const aShot = shotForCue(active, truck, localProgress, follow);

    // Layer 1 = trailer roof, hidden during top-down so we see the cargo.
    // Layer 2 = the -z trailer sidewall (the one between camera and forklift
    // during dynamic close-ups), hidden so the forklift loop stays visible.
    if (active.shot === "top_down") persp.layers.disable(1);
    else persp.layers.enable(1);
    if (active.shot === "forklift_close" || active.shot === "over_shoulder") {
      persp.layers.disable(2);
    } else {
      persp.layers.enable(2);
    }

    const pos = aShot.pos.clone();
    const look = aShot.lookAt.clone();
    let fov = aShot.fov;

    if (next) {
      const blendStart = active.t + active.duration - 0.8;
      if (now > blendStart) {
        const k = easeInOut((now - blendStart) / 0.8);
        const nShot = shotForCue(next, truck, 0, follow);
        pos.lerp(nShot.pos, k);
        look.lerp(nShot.lookAt, k);
        fov = fov * (1 - k) + nShot.fov * k;
      }
    }

    persp.position.lerp(pos, 0.20);
    const m = new THREE.Matrix4().lookAt(persp.position, look, persp.up);
    const q = new THREE.Quaternion().setFromRotationMatrix(m);
    persp.quaternion.slerp(q, 0.22);
    if (Math.abs(persp.fov - fov) > 0.05) {
      persp.fov = persp.fov * 0.85 + fov * 0.15;
      persp.updateProjectionMatrix();
    }
  });

  return null;
}
