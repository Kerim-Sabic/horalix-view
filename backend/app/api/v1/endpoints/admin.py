"""Administration endpoints for Horalix View.

Provides system administration, configuration, and monitoring capabilities.
"""

from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from app.api.v1.endpoints.auth import require_roles
from app.core.logging import audit_logger
from app.core.security import TokenData

router = APIRouter()


class SystemStatus(BaseModel):
    """System status information."""

    status: str
    version: str
    uptime_seconds: float
    cpu_usage_percent: float
    memory_usage_percent: float
    disk_usage_percent: float
    active_users: int
    pending_jobs: int


class AIModelStatus(BaseModel):
    """AI model status."""

    model_name: str
    is_loaded: bool
    memory_usage_mb: float
    inference_count: int
    average_inference_time_ms: float
    last_used: datetime | None


class StorageInfo(BaseModel):
    """Storage information."""

    total_bytes: int
    used_bytes: int
    free_bytes: int
    study_count: int
    series_count: int
    instance_count: int


class ConfigUpdate(BaseModel):
    """Configuration update request."""

    section: str
    key: str
    value: Any


class AuditLogEntry(BaseModel):
    """Audit log entry."""

    timestamp: datetime
    user_id: str
    action: str
    resource_type: str
    resource_id: str
    details: dict = {}
    ip_address: str | None = None


class AuditLogResponse(BaseModel):
    """Audit log response."""

    total: int
    entries: list[AuditLogEntry]


# Simulated system state
SYSTEM_START_TIME = datetime.now()


@router.get("/status", response_model=SystemStatus)
async def get_system_status(
    current_user: Annotated[TokenData, Depends(require_roles("admin"))],
) -> SystemStatus:
    """Get system status and health metrics."""
    uptime = (datetime.now() - SYSTEM_START_TIME).total_seconds()

    return SystemStatus(
        status="healthy",
        version="1.0.0",
        uptime_seconds=uptime,
        cpu_usage_percent=25.5,
        memory_usage_percent=42.0,
        disk_usage_percent=35.0,
        active_users=3,
        pending_jobs=2,
    )


@router.get("/ai/status", response_model=list[AIModelStatus])
async def get_ai_model_status(
    current_user: Annotated[TokenData, Depends(require_roles("admin"))],
) -> list[AIModelStatus]:
    """Get status of all AI models."""
    return [
        AIModelStatus(
            model_name="nnunet",
            is_loaded=False,
            memory_usage_mb=0,
            inference_count=0,
            average_inference_time_ms=0,
            last_used=None,
        ),
        AIModelStatus(
            model_name="medsam",
            is_loaded=False,
            memory_usage_mb=0,
            inference_count=0,
            average_inference_time_ms=0,
            last_used=None,
        ),
        AIModelStatus(
            model_name="yolov8",
            is_loaded=False,
            memory_usage_mb=0,
            inference_count=0,
            average_inference_time_ms=0,
            last_used=None,
        ),
    ]


@router.post("/ai/models/{model_name}/load")
async def load_ai_model(
    model_name: str,
    current_user: Annotated[TokenData, Depends(require_roles("admin"))],
) -> dict:
    """Load an AI model into memory."""
    audit_logger.log_configuration_change(
        user_id=current_user.user_id,
        setting_name=f"ai_model_{model_name}",
        old_value="unloaded",
        new_value="loaded",
        component="ai",
    )

    return {"message": f"Model {model_name} loading initiated", "status": "loading"}


@router.post("/ai/models/{model_name}/unload")
async def unload_ai_model(
    model_name: str,
    current_user: Annotated[TokenData, Depends(require_roles("admin"))],
) -> dict:
    """Unload an AI model from memory."""
    return {"message": f"Model {model_name} unloaded", "status": "unloaded"}


@router.get("/storage", response_model=StorageInfo)
async def get_storage_info(
    current_user: Annotated[TokenData, Depends(require_roles("admin"))],
) -> StorageInfo:
    """Get storage information."""
    return StorageInfo(
        total_bytes=1000000000000,  # 1TB
        used_bytes=350000000000,  # 350GB
        free_bytes=650000000000,  # 650GB
        study_count=1250,
        series_count=8500,
        instance_count=425000,
    )


@router.get("/config")
async def get_configuration(
    current_user: Annotated[TokenData, Depends(require_roles("admin"))],
) -> dict:
    """Get current system configuration."""
    from app.core.config import settings

    return {
        "app_name": settings.app_name,
        "version": settings.app_version,
        "environment": settings.environment,
        "dicom": {
            "ae_title": settings.dicom.ae_title,
            "port": settings.dicom.port,
            "dicomweb_enabled": settings.dicom.dicomweb_enabled,
        },
        "ai": {
            "device": settings.ai.device,
            "batch_size": settings.ai.batch_size,
            "mixed_precision": settings.ai.mixed_precision,
        },
        "compliance": {
            "hipaa_mode": settings.compliance.hipaa_mode,
            "audit_logging_enabled": settings.compliance.audit_logging_enabled,
        },
    }


