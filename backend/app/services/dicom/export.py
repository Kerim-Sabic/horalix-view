"""DICOM Export Service for Horalix View.

Creates real DICOM files for export including:
- DICOM Structured Reports (SR) for measurements
- DICOM Segmentation (SEG) for AI segmentations
- Original DICOM images with or without annotations

Uses highdicom for standards-compliant DICOM generation.
"""

import io
import tempfile
import zipfile
from datetime import datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

import numpy as np
import pydicom
from pydicom.uid import generate_uid
from pydicom.dataset import Dataset, FileMetaDataset
from pydicom.sequence import Sequence
from pydantic import BaseModel, Field

from app.core.logging import get_logger

logger = get_logger(__name__)


# ============================================================================
# Helpers
# ============================================================================

def _normalize_date(value: str | None) -> str | None:
    """Normalize date to DICOM YYYYMMDD format when possible."""
    if not value:
        return None
    digits = "".join(ch for ch in value if ch.isdigit())
    return digits[:8] if len(digits) >= 8 else None


def _normalize_time(value: str | None) -> str | None:
    """Normalize time to DICOM HHMMSS format when possible."""
    if not value:
        return None
    digits = "".join(ch for ch in value if ch.isdigit())
    return digits[:6] if len(digits) >= 4 else None

# ============================================================================
# Data Models
# ============================================================================

class Point2D(BaseModel):
    """2D point for measurements."""
    x: float
    y: float


class MeasurementExport(BaseModel):
    """Measurement data for export."""
    id: str
    type: str  # 'line', 'polygon', 'ellipse', etc.
    label: str | None = None
    points: list[Point2D]
    length_mm: float | None = None
    area_mm2: float | None = None
    perimeter_mm: float | None = None
    frame_index: int | None = None
    series_uid: str
    instance_uid: str | None = None


class TrackingFrameExport(BaseModel):
    """Single frame tracking data for export."""
    frame_index: int
    value: float  # length_mm or area_mm2
    unit: str  # 'mm' or 'mm2'


class TrackingExport(BaseModel):
    """Tracking data for export."""
    measurement_id: str
    label: str | None = None
    frames: list[TrackingFrameExport]
    min_value: float | None = None
    max_value: float | None = None
    mean_value: float | None = None
    unit: str  # 'mm' or 'mm2'


class SegmentationExport(BaseModel):
    """Segmentation data for export."""
    id: str
    label: str
    color: tuple[int, int, int] = (255, 0, 0)  # RGB
    mask_data: list[list[int]]  # 2D binary mask as nested lists
    frame_index: int | None = None
    instance_uid: str | None = None


class ExportRequest(BaseModel):
    """Complete export request."""
    study_uid: str
    series_uid: str
    patient_id: str | None = None
    patient_name: str | None = None
    patient_birth_date: str | None = None
    patient_sex: str | None = None
    issuer_of_patient_id: str | None = None
    other_patient_ids: str | None = None
    ethnic_group: str | None = None
    patient_comments: str | None = None
    study_id: str | None = None
    study_date: str | None = None
    study_time: str | None = None
    study_description: str | None = None
    accession_number: str | None = None
    referring_physician_name: str | None = None
    series_description: str | None = None
    series_number: int | None = None
    body_part_examined: str | None = None
    patient_position: str | None = None
    protocol_name: str | None = None
    slice_thickness: float | None = None
    spacing_between_slices: float | None = None
    window_center: float | None = None
    window_width: float | None = None
    modality: str = "US"
    measurements: list[MeasurementExport] = Field(default_factory=list)
    tracking_data: list[TrackingExport] = Field(default_factory=list)
    segmentations: list[SegmentationExport] = Field(default_factory=list)
    include_sr: bool = True
    include_seg: bool = True
    include_original: bool = True
    author_name: str | None = None
    institution_name: str | None = None


# ============================================================================
# DICOM SR Generator
# ============================================================================

