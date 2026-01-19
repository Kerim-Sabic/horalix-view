"""
Audit Log database model.

Provides comprehensive audit trail for HIPAA and 21 CFR Part 11 compliance,
tracking all user actions on protected health information (PHI).
"""

from datetime import datetime
from enum import Enum as PyEnum
from typing import Optional

from sqlalchemy import String, Boolean, Index, Enum, Text, JSON, DateTime, func
from sqlalchemy.orm import Mapped, mapped_column

from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from app.models.base import metadata


class AuditBase(DeclarativeBase):
    """Base class for audit log (without updated_at)."""

    metadata = metadata

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )


class AuditAction(str, PyEnum):
    """Audit action types."""

    # Authentication
    LOGIN = "login"
    LOGOUT = "logout"
    LOGIN_FAILED = "login_failed"
    PASSWORD_CHANGE = "password_change"
    MFA_ENABLED = "mfa_enabled"
    MFA_DISABLED = "mfa_disabled"

    # Study operations
    STUDY_VIEW = "study_view"
    STUDY_CREATE = "study_create"
    STUDY_UPDATE = "study_update"
    STUDY_DELETE = "study_delete"
    STUDY_EXPORT = "study_export"
    STUDY_ANONYMIZE = "study_anonymize"

    # Series/Instance operations
    SERIES_VIEW = "series_view"
    INSTANCE_VIEW = "instance_view"
    PIXEL_DATA_ACCESS = "pixel_data_access"

    # Patient operations
    PATIENT_VIEW = "patient_view"
    PATIENT_CREATE = "patient_create"
    PATIENT_UPDATE = "patient_update"
    PATIENT_DELETE = "patient_delete"
    PATIENT_MERGE = "patient_merge"

    # AI operations
    AI_JOB_SUBMIT = "ai_job_submit"
    AI_JOB_CANCEL = "ai_job_cancel"
    AI_RESULT_VIEW = "ai_result_view"
    AI_RESULT_APPROVE = "ai_result_approve"
    AI_RESULT_REJECT = "ai_result_reject"

    # Admin operations
    USER_CREATE = "user_create"
    USER_UPDATE = "user_update"
    USER_DELETE = "user_delete"
    USER_LOCK = "user_lock"
    USER_UNLOCK = "user_unlock"
    ROLE_CHANGE = "role_change"
    PERMISSION_CHANGE = "permission_change"
    SETTINGS_CHANGE = "settings_change"

    # System operations
    SYSTEM_STARTUP = "system_startup"
    SYSTEM_SHUTDOWN = "system_shutdown"
    BACKUP_CREATE = "backup_create"
    BACKUP_RESTORE = "backup_restore"


class AuditLog(AuditBase):
    """
    AuditLog model for compliance tracking.

    Records all significant actions in the system for HIPAA and
    21 CFR Part 11 compliance. Entries are immutable once created.
    """

    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)

    # Action details
    action: Mapped[AuditAction] = mapped_column(Enum(AuditAction), nullable=False, index=True)
    action_description: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)

    # User information
    user_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, index=True)
    username: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    user_roles: Mapped[Optional[str]] = mapped_column(String(256), nullable=True)

    # Resource being accessed/modified
    resource_type: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, index=True)
    resource_id: Mapped[Optional[str]] = mapped_column(String(256), nullable=True, index=True)

    # Additional context (JSON)
    details: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)

    # Before/after values for modifications
    old_value: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    new_value: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)

    # Request information
    ip_address: Mapped[Optional[str]] = mapped_column(String(45), nullable=True)
    user_agent: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    request_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    request_method: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)
    request_path: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)

    # Result
    success: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Timestamp (using server time for accuracy)
    timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
        index=True,
    )

    # Indexes for compliance queries
    __table_args__ = (
        Index("ix_audit_logs_user_timestamp", "user_id", "timestamp"),
        Index("ix_audit_logs_resource_timestamp", "resource_type", "resource_id", "timestamp"),
        Index("ix_audit_logs_action_timestamp", "action", "timestamp"),
        Index("ix_audit_logs_timestamp_desc", timestamp.desc()),
    )

    def __repr__(self) -> str:
        return f"<AuditLog(id={self.id}, action='{self.action}', user='{self.user_id}', resource='{self.resource_type}/{self.resource_id}')>"


# Note: This model intentionally does not have updated_at
# Audit logs should be immutable once created
