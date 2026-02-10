"""
Embedding cache for intermediate model outputs.

Caches computationally expensive intermediate results like:
- PanEcho embeddings (before task heads)
- EchoPrime study embeddings
- View classification results

Keyed by (study_uid, model_name, weights_hash) for cache invalidation on model updates.
"""

import pickle
import logging
import hashlib
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)


class EmbeddingCache:
    """
    Cache for intermediate model outputs (embeddings, predictions).

    Features:
    - Two-tier: memory cache (fast) + disk cache (persistent)
    - Automatic invalidation on model weight changes (weights_hash)
    - Optional disk persistence for cross-session caching
    """

    def __init__(
        self,
        cache_dir: Optional[Path] = None,
        enabled: bool = True,
        max_memory_entries: int = 100,
    ):
        """
        Initialize embedding cache.

        Args:
            cache_dir: Directory for disk cache (None = memory only)
            enabled: Enable/disable caching
            max_memory_entries: Max entries in memory cache
        """
        self.cache_dir = Path(cache_dir) if cache_dir else None
        self.enabled = enabled
        self.max_memory_entries = max_memory_entries

        # Memory cache (LRU-like with dict)
        self.memory_cache = {}

        # Create cache directory
        if self.enabled and self.cache_dir:
            self.cache_dir.mkdir(parents=True, exist_ok=True)
            logger.info(f"Embedding cache initialized at {self.cache_dir}")
        else:
            logger.info("Embedding cache initialized (memory only)")

    def _make_key(
        self,
        study_uid: str,
        model_name: str,
        weights_hash: Optional[str] = None,
    ) -> str:
        """
        Create cache key.

        Args:
            study_uid: Study UID
            model_name: Model name (e.g., "panecho", "echoprime")
            weights_hash: Optional SHA256 hash of model weights (for invalidation)

        Returns:
            Cache key string
        """
        if weights_hash:
            return f"{study_uid}_{model_name}_{weights_hash[:8]}"
        else:
            return f"{study_uid}_{model_name}"

    def get(
        self,
        study_uid: str,
        model_name: str,
        weights_hash: Optional[str] = None,
    ) -> Optional[Any]:
        """
        Get cached embedding.

        Args:
            study_uid: Study UID
            model_name: Model name
            weights_hash: Optional weights hash

        Returns:
            Cached data if found, None otherwise
        """
        if not self.enabled:
            return None

        key = self._make_key(study_uid, model_name, weights_hash)

        # Check memory cache first
        if key in self.memory_cache:
            logger.debug(f"Embedding cache HIT (memory): {key}")
            return self.memory_cache[key]

        # Check disk cache
        if self.cache_dir:
            cache_file = self.cache_dir / f"{key}.pkl"

            if cache_file.exists():
                try:
                    with open(cache_file, "rb") as f:
                        data = pickle.load(f)

                    # Load into memory cache
                    self._add_to_memory(key, data)

                    logger.debug(f"Embedding cache HIT (disk): {key}")
                    return data

                except Exception as e:
                    logger.warning(f"Failed to load embedding cache {key}: {e}")
                    # Remove corrupted cache file
                    cache_file.unlink(missing_ok=True)

        logger.debug(f"Embedding cache MISS: {key}")
        return None

    def put(
        self,
        study_uid: str,
        model_name: str,
        data: Any,
        weights_hash: Optional[str] = None,
    ) -> None:
        """
        Add embedding to cache.

        Args:
            study_uid: Study UID
            model_name: Model name
            data: Data to cache (embedding tensor, predictions dict, etc.)
            weights_hash: Optional weights hash
        """
        if not self.enabled:
            return

        key = self._make_key(study_uid, model_name, weights_hash)

        # Add to memory cache
        self._add_to_memory(key, data)

        # Write to disk cache
        if self.cache_dir:
            cache_file = self.cache_dir / f"{key}.pkl"

            try:
                with open(cache_file, "wb") as f:
                    pickle.dump(data, f)

                logger.debug(f"Embedding cache PUT: {key}")

            except Exception as e:
                logger.error(f"Failed to write embedding cache {key}: {e}")

    def _add_to_memory(self, key: str, data: Any) -> None:
        """
        Add entry to memory cache with LRU eviction.

        Args:
            key: Cache key
            data: Data to cache
        """
        # Simple LRU: if full, remove oldest entry
        if len(self.memory_cache) >= self.max_memory_entries:
            # Remove first entry (oldest)
            oldest_key = next(iter(self.memory_cache))
            del self.memory_cache[oldest_key]

        self.memory_cache[key] = data

    def clear(self) -> None:
        """Clear all cached embeddings (memory and disk)."""
        # Clear memory
        self.memory_cache.clear()

        # Clear disk
        if self.cache_dir:
            for cache_file in self.cache_dir.glob("*.pkl"):
                cache_file.unlink()

            logger.info("Embedding cache cleared (memory + disk)")
        else:
            logger.info("Embedding cache cleared (memory)")

    def get_stats(self) -> dict:
        """
        Get cache statistics.

        Returns:
            Dictionary with cache stats
        """
        disk_entries = 0
        disk_size_mb = 0.0

        if self.cache_dir:
            cache_files = list(self.cache_dir.glob("*.pkl"))
            disk_entries = len(cache_files)
            disk_size_mb = sum(f.stat().st_size for f in cache_files) / 1024**2

        return {
            "enabled": self.enabled,
            "memory_entries": len(self.memory_cache),
            "disk_entries": disk_entries,
            "disk_size_mb": disk_size_mb,
        }


def compute_weights_hash(weights_path: Path) -> str:
    """
    Compute SHA256 hash of model weights file.

    Used for cache invalidation when weights change.

    Args:
        weights_path: Path to weights file

    Returns:
        SHA256 hash (hex string)
    """
    sha256 = hashlib.sha256()

    with open(weights_path, "rb") as f:
        # Read in chunks to handle large files
        for chunk in iter(lambda: f.read(4096), b""):
            sha256.update(chunk)

    return sha256.hexdigest()
