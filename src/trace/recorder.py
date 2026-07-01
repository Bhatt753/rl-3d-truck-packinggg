"""Roll out a trained policy and emit a renderer-friendly trace.json.

The trace covers:
  - truck info (dims, in meters)
  - per-box specs (so renderer can pre-load geometry)
  - pick / place events with continuous timestamps
  - cinematic camera cues at scripted timestamps
  - final metrics card

Usage:
    python -m src.trace.recorder --checkpoint checkpoints/best.zip \
        --out renderer/public/traces/latest.json

If --checkpoint is omitted, a random masked agent is used (handy before
training has finished). Output still looks "agent-y" because masking removes
the most obvious garbage actions.
"""
from __future__ import annotations

import argparse
import json
from dataclasses import asdict
from pathlib import Path
from typing import Optional

import numpy as np

from src.env import TruckPackingEnv
from src.env.physics import ORIENTATIONS
from src.trace.schema import (
    BoxSpec,
    CameraCue,
    Metrics,
    PickEvent,
    PlaceEvent,
    TruckInfo,
)


PROJECT_ROOT = Path(__file__).resolve().parents[2]


# Timing (seconds) — the renderer reads these directly. Tune to taste.
TRUCK_APPROACH_S = 4.0
DOCK_PARK_S = 7.0
FIRST_PICK_S = 10.0       # truck parked + forklift in position
PICK_PLACE_S = 1.8        # full pickup→place cycle (renderer has 1×/2×/4×)
PLACE_OFFSET_S = 1.2      # within each cycle, time from pick to place event
FINAL_HOLD_S = 6.0


def _staging_position(box_idx_in_episode: int, truck_length_m: float, truck_width_m: float):
    """Lay boxes out in a neat staging grid alongside the parked truck.

    Coordinate convention here is renderer-world coords (in meters):
        x = along truck length (truck rear at +0.4, front at +0.4 + length)
        y = lateral (truck cargo centered at 0; staging on the -y side)
        z = height above floor
    """
    row = box_idx_in_episode // 10
    col = box_idx_in_episode % 10
    x = 1.5 + col * 0.55
    y = -(truck_width_m / 2 + 1.4) - row * 0.55
    z = 0.4
    return (x, y, z)


def _cinematic_cues(start_s: float, total_load_s: float, end_s: float) -> list[CameraCue]:
    """Build cue list that covers the entire trace duration without gaps.

    The bulk of loading is shown via a slow top-down pan whose duration is
    sized to fill the time between the establishing intro and the final
    orbit/pullback wrap-up.
    """
    intro_end = max(start_s - 1.0, 8.0)  # dock_align ends a touch before first pick
    forklift_close_end = start_s + 4.5
    over_shoulder_end = forklift_close_end + 9.0
    orbit_start = end_s - FINAL_HOLD_S
    top_down_duration = max(6.0, orbit_start - over_shoulder_end)

    return [
        CameraCue(t=0.0, shot="establish", duration=4.0),
        CameraCue(t=4.0, shot="truck_approach", duration=3.0),
        CameraCue(t=7.0, shot="dock_align", duration=max(0.1, intro_end - 7.0)),
        CameraCue(t=intro_end, shot="forklift_close", duration=forklift_close_end - intro_end),
        CameraCue(t=forklift_close_end, shot="over_shoulder", duration=9.0),
        CameraCue(t=over_shoulder_end, shot="top_down", duration=top_down_duration),
        CameraCue(t=orbit_start, shot="orbit", duration=3.0),
        CameraCue(t=end_s - 3.0, shot="final_pullback", duration=3.0),
    ]


