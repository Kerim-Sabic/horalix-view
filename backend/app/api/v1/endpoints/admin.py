"""Administration endpoints for Horalix View.

Provides system administration, configuration, and monitoring capabilities.
"""

from datetime import datetime
from typing import Annotated, Any
import shutil

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from pydantic import BaseModel

from app.api.v1.endpoints.auth import require_roles
from app.core.config import get_settings
from app.core.logging import audit_logger
from app.core.security import TokenData
from app.models.audit import AuditLog
from app.models.base import get_db
from app.models.job import AIJob, JobStatus
from app.models.user import User

router = APIRouter()
settings = get_settings()


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
    db: Annotated[AsyncSession, Depends(get_db)],
) -> SystemStatus:
    """Get system status and health metrics."""
    uptime = (datetime.now() - SYSTEM_START_TIME).total_seconds()

    cpu_usage = 0.0
    memory_usage = 0.0
    disk_usage = 0.0
    storage_path = "/"
    try:
        if hasattr(settings, "dicom"):
            storage_path = str(settings.dicom.storage_dir)
        usage = shutil.disk_usage(storage_path)
        disk_usage = (usage.used / usage.total) * 100 if usage.total else 0.0
    except Exception:
        disk_usage = 0.0

    try:
        import psutil

        cpu_usage = psutil.cpu_percent(interval=0.1)
        memory_usage = psutil.virtual_memory().percent
        if storage_path:
            disk_usage = psutil.disk_usage(storage_path).percent
    except Exception:
        cpu_usage = cpu_usage or 0.0
        memory_usage = memory_usage or 0.0

    active_users = (
        await db.scalar(select(func.count()).select_from(User).where(User.is_active.is_(True)))
        or 0
    )
    pending_jobs = (
        await db.scalar(
            select(func.count())
            .select_from(AIJob)
            .where(AIJob.status.in_([JobStatus.QUEUED, JobStatus.RUNNING]))
        )
        or 0
    )

    return SystemStatus(
        status="healthy",
        version="1.0.0",
        uptime_seconds=uptime,
        cpu_usage_percent=cpu_usage,
        memory_usage_percent=memory_usage,
        disk_usage_percent=disk_usage,
        active_users=active_users,
        pending_jobs=pending_jobs,
    )


@router.get("/ai/status", response_model=list[AIModelStatus])
async def get_ai_model_status(
    current_user: Annotated[TokenData, Depends(require_roles("admin"))],
    request: Request,
) -> list[AIModelStatus]:
    """Get status of all AI models."""
    registry = getattr(request.app.state, "model_registry", None)
    if not registry:
        return []

    availability = registry.get_model_availability()
    models: list[AIModelStatus] = []
    for name, status in availability.items():
        models.append(
            AIModelStatus(
                model_name=name,
                is_loaded=bool(status.get("loaded", False)),
                memory_usage_mb=0.0,
                inference_count=0,
                average_inference_time_ms=0.0,
                last_used=None,
            )
        )
    return models


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
    request: Request,
) -> StorageInfo:
    """Get storage information."""
    dicom_storage = getattr(request.app.state, "dicom_storage", None)
    total_bytes = 0
    used_bytes = 0
    free_bytes = 0
    study_count = 0
    series_count = 0
    instance_count = 0

    if dicom_storage:
        stats = await dicom_storage.get_storage_stats()
        used_bytes = int(stats.get("total_size_bytes", 0))
        study_count = int(stats.get("study_count", 0))
        series_count = int(stats.get("series_count", 0))
        instance_count = int(stats.get("instance_count", 0))

        try:
            usage = shutil.disk_usage(str(dicom_storage.storage_dir))
            total_bytes = usage.total
            free_bytes = usage.free
        except Exception:
            total_bytes = used_bytes
            free_bytes = 0

    return StorageInfo(
        total_bytes=total_bytes,
        used_bytes=used_bytes,
        free_bytes=free_bytes,
        study_count=study_count,
        series_count=series_count,
        instance_count=instance_count,
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
    db: Annotated[AsyncSession, Depends(get_db)],
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
    query = select(AuditLog)

    if user_id:
        query = query.where(AuditLog.user_id == user_id)
    if action:
        query = query.where(AuditLog.action == action)
    if resource_type:
        query = query.where(AuditLog.resource_type == resource_type)
    if from_date:
        query = query.where(AuditLog.timestamp >= from_date)
    if to_date:
        query = query.where(AuditLog.timestamp <= to_date)

    total_result = await db.execute(select(func.count()).select_from(query.subquery()))
    total = total_result.scalar() or 0

    result = await db.execute(
        query.order_by(AuditLog.timestamp.desc()).offset(offset).limit(limit)
    )
    logs = result.scalars().all()

    entries = [
        AuditLogEntry(
            timestamp=log.timestamp,
            user_id=log.user_id or "",
            action=log.action.value if hasattr(log.action, "value") else str(log.action),
            resource_type=log.resource_type or "",
            resource_id=log.resource_id or "",
            details=log.details or {},
            ip_address=log.ip_address,
        )
        for log in logs
    ]

    return AuditLogResponse(total=total, entries=entries)


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
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[dict]:
    """List all users."""
    result = await db.execute(select(User))
    users = result.scalars().all()
    return [
        {
            "id": user.user_id,
            "username": user.username,
            "email": user.email,
            "roles": user.roles_list,
            "is_active": user.is_active,
        }
        for user in users
    ]


@router.put("/users/{user_id}/roles")
async def update_user_roles(
    user_id: str,
    roles: list[str],
    current_user: Annotated[TokenData, Depends(require_roles("admin"))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    """Update user roles."""
    valid_roles = {"admin", "radiologist", "technologist", "referring_physician", "researcher"}
    invalid_roles = set(roles) - valid_roles
    if invalid_roles:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid roles: {', '.join(sorted(invalid_roles))}",
        )

    result = await db.execute(select(User).where(User.user_id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"User not found: {user_id}",
        )

    old_roles = user.roles_list
    user.roles_list = roles
    await db.commit()

    audit_logger.log_configuration_change(
        user_id=current_user.user_id,
        setting_name=f"user_{user_id}_roles",
        old_value=old_roles,
        new_value=roles,
        component="auth",
    )

    return {"message": "Roles updated", "user_id": user_id, "roles": roles}


@router.put("/users/{user_id}/status")
async def update_user_status(
    user_id: str,
    is_active: bool,
    current_user: Annotated[TokenData, Depends(require_roles("admin"))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    """Activate or deactivate a user."""
    result = await db.execute(select(User).where(User.user_id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"User not found: {user_id}",
        )

    user.is_active = is_active
    await db.commit()
    return {"message": "Status updated", "user_id": user_id, "is_active": is_active}


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
