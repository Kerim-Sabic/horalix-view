"""DICOM Storage Service for Horalix View.

Handles storage, retrieval, and management of DICOM files with support
for hierarchical organization and caching.
"""

import hashlib
import shutil
from datetime import datetime
from pathlib import Path
from typing import Any

import aiofiles
import aiofiles.os

from app.core.logging import get_logger

logger = get_logger(__name__)


class DicomStorageService:
    """Service for managing DICOM file storage.

    Organizes files in a hierarchical structure:
    storage_dir/
        ├── {patient_id}/
        │   ├── {study_uid}/
        │   │   ├── {series_uid}/
        │   │   │   ├── {instance_uid}.dcm
        │   │   │   └── ...
        │   │   └── ...
        │   └── ...
        └── ...
    """

    def __init__(self, storage_dir: Path):
        """Initialize storage service.

        Args:
            storage_dir: Base directory for DICOM storage

        """
        self.storage_dir = Path(storage_dir)
        self.cache_dir = self.storage_dir / ".cache"
        self.temp_dir = self.storage_dir / ".temp"
        self._ready = False

    async def initialize(self) -> None:
        """Initialize storage directories."""
        try:
            await aiofiles.os.makedirs(self.storage_dir, exist_ok=True)
            await aiofiles.os.makedirs(self.cache_dir, exist_ok=True)
            await aiofiles.os.makedirs(self.temp_dir, exist_ok=True)
            self._ready = True
            logger.info("DICOM storage initialized", path=str(self.storage_dir))
        except Exception as e:
            logger.error("Failed to initialize storage", error=str(e))
            raise

    def is_ready(self) -> bool:
        """Check if storage service is ready."""
        return self._ready

    async def store_instance(self, data: bytes) -> dict[str, Any]:
        """Store a DICOM instance.

        Args:
            data: DICOM file bytes

        Returns:
            Dictionary with storage information

        """
        try:
            # Parse DICOM to extract UIDs
            from io import BytesIO

            import pydicom

            ds = pydicom.dcmread(BytesIO(data), stop_before_pixels=True)

            patient_id = str(ds.get("PatientID", "UNKNOWN"))
            study_uid = str(ds.StudyInstanceUID)
            series_uid = str(ds.SeriesInstanceUID)
            instance_uid = str(ds.SOPInstanceUID)

            # Create directory structure
            instance_dir = self.storage_dir / patient_id / study_uid / series_uid
            await aiofiles.os.makedirs(instance_dir, exist_ok=True)

            # Store file
            file_path = instance_dir / f"{instance_uid}.dcm"
            async with aiofiles.open(file_path, "wb") as f:
                await f.write(data)

            # Calculate checksum
            checksum = hashlib.sha256(data).hexdigest()

            logger.info(
                "Stored DICOM instance",
                instance_uid=instance_uid,
                path=str(file_path),
            )

            return {
                "patient_id": patient_id,
                "study_instance_uid": study_uid,
                "series_instance_uid": series_uid,
                "sop_instance_uid": instance_uid,
                "file_path": str(file_path),
                "file_size": len(data),
                "checksum": checksum,
                "stored_at": datetime.now().isoformat(),
            }

        except Exception as e:
            logger.error("Failed to store DICOM instance", error=str(e))
            raise

    async def retrieve_instance(
        self,
        study_uid: str,
        series_uid: str,
        instance_uid: str,
        patient_id: str | None = None,
    ) -> bytes | None:
        """Retrieve a DICOM instance.

        Args:
            study_uid: Study Instance UID
            series_uid: Series Instance UID
            instance_uid: SOP Instance UID
            patient_id: Optional patient ID for faster lookup

        Returns:
            DICOM file bytes or None if not found

        """
        # Try direct path if patient_id is known
        if patient_id:
            file_path = (
                self.storage_dir / patient_id / study_uid / series_uid / f"{instance_uid}.dcm"
            )
            if file_path.exists():
                async with aiofiles.open(file_path, "rb") as f:
                    return await f.read()

        # Search for the instance
        for patient_dir in self.storage_dir.iterdir():
            if patient_dir.name.startswith("."):
                continue
            file_path = patient_dir / study_uid / series_uid / f"{instance_uid}.dcm"
            if file_path.exists():
                async with aiofiles.open(file_path, "rb") as f:
                    return await f.read()

        return None

    async def delete_instance(
        self,
        study_uid: str,
        series_uid: str,
        instance_uid: str,
    ) -> bool:
        """Delete a DICOM instance.

        Args:
            study_uid: Study Instance UID
            series_uid: Series Instance UID
            instance_uid: SOP Instance UID

        Returns:
            True if deleted, False if not found

        """
        for patient_dir in self.storage_dir.iterdir():
            if patient_dir.name.startswith("."):
                continue
            file_path = patient_dir / study_uid / series_uid / f"{instance_uid}.dcm"
            if file_path.exists():
                await aiofiles.os.remove(file_path)
                logger.info("Deleted DICOM instance", instance_uid=instance_uid)
                return True
        return False

    async def delete_study(self, study_uid: str) -> int:
        """Delete all instances of a study.

        Args:
            study_uid: Study Instance UID

        Returns:
            Number of instances deleted

        """
        deleted_count = 0
        for patient_dir in self.storage_dir.iterdir():
            if patient_dir.name.startswith("."):
                continue
            study_dir = patient_dir / study_uid
            if study_dir.exists():
                # Count files before deletion
                for series_dir in study_dir.iterdir():
                    if series_dir.is_dir():
                        deleted_count += len(list(series_dir.glob("*.dcm")))
                # Remove study directory
                shutil.rmtree(study_dir)
                logger.info(
                    "Deleted study",
                    study_uid=study_uid,
                    instances_deleted=deleted_count,
                )
        return deleted_count

    async def get_study_path(self, study_uid: str) -> Path | None:
        """Get the storage path for a study."""
        for patient_dir in self.storage_dir.iterdir():
            if patient_dir.name.startswith("."):
                continue
            study_dir = patient_dir / study_uid
            if study_dir.exists():
                return study_dir
        return None

    async def get_storage_stats(self) -> dict[str, Any]:
        """Get storage statistics."""
        total_size = 0
        study_count = 0
        series_count = 0
        instance_count = 0

        for patient_dir in self.storage_dir.iterdir():
            if patient_dir.name.startswith(".") or not patient_dir.is_dir():
                continue
            for study_dir in patient_dir.iterdir():
                if not study_dir.is_dir():
                    continue
                study_count += 1
                for series_dir in study_dir.iterdir():
                    if not series_dir.is_dir():
                        continue
                    series_count += 1
                    for dcm_file in series_dir.glob("*.dcm"):
                        instance_count += 1
                        total_size += dcm_file.stat().st_size

        return {
            "total_size_bytes": total_size,
            "study_count": study_count,
            "series_count": series_count,
            "instance_count": instance_count,
        }

    async def cleanup_temp(self) -> int:
        """Clean up temporary files."""
        cleaned = 0
        if self.temp_dir.exists():
            for temp_file in self.temp_dir.iterdir():
                try:
                    if temp_file.is_file():
                        await aiofiles.os.remove(temp_file)
                        cleaned += 1
                    elif temp_file.is_dir():
                        shutil.rmtree(temp_file)
                        cleaned += 1
                except Exception as e:
                    logger.warning("Failed to clean temp file", path=str(temp_file), error=str(e))
        return cleaned
