"""DICOM Networking Service for Horalix View.

Implements DICOM networking protocols including C-STORE, C-MOVE, C-FIND,
and C-ECHO for PACS integration.
"""

from collections.abc import Callable
from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from typing import Any

from app.core.logging import get_logger

logger = get_logger(__name__)


class DicomServiceType(str, Enum):
    """DICOM service types."""

    C_ECHO = "C-ECHO"
    C_STORE = "C-STORE"
    C_FIND = "C-FIND"
    C_MOVE = "C-MOVE"
    C_GET = "C-GET"


class QueryRetrieveLevel(str, Enum):
    """DICOM Query/Retrieve levels."""

    PATIENT = "PATIENT"
    STUDY = "STUDY"
    SERIES = "SERIES"
    IMAGE = "IMAGE"


@dataclass
class DicomNode:
    """DICOM network node configuration."""

    ae_title: str
    host: str
    port: int
    description: str = ""
    is_tls: bool = False


@dataclass
class AssociationResult:
    """Result of DICOM association."""

    success: bool
    message: str
    accepted_contexts: list[str] = None
    rejected_contexts: list[str] = None


@dataclass
class QueryResult:
    """Result of DICOM query."""

    level: QueryRetrieveLevel
    matches: list[dict[str, Any]]
    status: str
    message: str = ""


