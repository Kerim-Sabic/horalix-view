"""
DICOM metadata extraction utilities.

Extracts key metadata for:
- Pixel spacing (for measurements)
- Frame time/rate (for cine sequences)
- View information
- Patient orientation
"""

import pydicom
from pathlib import Path
from typing import Optional, Tuple


def extract_dicom_metadata(dicom_path: Path) -> dict:
    """
    Extract all relevant metadata from DICOM file.

    Args:
        dicom_path: Path to DICOM file

    Returns:
        Dictionary with metadata
    """
    ds = pydicom.dcmread(str(dicom_path))

    metadata = {
        # Identifiers
        "study_uid": str(ds.StudyInstanceUID),
        "series_uid": str(ds.SeriesInstanceUID),
        "instance_uid": str(ds.SOPInstanceUID),
        # Image properties
        "rows": int(ds.Rows),
        "columns": int(ds.Columns),
        "num_frames": int(getattr(ds, "NumberOfFrames", 1)),
        # Pixel spacing
        "pixel_spacing": get_pixel_spacing(ds),
        # Temporal info
        "frame_time_ms": get_frame_time(ds),
        "cine_rate": get_cine_rate(ds),
        # Modality
        "modality": str(ds.Modality),
        # Image type
        "image_type": list(ds.ImageType) if hasattr(ds, "ImageType") else [],
    }

    return metadata


def get_pixel_spacing(ds: pydicom.Dataset) -> Optional[Tuple[float, float]]:
    """
    Extract pixel spacing from DICOM dataset.

    Tries multiple tags:
    1. PixelSpacing (0028,0030) - Standard tag
    2. UltrasoundRegion PhysicalDelta* - Ultrasound-specific
    3. ImagerPixelSpacing (0018,1164) - Alternative

    Args:
        ds: DICOM dataset

    Returns:
        Tuple of (row_spacing_mm, col_spacing_mm) or None if not found
    """
    # Try PixelSpacing first (most common)
    if hasattr(ds, "PixelSpacing"):
        # PixelSpacing is [row_spacing, col_spacing] in mm
        row_mm, col_mm = map(float, ds.PixelSpacing)
        return (row_mm, col_mm)

    # Try UltrasoundRegion (for echo)
    if hasattr(ds, "SequenceOfUltrasoundRegions"):
        for region in ds.SequenceOfUltrasoundRegions:
            if hasattr(region, "PhysicalDeltaX") and hasattr(region, "PhysicalDeltaY"):
                # PhysicalDelta is in cm, convert to mm
                col_mm = float(region.PhysicalDeltaX) * 10.0
                row_mm = float(region.PhysicalDeltaY) * 10.0
                return (row_mm, col_mm)

    # Try ImagerPixelSpacing
    if hasattr(ds, "ImagerPixelSpacing"):
        row_mm, col_mm = map(float, ds.ImagerPixelSpacing)
        return (row_mm, col_mm)

    return None


def get_frame_time(ds: pydicom.Dataset) -> Optional[float]:
    """
    Get time per frame in milliseconds.

    Args:
        ds: DICOM dataset

    Returns:
        Frame time in ms or None
    """
    if hasattr(ds, "FrameTime"):
        return float(ds.FrameTime)

    # Calculate from CineRate if available
    if hasattr(ds, "CineRate"):
        fps = float(ds.CineRate)
        return 1000.0 / fps if fps > 0 else None

    # Default assumption for echo (30 FPS)
    if str(ds.Modality) == "US":
        return 1000.0 / 30.0

    return None


def get_cine_rate(ds: pydicom.Dataset) -> Optional[float]:
    """
    Get cine frame rate (FPS).

    Args:
        ds: DICOM dataset

    Returns:
        Frame rate in FPS or None
    """
    if hasattr(ds, "CineRate"):
        return float(ds.CineRate)

    if hasattr(ds, "FrameTime"):
        frame_time_ms = float(ds.FrameTime)
        return 1000.0 / frame_time_ms if frame_time_ms > 0 else None

    # Default for echo
    if str(ds.Modality) == "US":
        return 30.0

    return None
