"""Episode-level metrics independent of the env (so we can compare runs)."""
from __future__ import annotations

import numpy as np


def utilization(grid: np.ndarray) -> float:
    return float(grid.sum()) / float(grid.size)


def fragmentation(grid: np.ndarray) -> float:
    """Crude fragmentation: empty cells fully enclosed (or under the pile)
    divided by total empty cells. High = bad."""
    empty = (grid == 0)
    if not empty.any():
        return 0.0
    # An empty cell is "trapped" if there is at least one filled cell above it
    # along z.
    cx, cy, cz = grid.shape
    trapped = np.zeros_like(empty, dtype=bool)
    occupied_above = np.cumsum(grid[:, :, ::-1], axis=2)[:, :, ::-1] - grid
    trapped = empty & (occupied_above > 0)
    return float(trapped.sum()) / float(empty.sum())


def support_score(placements: list[dict]) -> float:
    if not placements:
        return 0.0
    return float(np.mean([p["support"] for p in placements]))


def summarize(grid: np.ndarray, placements: list[dict]) -> dict:
    return {
        "utilization": utilization(grid),
        "fragmentation": fragmentation(grid),
        "support_mean": support_score(placements),
        "boxes_placed": len(placements),
    }
