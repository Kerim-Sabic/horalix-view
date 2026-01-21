"""DICOM Parser Service for Horalix View.

Provides utilities for parsing DICOM files, extracting metadata,
and handling pixel data across different modalities.
"""

from dataclasses import dataclass
from datetime import date, time
from io import BytesIO
from pathlib import Path
from typing import Any

import numpy as np

from app.core.logging import get_logger

logger = get_logger(__name__)


@dataclass
class DicomMetadata:
    """Parsed DICOM metadata."""

    # Patient level
    patient_id: str | None = None
    patient_name: str | None = None
    patient_birth_date: date | None = None
    patient_sex: str | None = None
    patient_age: str | None = None

    # Study level
    study_instance_uid: str | None = None
    study_id: str | None = None
    study_date: date | None = None
    study_time: time | None = None
    study_description: str | None = None
    accession_number: str | None = None
    referring_physician_name: str | None = None
    institution_name: str | None = None

    # Series level
    series_instance_uid: str | None = None
    series_number: int | None = None
    series_description: str | None = None
    modality: str | None = None
    body_part_examined: str | None = None
    protocol_name: str | None = None

    # Instance level
    sop_instance_uid: str | None = None
    sop_class_uid: str | None = None
    instance_number: int | None = None
    acquisition_number: int | None = None

    # Image attributes
    rows: int | None = None
    columns: int | None = None
    bits_allocated: int | None = None
    bits_stored: int | None = None
    high_bit: int | None = None
    pixel_representation: int | None = None
    samples_per_pixel: int | None = None
    photometric_interpretation: str | None = None
    planar_configuration: int | None = None

    # Spatial attributes
    pixel_spacing: tuple[float, float] | None = None
    slice_thickness: float | None = None
    slice_location: float | None = None
    image_position_patient: tuple[float, float, float] | None = None
    image_orientation_patient: tuple[float, ...] | None = None
    spacing_between_slices: float | None = None

    # Display attributes
    window_center: float | list[float] | None = None
    window_width: float | list[float] | None = None
    rescale_intercept: float = 0.0
    rescale_slope: float = 1.0
    rescale_type: str | None = None

    # Transfer syntax
    transfer_syntax_uid: str | None = None
    is_compressed: bool = False
    is_little_endian: bool = True
    is_implicit_vr: bool = False