class DicomSRGenerator:
    """Creates DICOM Structured Reports for measurements."""

    # DICOM coding schemes
    DCM = "DCM"  # DICOM
    SCT = "SCT"  # SNOMED CT
    UCUM = "UCUM"  # Units of Measure

    def __init__(
        self,
        study_uid: str,
        series_uid: str,
        patient_id: str | None = None,
        patient_name: str | None = None,
        patient_birth_date: str | None = None,
        patient_sex: str | None = None,
        study_id: str | None = None,
        study_date: str | None = None,
        study_time: str | None = None,
        study_description: str | None = None,
        accession_number: str | None = None,
        referring_physician_name: str | None = None,
        author_name: str | None = None,
        institution_name: str | None = None,
    ):
        """Initialize SR generator with study context."""
        self.study_uid = study_uid
        self.series_uid = series_uid
        self.patient_id = patient_id or "ANONYMOUS"
        self.patient_name = patient_name or "Anonymous^Patient"
        self.patient_birth_date = patient_birth_date
        self.patient_sex = patient_sex
        self.study_id = study_id
        self.study_date = _normalize_date(study_date) or datetime.now().strftime("%Y%m%d")
        self.study_time = _normalize_time(study_time)
        self.study_description = study_description or "Imaging Study"
        self.accession_number = accession_number
        self.referring_physician_name = referring_physician_name
        self.author_name = author_name
        self.institution_name = institution_name

        # Generate new UIDs for the SR
        self.sr_series_uid = generate_uid()
        self.sr_instance_uid = generate_uid()

    def create_sr(
        self,
        measurements: list[MeasurementExport],
        tracking_data: list[TrackingExport] | None = None,
    ) -> pydicom.Dataset:
        """Create a DICOM Structured Report with measurements.

        Args:
            measurements: List of measurements to include
            tracking_data: Optional tracking data for cine measurements

        Returns:
            Complete DICOM SR dataset ready for saving
        """
        # Create file meta information
        file_meta = FileMetaDataset()
        file_meta.MediaStorageSOPClassUID = "1.2.840.10008.5.1.4.1.1.88.22"  # Enhanced SR
        file_meta.MediaStorageSOPInstanceUID = self.sr_instance_uid
        file_meta.TransferSyntaxUID = pydicom.uid.ExplicitVRLittleEndian
        file_meta.ImplementationClassUID = "1.2.3.4.5.6.7.8.9"
        file_meta.ImplementationVersionName = "HORALIX_VIEW_1.0"

        # Create main dataset
        ds = Dataset()
        ds.file_meta = file_meta
        ds.is_little_endian = True
        ds.is_implicit_VR = False

        # Patient module
        ds.PatientName = self.patient_name
        ds.PatientID = self.patient_id
        if self.patient_birth_date:
            normalized = _normalize_date(self.patient_birth_date)
            if normalized:
                ds.PatientBirthDate = normalized
        if self.patient_sex:
            ds.PatientSex = self.patient_sex

        # General Study module
        ds.StudyInstanceUID = self.study_uid
        ds.StudyDate = self.study_date
        ds.StudyTime = self.study_time or datetime.now().strftime("%H%M%S")
        if self.referring_physician_name:
            ds.ReferringPhysicianName = self.referring_physician_name
        if self.study_id:
            ds.StudyID = self.study_id
        if self.accession_number:
            ds.AccessionNumber = self.accession_number
        ds.StudyDescription = self.study_description

        # SR Series module
        ds.Modality = "SR"
        ds.SeriesInstanceUID = self.sr_series_uid
        ds.SeriesNumber = 9999  # Use high number to appear at end
        ds.SeriesDescription = "Measurement Report"

        # SR Document module
        ds.SOPClassUID = "1.2.840.10008.5.1.4.1.1.88.22"  # Enhanced SR
        ds.SOPInstanceUID = self.sr_instance_uid
        ds.InstanceNumber = 1
        ds.ContentDate = datetime.now().strftime("%Y%m%d")
        ds.ContentTime = datetime.now().strftime("%H%M%S.%f")[:13]
        ds.ValueType = "CONTAINER"
        ds.CompletionFlag = "COMPLETE"
        ds.VerificationFlag = "UNVERIFIED"

        # Document title
        ds.ConceptNameCodeSequence = self._create_code_sequence(
            "126000", self.DCM, "Imaging Measurement Report"
        )

        # Build content tree
        ds.ContentSequence = self._build_content_tree(measurements, tracking_data)

        # Referenced series (link back to original images)
        ds.ReferencedPerformedProcedureStepSequence = Sequence()
        ds.CurrentRequestedProcedureEvidenceSequence = self._create_evidence_sequence()

        # Author info
        if self.author_name:
            author_seq = Dataset()
            author_seq.PersonName = self.author_name
            ds.ContentCreatorName = self.author_name

        if self.institution_name:
            ds.InstitutionName = self.institution_name

        return ds

    def _build_content_tree(
        self,
        measurements: list[MeasurementExport],
        tracking_data: list[TrackingExport] | None = None,
    ) -> Sequence:
        """Build the SR content tree with measurements."""
        content_seq = Sequence()

        # Add observation context
        context_item = Dataset()
        context_item.RelationshipType = "HAS OBS CONTEXT"
        context_item.ValueType = "CODE"
        context_item.ConceptNameCodeSequence = self._create_code_sequence(
            "121005", self.DCM, "Observer Type"
        )
        context_item.ConceptCodeSequence = self._create_code_sequence(
            "121006", self.DCM, "Person"
        )
        content_seq.append(context_item)

        # Add measurement group container
        measurement_group = Dataset()
        measurement_group.RelationshipType = "CONTAINS"
        measurement_group.ValueType = "CONTAINER"
        measurement_group.ConceptNameCodeSequence = self._create_code_sequence(
            "125007", self.DCM, "Measurement Group"
        )
        measurement_group.ContinuityOfContent = "SEPARATE"
        measurement_group.ContentSequence = Sequence()

        # Add each measurement
        for measurement in measurements:
            measurement_item = self._create_measurement_item(measurement)
            measurement_group.ContentSequence.append(measurement_item)

        content_seq.append(measurement_group)

        # Add tracking data if present
        if tracking_data:
            tracking_group = Dataset()
            tracking_group.RelationshipType = "CONTAINS"
            tracking_group.ValueType = "CONTAINER"
            tracking_group.ConceptNameCodeSequence = self._create_code_sequence(
                "125015", self.DCM, "Time Point Content"
            )
            tracking_group.ContinuityOfContent = "SEPARATE"
            tracking_group.ContentSequence = Sequence()

            for tracking in tracking_data:
                tracking_item = self._create_tracking_item(tracking)
                tracking_group.ContentSequence.append(tracking_item)

            content_seq.append(tracking_group)

        return content_seq

    def _create_measurement_item(self, measurement: MeasurementExport) -> Dataset:
        """Create a measurement content item."""
        item = Dataset()
        item.RelationshipType = "CONTAINS"
        item.ValueType = "CONTAINER"
        item.ContinuityOfContent = "SEPARATE"

        # Determine measurement type code
        if measurement.type == "line":
            type_code = ("410668003", self.SCT, "Length")
        elif measurement.type in ("polygon", "ellipse", "rectangle"):
            type_code = ("42798000", self.SCT, "Area")
        else:
            type_code = ("363787002", self.SCT, "Observable entity")

        item.ConceptNameCodeSequence = self._create_code_sequence(*type_code)
        item.ContentSequence = Sequence()

        # Add label if present
        if measurement.label:
            label_item = Dataset()
            label_item.RelationshipType = "HAS CONCEPT MOD"
            label_item.ValueType = "TEXT"
            label_item.ConceptNameCodeSequence = self._create_code_sequence(
                "112039", self.DCM, "Tracking Identifier"
            )
            label_item.TextValue = measurement.label
            item.ContentSequence.append(label_item)

        # Add measurement values
        if measurement.length_mm is not None:
            value_item = self._create_numeric_item(
                "410668003", self.SCT, "Length",
                measurement.length_mm, "mm", self.UCUM, "millimeter"
            )
            item.ContentSequence.append(value_item)

        if measurement.area_mm2 is not None:
            value_item = self._create_numeric_item(
                "42798000", self.SCT, "Area",
                measurement.area_mm2, "mm2", self.UCUM, "square millimeter"
            )
            item.ContentSequence.append(value_item)

        if measurement.perimeter_mm is not None:
            value_item = self._create_numeric_item(
                "131191004", self.SCT, "Circumference",
                measurement.perimeter_mm, "mm", self.UCUM, "millimeter"
            )
            item.ContentSequence.append(value_item)

        # Add spatial coordinates
        scoord_item = self._create_scoord_item(measurement)
        item.ContentSequence.append(scoord_item)

        return item

    def _create_numeric_item(
        self,
        code_value: str,
        coding_scheme: str,
        code_meaning: str,
        numeric_value: float,
        unit_code: str,
        unit_scheme: str,
        unit_meaning: str,
    ) -> Dataset:
        """Create a numeric measurement value item."""
        item = Dataset()
        item.RelationshipType = "CONTAINS"
        item.ValueType = "NUM"
        item.ConceptNameCodeSequence = self._create_code_sequence(
            code_value, coding_scheme, code_meaning
        )

        # Measured value sequence
        mv_seq = Dataset()
        mv_seq.NumericValue = str(numeric_value)
        mv_seq.FloatingPointValue = numeric_value
        mv_seq.MeasurementUnitsCodeSequence = self._create_code_sequence(
            unit_code, unit_scheme, unit_meaning
        )
        item.MeasuredValueSequence = Sequence([mv_seq])

        return item

    def _create_scoord_item(self, measurement: MeasurementExport) -> Dataset:
        """Create spatial coordinates item for measurement."""
        item = Dataset()
        item.RelationshipType = "INFERRED FROM"
        item.ValueType = "SCOORD"

        # Flatten points to coordinate array
        coords = []
        for point in measurement.points:
            coords.extend([point.x, point.y])

        item.GraphicData = coords

        if measurement.type == "line":
            item.GraphicType = "POLYLINE"
        elif measurement.type == "polygon":
            # Close the polygon
            if measurement.points:
                coords.extend([measurement.points[0].x, measurement.points[0].y])
                item.GraphicData = coords
            item.GraphicType = "POLYGON"
        elif measurement.type == "ellipse":
            item.GraphicType = "ELLIPSE"
        else:
            item.GraphicType = "POLYLINE"

        # Reference to image
        if measurement.instance_uid:
            ref_item = Dataset()
            ref_item.RelationshipType = "SELECTED FROM"
            ref_item.ValueType = "IMAGE"
            ref_seq = Dataset()
            ref_seq.ReferencedSOPClassUID = "1.2.840.10008.5.1.4.1.1.7"  # Secondary Capture
            ref_seq.ReferencedSOPInstanceUID = measurement.instance_uid
            if measurement.frame_index is not None:
                ref_seq.ReferencedFrameNumber = measurement.frame_index + 1
            ref_item.ReferencedSOPSequence = Sequence([ref_seq])
            item.ContentSequence = Sequence([ref_item])

        return item

    def _create_tracking_item(self, tracking: TrackingExport) -> Dataset:
        """Create tracking data content item."""
        item = Dataset()
        item.RelationshipType = "CONTAINS"
        item.ValueType = "CONTAINER"
        item.ContinuityOfContent = "SEPARATE"
        item.ConceptNameCodeSequence = self._create_code_sequence(
            "125010", self.DCM, "Measurement"
        )
        item.ContentSequence = Sequence()

        # Add label
        if tracking.label:
            label_item = Dataset()
            label_item.RelationshipType = "HAS CONCEPT MOD"
            label_item.ValueType = "TEXT"
            label_item.ConceptNameCodeSequence = self._create_code_sequence(
                "112039", self.DCM, "Tracking Identifier"
            )
            label_item.TextValue = tracking.label
            item.ContentSequence.append(label_item)

        # Add summary statistics
        unit_code = "mm" if tracking.unit == "mm" else "mm2"
        unit_meaning = "millimeter" if tracking.unit == "mm" else "square millimeter"

        if tracking.min_value is not None:
            min_item = self._create_numeric_item(
                "373041007", self.SCT, "Minimum",
                tracking.min_value, unit_code, self.UCUM, unit_meaning
            )
            item.ContentSequence.append(min_item)

        if tracking.max_value is not None:
            max_item = self._create_numeric_item(
                "373042000", self.SCT, "Maximum",
                tracking.max_value, unit_code, self.UCUM, unit_meaning
            )
            item.ContentSequence.append(max_item)

        if tracking.mean_value is not None:
            mean_item = self._create_numeric_item(
                "373098007", self.SCT, "Mean",
                tracking.mean_value, unit_code, self.UCUM, unit_meaning
            )
            item.ContentSequence.append(mean_item)

        # Add frame-by-frame data
        for frame_data in tracking.frames:
            frame_item = Dataset()
            frame_item.RelationshipType = "CONTAINS"
            frame_item.ValueType = "NUM"
            frame_item.ConceptNameCodeSequence = self._create_code_sequence(
                "113069", self.DCM, "Value"
            )

            mv_seq = Dataset()
            mv_seq.NumericValue = str(frame_data.value)
            mv_seq.FloatingPointValue = frame_data.value
            mv_seq.MeasurementUnitsCodeSequence = self._create_code_sequence(
                unit_code, self.UCUM, unit_meaning
            )
            frame_item.MeasuredValueSequence = Sequence([mv_seq])

            # Frame reference
            ref = Dataset()
            ref.ReferencedFrameNumber = frame_data.frame_index + 1
            frame_item.ContentSequence = Sequence([ref])

            item.ContentSequence.append(frame_item)

        return item

    def _create_code_sequence(
        self,
        code_value: str,
        coding_scheme: str,
        code_meaning: str,
    ) -> Sequence:
        """Create a code sequence item."""
        item = Dataset()
        item.CodeValue = code_value
        item.CodingSchemeDesignator = coding_scheme
        item.CodeMeaning = code_meaning
        return Sequence([item])

    def _create_evidence_sequence(self) -> Sequence:
        """Create referenced evidence sequence."""
        evidence = Dataset()
        evidence.StudyInstanceUID = self.study_uid

        series_ref = Dataset()
        series_ref.SeriesInstanceUID = self.series_uid
        series_ref.ReferencedSOPSequence = Sequence()

        evidence.ReferencedSeriesSequence = Sequence([series_ref])
        return Sequence([evidence])