class DicomNetworkService:
    """Service for DICOM networking operations.

    Supports:
    - C-ECHO: Verify connectivity
    - C-FIND: Query for studies/series/instances
    - C-MOVE: Request data transfer
    - C-STORE: Store DICOM instances
    """

    def __init__(
        self,
        ae_title: str = "HORALIX_VIEW",
        port: int = 11112,
        storage_dir: Path | None = None,
    ):
        """Initialize DICOM network service.

        Args:
            ae_title: Application Entity Title
            port: DICOM listening port
            storage_dir: Directory for storing received instances

        """
        self.ae_title = ae_title
        self.port = port
        self.storage_dir = storage_dir or Path("./storage/dicom")
        self._scp_running = False
        self._registered_nodes: dict[str, DicomNode] = {}
        self._pynetdicom_available = True

        try:
            import pynetdicom
        except ImportError:
            self._pynetdicom_available = False
            logger.warning("pynetdicom not available, DICOM networking disabled")

    def register_node(self, node: DicomNode) -> None:
        """Register a DICOM node for communication.

        Args:
            node: DicomNode configuration

        """
        self._registered_nodes[node.ae_title] = node
        logger.info(
            "Registered DICOM node",
            ae_title=node.ae_title,
            host=node.host,
            port=node.port,
        )

    def unregister_node(self, ae_title: str) -> bool:
        """Unregister a DICOM node.

        Args:
            ae_title: AE Title of node to remove

        Returns:
            True if removed, False if not found

        """
        if ae_title in self._registered_nodes:
            del self._registered_nodes[ae_title]
            return True
        return False

    def get_registered_nodes(self) -> list[DicomNode]:
        """Get all registered DICOM nodes."""
        return list(self._registered_nodes.values())

    async def echo(self, node: DicomNode) -> AssociationResult:
        """Verify connectivity to a DICOM node using C-ECHO.

        Args:
            node: Target DICOM node

        Returns:
            AssociationResult indicating success/failure

        """
        if not self._pynetdicom_available:
            return AssociationResult(
                success=False,
                message="pynetdicom not available",
            )

        try:
            from pynetdicom import AE
            from pynetdicom.sop_class import Verification

            ae = AE(ae_title=self.ae_title)
            ae.add_requested_context(Verification)

            assoc = ae.associate(node.host, node.port, ae_title=node.ae_title)

            if assoc.is_established:
                status = assoc.send_c_echo()
                assoc.release()

                if status and status.Status == 0x0000:
                    return AssociationResult(
                        success=True,
                        message="C-ECHO successful",
                    )
                return AssociationResult(
                    success=False,
                    message=f"C-ECHO failed with status: {status}",
                )
            return AssociationResult(
                success=False,
                message="Association rejected or aborted",
            )

        except Exception as e:
            logger.error("C-ECHO failed", error=str(e))
            return AssociationResult(
                success=False,
                message=str(e),
            )

    async def find(
        self,
        node: DicomNode,
        level: QueryRetrieveLevel,
        query: dict[str, Any],
    ) -> QueryResult:
        """Query a DICOM node using C-FIND.

        Args:
            node: Target DICOM node
            level: Query/Retrieve level
            query: Query parameters (DICOM tag names to values)

        Returns:
            QueryResult with matching records

        """
        if not self._pynetdicom_available:
            return QueryResult(
                level=level,
                matches=[],
                status="error",
                message="pynetdicom not available",
            )

        try:
            from pydicom.dataset import Dataset
            from pynetdicom import AE
            from pynetdicom.sop_class import (
                PatientRootQueryRetrieveInformationModelFind,
                StudyRootQueryRetrieveInformationModelFind,
            )

            ae = AE(ae_title=self.ae_title)
            ae.add_requested_context(StudyRootQueryRetrieveInformationModelFind)
            ae.add_requested_context(PatientRootQueryRetrieveInformationModelFind)

            # Build query dataset
            ds = Dataset()
            ds.QueryRetrieveLevel = level.value

            # Map common query parameters
            tag_mapping = {
                "PatientID": 0x00100020,
                "PatientName": 0x00100010,
                "StudyInstanceUID": 0x0020000D,
                "StudyDate": 0x00080020,
                "Modality": 0x00080060,
                "SeriesInstanceUID": 0x0020000E,
                "SOPInstanceUID": 0x00080018,
            }

            for key, value in query.items():
                if key in tag_mapping:
                    setattr(ds, key, value)

            assoc = ae.associate(node.host, node.port, ae_title=node.ae_title)

            if assoc.is_established:
                matches = []
                responses = assoc.send_c_find(ds, StudyRootQueryRetrieveInformationModelFind)

                for status, identifier in responses:
                    if status and status.Status in (0xFF00, 0xFF01):
                        if identifier:
                            match = {}
                            for elem in identifier:
                                if elem.VR != "SQ":
                                    match[elem.keyword] = str(elem.value)
                            matches.append(match)

                assoc.release()

                return QueryResult(
                    level=level,
                    matches=matches,
                    status="success",
                )
            return QueryResult(
                level=level,
                matches=[],
                status="error",
                message="Association rejected",
            )

        except Exception as e:
            logger.error("C-FIND failed", error=str(e))
            return QueryResult(
                level=level,
                matches=[],
                status="error",
                message=str(e),
            )

    async def move(
        self,
        node: DicomNode,
        destination_ae: str,
        level: QueryRetrieveLevel,
        identifiers: dict[str, Any],
    ) -> dict[str, Any]:
        """Request data transfer using C-MOVE.

        Args:
            node: Source DICOM node
            destination_ae: Destination AE Title
            level: Query/Retrieve level
            identifiers: Identifiers for data to retrieve

        Returns:
            Move operation result

        """
        if not self._pynetdicom_available:
            return {"success": False, "message": "pynetdicom not available"}

        try:
            from pydicom.dataset import Dataset
            from pynetdicom import AE
            from pynetdicom.sop_class import StudyRootQueryRetrieveInformationModelMove

            ae = AE(ae_title=self.ae_title)
            ae.add_requested_context(StudyRootQueryRetrieveInformationModelMove)

            ds = Dataset()
            ds.QueryRetrieveLevel = level.value

            for key, value in identifiers.items():
                setattr(ds, key, value)

            assoc = ae.associate(node.host, node.port, ae_title=node.ae_title)

            if assoc.is_established:
                responses = assoc.send_c_move(
                    ds,
                    destination_ae,
                    StudyRootQueryRetrieveInformationModelMove,
                )

                completed = 0
                failed = 0
                warning = 0

                for status, identifier in responses:
                    if status:
                        if status.Status == 0x0000:
                            pass  # Success
                        elif status.Status == 0xFF00:
                            completed += 1
                        elif status.Status == 0xB000:
                            warning += 1
                        else:
                            failed += 1

                assoc.release()

                return {
                    "success": failed == 0,
                    "completed": completed,
                    "failed": failed,
                    "warning": warning,
                }
            return {"success": False, "message": "Association rejected"}

        except Exception as e:
            logger.error("C-MOVE failed", error=str(e))
            return {"success": False, "message": str(e)}

    async def store(
        self,
        node: DicomNode,
        instances: list[Path | bytes],
    ) -> dict[str, Any]:
        """Store instances to a DICOM node using C-STORE.

        Args:
            node: Destination DICOM node
            instances: List of file paths or DICOM bytes to store

        Returns:
            Store operation result

        """
        if not self._pynetdicom_available:
            return {"success": False, "message": "pynetdicom not available"}

        try:
            from io import BytesIO

            import pydicom
            from pynetdicom import AE, StoragePresentationContexts

            ae = AE(ae_title=self.ae_title)
            ae.requested_contexts = StoragePresentationContexts

            assoc = ae.associate(node.host, node.port, ae_title=node.ae_title)

            if assoc.is_established:
                success_count = 0
                fail_count = 0

                for instance in instances:
                    if isinstance(instance, Path):
                        ds = pydicom.dcmread(str(instance))
                    else:
                        ds = pydicom.dcmread(BytesIO(instance))

                    status = assoc.send_c_store(ds)

                    if status and status.Status == 0x0000:
                        success_count += 1
                    else:
                        fail_count += 1

                assoc.release()

                return {
                    "success": fail_count == 0,
                    "stored": success_count,
                    "failed": fail_count,
                }
            return {"success": False, "message": "Association rejected"}

        except Exception as e:
            logger.error("C-STORE failed", error=str(e))
            return {"success": False, "message": str(e)}

    async def start_scp(
        self,
        on_store: Callable[[Any], int] | None = None,
    ) -> bool:
        """Start Storage SCP (Service Class Provider).

        Args:
            on_store: Callback for handling incoming C-STORE requests

        Returns:
            True if started successfully

        """
        if not self._pynetdicom_available:
            logger.error("Cannot start SCP: pynetdicom not available")
            return False

        if self._scp_running:
            logger.warning("SCP already running")
            return True

        try:
            from pynetdicom import AE, StoragePresentationContexts, evt
            from pynetdicom.sop_class import Verification

            ae = AE(ae_title=self.ae_title)
            ae.supported_contexts = StoragePresentationContexts
            ae.add_supported_context(Verification)

            def handle_store(event):
                """Handle incoming C-STORE request."""
                ds = event.dataset
                ds.file_meta = event.file_meta

                # Save to storage
                if self.storage_dir:
                    patient_id = str(ds.get("PatientID", "UNKNOWN"))
                    study_uid = str(ds.StudyInstanceUID)
                    series_uid = str(ds.SeriesInstanceUID)
                    instance_uid = str(ds.SOPInstanceUID)

                    save_dir = self.storage_dir / patient_id / study_uid / series_uid
                    save_dir.mkdir(parents=True, exist_ok=True)

                    save_path = save_dir / f"{instance_uid}.dcm"
                    ds.save_as(str(save_path))

                    logger.info("Received instance", instance_uid=instance_uid)

                if on_store:
                    return on_store(ds)

                return 0x0000  # Success

            handlers = [(evt.EVT_C_STORE, handle_store)]

            # Start SCP in background thread
            ae.start_server(("0.0.0.0", self.port), block=False, evt_handlers=handlers)
            self._scp_running = True

            logger.info("DICOM SCP started", ae_title=self.ae_title, port=self.port)
            return True

        except Exception as e:
            logger.error("Failed to start SCP", error=str(e))
            return False

    async def stop_scp(self) -> None:
        """Stop Storage SCP."""
        # In production, properly shutdown the server
        self._scp_running = False
        logger.info("DICOM SCP stopped")