class DicomParser:
    """Parser for DICOM files.

    Handles parsing of DICOM headers, pixel data extraction,
    and modality-specific processing.
    """

    # SOP Class UIDs for common modalities
    SOP_CLASSES = {
        "1.2.840.10008.5.1.4.1.1.2": "CT Image Storage",
        "1.2.840.10008.5.1.4.1.1.4": "MR Image Storage",
        "1.2.840.10008.5.1.4.1.1.128": "PET Image Storage",
        "1.2.840.10008.5.1.4.1.1.6.1": "Ultrasound Image Storage",
        "1.2.840.10008.5.1.4.1.1.1.2": "Digital Mammography X-Ray Image Storage",
        "1.2.840.10008.5.1.4.1.1.1": "Computed Radiography Image Storage",
        "1.2.840.10008.5.1.4.1.1.7": "Secondary Capture Image Storage",
        "1.2.840.10008.5.1.4.1.1.88.11": "Basic Text SR Storage",
        "1.2.840.10008.5.1.4.1.1.77.1.6": "VL Whole Slide Microscopy Image Storage",
    }

    def __init__(self):
        """Initialize parser."""
        self._pydicom_available = True
        try:
            import pydicom
        except ImportError:
            self._pydicom_available = False
            logger.warning("pydicom not available, DICOM parsing disabled")

    def parse_file(self, file_path: Path | str) -> DicomMetadata:
        """Parse a DICOM file and extract metadata.

        Args:
            file_path: Path to DICOM file

        Returns:
            Parsed DicomMetadata object

        """
        if not self._pydicom_available:
            raise RuntimeError("pydicom is not installed")

        import pydicom

        ds = pydicom.dcmread(str(file_path), stop_before_pixels=True)
        return self._extract_metadata(ds)

    def parse_bytes(self, data: bytes) -> DicomMetadata:
        """Parse DICOM data from bytes.

        Args:
            data: DICOM file bytes

        Returns:
            Parsed DicomMetadata object

        """
        if not self._pydicom_available:
            raise RuntimeError("pydicom is not installed")

        import pydicom

        ds = pydicom.dcmread(BytesIO(data), stop_before_pixels=True)
        return self._extract_metadata(ds)

    def _extract_metadata(self, ds: Any) -> DicomMetadata:
        """Extract metadata from pydicom Dataset."""
        metadata = DicomMetadata()

        # Helper function for safe attribute access
        def get_value(tag: str, default: Any = None) -> Any:
            if hasattr(ds, tag):
                val = getattr(ds, tag)
                if val is not None and str(val).strip():
                    return val
            return default

        # Patient level
        metadata.patient_id = get_value("PatientID")
        metadata.patient_name = str(get_value("PatientName", ""))
        metadata.patient_sex = get_value("PatientSex")
        metadata.patient_age = get_value("PatientAge")

        if hasattr(ds, "PatientBirthDate") and ds.PatientBirthDate:
            try:
                from datetime import datetime

                metadata.patient_birth_date = datetime.strptime(
                    str(ds.PatientBirthDate), "%Y%m%d"
                ).date()
            except ValueError:
                pass

        # Study level
        metadata.study_instance_uid = get_value("StudyInstanceUID")
        metadata.study_id = get_value("StudyID")
        metadata.study_description = get_value("StudyDescription")
        metadata.accession_number = get_value("AccessionNumber")
        metadata.referring_physician_name = str(get_value("ReferringPhysicianName", ""))
        metadata.institution_name = get_value("InstitutionName")

        if hasattr(ds, "StudyDate") and ds.StudyDate:
            try:
                from datetime import datetime

                metadata.study_date = datetime.strptime(str(ds.StudyDate), "%Y%m%d").date()
            except ValueError:
                pass

        # Series level
        metadata.series_instance_uid = get_value("SeriesInstanceUID")
        metadata.series_number = get_value("SeriesNumber")
        metadata.series_description = get_value("SeriesDescription")
        metadata.modality = get_value("Modality")
        metadata.body_part_examined = get_value("BodyPartExamined")
        metadata.protocol_name = get_value("ProtocolName")

        # Instance level
        metadata.sop_instance_uid = get_value("SOPInstanceUID")
        metadata.sop_class_uid = get_value("SOPClassUID")
        metadata.instance_number = get_value("InstanceNumber")
        metadata.acquisition_number = get_value("AcquisitionNumber")

        # Image attributes
        metadata.rows = get_value("Rows")
        metadata.columns = get_value("Columns")
        metadata.bits_allocated = get_value("BitsAllocated")
        metadata.bits_stored = get_value("BitsStored")
        metadata.high_bit = get_value("HighBit")
        metadata.pixel_representation = get_value("PixelRepresentation")
        metadata.samples_per_pixel = get_value("SamplesPerPixel")
        metadata.photometric_interpretation = get_value("PhotometricInterpretation")
        metadata.planar_configuration = get_value("PlanarConfiguration")

        # Spatial attributes
        if hasattr(ds, "PixelSpacing") and ds.PixelSpacing:
            ps = ds.PixelSpacing
            metadata.pixel_spacing = (float(ps[0]), float(ps[1]))

        metadata.slice_thickness = get_value("SliceThickness")
        if metadata.slice_thickness:
            metadata.slice_thickness = float(metadata.slice_thickness)

        metadata.slice_location = get_value("SliceLocation")
        if metadata.slice_location:
            metadata.slice_location = float(metadata.slice_location)

        metadata.spacing_between_slices = get_value("SpacingBetweenSlices")
        if metadata.spacing_between_slices:
            metadata.spacing_between_slices = float(metadata.spacing_between_slices)

        if hasattr(ds, "ImagePositionPatient") and ds.ImagePositionPatient:
            ipp = ds.ImagePositionPatient
            metadata.image_position_patient = (float(ipp[0]), float(ipp[1]), float(ipp[2]))

        if hasattr(ds, "ImageOrientationPatient") and ds.ImageOrientationPatient:
            iop = ds.ImageOrientationPatient
            metadata.image_orientation_patient = tuple(float(v) for v in iop)

        # Display attributes
        wc = get_value("WindowCenter")
        ww = get_value("WindowWidth")
        if wc is not None:
            if hasattr(wc, "__iter__") and not isinstance(wc, str):
                metadata.window_center = [float(v) for v in wc]
            else:
                metadata.window_center = float(wc)
        if ww is not None:
            if hasattr(ww, "__iter__") and not isinstance(ww, str):
                metadata.window_width = [float(v) for v in ww]
            else:
                metadata.window_width = float(ww)

        ri = get_value("RescaleIntercept")
        rs = get_value("RescaleSlope")
        if ri is not None:
            metadata.rescale_intercept = float(ri)
        if rs is not None:
            metadata.rescale_slope = float(rs)
        metadata.rescale_type = get_value("RescaleType")

        # Transfer syntax
        if hasattr(ds, "file_meta") and ds.file_meta:
            metadata.transfer_syntax_uid = get_value("TransferSyntaxUID")
            if hasattr(ds.file_meta, "TransferSyntaxUID"):
                ts = str(ds.file_meta.TransferSyntaxUID)
                metadata.transfer_syntax_uid = ts
                # Check if compressed
                compressed_syntaxes = [
                    "1.2.840.10008.1.2.4",  # JPEG variants
                    "1.2.840.10008.1.2.5",  # RLE
                ]
                metadata.is_compressed = any(ts.startswith(cs) for cs in compressed_syntaxes)

        return metadata

    def get_pixel_array(
        self,
        file_path: Path | str | None = None,
        data: bytes | None = None,
        apply_rescale: bool = True,
    ) -> np.ndarray:
        """Extract pixel array from DICOM file.

        Args:
            file_path: Path to DICOM file
            data: DICOM file bytes (alternative to file_path)
            apply_rescale: Apply rescale slope/intercept

        Returns:
            Numpy array of pixel data

        """
        if not self._pydicom_available:
            raise RuntimeError("pydicom is not installed")

        import pydicom

        if file_path:
            ds = pydicom.dcmread(str(file_path))
        elif data:
            ds = pydicom.dcmread(BytesIO(data))
        else:
            raise ValueError("Must provide either file_path or data")

        pixel_array = ds.pixel_array

        if apply_rescale:
            slope = float(getattr(ds, "RescaleSlope", 1.0))
            intercept = float(getattr(ds, "RescaleIntercept", 0.0))
            if slope != 1.0 or intercept != 0.0:
                pixel_array = pixel_array.astype(np.float32) * slope + intercept

        return pixel_array

    def apply_windowing(
        self,
        pixel_array: np.ndarray,
        window_center: float,
        window_width: float,
    ) -> np.ndarray:
        """Apply window/level to pixel data.

        Args:
            pixel_array: Input pixel array
            window_center: Window center value
            window_width: Window width value

        Returns:
            Windowed array scaled to 0-255

        """
        min_val = window_center - window_width / 2
        max_val = window_center + window_width / 2

        windowed = np.clip(pixel_array, min_val, max_val)
        windowed = ((windowed - min_val) / (max_val - min_val) * 255).astype(np.uint8)

        return windowed

    def get_modality_name(self, sop_class_uid: str) -> str:
        """Get human-readable modality name from SOP Class UID."""
        return self.SOP_CLASSES.get(sop_class_uid, "Unknown")
