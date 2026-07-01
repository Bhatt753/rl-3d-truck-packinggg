"""Evaluate a trained policy across N episodes; report packing metrics."""
from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
from sb3_contrib import MaskablePPO
from sb3_contrib.common.maskable.utils import get_action_masks
from sb3_contrib.common.wrappers import ActionMasker

from src.env import TruckPackingEnv


PROJECT_ROOT = Path(__file__).resolve().parents[2]


def _mask_fn(env: TruckPackingEnv):
    return env.action_masks()


def evaluate(checkpoint: str, episodes: int = 20, seed: int = 1234) -> dict:
    env = TruckPackingEnv(seed=seed)
    env_masked = ActionMasker(env, _mask_fn)
    model = MaskablePPO.load(checkpoint, env=env_masked)

    utils, counts, rewards = [], [], []
    for ep in range(episodes):
        obs, _ = env_masked.reset(seed=seed + ep)
        terminated = truncated = False
        ep_r = 0.0
        while not (terminated or truncated):
            masks = get_action_masks(env_masked)
            action, _ = model.predict(obs, action_masks=masks, deterministic=True)
            obs, r, terminated, truncated, _ = env_masked.step(int(action))
            ep_r += float(r)
        utils.append(env.grid.utilization() if env.grid else 0.0)
        counts.append(env.boxes_placed)
        rewards.append(ep_r)

    return {
        "episodes": episodes,
        "utilization_mean": float(np.mean(utils)),
        "utilization_std": float(np.std(utils)),
        "boxes_placed_mean": float(np.mean(counts)),
        "reward_mean": float(np.mean(rewards)),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--checkpoint", required=True)
    parser.add_argument("--episodes", type=int, default=20)
    args = parser.parse_args()
    result = evaluate(args.checkpoint, episodes=args.episodes)
    print(result)


if __name__ == "__main__":
    main()
