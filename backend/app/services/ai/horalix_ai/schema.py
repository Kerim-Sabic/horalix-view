"""
Output schema for horalix_ai composite model.

Defines the overlay-first data structures for AI results that will be rendered
as interactive, toggleable overlays in the Horalix viewer.
"""

from pydantic import BaseModel, Field
from typing import List, Dict, Optional, Literal, Union, Any
from datetime import datetime


class Point2D(BaseModel):
    """2D point in pixel coordinates."""
    x: float
    y: float


class OverlayTarget(BaseModel):
    """
    Identifies which DICOM image an overlay applies to.

    For single-frame images, frame_index is None.
    For multiframe cines, frame_index is 0-indexed.
    """
    series_uid: str
    instance_uid: str
    frame_index: Optional[int] = None


class MaskOverlay(BaseModel):
    """Segmentation mask overlay (e.g., LV cavity, RV)."""
    id: str = Field(..., description="Unique identifier for this overlay")
    type: Literal["mask"] = "mask"
    target: OverlayTarget
    label: str = Field(..., description="Human-readable label (e.g., 'LV Cavity (ED)')")
    mask_path: str = Field(..., description="Relative path to .npz mask file")
    default_visible: bool = True
    color_hint: str = Field(default="#4ade80", description="Hex color for UI rendering")
    opacity: float = Field(default=0.5, ge=0.0, le=1.0)


class PolylineOverlay(BaseModel):
    """Vector polyline or contour overlay (e.g., LV endocardium contour)."""
    id: str
    type: Literal["polyline"] = "polyline"
    target: OverlayTarget
    label: str = Field(..., description="Human-readable label (e.g., 'LV Endocardium (ES)')")
    points_px: List[Point2D] = Field(..., description="Points in original DICOM pixel space")
    closed: bool = Field(default=False, description="True for closed contours, False for open polylines")
    default_visible: bool = True
    color: str = Field(default="#3b82f6", description="Hex color")
    line_width: int = Field(default=2, ge=1)


class PointOverlay(BaseModel):
    """Individual point landmark (e.g., valve hinge point)."""
    id: str
    type: Literal["point"] = "point"
    target: OverlayTarget
    label: str
    point_px: Point2D
    default_visible: bool = True
    color: str = Field(default="#f59e0b", description="Hex color")
    radius: int = Field(default=3, ge=1)


class LineOverlay(BaseModel):
    """
    Two-point line overlay for measurements (e.g., IVS thickness, LVID).

    Includes optional measurement value and unit for display as label.
    """
    id: str
    type: Literal["line"] = "line"
    target: OverlayTarget
    label: str = Field(..., description="Measurement name (e.g., 'IVS Thickness')")
    start_px: Point2D
    end_px: Point2D
    default_visible: bool = True
    color: str = Field(default="#ef4444", description="Hex color")
    line_width: int = Field(default=2, ge=1)
    measurement_value: Optional[float] = Field(None, description="Measured value (e.g., 1.2)")
    measurement_unit: Optional[str] = Field(None, description="Unit (e.g., 'cm', 'mm')")


# Union type for all overlay types
OverlayUnion = Union[MaskOverlay, PolylineOverlay, PointOverlay, LineOverlay]


class MeasurementRecord(BaseModel):
    """
    Structured measurement record for table display.

    Includes measurement name, value, unit, confidence, and frame associations.
    """
    measurement_type: str = Field(..., description="Unique measurement identifier (e.g., 'ivs_ED', 'lvid_ES')")
    measurement_name: str = Field(..., description="Display name (e.g., 'IVS ED', 'LVID ES')")
    value: float
    unit: str = Field(..., description="Unit (cm, mm, mL, %, etc.)")
    confidence: Optional[float] = Field(None, ge=0.0, le=1.0, description="Model confidence")
    frame_number: Optional[int] = Field(None, description="Frame index (0-indexed)")
    instance_uid: Optional[str] = Field(None, description="Source instance UID")
    view: Optional[str] = Field(None, description="View label (A4C, PLAX, etc.)")
    method: Optional[str] = Field(None, description="Inference method (e.g., 'DeepLabV3_keypoints')")
    validation: Optional[Dict[str, Any]] = Field(
        default=None,
        description="Clinical validation metadata (status, ranges, message)",
    )


class CurveData(BaseModel):
    """
    Time-series data (e.g., LV volume over cardiac cycle).

    Used for plotting curves with optional event markers (ED/ES).
    """
    name: str = Field(..., description="Curve name (e.g., 'LV Volume')")
    unit: str = Field(..., description="Y-axis unit (e.g., 'mL')")
    instance_uid: str
    t_ms: List[float] = Field(..., description="Time axis in milliseconds")
    y: List[float] = Field(..., description="Y values")
    markers: Optional[Dict[str, int]] = Field(None, description="Event markers (e.g., {'ED': 12, 'ES': 28})")


class StructuredReport(BaseModel):
    """
    Structured report with machine-readable sections and human-readable summary.

    Sections organized hierarchically (e.g., "Left Ventricle" -> {"Size": "Normal", "EF": 0.60}).
    """
    sections: Dict[str, Dict[str, Any]] = Field(default_factory=dict)
    text: str = Field(default="", description="Human-readable summary text")


