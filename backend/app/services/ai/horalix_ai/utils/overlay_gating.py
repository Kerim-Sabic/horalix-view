from typing import Optional


def area_ratio_valid(
    area_ratio: float,
    min_ratio: float = 0.01,
    max_ratio: float = 0.7,
) -> bool:
    """Return True when LV mask area ratio is within acceptable bounds."""
    return min_ratio <= area_ratio <= max_ratio


def area_change_valid(
    prev_ratio: Optional[float],
    current_ratio: float,
    max_delta_ratio: float = 0.5,
) -> bool:
    """Return True when frame-to-frame area change is within tolerance."""
    if prev_ratio is None or prev_ratio <= 0:
        return True
    return abs(current_ratio - prev_ratio) / prev_ratio <= max_delta_ratio
