"""
Instance management endpoints for Horalix View.

Handles individual DICOM instances (images) including pixel data retrieval,
metadata access, and image manipulation.
"""

from typing import Annotated
from io import BytesIO

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.api.v1.endpoints.auth import get_current_active_user
from app.core.security import TokenData

router = APIRouter()


class InstanceMetadata(BaseModel):
    """DICOM instance metadata."""

    sop_instance_uid: str = Field(..., description="Unique instance identifier")
    sop_class_uid: str = Field(..., description="SOP class UID")
    series_instance_uid: str = Field(..., description="Parent series UID")
    study_instance_uid: str = Field(..., description="Parent study UID")
    instance_number: int | None = Field(None, description="Instance number")
    rows: int = Field(..., description="Image rows")
    columns: int = Field(..., description="Image columns")
    bits_allocated: int = Field(16, description="Bits allocated per pixel")
    bits_stored: int = Field(12, description="Bits stored per pixel")
    photometric_interpretation: str = Field("MONOCHROME2", description="Photometric interpretation")
    pixel_spacing: tuple[float, float] | None = Field(None, description="Pixel spacing (row, col)")
    slice_thickness: float | None = Field(None, description="Slice thickness in mm")
    slice_location: float | None = Field(None, description="Slice location")
    image_position_patient: tuple[float, float, float] | None = Field(None, description="Image position")
    image_orientation_patient: tuple[float, ...] | None = Field(None, description="Image orientation")
    window_center: float | None = Field(None, description="Window center")
    window_width: float | None = Field(None, description="Window width")
    rescale_intercept: float = Field(0.0, description="Rescale intercept")
    rescale_slope: float = Field(1.0, description="Rescale slope")


class PixelDataInfo(BaseModel):
    """Pixel data information."""

    sop_instance_uid: str
    rows: int
    columns: int
    bits_allocated: int
    pixel_representation: int
    samples_per_pixel: int
    transfer_syntax_uid: str
    is_compressed: bool
    frame_count: int


# Simulated instance database
INSTANCES_DB: dict[str, dict] = {}

# Generate instances for demo series
for series_uid_suffix in ["1", "2", "3"]:
    series_uid = f"1.2.840.113619.2.55.3.123456789.1.{series_uid_suffix}"
    for i in range(150):
        instance_uid = f"{series_uid}.{i + 1}"
        INSTANCES_DB[instance_uid] = {
            "sop_instance_uid": instance_uid,
            "sop_class_uid": "1.2.840.10008.5.1.4.1.1.2",
            "series_instance_uid": series_uid,
            "study_instance_uid": "1.2.840.113619.2.55.3.123456789.1",
            "instance_number": i + 1,
            "rows": 512,
            "columns": 512,
            "bits_allocated": 16,
            "bits_stored": 12,
            "photometric_interpretation": "MONOCHROME2",
            "pixel_spacing": (0.5, 0.5),
            "slice_thickness": 2.5,
            "slice_location": -100.0 + i * 2.5,
            "image_position_patient": (-128.0, -128.0, -100.0 + i * 2.5),
            "image_orientation_patient": (1.0, 0.0, 0.0, 0.0, 1.0, 0.0),
            "window_center": 40.0,
            "window_width": 400.0,
            "rescale_intercept": -1024.0,
            "rescale_slope": 1.0,
        }


@router.get("/{instance_uid}", response_model=InstanceMetadata)
async def get_instance(
    instance_uid: str,
    current_user: Annotated[TokenData, Depends(get_current_active_user)],
) -> InstanceMetadata:
    """
    Get instance metadata.

    Returns DICOM header information for the specified instance.
    """
    instance_data = INSTANCES_DB.get(instance_uid)
    if not instance_data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Instance not found: {instance_uid}",
        )

    return InstanceMetadata(**instance_data)


@router.get("/{instance_uid}/pixel-data", response_class=Response)
async def get_pixel_data(
    instance_uid: str,
    current_user: Annotated[TokenData, Depends(get_current_active_user)],
    format: str = Query("raw", enum=["raw", "png", "jpeg"], description="Output format"),
    quality: int = Query(90, ge=1, le=100, description="JPEG quality"),
    window_center: float | None = Query(None, description="Override window center"),
    window_width: float | None = Query(None, description="Override window width"),
) -> Response:
    """
    Get instance pixel data.

    Returns the image data in the requested format.
    Supports windowing parameters for display optimization.
    """
    instance_data = INSTANCES_DB.get(instance_uid)
    if not instance_data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Instance not found: {instance_uid}",
        )

    # In production, retrieve actual pixel data from storage
    # Here we generate a placeholder gradient image
    import numpy as np

    rows = instance_data["rows"]
    cols = instance_data["columns"]

    # Generate synthetic image data
    x = np.linspace(0, 1, cols)
    y = np.linspace(0, 1, rows)
    xx, yy = np.meshgrid(x, y)
    pixel_data = ((np.sin(xx * 10) * np.cos(yy * 10) + 1) * 2000 - 1024).astype(np.int16)

    # Apply windowing
    wc = window_center or instance_data.get("window_center", 40)
    ww = window_width or instance_data.get("window_width", 400)

    if format == "raw":
        return Response(
            content=pixel_data.tobytes(),
            media_type="application/octet-stream",
            headers={
                "X-Rows": str(rows),
                "X-Columns": str(cols),
                "X-Bits-Allocated": "16",
                "X-Window-Center": str(wc),
                "X-Window-Width": str(ww),
            },
        )
    else:
        from PIL import Image

        # Apply window/level
        min_val = wc - ww / 2
        max_val = wc + ww / 2
        display_data = np.clip(pixel_data, min_val, max_val)
        display_data = ((display_data - min_val) / (max_val - min_val) * 255).astype(np.uint8)

        # Create PIL image
        img = Image.fromarray(display_data, mode="L")

        # Save to buffer
        buffer = BytesIO()
        if format == "png":
            img.save(buffer, format="PNG")
            media_type = "image/png"
        else:
            img.save(buffer, format="JPEG", quality=quality)
            media_type = "image/jpeg"

        buffer.seek(0)
        return StreamingResponse(buffer, media_type=media_type)


