from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, Optional

import torch

from app.core.config import Settings
from app.services.ai.horalix_ai.caching import EmbeddingCache, FrameCache


@dataclass
class HoralixRuntimeContext:
    settings: Settings
    device: str
    gpu_id: int
    panecho_model: Optional[torch.nn.Module] = None
    echoprime_model: Optional[torch.nn.Module] = None
    view_classifier: Optional[torch.nn.Module] = None
    measurements_models: Dict[str, torch.nn.Module] = field(default_factory=dict)
    echonet_model: Optional[torch.nn.Module] = None
    frame_cache: Optional[FrameCache] = None
    embedding_cache: Optional[EmbeddingCache] = None
