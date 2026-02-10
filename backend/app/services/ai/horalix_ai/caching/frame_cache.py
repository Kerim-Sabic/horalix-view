"""
Frame cache for decoded DICOM frames.

LRU cache with configurable size limit to avoid re-decoding the same frames.
"""

import sys
import logging
from collections import OrderedDict
from typing import Optional, Tuple
import numpy as np

logger = logging.getLogger(__name__)


class FrameCache:
    """
    LRU (Least Recently Used) cache for decoded DICOM frames.

    Key: (instance_uid, frame_index)
    Value: (frame_array, metadata_dict)

    Memory management:
    - Tracks total size in bytes
    - Evicts LRU entries when size limit exceeded
    - Configurable max size (default 10GB)
    """

    def __init__(self, max_size_gb: int = 10):
        """
        Initialize frame cache.

        Args:
            max_size_gb: Maximum cache size in GB
        """
        self.max_size_bytes = max_size_gb * 1024**3
        self.cache = OrderedDict()  # For LRU ordering
        self.current_size_bytes = 0
        self.hits = 0
        self.misses = 0

        logger.info(f"Frame cache initialized with max size {max_size_gb} GB")

    def get(
        self,
        instance_uid: str,
        frame_index: int = 0,
    ) -> Optional[Tuple[np.ndarray, dict]]:
        """
        Get frame from cache.

        Args:
            instance_uid: DICOM instance UID
            frame_index: Frame index (0 for single-frame, 0-N for multiframe)

        Returns:
            Tuple of (frame_array, metadata) if found, None otherwise
        """
        key = (instance_uid, frame_index)

        if key in self.cache:
            # Move to end (most recently used)
            self.cache.move_to_end(key)
            self.hits += 1

            frame, metadata = self.cache[key]
            logger.debug(f"Frame cache HIT: {key}")

            return (frame, metadata)

        self.misses += 1
        logger.debug(f"Frame cache MISS: {key}")

        return None

    def put(
        self,
        instance_uid: str,
        frame_index: int,
        frame: np.ndarray,
        metadata: dict,
    ) -> None:
        """
        Add frame to cache.

        Evicts LRU entries if cache size limit exceeded.

        Args:
            instance_uid: DICOM instance UID
            frame_index: Frame index
            frame: Frame array
            metadata: Frame metadata dict
        """
        key = (instance_uid, frame_index)

        # Calculate size of this entry
        frame_size = frame.nbytes + sys.getsizeof(metadata)

        # Evict LRU entries if needed
        while self.current_size_bytes + frame_size > self.max_size_bytes and self.cache:
            evicted_key, evicted_val = self.cache.popitem(last=False)  # Remove oldest
            evicted_frame, evicted_meta = evicted_val
            evicted_size = evicted_frame.nbytes + sys.getsizeof(evicted_meta)
            self.current_size_bytes -= evicted_size

            logger.debug(f"Frame cache EVICT: {evicted_key} ({evicted_size / 1024**2:.1f} MB)")

        # Add to cache
        self.cache[key] = (frame, metadata)
        self.current_size_bytes += frame_size

        logger.debug(
            f"Frame cache PUT: {key} ({frame_size / 1024**2:.1f} MB), "
            f"total: {self.current_size_bytes / 1024**3:.2f} GB"
        )

    def clear(self) -> None:
        """Clear all cached frames."""
        self.cache.clear()
        self.current_size_bytes = 0
        self.hits = 0
        self.misses = 0

        logger.info("Frame cache cleared")

    def get_stats(self) -> dict:
        """
        Get cache statistics.

        Returns:
            Dictionary with cache stats
        """
        total_requests = self.hits + self.misses
        hit_rate = self.hits / total_requests if total_requests > 0 else 0.0

        return {
            "size_gb": self.current_size_bytes / 1024**3,
            "max_size_gb": self.max_size_bytes / 1024**3,
            "num_entries": len(self.cache),
            "hits": self.hits,
            "misses": self.misses,
            "hit_rate": hit_rate,
        }

    def __len__(self) -> int:
        """Return number of cached entries."""
        return len(self.cache)
