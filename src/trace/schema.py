"""Shared schema for episode traces consumed by the R3F renderer.

A trace is a small JSON document. All positions are in meters in renderer
world space (truck-local origin = rear-floor-center of the cargo area).

Events are ordered by `t` (seconds since the simulation start). The renderer
keys all animations off these timestamps.
"""
from __future__ import annotations

from dataclasses import dataclass, asdict
from typing import Literal


@dataclass
class TruckInfo:
    length_m: float
    width_m: float
    height_m: float
    resolution_m: float
    cells: tuple[int, int, int]


@dataclass
class BoxSpec:
    id: int
    l_m: float
    w_m: float
    h_m: float
    fragile: bool


@dataclass
class PickEvent:
    t: float
    type: Literal["pick"]
    box_id: int
    source: tuple[float, float, float]  # staging area world coords


@dataclass
class PlaceEvent:
    t: float
    type: Literal["place"]
    box_id: int
    target: tuple[float, float, float]  # truck-local corner (min-x, min-y, min-z)
    size: tuple[float, float, float]    # final oriented (dx, dy, dz) in meters
    orient: int


@dataclass
class CameraCue:
    t: float
    shot: Literal[
        "establish",
        "truck_approach",
        "dock_align",
        "forklift_close",
        "over_shoulder",
        "top_down",
        "orbit",
        "final_pullback",
    ]
    duration: float


@dataclass
class Metrics:
    utilization: float
    boxes_placed: int
    boxes_total: int
    duration_s: float


def event_to_dict(e) -> dict:
    return asdict(e)
