"""Feature extractor for the Dict observation.

Height map → small CNN.
Box queue + stats → MLP.
Concatenated → policy + value heads (handled by sb3-contrib MaskableActorCriticPolicy).
"""
from __future__ import annotations

import torch
import torch.nn as nn
from gymnasium import spaces
from stable_baselines3.common.torch_layers import BaseFeaturesExtractor


class TruckFeaturesExtractor(BaseFeaturesExtractor):
    def __init__(
        self,
        observation_space: spaces.Dict,
        features_dim: int = 256,
        cnn_channels: tuple[int, ...] = (32, 64, 64),
        mlp_hidden: tuple[int, ...] = (256, 256),
    ):
        super().__init__(observation_space, features_dim=features_dim)
        h_shape = observation_space["height_map"].shape  # (1, X, Y)
        in_c = h_shape[0]
        layers: list[nn.Module] = []
        prev = in_c
        for c in cnn_channels:
            layers += [nn.Conv2d(prev, c, kernel_size=3, padding=1), nn.ReLU()]
            prev = c
        self.cnn = nn.Sequential(*layers, nn.AdaptiveAvgPool2d((4, 4)), nn.Flatten())
        cnn_out = prev * 4 * 4

        q_shape = observation_space["box_queue"].shape  # (K, 5)
        s_shape = observation_space["stats"].shape  # (4,)
        mlp_in = q_shape[0] * q_shape[1] + s_shape[0]
        mlp_layers: list[nn.Module] = []
        prev = mlp_in
        for h in mlp_hidden:
            mlp_layers += [nn.Linear(prev, h), nn.ReLU()]
            prev = h
        self.mlp = nn.Sequential(*mlp_layers)

        self.head = nn.Sequential(
            nn.Linear(cnn_out + prev, features_dim),
            nn.ReLU(),
        )

    def forward(self, obs: dict[str, torch.Tensor]) -> torch.Tensor:
        hm = obs["height_map"]
        # SB3 may pass (B, 1, X, Y) already; ensure 4D.
        if hm.dim() == 3:
            hm = hm.unsqueeze(1)
        cnn_feat = self.cnn(hm)
        q = obs["box_queue"].reshape(obs["box_queue"].size(0), -1)
        s = obs["stats"]
        mlp_feat = self.mlp(torch.cat([q, s], dim=1))
        return self.head(torch.cat([cnn_feat, mlp_feat], dim=1))
