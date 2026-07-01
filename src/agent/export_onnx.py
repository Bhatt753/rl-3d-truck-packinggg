"""Export trained Maskable PPO actor to ONNX for cross-language inference."""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

# Windows cp1252 stdout can't encode the checkmark torch.onnx prints on success.
# Force UTF-8 before importing torch.onnx.
if sys.platform == "win32":
    os.environ.setdefault("PYTHONIOENCODING", "utf-8")
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except (AttributeError, OSError):
        pass

import torch
from sb3_contrib import MaskablePPO

from src.env import TruckPackingEnv


class _PolicyWrapper(torch.nn.Module):
    """Wraps the SB3 policy so that inputs/outputs are clean tensors.

    Inputs:  height_map (B, 1, X, Y), box_queue (B, K, 5), stats (B, 4)
    Output:  action logits (B, A)
    """

    def __init__(self, sb3_policy):
        super().__init__()
        self.policy = sb3_policy

    def forward(self, height_map, box_queue, stats):
        obs = {"height_map": height_map, "box_queue": box_queue, "stats": stats}
        # SB3 MaskableActorCriticPolicy exposes `evaluate_actions` and the distribution.
        # Easiest: run the features extractor + action net manually.
        features = self.policy.extract_features(obs)
        latent_pi = self.policy.mlp_extractor.forward_actor(features)
        return self.policy.action_net(latent_pi)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--checkpoint", required=True)
    parser.add_argument("--out", default="assets/policy.onnx")
    args = parser.parse_args()

    env = TruckPackingEnv()
    model = MaskablePPO.load(args.checkpoint, device="cpu")
    wrapper = _PolicyWrapper(model.policy).eval()

    cells_x, cells_y = env.cells_x, env.cells_y
    K = env.lookahead
    dummy_h = torch.zeros(1, 1, cells_x, cells_y)
    dummy_q = torch.zeros(1, K, 5)
    dummy_s = torch.zeros(1, 4)

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    # PyTorch 2.12+ uses the dynamo-based exporter. dynamic_axes is deprecated
    # in favor of dynamic_shapes (a per-input spec).
    batch = torch.export.Dim("batch")
    dynamic_shapes = {
        "height_map": {0: batch},
        "box_queue": {0: batch},
        "stats": {0: batch},
    }
    torch.onnx.export(
        wrapper,
        (dummy_h, dummy_q, dummy_s),
        str(out),
        input_names=["height_map", "box_queue", "stats"],
        output_names=["logits"],
        opset_version=18,
        dynamic_shapes=dynamic_shapes,
    )
    print(f"Wrote {out}")


if __name__ == "__main__":
    main()
