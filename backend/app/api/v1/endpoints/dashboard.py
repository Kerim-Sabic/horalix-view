"""Dashboard endpoints for Horalix View.

Provides dashboard statistics and overview data for the frontend.
"""

from datetime import datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints.auth import get_current_active_user
from app.core.config import get_settings
from app.core.security import TokenData
from app.models.base import get_db
from app.models.instance import Instance
from app.models.job import AIJob, JobStatus
from app.models.patient import Patient
from app.models.series import Series
from app.models.study import Study

router = APIRouter()
settings = get_settings()


class DashboardStats(BaseModel):
    """Dashboard statistics."""

    total_studies: int
    total_patients: int
    total_series: int
    total_instances: int
    ai_jobs_today: int
    ai_jobs_running: int
    storage_used_bytes: int
    storage_total_bytes: int


@router.get("/stats", response_model=DashboardStats)
async def get_dashboard_stats(
    current_user: Annotated[TokenData, Depends(get_current_active_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> DashboardStats:
    """Get dashboard statistics.

    Returns aggregated statistics for display on the dashboard.
    """
    # Get counts from database
    total_studies = await db.scalar(select(func.count()).select_from(Study)) or 0
    total_patients = await db.scalar(select(func.count()).select_from(Patient)) or 0
    total_series = await db.scalar(select(func.count()).select_from(Series)) or 0
    total_instances = await db.scalar(select(func.count()).select_from(Instance)) or 0

    # Get AI job counts
    today_start = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)

    ai_jobs_today = (
        await db.scalar(
            select(func.count())
            .select_from(AIJob)
            .where(AIJob.created_at >= today_start)
        )
        or 0
    )

    ai_jobs_running = (
        await db.scalar(
            select(func.count())
            .select_from(AIJob)
            .where(AIJob.status == JobStatus.RUNNING)
        )
        or 0
    )

    # Calculate storage usage
    # Sum up file sizes from instances
    storage_used = (
        await db.scalar(
            select(func.coalesce(func.sum(Instance.file_size), 0)).select_from(Instance)
        )
        or 0
    )

    # Default total storage (1TB) - can be made configurable
    storage_total = settings.storage.max_storage_bytes if hasattr(settings, 'storage') else 1_000_000_000_000

    return DashboardStats(
        total_studies=total_studies,
        total_patients=total_patients,
        total_series=total_series,
        total_instances=total_instances,
        ai_jobs_today=ai_jobs_today,
        ai_jobs_running=ai_jobs_running,
        storage_used_bytes=int(storage_used),
        storage_total_bytes=storage_total,
    )