# ============================================================================
# DICOM SEG Generator
# ============================================================================

class DicomSEGGenerator:
    """Creates DICOM Segmentation objects for AI results."""

    def __init__(
        self,
        study_uid: str,
        series_uid: str,
        source_instance_uid: str,
        rows: int,
        columns: int,
        patient_id: str | None = None,
        patient_name: str | None = None,
        patient_birth_date: str | None = None,
        patient_sex: str | None = None,
        study_id: str | None = None,
        study_date: str | None = None,
        study_time: str | None = None,
        study_description: str | None = None,
        accession_number: str | None = None,
        referring_physician_name: str | None = None,
        institution_name: str | None = None,
    ):
        """Initialize SEG generator."""
        self.study_uid = study_uid
        self.series_uid = series_uid
        self.source_instance_uid = source_instance_uid
        self.rows = rows
        self.columns = columns
        self.patient_id = patient_id or "ANONYMOUS"
        self.patient_name = patient_name or "Anonymous^Patient"
        self.patient_birth_date = patient_birth_date
        self.patient_sex = patient_sex
        self.study_id = study_id
        self.study_date = _normalize_date(study_date) or datetime.now().strftime("%Y%m%d")
        self.study_time = _normalize_time(study_time)
        self.study_description = study_description
        self.accession_number = accession_number
        self.referring_physician_name = referring_physician_name
        self.institution_name = institution_name

        self.seg_series_uid = generate_uid()
        self.seg_instance_uid = generate_uid()

    def create_seg(
        self,
        segmentations: list[SegmentationExport],
    ) -> pydicom.Dataset:
        """Create a DICOM Segmentation with given masks.

        Args:
            segmentations: List of segmentation masks

        Returns:
            Complete DICOM SEG dataset
        """
        # Create file meta
        file_meta = FileMetaDataset()
        file_meta.MediaStorageSOPClassUID = "1.2.840.10008.5.1.4.1.1.66.4"  # Segmentation
        file_meta.MediaStorageSOPInstanceUID = self.seg_instance_uid
        file_meta.TransferSyntaxUID = pydicom.uid.ExplicitVRLittleEndian
        file_meta.ImplementationClassUID = "1.2.3.4.5.6.7.8.9"
        file_meta.ImplementationVersionName = "HORALIX_VIEW_1.0"

        ds = Dataset()
        ds.file_meta = file_meta
        ds.is_little_endian = True
        ds.is_implicit_VR = False

        # Patient module
        ds.PatientName = self.patient_name
        ds.PatientID = self.patient_id
        if self.patient_birth_date:
            normalized = _normalize_date(self.patient_birth_date)
            if normalized:
                ds.PatientBirthDate = normalized
        if self.patient_sex:
            ds.PatientSex = self.patient_sex

        # Study module
        ds.StudyInstanceUID = self.study_uid
        ds.StudyDate = self.study_date
        ds.StudyTime = self.study_time or datetime.now().strftime("%H%M%S")
        if self.referring_physician_name:
            ds.ReferringPhysicianName = self.referring_physician_name
        if self.study_id:
            ds.StudyID = self.study_id
        if self.accession_number:
            ds.AccessionNumber = self.accession_number
        if self.study_description:
            ds.StudyDescription = self.study_description
        if self.institution_name:
            ds.InstitutionName = self.institution_name

        # Series module
        ds.Modality = "SEG"
        ds.SeriesInstanceUID = self.seg_series_uid
        ds.SeriesNumber = 9998
        ds.SeriesDescription = "AI Segmentation"

        # Instance module
        ds.SOPClassUID = "1.2.840.10008.5.1.4.1.1.66.4"
        ds.SOPInstanceUID = self.seg_instance_uid
        ds.InstanceNumber = 1
        ds.ContentDate = datetime.now().strftime("%Y%m%d")
        ds.ContentTime = datetime.now().strftime("%H%M%S.%f")[:13]

        # Image Pixel module
        ds.SamplesPerPixel = 1
        ds.PhotometricInterpretation = "MONOCHROME2"
        ds.Rows = self.rows
        ds.Columns = self.columns
        ds.BitsAllocated = 8
        ds.BitsStored = 8
        ds.HighBit = 7
        ds.PixelRepresentation = 0
        ds.LossyImageCompression = "00"
        ds.SegmentationType = "BINARY"

        # Referenced Series Sequence
        ref_series = Dataset()
        ref_series.SeriesInstanceUID = self.series_uid
        ref_instance = Dataset()
        ref_instance.ReferencedSOPClassUID = "1.2.840.10008.5.1.4.1.1.7"
        ref_instance.ReferencedSOPInstanceUID = self.source_instance_uid
        ref_series.ReferencedInstanceSequence = Sequence([ref_instance])
        ds.ReferencedSeriesSequence = Sequence([ref_series])

        # Build segment sequences and pixel data
        ds.SegmentSequence = Sequence()
        all_frames = []

        for i, seg in enumerate(segmentations):
            # Segment sequence item
            seg_item = Dataset()
            seg_item.SegmentNumber = i + 1
            seg_item.SegmentLabel = seg.label
            seg_item.SegmentAlgorithmType = "AUTOMATIC"
            seg_item.SegmentAlgorithmName = "Horalix AI"

            # Category and type codes
            seg_item.SegmentedPropertyCategoryCodeSequence = self._create_code_sequence(
                "123037004", "SCT", "Anatomical Structure"
            )
            seg_item.SegmentedPropertyTypeCodeSequence = self._create_code_sequence(
                "123037004", "SCT", "Anatomical Structure"
            )

            # Color (CIELab)
            r, g, b = seg.color
            seg_item.RecommendedDisplayCIELabValue = [
                int(r * 100 / 255),
                int((g - 128) * 256 / 255),
                int((b - 128) * 256 / 255),
            ]

            ds.SegmentSequence.append(seg_item)

            # Add mask to frames
            mask = np.array(seg.mask_data, dtype=np.uint8)
            if mask.shape != (self.rows, self.columns):
                # Resize if needed
                import cv2
                mask = cv2.resize(mask, (self.columns, self.rows), interpolation=cv2.INTER_NEAREST)
            all_frames.append(mask)

        # Combine frames into pixel data
        if all_frames:
            pixel_array = np.stack(all_frames, axis=0)
            ds.NumberOfFrames = len(all_frames)
            ds.PixelData = pixel_array.tobytes()

            # Per-frame functional groups
            ds.PerFrameFunctionalGroupsSequence = Sequence()
            for i in range(len(all_frames)):
                frame_item = Dataset()
                seg_id = Dataset()
                seg_id.ReferencedSegmentNumber = i + 1
                frame_item.SegmentIdentificationSequence = Sequence([seg_id])
                ds.PerFrameFunctionalGroupsSequence.append(frame_item)

        return ds

    def _create_code_sequence(
        self,
        code_value: str,
        coding_scheme: str,
        code_meaning: str,
    ) -> Sequence:
        """Create a code sequence item."""
        item = Dataset()
        item.CodeValue = code_value
        item.CodingSchemeDesignator = coding_scheme
        item.CodeMeaning = code_meaning
        return Sequence([item])