class HoralixAIOutput(BaseModel):
    """
    Complete output from horalix_ai composite model.

    This is the primary result object returned by the worker and stored in the
    results directory. It contains all AI-generated overlays, measurements,
    curves, and structured findings.
    """
    schema_version: str = Field(default="1.0", description="Schema version for future compatibility")

    # Metadata
    study_uid: str
    model_name: Literal["horalix_ai"] = Field(default="horalix_ai")
    model_version: str = Field(default="1.0.0")
    inference_time_ms: float = Field(..., ge=0.0)
    gpu_id: int = Field(..., ge=0)
    timestamp: datetime = Field(default_factory=datetime.now)
    patient_sex: Optional[str] = Field(default=None, description="Patient sex (M/F/O) if available")
    patient_height_cm: Optional[float] = Field(default=None, description="Patient height in cm if available")
    patient_weight_kg: Optional[float] = Field(default=None, description="Patient weight in kg if available")
    patient_bmi: Optional[float] = Field(default=None, description="Patient BMI if available")
    patient_context_source: Optional[str] = Field(default=None, description="Source of patient context (dicom/manual)")

    # View Classification (maps instance_uid to view label)
    # This allows the frontend to display cines by their clinical view name
    view_predictions: Dict[str, str] = Field(
        default_factory=dict,
        description="View classification per instance (e.g., {'1.2.3.4': 'A4C', '1.2.3.5': 'PLAX'})"
    )
    view_confidences: Dict[str, float] = Field(
        default_factory=dict,
        description="View classification confidence per instance (0-1)"
    )
    view_diagnostics: Dict[str, Dict[str, Any]] = Field(
        default_factory=dict,
        description="Per-instance diagnostics for view mapping and gating decisions",
    )

    # Findings (merged PanEcho + EchoPrime predictions)
    findings: Dict[str, Any] = Field(default_factory=dict, description="Study-level predictions")

    # Overlays (interactive, toggleable in viewer)
    overlays: List[OverlayUnion] = Field(default_factory=list)

    # Measurements Table
    measurements: List[MeasurementRecord] = Field(default_factory=list)

    # Curves (time-series data)
    curves: List[CurveData] = Field(default_factory=list)

    # Structured Report
    report: StructuredReport = Field(default_factory=StructuredReport)

    # File Outputs (optional, for clinical review - annotated videos)
    file_outputs: Dict[str, str] = Field(
        default_factory=dict,
        description="Paths to generated files (e.g., {'lv_segmentation_video': 'path/to/video.mp4'})"
    )

    # DICOM Exports (Phase 2 - SEG/SR)
    dicom_exports: Dict[str, str] = Field(
        default_factory=dict,
        description="Paths to DICOM export files (e.g., {'seg': 'path/to/seg.dcm'})"
    )


class Job(BaseModel):
    """
    Inference job metadata passed to workers via job queue.

    Workers read this from the job queue directory and execute the pipeline.
    """
    job_id: str
    study_uid: str
    series_uid: Optional[str] = None
    instance_uid: Optional[str] = None
    enable_echonet: bool = True
    enable_measurements: bool = True
    priority: int = Field(default=5, ge=1, le=10, description="Priority (1=highest, 10=lowest)")
    submitted_at: datetime = Field(default_factory=datetime.now)
    patient_context: Dict[str, Any] = Field(default_factory=dict, description="Optional patient context overrides")


class JobStatus(BaseModel):
    """
    Job status tracking.

    Written by workers to the status directory for the backend to poll.
    """
    job_id: str
    status: Literal["PENDING", "CLAIMED", "RUNNING", "COMPLETED", "FAILED", "CANCELLED"]
    progress: float = Field(default=0.0, ge=0.0, le=100.0, description="Progress percentage")
    gpu_id: Optional[int] = None
    worker_pid: Optional[int] = None
    claimed_at: Optional[datetime] = None
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    error_message: Optional[str] = None
    result_path: Optional[str] = Field(None, description="Path to result JSON (when completed)")


class TransformMetadata(BaseModel):
    """
    Coordinate transform metadata for mapping between model space and DICOM space.

    Used to convert model outputs (e.g., keypoints at 640×480) back to original DICOM
    resolution (e.g., 800×600).
    """
    orig_h: int = Field(..., description="Original DICOM height")
    orig_w: int = Field(..., description="Original DICOM width")
    model_h: int = Field(..., description="Model input height")
    model_w: int = Field(..., description="Model input width")
    ratio_h: float = Field(..., description="orig_h / model_h")
    ratio_w: float = Field(..., description="orig_w / model_w")


class FrameBundle(BaseModel):
    """
    Bundle of frames + metadata for a single DICOM instance.

    Used internally in the pipeline to pass data between stages.
    """
    instance_uid: str
    series_uid: str
    frames: List[Any] = Field(..., description="List of frame arrays (numpy or torch tensors)")
    metadata: Dict[str, Any] = Field(default_factory=dict, description="DICOM metadata")
    num_frames: int
    pixel_spacing: Optional[tuple[float, float]] = Field(None, description="(row_mm, col_mm)")
    frame_time_ms: Optional[float] = Field(None, description="Milliseconds per frame (for cine)")

    class Config:
        arbitrary_types_allowed = True  # Allow numpy arrays
