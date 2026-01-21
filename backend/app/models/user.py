"""
User database model.

Represents a system user with authentication credentials and role-based
access control for hospital-grade security.
"""

from datetime import datetime
from typing import Optional

from sqlalchemy import String, Boolean, DateTime, Text, Index
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class User(Base):
    """
    User model representing a system user.

    Supports role-based access control with multiple roles per user.
    Passwords are stored as bcrypt hashes.
    """

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)

    # Unique user identifier (for external references)
    user_id: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)

    # Login credentials
    username: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    email: Mapped[str] = mapped_column(String(256), unique=True, nullable=False, index=True)
    hashed_password: Mapped[str] = mapped_column(String(256), nullable=False)

    # User profile
    full_name: Mapped[Optional[str]] = mapped_column(String(256), nullable=True)
    title: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    department: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    phone: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)

    # Role-based access control (stored as comma-separated roles)
    # Valid roles: admin, radiologist, technologist, referring_physician, researcher
    roles: Mapped[str] = mapped_column(String(256), nullable=False, default="referring_physician")

    # Account status
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    is_verified: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_locked: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    # Login tracking
    last_login: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    failed_login_attempts: Mapped[int] = mapped_column(default=0)
    locked_until: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    # Password management
    password_changed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    must_change_password: Mapped[bool] = mapped_column(Boolean, default=False)

    # API keys (hashed, stored as comma-separated if multiple)
    api_key_hash: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)

    # MFA settings
    mfa_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    mfa_secret: Mapped[Optional[str]] = mapped_column(String(256), nullable=True)

    # Notes (admin use)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Indexes
    __table_args__ = (
        Index("ix_users_is_active", "is_active"),
        Index("ix_users_roles", "roles"),
    )

    @property
    def roles_list(self) -> list[str]:
        """Get roles as a list."""
        if self.roles:
            return [r.strip() for r in self.roles.split(",") if r.strip()]
        return []

    @roles_list.setter
    def roles_list(self, value: list[str]) -> None:
        """Set roles from a list."""
        self.roles = ",".join(value) if value else ""

    def has_role(self, role: str) -> bool:
        """Check if user has a specific role."""
        return role in self.roles_list

    def has_any_role(self, roles: list[str]) -> bool:
        """Check if user has any of the specified roles."""
        return any(self.has_role(r) for r in roles)

    def __repr__(self) -> str:
        return f"<User(id={self.id}, username='{self.username}', roles='{self.roles}')>"