@router.get("/{instance_uid}/thumbnail", response_class=Response)
async def get_thumbnail(
    instance_uid: str,
    current_user: Annotated[TokenData, Depends(get_current_active_user)],
    size: int = Query(128, ge=32, le=512, description="Thumbnail size"),
) -> Response:
    """
    Get instance thumbnail.

    Returns a small preview image for quick display in study browsers.
    """
    instance_data = INSTANCES_DB.get(instance_uid)
    if not instance_data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Instance not found: {instance_uid}",
        )

    # Generate synthetic thumbnail
    import numpy as np
    from PIL import Image

    # Create gradient thumbnail
    x = np.linspace(0, 1, size)
    y = np.linspace(0, 1, size)
    xx, yy = np.meshgrid(x, y)
    data = ((np.sin(xx * 10) * np.cos(yy * 10) + 1) * 127).astype(np.uint8)

    img = Image.fromarray(data, mode="L")
    buffer = BytesIO()
    img.save(buffer, format="PNG")
    buffer.seek(0)

    return StreamingResponse(buffer, media_type="image/png")


@router.get("/{instance_uid}/pixel-info", response_model=PixelDataInfo)
async def get_pixel_info(
    instance_uid: str,
    current_user: Annotated[TokenData, Depends(get_current_active_user)],
) -> PixelDataInfo:
    """
    Get pixel data information.

    Returns technical details about the pixel data format.
    """
    instance_data = INSTANCES_DB.get(instance_uid)
    if not instance_data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Instance not found: {instance_uid}",
        )

    return PixelDataInfo(
        sop_instance_uid=instance_uid,
        rows=instance_data["rows"],
        columns=instance_data["columns"],
        bits_allocated=instance_data["bits_allocated"],
        pixel_representation=1,  # Signed
        samples_per_pixel=1,
        transfer_syntax_uid="1.2.840.10008.1.2.1",  # Explicit VR Little Endian
        is_compressed=False,
        frame_count=1,
    )


@router.get("/{instance_uid}/tags")
async def get_dicom_tags(
    instance_uid: str,
    current_user: Annotated[TokenData, Depends(get_current_active_user)],
    include_private: bool = Query(False, description="Include private tags"),
) -> dict:
    """
    Get all DICOM tags for an instance.

    Returns the complete DICOM header as a dictionary.
    """
    instance_data = INSTANCES_DB.get(instance_uid)
    if not instance_data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Instance not found: {instance_uid}",
        )

    # Return common DICOM tags
    tags = {
        "(0008,0016)": {"vr": "UI", "name": "SOPClassUID", "value": instance_data["sop_class_uid"]},
        "(0008,0018)": {"vr": "UI", "name": "SOPInstanceUID", "value": instance_uid},
        "(0020,000D)": {"vr": "UI", "name": "StudyInstanceUID", "value": instance_data["study_instance_uid"]},
        "(0020,000E)": {"vr": "UI", "name": "SeriesInstanceUID", "value": instance_data["series_instance_uid"]},
        "(0020,0013)": {"vr": "IS", "name": "InstanceNumber", "value": str(instance_data.get("instance_number", ""))},
        "(0028,0010)": {"vr": "US", "name": "Rows", "value": instance_data["rows"]},
        "(0028,0011)": {"vr": "US", "name": "Columns", "value": instance_data["columns"]},
        "(0028,0100)": {"vr": "US", "name": "BitsAllocated", "value": instance_data["bits_allocated"]},
        "(0028,0101)": {"vr": "US", "name": "BitsStored", "value": instance_data["bits_stored"]},
        "(0028,0004)": {"vr": "CS", "name": "PhotometricInterpretation", "value": instance_data["photometric_interpretation"]},
        "(0028,1050)": {"vr": "DS", "name": "WindowCenter", "value": instance_data.get("window_center")},
        "(0028,1051)": {"vr": "DS", "name": "WindowWidth", "value": instance_data.get("window_width")},
        "(0028,1052)": {"vr": "DS", "name": "RescaleIntercept", "value": instance_data.get("rescale_intercept", 0)},
        "(0028,1053)": {"vr": "DS", "name": "RescaleSlope", "value": instance_data.get("rescale_slope", 1)},
    }

    return {"instance_uid": instance_uid, "tags": tags}
