"""Benchmark the env's step + mask computation."""
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np

from src.env.truck_packing_env import TruckPackingEnv


def main():
    env = TruckPackingEnv(seed=0)
    rng = np.random.default_rng(0)

    obs, _ = env.reset(seed=0)
    t0 = time.perf_counter()
    n_steps = 0
    target = 1000
    while n_steps < target:
        mask = env.action_masks()
        valid = np.flatnonzero(mask)
        if valid.size == 0:
            obs, _ = env.reset()
            continue
        a = int(rng.choice(valid))
        obs, r, term, trunc, info = env.step(a)
        n_steps += 1
        if term or trunc:
            obs, _ = env.reset()
    dt = time.perf_counter() - t0
    print(f"{n_steps} env steps in {dt:.2f}s -> {n_steps / dt:.0f} steps/sec")


if __name__ == "__main__":
    main()
