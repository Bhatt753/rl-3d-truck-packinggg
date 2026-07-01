"""Generate a deterministic sample trace using the masked-random baseline.

Run once after installing Python deps:
    python scripts/make_sample_trace.py

The output ships with the repo so the renderer works before any training.
"""
import sys
from pathlib import Path

# Allow running without `pip install -e .`
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.trace.recorder import record


if __name__ == "__main__":
    out = Path("renderer/public/traces/sample.json")
    record(checkpoint=None, out_path=out, seed=7)
    # Also seed latest.json with the same content so a fresh checkout demos.
    latest = Path("renderer/public/traces/latest.json")
    if not latest.exists():
        latest.write_bytes(out.read_bytes())
        print(f"Seeded {latest}")
