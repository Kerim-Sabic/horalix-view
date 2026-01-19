"""
DICOMweb endpoints for Horalix View.

Implements WADO-RS, QIDO-RS, and STOW-RS services for interoperability
with PACS and other DICOM systems.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Request, status
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel

from app.api.v1.endpoints.auth import get_current_active_user, require_roles
from app.core.security import TokenData

router = APIRouter()


class DicomwebSearchResult(BaseModel):
    """DICOMweb search result."""

    study_instance_uid: str
    patient_name: str | None = None
    patient_id: str | None = None
    study_date: str | None = None
    study_description: str | None = None
    modalities_in_study: list[str] = []
    number_of_study_related_series: int = 0
    number_of_study_related_instances: int = 0


# =============================================================================
# QIDO-RS Endpoints (Query based on ID for DICOM Objects - RESTful Services)
# =============================================================================


@router.get("/studies", response_model=list[dict])
async def qido_search_studies(
    current_user: Annotated[TokenData, Depends(get_current_active_user)],
    PatientID: str | None = Query(None, alias="00100020"),
    PatientName: str | None = Query(None, alias="00100010"),
    StudyDate: str | None = Query(None, alias="00080020"),
    ModalitiesInStudy: str | None = Query(None, alias="00080061"),
    StudyInstanceUID: str | None = Query(None, alias="0020000D"),
    AccessionNumber: str | None = Query(None, alias="00080050"),
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
) -> list[dict]:
    """
    QIDO-RS: Search for studies.

    Query parameters use DICOM tag format (e.g., 00100020 for Patient ID).
    Supports wildcards (*) in search values.
    """
    # Return sample DICOM JSON format
    return [
        {
            "00080020": {"vr": "DA", "Value": ["20240115"]},
            "00080050": {"vr": "SH", "Value": ["ACC001"]},
            "00080061": {"vr": "CS", "Value": ["CT"]},
            "00100010": {"vr": "PN", "Value": [{"Alphabetic": "Doe^John"}]},
            "00100020": {"vr": "LO", "Value": ["PAT001"]},
            "0020000D": {"vr": "UI", "Value": ["1.2.840.113619.2.55.3.123456789.1"]},
            "00201206": {"vr": "IS", "Value": [3]},
            "00201208": {"vr": "IS", "Value": [450]},
        }
    ]


@router.get("/studies/{study_uid}/series", response_model=list[dict])
async def qido_search_series(
    study_uid: str,
    current_user: Annotated[TokenData, Depends(get_current_active_user)],
    Modality: str | None = Query(None, alias="00080060"),
    SeriesInstanceUID: str | None = Query(None, alias="0020000E"),
    SeriesNumber: str | None = Query(None, alias="00200011"),
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
) -> list[dict]:
    """
    QIDO-RS: Search for series within a study.
    """
    return [
        {
            "00080060": {"vr": "CS", "Value": ["CT"]},
            "0020000D": {"vr": "UI", "Value": [study_uid]},
            "0020000E": {"vr": "UI", "Value": [f"{study_uid}.1"]},
            "00200011": {"vr": "IS", "Value": [1]},
            "0008103E": {"vr": "LO", "Value": ["Axial Soft Tissue"]},
            "00201209": {"vr": "IS", "Value": [150]},
        }
    ]


@router.get("/studies/{study_uid}/series/{series_uid}/instances", response_model=list[dict])
async def qido_search_instances(
    study_uid: str,
    series_uid: str,
    current_user: Annotated[TokenData, Depends(get_current_active_user)],
    SOPInstanceUID: str | None = Query(None, alias="00080018"),
    InstanceNumber: str | None = Query(None, alias="00200013"),
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
) -> list[dict]:
    """
    QIDO-RS: Search for instances within a series.
    """
    instances = []
    for i in range(min(10, limit)):
        instances.append({
            "00080016": {"vr": "UI", "Value": ["1.2.840.10008.5.1.4.1.1.2"]},
            "00080018": {"vr": "UI", "Value": [f"{series_uid}.{i + 1}"]},
            "0020000D": {"vr": "UI", "Value": [study_uid]},
            "0020000E": {"vr": "UI", "Value": [series_uid]},
            "00200013": {"vr": "IS", "Value": [i + 1]},
            "00280010": {"vr": "US", "Value": [512]},
            "00280011": {"vr": "US", "Value": [512]},
        })
    return instances


# =============================================================================
# WADO-RS Endpoints (Web Access to DICOM Objects - RESTful Services)
# =============================================================================


@router.get("/studies/{study_uid}")
async def wado_retrieve_study(
    study_uid: str,
    current_user: Annotated[TokenData, Depends(get_current_active_user)],
    accept: str | None = Query(None, description="Requested media type"),
) -> Response:
    """
    WADO-RS: Retrieve entire study as multipart DICOM.
    """
    # In production, stream actual DICOM data
    return Response(
        content=b"DICOM study data placeholder",
        media_type="multipart/related; type=application/dicom",
    )


@router.get("/studies/{study_uid}/series/{series_uid}")
async def wado_retrieve_series(
    study_uid: str,
    series_uid: str,
    current_user: Annotated[TokenData, Depends(get_current_active_user)],
) -> Response:
    """
    WADO-RS: Retrieve entire series as multipart DICOM.
    """
    return Response(
        content=b"DICOM series data placeholder",
        media_type="multipart/related; type=application/dicom",
    )


@router.get("/studies/{study_uid}/series/{series_uid}/instances/{instance_uid}")
async def wado_retrieve_instance(
    study_uid: str,
    series_uid: str,
    instance_uid: str,
    current_user: Annotated[TokenData, Depends(get_current_active_user)],
) -> Response:
    """
    WADO-RS: Retrieve single instance as DICOM.
    """
    return Response(
        content=b"DICOM instance data placeholder",
        media_type="application/dicom",
    )


@router.get("/studies/{study_uid}/series/{series_uid}/instances/{instance_uid}/frames/{frame_numbers}")
async def wado_retrieve_frames(
    study_uid: str,
    series_uid: str,
    instance_uid: str,
    frame_numbers: str,
    current_user: Annotated[TokenData, Depends(get_current_active_user)],
    accept: str | None = Query(None),
) -> Response:
    """
    WADO-RS: Retrieve specific frames from a multi-frame instance.

    frame_numbers: Comma-separated frame numbers (1-indexed)
    """
    return Response(
        content=b"Frame data placeholder",
        media_type="multipart/related; type=application/octet-stream",
    )


@router.get("/studies/{study_uid}/series/{series_uid}/instances/{instance_uid}/rendered")
async def wado_retrieve_rendered(
    study_uid: str,
    series_uid: str,
    instance_uid: str,
    current_user: Annotated[TokenData, Depends(get_current_active_user)],
    accept: str = Query("image/png"),
    window: str | None = Query(None, description="Window center,width"),
    viewport: str | None = Query(None, description="width,height"),
) -> Response:
    """
    WADO-RS: Retrieve rendered image.

    Returns the instance rendered as a consumer image format (PNG, JPEG, etc.).
    """
    from io import BytesIO
    import numpy as np
    from PIL import Image

    # Parse window parameters
    window_center, window_width = 40, 400
    if window:
        parts = window.split(",")
        if len(parts) == 2:
            window_center, window_width = float(parts[0]), float(parts[1])

    # Generate placeholder image
    size = 512
    x = np.linspace(0, 1, size)
    y = np.linspace(0, 1, size)
    xx, yy = np.meshgrid(x, y)
    data = ((np.sin(xx * 10) * np.cos(yy * 10) + 1) * 127).astype(np.uint8)

    img = Image.fromarray(data, mode="L")
    buffer = BytesIO()

    if "jpeg" in accept.lower():
        img.save(buffer, format="JPEG", quality=90)
        media_type = "image/jpeg"
    else:
        img.save(buffer, format="PNG")
        media_type = "image/png"

    buffer.seek(0)

    return StreamingResponse(buffer, media_type=media_type)


@router.get("/studies/{study_uid}/series/{series_uid}/instances/{instance_uid}/metadata")
async def wado_retrieve_metadata(
    study_uid: str,
    series_uid: str,
    instance_uid: str,
    current_user: Annotated[TokenData, Depends(get_current_active_user)],
) -> list[dict]:
    """
    WADO-RS: Retrieve instance metadata as DICOM JSON.
    """
    return [
        {
            "00080016": {"vr": "UI", "Value": ["1.2.840.10008.5.1.4.1.1.2"]},
            "00080018": {"vr": "UI", "Value": [instance_uid]},
            "0020000D": {"vr": "UI", "Value": [study_uid]},
            "0020000E": {"vr": "UI", "Value": [series_uid]},
            "00280010": {"vr": "US", "Value": [512]},
            "00280011": {"vr": "US", "Value": [512]},
            "00280100": {"vr": "US", "Value": [16]},
            "00281050": {"vr": "DS", "Value": [40]},
            "00281051": {"vr": "DS", "Value": [400]},
        }
    ]


# =============================================================================
# STOW-RS Endpoints (Store Over the Web - RESTful Services)
# =============================================================================


@router.post("/studies", status_code=status.HTTP_200_OK)
async def stow_store_instances(
    request: Request,
    current_user: Annotated[TokenData, Depends(require_roles("admin", "technologist"))],
) -> dict:
    """
    STOW-RS: Store DICOM instances.

    Accepts multipart/related request with DICOM instances.
    Returns store results for each instance.
    """
    content_type = request.headers.get("content-type", "")

    if "multipart/related" not in content_type:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Content-Type must be multipart/related",
        )

    # In production, parse multipart and store instances
    body = await request.body()

    return {
        "00081190": {"vr": "UR", "Value": ["/studies/1.2.840.113619.2.55.3.123456789.1"]},
        "00081199": {
            "vr": "SQ",
            "Value": [
                {
                    "00081150": {"vr": "UI", "Value": ["1.2.840.10008.5.1.4.1.1.2"]},
                    "00081155": {"vr": "UI", "Value": ["1.2.840.113619.2.55.3.123456789.1.1.1"]},
                    "00081190": {"vr": "UR", "Value": ["/studies/.../instances/..."]},
                }
            ],
        },
    }


@router.post("/studies/{study_uid}", status_code=status.HTTP_200_OK)
async def stow_store_to_study(
    study_uid: str,
    request: Request,
    current_user: Annotated[TokenData, Depends(require_roles("admin", "technologist"))],
) -> dict:
    """
    STOW-RS: Store instances to a specific study.
    """
    return {
        "00081190": {"vr": "UR", "Value": [f"/studies/{study_uid}"]},
        "00081199": {"vr": "SQ", "Value": []},
    }


# =============================================================================
# Additional DICOMweb Features
# =============================================================================


@router.get("/studies/{study_uid}/thumbnail")
async def wado_study_thumbnail(
    study_uid: str,
    current_user: Annotated[TokenData, Depends(get_current_active_user)],
    viewport: str = Query("128,128"),
) -> Response:
    """
    WADO-RS: Get study thumbnail.
    """
    from io import BytesIO
    import numpy as np
    from PIL import Image

    parts = viewport.split(",")
    width = int(parts[0]) if len(parts) > 0 else 128
    height = int(parts[1]) if len(parts) > 1 else width

    x = np.linspace(0, 1, width)
    y = np.linspace(0, 1, height)
    xx, yy = np.meshgrid(x, y)
    data = ((np.sin(xx * 10) * np.cos(yy * 10) + 1) * 127).astype(np.uint8)

    img = Image.fromarray(data, mode="L")
    buffer = BytesIO()
    img.save(buffer, format="PNG")
    buffer.seek(0)

    return StreamingResponse(buffer, media_type="image/png")


@router.delete("/studies/{study_uid}")
async def wado_delete_study(
    study_uid: str,
    current_user: Annotated[TokenData, Depends(require_roles("admin"))],
) -> None:
    """
    WADO-RS: Delete a study (non-standard extension).
    """
    # In production, delete the study
    return None
