# Smart Truck Loading — RL Simulation

Reinforcement-learning-powered 3D bin packing for truck loading, rendered as a cinematic warehouse simulation in the browser.

## Architecture

- **Training**: Headless Python env (Gymnasium) trained with Maskable PPO. Fast, no rendering.
- **Trace**: Trained policy rolls out one episode → `trace.json` (a timeline of pick/place events).
- **Renderer**: Three.js + React Three Fiber app reads the trace and plays it back with cinematic camera, industrial lighting, and a forklift AGV animation.

Training and rendering are decoupled. The RL agent never sees the pretty visuals — it learns from a fast height-map observation. The renderer is a deterministic replay.

## Quick start

### 1. Python side (training + trace)

```powershell
# from project root
python -m venv .venv
. .\.venv\Scripts\Activate.ps1
pip install -e .

# sanity check the env (random agent)
python -m src.env.truck_packing_env

# train (writes checkpoints/ and tensorboard logs)
python -m src.agent.train

# generate a trace from the latest checkpoint
python -m src.trace.recorder --checkpoint checkpoints/best.zip --out renderer/public/traces/latest.json
```

### 2. Renderer (web)

```powershell
cd renderer
npm install
npm run dev
# open http://localhost:5173
```

The renderer loads `public/traces/latest.json` by default. A sample trace ships in the repo so you can preview the renderer before training finishes.

## Project structure

```
configs/    # env, training, curriculum YAMLs
src/        # Python: env, agent, trace recorder, analytics
renderer/   # Three.js + R3F web app
traces/     # generated episode traces (gitignored)
checkpoints/# trained policies (gitignored)
assets/     # 3D models (GLB) and textures
scripts/    # convenience scripts
```

## Design notes

See `docs/` (and inline docstrings in each module) for the full design — state space, action space, reward shaping, training curriculum, and camera shot list.
