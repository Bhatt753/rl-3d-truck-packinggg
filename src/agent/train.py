"""Train Maskable PPO on TruckPackingEnv.

Run from project root:
    python -m src.agent.train
    python -m src.agent.train --config configs/train_ppo.yaml
"""
from __future__ import annotations

import argparse
from pathlib import Path

import yaml
from sb3_contrib import MaskablePPO
from sb3_contrib.common.maskable.callbacks import MaskableEvalCallback
from sb3_contrib.common.maskable.utils import get_action_masks
from sb3_contrib.common.wrappers import ActionMasker
from stable_baselines3.common.callbacks import CheckpointCallback
from stable_baselines3.common.monitor import Monitor
from stable_baselines3.common.vec_env import SubprocVecEnv, DummyVecEnv

from src.env import TruckPackingEnv
from src.agent.policy import TruckFeaturesExtractor


PROJECT_ROOT = Path(__file__).resolve().parents[2]


def mask_fn(env: TruckPackingEnv):
    return env.action_masks()


def make_env(seed: int = 0, eval_env: bool = False):
    def _init():
        env = TruckPackingEnv(seed=seed)
        env = ActionMasker(env, mask_fn)
        env = Monitor(env)
        return env
    return _init


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", default=str(PROJECT_ROOT / "configs" / "train_ppo.yaml"))
    parser.add_argument("--resume", default=None, help="checkpoint .zip to resume from")
    parser.add_argument("--quick", action="store_true", help="short run for smoke-testing")
    parser.add_argument("--steps", type=int, default=None, help="override total timesteps")
    parser.add_argument("--n-envs", type=int, default=None, help="override n_envs")
    args = parser.parse_args()

    with open(args.config, "r", encoding="utf-8") as f:
        cfg = yaml.safe_load(f)

    n_envs = int(cfg["n_envs"])
    if args.quick:
        n_envs = 2
        cfg["total_timesteps"] = 20_000
        cfg["eval"]["freq"] = 5_000
    if args.steps is not None:
        cfg["total_timesteps"] = int(args.steps)
        # Scale eval freq so we still get 4-8 evals during the run.
        cfg["eval"]["freq"] = max(2_500, int(args.steps) // 8)
    if args.n_envs is not None:
        n_envs = int(args.n_envs)

    seed = int(cfg.get("seed", 42))
    vec_cls = SubprocVecEnv if n_envs > 1 else DummyVecEnv
    train_env = vec_cls([make_env(seed + i) for i in range(n_envs)])
    # MaskableEvalCallback warns when train/eval env types differ. Match types.
    eval_env = vec_cls([make_env(seed + 999, eval_env=True)])

    log_dir = PROJECT_ROOT / cfg["logging"]["tensorboard_dir"]
    ckpt_dir = PROJECT_ROOT / cfg["logging"]["checkpoint_dir"]
    log_dir.mkdir(parents=True, exist_ok=True)
    ckpt_dir.mkdir(parents=True, exist_ok=True)

    policy_kwargs = dict(
        features_extractor_class=TruckFeaturesExtractor,
        features_extractor_kwargs=dict(
            features_dim=int(cfg["policy"]["features_dim"]),
            cnn_channels=tuple(cfg["policy"]["cnn_channels"]),
            mlp_hidden=tuple(cfg["policy"]["mlp_hidden"]),
        ),
        net_arch=dict(pi=[128], vf=[128]),
    )

    ppo_kwargs = dict(
        learning_rate=float(cfg["ppo"]["learning_rate"]),
        n_steps=int(cfg["ppo"]["n_steps"]),
        batch_size=int(cfg["ppo"]["batch_size"]),
        n_epochs=int(cfg["ppo"]["n_epochs"]),
        gamma=float(cfg["ppo"]["gamma"]),
        gae_lambda=float(cfg["ppo"]["gae_lambda"]),
        clip_range=float(cfg["ppo"]["clip_range"]),
        ent_coef=float(cfg["ppo"]["ent_coef"]),
        vf_coef=float(cfg["ppo"]["vf_coef"]),
        max_grad_norm=float(cfg["ppo"]["max_grad_norm"]),
        tensorboard_log=str(log_dir),
        verbose=1,
        policy_kwargs=policy_kwargs,
    )

    if args.resume:
        # MaskablePPO.load takes only env/device/custom_objects — not full kwargs.
        # Tensorboard log is set as an attribute below since load() preserves
        # original hyperparams.
        model = MaskablePPO.load(args.resume, env=train_env, device="auto")
        model.tensorboard_log = str(log_dir)
    else:
        model = MaskablePPO("MultiInputPolicy", train_env, **ppo_kwargs)

    callbacks = [
        CheckpointCallback(
            save_freq=max(1, int(cfg["logging"]["checkpoint_freq"]) // n_envs),
            save_path=str(ckpt_dir),
            name_prefix="ppo",
        ),
        MaskableEvalCallback(
            eval_env,
            best_model_save_path=str(ckpt_dir),
            log_path=str(log_dir / "eval"),
            eval_freq=max(1, int(cfg["eval"]["freq"]) // n_envs),
            n_eval_episodes=int(cfg["eval"]["n_episodes"]),
            deterministic=True,
        ),
    ]

    model.learn(total_timesteps=int(cfg["total_timesteps"]), callback=callbacks)
    model.save(str(ckpt_dir / "final"))
    print(f"Saved final model to {ckpt_dir / 'final.zip'}")


if __name__ == "__main__":
    main()
