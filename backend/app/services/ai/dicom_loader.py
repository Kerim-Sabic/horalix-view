"""DICOM Loading Pipeline for AI Inference.

Provides clean utilities to load pixel data from stored DICOM instances,
building properly ordered volumes with correct metadata for AI model inference.
"""

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np

from app.core.logging import get_logger
from app.services.dicom.storage import DicomStorageService

logger = get_logger(__name__)


@dataclass
class VolumeMetadata:
    """Metadata for a loaded DICOM volume."""

    study_uid: str
    series_uid: str
    modality: str
    pixel_spacing: tuple[float, float] | None = None
    slice_thickness: float | None = None
    spacing: tuple[float, float, float] | None = None  # (z, y, x) or (row, col) for 2D
    image_orientation: list[float] | None = None
    image_position: list[float] | None = None
    window_center: float | None = None
    window_width: float | None = None
    rescale_slope: float = 1.0
    rescale_intercept: float = 0.0
    photometric_interpretation: str = "MONOCHROME2"
    bits_stored: int = 16
    rows: int = 512
    columns: int = 512
    num_slices: int = 1
    instance_uids: list[str] = field(default_factory=list)
    instance_files: list[str] = field(default_factory=list)


@dataclass
class LoadedVolume:
    """A loaded DICOM volume with pixel data and metadata."""

    pixel_data: np.ndarray  # Shape: (D, H, W) for 3D or (H, W) for 2D
    metadata: VolumeMetadata
    is_3d: bool = True

    @property
    def shape(self) -> tuple[int, ...]:
        return self.pixel_data.shape

    @property
    def dtype(self) -> np.dtype:
        return self.pixel_data.dtype