def record(
    checkpoint: Optional[str],
    out_path: Path,
    seed: int = 7,
) -> dict:
    env = TruckPackingEnv(seed=seed)

    # Policy or random-masked baseline.
    use_policy = bool(checkpoint)
    model = None
    if use_policy:
        from sb3_contrib import MaskablePPO  # imported lazily
        model = MaskablePPO.load(checkpoint, device="cpu")

    obs, _ = env.reset(seed=seed)
    queue_initial = list(env.queue)  # preserve original boxes for the renderer

    pick_events: list[PickEvent] = []
    place_events: list[PlaceEvent] = []

    # Walk the episode, emitting events with simulated timestamps.
    t = FIRST_PICK_S
    placement_idx = 0
    terminated = False
    while not terminated:
        mask = env.action_masks()
        if not mask.any():
            break
        if use_policy and model is not None:
            action, _ = model.predict(obs, action_masks=mask, deterministic=True)
            action = int(action)
        else:
            rng = np.random.default_rng(seed + placement_idx)
            action = int(rng.choice(np.flatnonzero(mask)))

        # The env mutates queue when we step; capture the chosen box BEFORE.
        from src.env.observation import decode_action
        box_idx_in_visible, orient, x, y = decode_action(
            action, env.lookahead, len(ORIENTATIONS), env.cells_x, env.cells_y
        )
        chosen_box = env.queue[box_idx_in_visible]

        obs, r, terminated, truncated, info = env.step(action)

        # Translate grid placement → meters in truck-local space.
        place = info["placement"]
        res = env.resolution
        target_m = (place["x"] * res, place["y"] * res, place["z"] * res)
        size_m = (place["dx"] * res, place["dy"] * res, place["dz"] * res)

        src = _staging_position(
            placement_idx, env.cfg["truck"]["length"], env.cfg["truck"]["width"]
        )
        pick_events.append(PickEvent(t=t, type="pick", box_id=chosen_box.id, source=src))
        place_events.append(
            PlaceEvent(
                t=t + PLACE_OFFSET_S,
                type="place",
                box_id=chosen_box.id,
                target=target_m,
                size=size_m,
                orient=orient,
            )
        )
        t += PICK_PLACE_S
        placement_idx += 1

    total_load_s = t - FIRST_PICK_S
    end_s = t + FINAL_HOLD_S

    # Build the full doc.
    truck_info = TruckInfo(
        length_m=env.cfg["truck"]["length"],
        width_m=env.cfg["truck"]["width"],
        height_m=env.cfg["truck"]["height"],
        resolution_m=env.resolution,
        cells=(env.cells_x, env.cells_y, env.cells_z),
    )
    res = env.resolution
    box_specs = [
        BoxSpec(
            id=b.id,
            l_m=b.l * res,
            w_m=b.w * res,
            h_m=b.h * res,
            fragile=b.fragile,
        )
        for b in queue_initial
    ]
    metrics = Metrics(
        utilization=env.grid.utilization() if env.grid else 0.0,
        boxes_placed=env.boxes_placed,
        boxes_total=env.queue_total,
        duration_s=end_s,
    )

    events = []
    for e in pick_events + place_events:
        events.append(asdict(e))
    events.sort(key=lambda e: e["t"])

    doc = {
        "version": 1,
        "truck": asdict(truck_info),
        "boxes": [asdict(b) for b in box_specs],
        "events": events,
        "camera": [asdict(c) for c in _cinematic_cues(FIRST_PICK_S, total_load_s, end_s)],
        "metrics": asdict(metrics),
        "policy": "trained" if use_policy else "random_masked",
    }

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(doc, f, indent=2)
    print(f"Wrote {out_path} — utilization {metrics.utilization:.1%}, "
          f"{metrics.boxes_placed}/{metrics.boxes_total} boxes")
    return doc


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--checkpoint", default=None)
    parser.add_argument(
        "--out",
        default=str(PROJECT_ROOT / "renderer" / "public" / "traces" / "latest.json"),
    )
    parser.add_argument("--seed", type=int, default=7)
    args = parser.parse_args()
    record(args.checkpoint, Path(args.out), seed=args.seed)


if __name__ == "__main__":
    main()