# ============================================================================
# Export Service
# ============================================================================

class DicomExportService:
    """Service for exporting DICOM data with measurements and segmentations."""

    def __init__(self, storage_dir: Path):
        """Initialize export service.

        Args:
            storage_dir: Base directory for DICOM storage
        """
        self.storage_dir = Path(storage_dir)
        self.export_dir = self.storage_dir / ".exports"

    async def initialize(self) -> None:
        """Initialize export directories."""
        import aiofiles.os
        await aiofiles.os.makedirs(self.export_dir, exist_ok=True)

    async def create_export_package(
        self,
        request: ExportRequest,
    ) -> tuple[bytes, str]:
        """Create a ZIP package with DICOM files.

        Args:
            request: Export request with measurements and segmentations

        Returns:
            Tuple of (zip_bytes, filename)
        """
        logger.info(
            "Creating DICOM export package",
            study_uid=request.study_uid,
            num_measurements=len(request.measurements),
            num_segmentations=len(request.segmentations),
        )

        # Create temporary directory for files
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)
            files_to_include: list[tuple[Path, str]] = []

            # Generate SR if requested and there are measurements
            if request.include_sr and request.measurements:
                sr_generator = DicomSRGenerator(
                    study_uid=request.study_uid,
                    series_uid=request.series_uid,
                    patient_id=request.patient_id,
                    patient_name=request.patient_name,
                    patient_birth_date=request.patient_birth_date,
                    patient_sex=request.patient_sex,
                    study_id=request.study_id,
                    study_date=request.study_date,
                    study_time=request.study_time,
                    study_description=request.study_description,
                    accession_number=request.accession_number,
                    referring_physician_name=request.referring_physician_name,
                    author_name=request.author_name,
                    institution_name=request.institution_name,
                )

                tracking = request.tracking_data if request.tracking_data else None
                sr_dataset = sr_generator.create_sr(request.measurements, tracking)

                sr_path = temp_path / "SR" / f"measurement_report_{sr_generator.sr_instance_uid}.dcm"
                sr_path.parent.mkdir(parents=True, exist_ok=True)
                sr_dataset.save_as(str(sr_path))
                files_to_include.append((sr_path, f"SR/{sr_path.name}"))

                logger.info("Created DICOM SR", instance_uid=sr_generator.sr_instance_uid)

            # Generate SEG if requested and there are segmentations
            if request.include_seg and request.segmentations:
                # Get dimensions from first segmentation
                first_seg = request.segmentations[0]
                rows = len(first_seg.mask_data)
                columns = len(first_seg.mask_data[0]) if rows > 0 else 0

                seg_generator = DicomSEGGenerator(
                    study_uid=request.study_uid,
                    series_uid=request.series_uid,
                    source_instance_uid=first_seg.instance_uid or generate_uid(),
                    rows=rows,
                    columns=columns,
                    patient_id=request.patient_id,
                    patient_name=request.patient_name,
                    patient_birth_date=request.patient_birth_date,
                    patient_sex=request.patient_sex,
                    study_id=request.study_id,
                    study_date=request.study_date,
                    study_time=request.study_time,
                    study_description=request.study_description,
                    accession_number=request.accession_number,
                    referring_physician_name=request.referring_physician_name,
                    institution_name=request.institution_name,
                )

                seg_dataset = seg_generator.create_seg(request.segmentations)

                seg_path = temp_path / "SEG" / f"segmentation_{seg_generator.seg_instance_uid}.dcm"
                seg_path.parent.mkdir(parents=True, exist_ok=True)
                seg_dataset.save_as(str(seg_path))
                files_to_include.append((seg_path, f"SEG/{seg_path.name}"))

                logger.info("Created DICOM SEG", instance_uid=seg_generator.seg_instance_uid)

            # Copy original DICOM files if requested
            if request.include_original:
                original_files = await self._find_original_files(
                    request.study_uid,
                    request.series_uid,
                )
                has_overrides = self._has_metadata_overrides(request)
                for orig_path in original_files:
                    arc_name = f"ORIGINAL/{orig_path.parent.name}/{orig_path.name}"
                    if not has_overrides:
                        files_to_include.append((orig_path, arc_name))
                        continue

                    try:
                        ds = pydicom.dcmread(str(orig_path))
                        self._apply_metadata_overrides(ds, request)
                        updated_path = temp_path / "ORIGINAL" / orig_path.parent.name / orig_path.name
                        updated_path.parent.mkdir(parents=True, exist_ok=True)
                        ds.save_as(str(updated_path), write_like_original=False)
                        files_to_include.append((updated_path, arc_name))
                    except Exception as exc:
                        logger.warning(
                            "Failed to update DICOM metadata for export; using original file",
                            file=str(orig_path),
                            error=str(exc),
                        )
                        files_to_include.append((orig_path, arc_name))

            # Create ZIP archive
            zip_buffer = io.BytesIO()
            with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
                for file_path, arc_name in files_to_include:
                    zf.write(file_path, arc_name)

                # Add manifest
                manifest = self._create_manifest(request, files_to_include)
                zf.writestr("MANIFEST.txt", manifest)

            zip_bytes = zip_buffer.getvalue()
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            filename = f"dicom_export_{request.study_uid[-8:]}_{timestamp}.zip"

            logger.info(
                "Export package created",
                filename=filename,
                size_bytes=len(zip_bytes),
                num_files=len(files_to_include),
            )

            return zip_bytes, filename

    async def _find_original_files(
        self,
        study_uid: str,
        series_uid: str,
    ) -> list[Path]:
        """Find original DICOM files for a series."""
        files = []

        # Search in storage directory
        for patient_dir in self.storage_dir.iterdir():
            if patient_dir.name.startswith("."):
                continue

            study_path = patient_dir / study_uid / series_uid
            if study_path.exists():
                files.extend(study_path.glob("*.dcm"))

        return files

    def _has_metadata_overrides(self, request: ExportRequest) -> bool:
        """Check if any metadata overrides were provided."""
        values = [
            request.patient_id,
            request.patient_name,
            request.patient_birth_date,
            request.patient_sex,
            request.issuer_of_patient_id,
            request.other_patient_ids,
            request.ethnic_group,
            request.patient_comments,
            request.study_id,
            request.study_date,
            request.study_time,
            request.study_description,
            request.accession_number,
            request.referring_physician_name,
            request.institution_name,
            request.series_description,
            request.series_number,
            request.body_part_examined,
            request.patient_position,
            request.protocol_name,
            request.slice_thickness,
            request.spacing_between_slices,
            request.window_center,
            request.window_width,
        ]
        for value in values:
            if value is None:
                continue
            if isinstance(value, str) and not value.strip():
                continue
            return True
        return False

    def _apply_metadata_overrides(self, ds: pydicom.Dataset, request: ExportRequest) -> None:
        """Apply metadata overrides to a DICOM dataset."""
        def set_if(tag: str, value: Any, transform: Any | None = None) -> None:
            if value is None:
                return
            if isinstance(value, str) and not value.strip():
                return
            ds.__setattr__(tag, transform(value) if transform else value)

        set_if("PatientID", request.patient_id)
        set_if("PatientName", request.patient_name)
        set_if("PatientBirthDate", _normalize_date(request.patient_birth_date))
        set_if("PatientSex", request.patient_sex)
        set_if("IssuerOfPatientID", request.issuer_of_patient_id)
        set_if("OtherPatientIDs", request.other_patient_ids)
        set_if("EthnicGroup", request.ethnic_group)
        set_if("PatientComments", request.patient_comments)

        set_if("StudyID", request.study_id)
        set_if("StudyDate", _normalize_date(request.study_date))
        set_if("StudyTime", _normalize_time(request.study_time))
        set_if("StudyDescription", request.study_description)
        set_if("AccessionNumber", request.accession_number)
        set_if("ReferringPhysicianName", request.referring_physician_name)
        set_if("InstitutionName", request.institution_name)

        set_if("SeriesDescription", request.series_description)
        set_if("SeriesNumber", request.series_number)
        set_if("BodyPartExamined", request.body_part_examined)
        set_if("PatientPosition", request.patient_position)
        set_if("ProtocolName", request.protocol_name)
        set_if("SliceThickness", request.slice_thickness)
        set_if("SpacingBetweenSlices", request.spacing_between_slices)
        set_if("WindowCenter", request.window_center)
        set_if("WindowWidth", request.window_width)

    def _create_manifest(
        self,
        request: ExportRequest,
        files: list[tuple[Path, str]],
    ) -> str:
        """Create export manifest text."""
        lines = [
            "HORALIX DICOM EXPORT MANIFEST",
            "=" * 50,
            f"Export Date: {datetime.now().isoformat()}",
            f"Study UID: {request.study_uid}",
            f"Series UID: {request.series_uid}",
            f"Patient ID: {request.patient_id or 'N/A'}",
            f"Patient Name: {request.patient_name or 'N/A'}",
            f"Study Description: {request.study_description or 'N/A'}",
            f"Series Description: {request.series_description or 'N/A'}",
            "",
            "CONTENTS:",
            "-" * 30,
        ]

        sr_files = [f for _, f in files if f.startswith("SR/")]
        seg_files = [f for _, f in files if f.startswith("SEG/")]
        orig_files = [f for _, f in files if f.startswith("ORIGINAL/")]

        if sr_files:
            lines.append(f"\nStructured Reports ({len(sr_files)} files):")
            for f in sr_files:
                lines.append(f"  - {f}")

        if seg_files:
            lines.append(f"\nSegmentation Objects ({len(seg_files)} files):")
            for f in seg_files:
                lines.append(f"  - {f}")

        if orig_files:
            lines.append(f"\nOriginal Images ({len(orig_files)} files):")
            for f in orig_files:
                lines.append(f"  - {f}")

        lines.extend([
            "",
            "MEASUREMENTS:",
            "-" * 30,
        ])

        for m in request.measurements:
            label = m.label or f"{m.type.title()} Measurement"
            if m.length_mm is not None:
                lines.append(f"  {label}: {m.length_mm:.2f} mm")
            elif m.area_mm2 is not None:
                lines.append(f"  {label}: {m.area_mm2:.2f} mm^2")

        if request.tracking_data:
            lines.extend([
                "",
                "TRACKING DATA:",
                "-" * 30,
            ])
            for t in request.tracking_data:
                label = t.label or f"Measurement {t.measurement_id[:8]}"
                lines.append(f"  {label}:")
                if t.min_value is not None:
                    lines.append(f"    Min: {t.min_value:.2f} {t.unit}")
                if t.max_value is not None:
                    lines.append(f"    Max: {t.max_value:.2f} {t.unit}")
                if t.mean_value is not None:
                    lines.append(f"    Mean: {t.mean_value:.2f} {t.unit}")

        lines.extend([
            "",
            "-" * 50,
            "Generated by Horalix DICOM Viewer",
        ])

        return "\n".join(lines)


# Factory function for dependency injection
def get_export_service(storage_dir: Path) -> DicomExportService:
    """Get DICOM export service instance."""
    return DicomExportService(storage_dir)