class DicomLoader:
    """DICOM loading pipeline for AI inference.

    Loads pixel data from stored DICOM instances, orders slices correctly,
    and provides properly formatted numpy arrays for model inference.
    """

    def __init__(self, storage_service: DicomStorageService):
        """Initialize the DICOM loader.

        Args:
            storage_service: The DICOM storage service for file access

        """
        self.storage = storage_service

    async def load_series(
        self,
        study_uid: str,
        series_uid: str,
        apply_rescale: bool = False,
        apply_windowing: bool = False,
        target_dtype: np.dtype | None = None,
    ) -> LoadedVolume:
        """Load a complete DICOM series as a volume.

        Args:
            study_uid: Study Instance UID
            series_uid: Series Instance UID
            apply_rescale: Apply RescaleSlope/Intercept to get HU values (for CT)
            apply_windowing: Apply WindowCenter/Width for display
            target_dtype: Target numpy dtype (default: preserve original)

        Returns:
            LoadedVolume with pixel data and metadata

        Raises:
            FileNotFoundError: If series not found
            ValueError: If no valid DICOM instances found

        """
        import pydicom

        # Find the study directory
        study_path = await self.storage.get_study_path(study_uid)
        if study_path is None:
            raise FileNotFoundError(f"Study not found: {study_uid}")

        series_path = study_path / series_uid
        if not series_path.exists():
            raise FileNotFoundError(f"Series not found: {series_uid}")

        # Load all DICOM files in the series
        dcm_files = list(series_path.glob("*.dcm"))
        if not dcm_files:
            raise ValueError(f"No DICOM instances found in series: {series_uid}")

        # Read all datasets
        datasets: list[tuple[pydicom.Dataset, float, str, Path]] = []

        for dcm_file in dcm_files:
            try:
                ds = pydicom.dcmread(str(dcm_file))

                # Get slice location for ordering
                slice_location = float(getattr(ds, "SliceLocation", 0.0))
                if slice_location == 0.0:
                    # Try to compute from ImagePositionPatient
                    if hasattr(ds, "ImagePositionPatient") and hasattr(
                        ds, "ImageOrientationPatient"
                    ):
                        pos = ds.ImagePositionPatient
                        orient = ds.ImageOrientationPatient
                        # Use the z-component (or compute from orientation)
                        slice_location = float(pos[2])
                    else:
                        # Fall back to instance number
                        slice_location = float(getattr(ds, "InstanceNumber", 0))

                instance_uid = str(ds.SOPInstanceUID)
                datasets.append((ds, slice_location, instance_uid, dcm_file))

            except Exception as e:
                logger.warning(f"Failed to read DICOM file {dcm_file}: {e}")
                continue

        if not datasets:
            raise ValueError(f"No valid DICOM instances found in series: {series_uid}")

        # Sort by slice location
        datasets.sort(key=lambda x: x[1])

        # Extract metadata from first dataset
        first_ds = datasets[0][0]
        metadata = self._extract_metadata(first_ds, study_uid, series_uid, [d[2] for d in datasets])
        metadata.instance_files = [str(d[3]) for d in datasets]
        metadata.num_slices = len(datasets)

        # Build volume
        if len(datasets) == 1:
            # Single slice (2D)
            pixel_array = self._get_pixel_array(first_ds)
            volume = pixel_array
            is_3d = False
        else:
            # Multi-slice (3D)
            slices = []
            for ds, _, _, _ in datasets:
                pixel_array = self._get_pixel_array(ds)
                slices.append(pixel_array)

            # Stack into 3D volume (D, H, W)
            volume = np.stack(slices, axis=0)
            is_3d = True

            # Calculate z-spacing from slice locations
            if len(datasets) >= 2:
                z_spacing = abs(datasets[1][1] - datasets[0][1])
                if z_spacing > 0 and metadata.pixel_spacing:
                    metadata.spacing = (
                        z_spacing,
                        metadata.pixel_spacing[0],
                        metadata.pixel_spacing[1],
                    )
                    metadata.slice_thickness = z_spacing

        # Apply rescale if requested
        if apply_rescale:
            volume = volume.astype(np.float32)
            volume = volume * metadata.rescale_slope + metadata.rescale_intercept

        # Apply windowing if requested
        if (
            apply_windowing
            and metadata.window_center is not None
            and metadata.window_width is not None
        ):
            volume = self._apply_windowing(
                volume,
                metadata.window_center,
                metadata.window_width,
                metadata.rescale_slope if not apply_rescale else 1.0,
                metadata.rescale_intercept if not apply_rescale else 0.0,
            )

        # Convert dtype if requested
        if target_dtype is not None:
            volume = volume.astype(target_dtype)

        logger.info(
            "Loaded DICOM series",
            study_uid=study_uid,
            series_uid=series_uid,
            shape=volume.shape,
            dtype=str(volume.dtype),
            modality=metadata.modality,
        )

        return LoadedVolume(
            pixel_data=volume,
            metadata=metadata,
            is_3d=is_3d,
        )

    async def load_instance(
        self,
        study_uid: str,
        series_uid: str,
        instance_uid: str,
        apply_rescale: bool = False,
    ) -> LoadedVolume:
        """Load a single DICOM instance.

        Args:
            study_uid: Study Instance UID
            series_uid: Series Instance UID
            instance_uid: SOP Instance UID
            apply_rescale: Apply RescaleSlope/Intercept

        Returns:
            LoadedVolume with 2D pixel data

        """
        from io import BytesIO

        import pydicom

        # Retrieve the instance data
        data = await self.storage.retrieve_instance(
            study_uid=study_uid,
            series_uid=series_uid,
            instance_uid=instance_uid,
        )

        if data is None:
            raise FileNotFoundError(f"Instance not found: {instance_uid} in series {series_uid}")

        # Parse DICOM
        ds = pydicom.dcmread(BytesIO(data))

        # Extract metadata
        metadata = self._extract_metadata(ds, study_uid, series_uid, [instance_uid])

        # Get pixel data
        pixel_array = self._get_pixel_array(ds)

        # Apply rescale if requested
        if apply_rescale:
            pixel_array = pixel_array.astype(np.float32)
            pixel_array = pixel_array * metadata.rescale_slope + metadata.rescale_intercept

        return LoadedVolume(
            pixel_data=pixel_array,
            metadata=metadata,
            is_3d=False,
        )

    def _get_pixel_array(self, ds: Any) -> np.ndarray:
        """Extract pixel array from dataset."""
        try:
            pixel_array = ds.pixel_array
            return pixel_array.astype(np.float32)
        except Exception as e:
            logger.error(f"Failed to extract pixel data: {e}")
            raise ValueError(f"Cannot extract pixel data: {e}")

    def _extract_metadata(
        self,
        ds: Any,
        study_uid: str,
        series_uid: str,
        instance_uids: list[str],
    ) -> VolumeMetadata:
        """Extract metadata from a DICOM dataset."""
        # Get pixel spacing
        pixel_spacing = None
        if hasattr(ds, "PixelSpacing") and ds.PixelSpacing:
            pixel_spacing = (float(ds.PixelSpacing[0]), float(ds.PixelSpacing[1]))

        # Get window settings
        window_center = None
        window_width = None
        if hasattr(ds, "WindowCenter"):
            wc = ds.WindowCenter
            window_center = float(wc[0] if isinstance(wc, (list, tuple)) else wc)
        if hasattr(ds, "WindowWidth"):
            ww = ds.WindowWidth
            window_width = float(ww[0] if isinstance(ww, (list, tuple)) else ww)

        # Get rescale values
        rescale_slope = float(getattr(ds, "RescaleSlope", 1.0))
        rescale_intercept = float(getattr(ds, "RescaleIntercept", 0.0))

        return VolumeMetadata(
            study_uid=study_uid,
            series_uid=series_uid,
            modality=str(getattr(ds, "Modality", "UNKNOWN")),
            pixel_spacing=pixel_spacing,
            slice_thickness=float(getattr(ds, "SliceThickness", 0.0)) or None,
            image_orientation=(
                list(ds.ImageOrientationPatient) if hasattr(ds, "ImageOrientationPatient") else None
            ),
            image_position=(
                list(ds.ImagePositionPatient) if hasattr(ds, "ImagePositionPatient") else None
            ),
            window_center=window_center,
            window_width=window_width,
            rescale_slope=rescale_slope,
            rescale_intercept=rescale_intercept,
            photometric_interpretation=str(getattr(ds, "PhotometricInterpretation", "MONOCHROME2")),
            bits_stored=int(getattr(ds, "BitsStored", 16)),
            rows=int(getattr(ds, "Rows", 512)),
            columns=int(getattr(ds, "Columns", 512)),
            instance_uids=instance_uids,
        )

    def _apply_windowing(
        self,
        image: np.ndarray,
        window_center: float,
        window_width: float,
        rescale_slope: float = 1.0,
        rescale_intercept: float = 0.0,
    ) -> np.ndarray:
        """Apply windowing to image for display."""
        # Apply rescale if not already applied
        img = image.astype(np.float32)
        if rescale_slope != 1.0 or rescale_intercept != 0.0:
            img = img * rescale_slope + rescale_intercept

        # Apply windowing
        lower = window_center - window_width / 2
        upper = window_center + window_width / 2

        img = np.clip(img, lower, upper)
        img = (img - lower) / (window_width) * 255.0

        return img.astype(np.uint8)

    def prepare_for_inference(
        self,
        volume: LoadedVolume,
        normalize: bool = True,
        convert_to_rgb: bool = False,
        target_size: tuple[int, int] | None = None,
    ) -> np.ndarray:
        """Prepare a loaded volume for model inference.

        Args:
            volume: LoadedVolume from load_series/load_instance
            normalize: Normalize to [0, 1] range
            convert_to_rgb: Convert grayscale to RGB (3 channels)
            target_size: Resize to (height, width) if specified

        Returns:
            Preprocessed numpy array ready for inference

        """
        import cv2

        data = volume.pixel_data.copy()

        # Normalize to [0, 1]
        if normalize:
            if data.dtype == np.uint8:
                data = data.astype(np.float32) / 255.0
            else:
                # For medical images, normalize based on percentiles to handle outliers
                p_low, p_high = np.percentile(data, [0.5, 99.5])
                data = np.clip(data, p_low, p_high)
                data = (data - p_low) / (p_high - p_low + 1e-8)
                data = data.astype(np.float32)

        # Handle 3D volumes - process slice by slice if needed
        if volume.is_3d:
            processed_slices = []
            for i in range(data.shape[0]):
                slice_data = data[i]
                if target_size:
                    slice_data = cv2.resize(slice_data, target_size[::-1])  # cv2 uses (w, h)
                if convert_to_rgb:
                    slice_data = np.stack([slice_data] * 3, axis=-1)
                processed_slices.append(slice_data)
            data = np.stack(processed_slices, axis=0)
        else:
            if target_size:
                data = cv2.resize(data, target_size[::-1])
            if convert_to_rgb:
                data = np.stack([data] * 3, axis=-1)

        return data
