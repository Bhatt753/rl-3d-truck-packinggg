"""Quick smoke: load policy.onnx, run a single inference, compare against the
PyTorch model on the same input. Tolerance loose because of fp32 + graph
rewrites."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np
import onnxruntime as ort
import torch
from sb3_contrib import MaskablePPO

from src.agent.export_onnx import _PolicyWrapper
from src.env import TruckPackingEnv


def main():
    env = TruckPackingEnv(seed=0)
    obs, _ = env.reset(seed=0)
    h = obs["height_map"][None].astype(np.float32)
    q = obs["box_queue"][None].astype(np.float32)
    s = obs["stats"][None].astype(np.float32)

    # PyTorch ref.
    model = MaskablePPO.load("checkpoints/best_model.zip", device="cpu")
    wrapper = _PolicyWrapper(model.policy).eval()
    with torch.no_grad():
        logits_pt = wrapper(
            torch.from_numpy(h), torch.from_numpy(q), torch.from_numpy(s)
        ).numpy()

    # ONNX.
    sess = ort.InferenceSession("assets/policy.onnx", providers=["CPUExecutionProvider"])
    logits_onnx = sess.run(None, {"height_map": h, "box_queue": q, "stats": s})[0]

    diff = np.abs(logits_pt - logits_onnx).max()
    print(f"logits shape: pt={logits_pt.shape} onnx={logits_onnx.shape}")
    print(f"argmax pt={int(logits_pt.argmax())} onnx={int(logits_onnx.argmax())}")
    print(f"max abs diff: {diff:.6f}")
    assert diff < 1e-3, "ONNX output diverges from PyTorch reference"
    print("ONNX parity: OK")


if __name__ == "__main__":
    main()
