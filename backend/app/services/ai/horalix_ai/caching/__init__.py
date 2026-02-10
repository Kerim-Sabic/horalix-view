"""
Caching modules for horalix_ai composite model.

Two-level caching strategy:
1. Frame cache: LRU cache for decoded DICOM frames (10GB default)
2. Embedding cache: Cache for intermediate model outputs (PanEcho, EchoPrime embeddings)

Caching is critical for performance when processing repeat studies or similar views.
"""

from .frame_cache import FrameCache
from .embedding_cache import EmbeddingCache

__all__ = [
    "FrameCache",
    "EmbeddingCache",
]