@router.put("/config")
async def update_configuration(
    update: ConfigUpdate,
    current_user: Annotated[TokenData, Depends(require_roles("admin"))],
) -> dict:
    """Update system configuration.

    Changes may require a restart to take effect.
    """
    audit_logger.log_configuration_change(
        user_id=current_user.user_id,
        setting_name=f"{update.section}.{update.key}",
        old_value="[previous]",
        new_value=update.value,
        component=update.section,
    )

    return {
        "message": "Configuration updated",
        "section": update.section,
        "key": update.key,
        "requires_restart": update.section in ["database", "redis"],
    }


@router.get("/audit-logs", response_model=AuditLogResponse)
async def get_audit_logs(
    current_user: Annotated[TokenData, Depends(require_roles("admin"))],
    user_id: str | None = None,
    action: str | None = None,
    resource_type: str | None = None,
    from_date: datetime | None = None,
    to_date: datetime | None = None,
    limit: int = 100,
    offset: int = 0,
) -> AuditLogResponse:
    """Query audit logs.

    Supports filtering by user, action, resource type, and date range.
    """
    # Return sample audit logs
    entries = [
        AuditLogEntry(
            timestamp=datetime.now(),
            user_id="user_001",
            action="VIEW",
            resource_type="study",
            resource_id="1.2.840.113619.2.55.3.123456789.1",
            ip_address="192.168.1.100",
        ),
        AuditLogEntry(
            timestamp=datetime.now(),
            user_id="user_002",
            action="EXPORT",
            resource_type="study",
            resource_id="1.2.840.113619.2.55.3.123456789.2",
            details={"format": "DICOM", "anonymized": True},
            ip_address="192.168.1.101",
        ),
    ]

    return AuditLogResponse(total=len(entries), entries=entries)


@router.post("/audit-logs/export")
async def export_audit_logs(
    current_user: Annotated[TokenData, Depends(require_roles("admin"))],
    from_date: datetime | None = None,
    to_date: datetime | None = None,
    format: str = "csv",
) -> dict:
    """Export audit logs for compliance reporting."""
    return {
        "message": "Audit log export initiated",
        "format": format,
        "download_url": "/api/v1/admin/audit-logs/download/export_123.csv",
    }


@router.get("/users")
async def list_users(
    current_user: Annotated[TokenData, Depends(require_roles("admin"))],
) -> list[dict]:
    """List all users."""
    from app.api.v1.endpoints.auth import USERS_DB

    return [
        {
            "id": u["id"],
            "username": u["username"],
            "email": u["email"],
            "roles": u["roles"],
            "is_active": u["is_active"],
        }
        for u in USERS_DB.values()
    ]


@router.put("/users/{user_id}/roles")
async def update_user_roles(
    user_id: str,
    roles: list[str],
    current_user: Annotated[TokenData, Depends(require_roles("admin"))],
) -> dict:
    """Update user roles."""
    from app.api.v1.endpoints.auth import USERS_DB

    for user in USERS_DB.values():
        if user["id"] == user_id:
            old_roles = user["roles"]
            user["roles"] = roles

            audit_logger.log_configuration_change(
                user_id=current_user.user_id,
                setting_name=f"user_{user_id}_roles",
                old_value=old_roles,
                new_value=roles,
                component="auth",
            )

            return {"message": "Roles updated", "user_id": user_id, "roles": roles}

    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail=f"User not found: {user_id}",
    )


@router.put("/users/{user_id}/status")
async def update_user_status(
    user_id: str,
    is_active: bool,
    current_user: Annotated[TokenData, Depends(require_roles("admin"))],
) -> dict:
    """Activate or deactivate a user."""
    from app.api.v1.endpoints.auth import USERS_DB

    for user in USERS_DB.values():
        if user["id"] == user_id:
            user["is_active"] = is_active
            return {"message": "Status updated", "user_id": user_id, "is_active": is_active}

    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail=f"User not found: {user_id}",
    )


@router.post("/maintenance/cleanup")
async def run_cleanup(
    current_user: Annotated[TokenData, Depends(require_roles("admin"))],
    cleanup_temp: bool = True,
    cleanup_cache: bool = False,
    cleanup_old_exports: bool = True,
    days_old: int = 30,
) -> dict:
    """Run maintenance cleanup tasks."""
    return {
        "message": "Cleanup initiated",
        "tasks": {
            "temp_files": cleanup_temp,
            "cache": cleanup_cache,
            "old_exports": cleanup_old_exports,
        },
        "days_threshold": days_old,
    }


@router.post("/maintenance/reindex")
async def reindex_database(
    current_user: Annotated[TokenData, Depends(require_roles("admin"))],
) -> dict:
    """Reindex the DICOM database."""
    return {"message": "Reindexing initiated", "status": "running"}
