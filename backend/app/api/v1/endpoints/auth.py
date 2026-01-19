"""
Authentication endpoints for Horalix View.

Provides OAuth2 password flow authentication with JWT tokens,
user management, and role-based access control.
"""

from datetime import datetime, timezone
from typing import Annotated
import uuid

from fastapi import APIRouter, Depends, HTTPException, status, Request
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import SecurityManager, TokenData, PermissionChecker
from app.core.logging import audit_logger
from app.models.base import get_db
from app.models.user import User

router = APIRouter()

# OAuth2 scheme
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/token")

# Security manager instance
security = SecurityManager(
    secret_key=settings.secret_key,
    algorithm=settings.algorithm,
    access_token_expire_minutes=settings.access_token_expire_minutes,
)


class Token(BaseModel):
    """OAuth2 token response."""

    access_token: str
    token_type: str = "bearer"
    expires_in: int


class UserCreate(BaseModel):
    """User creation request."""

    username: str = Field(..., min_length=3, max_length=64)
    email: EmailStr
    password: str = Field(..., min_length=8)
    full_name: str | None = None
    roles: list[str] = Field(default=["referring_physician"])


class UserResponse(BaseModel):
    """User response model."""

    user_id: str
    username: str
    email: str
    full_name: str | None
    roles: list[str]
    is_active: bool
    is_verified: bool
    last_login: datetime | None

    class Config:
        from_attributes = True


class PasswordChange(BaseModel):
    """Password change request."""

    current_password: str
    new_password: str = Field(..., min_length=8)


async def get_current_user(
    token: Annotated[str, Depends(oauth2_scheme)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> TokenData:
    """
    Validate JWT token and return current user.

    Raises HTTPException if token is invalid or expired.
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

    token_data = security.decode_token(token)
    if not token_data:
        raise credentials_exception

    # Verify user still exists and is active
    query = select(User).where(User.user_id == token_data.user_id)
    result = await db.execute(query)
    user = result.scalar_one_or_none()

    if not user or not user.is_active:
        raise credentials_exception

    return token_data


async def get_current_active_user(
    current_user: Annotated[TokenData, Depends(get_current_user)],
) -> TokenData:
    """
    Get current active user.

    Returns the current user token data if valid.
    """
    return current_user


def require_roles(*roles: str):
    """
    Dependency factory that requires specific roles.

    Usage:
        @router.get("/admin", dependencies=[Depends(require_roles("admin"))])
        async def admin_endpoint():
            pass
    """
    async def role_checker(
        current_user: Annotated[TokenData, Depends(get_current_active_user)],
    ) -> TokenData:
        if not any(role in current_user.roles for role in roles):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Insufficient permissions",
            )
        return current_user

    return role_checker


def require_permissions(*permissions: str):
    """
    Dependency factory that requires specific permissions.

    Usage:
        @router.get("/view", dependencies=[Depends(require_permissions("view:studies"))])
        async def view_endpoint():
            pass
    """
    async def permission_checker(
        current_user: Annotated[TokenData, Depends(get_current_active_user)],
    ) -> TokenData:
        checker = PermissionChecker(current_user.roles, current_user.permissions)
        if not checker.has_all_permissions(list(permissions)):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Insufficient permissions",
            )
        return current_user

    return permission_checker


@router.post("/token", response_model=Token)
async def login(
    request: Request,
    form_data: Annotated[OAuth2PasswordRequestForm, Depends()],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Token:
    """
    OAuth2 password grant authentication.

    Returns a JWT access token on successful authentication.
    """
    # Find user by username
    query = select(User).where(User.username == form_data.username)
    result = await db.execute(query)
    user = result.scalar_one_or_none()

    # Get client IP for audit logging
    client_ip = request.client.host if request.client else "unknown"

    if not user:
        # Log failed attempt
        audit_logger.log_authentication(
            user_id=None,
            username=form_data.username,
            success=False,
            ip_address=client_ip,
            failure_reason="user_not_found",
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Check if account is locked
    if user.is_locked:
        if user.locked_until and user.locked_until > datetime.now(timezone.utc):
            audit_logger.log_authentication(
                user_id=user.user_id,
                username=form_data.username,
                success=False,
                ip_address=client_ip,
                failure_reason="account_locked",
            )
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Account is temporarily locked",
                headers={"WWW-Authenticate": "Bearer"},
            )
        else:
            # Unlock if lock period expired
            user.is_locked = False
            user.locked_until = None
            user.failed_login_attempts = 0

    # Verify password
    if not security.verify_password(form_data.password, user.hashed_password):
        # Increment failed attempts
        user.failed_login_attempts = (user.failed_login_attempts or 0) + 1

        # Lock account after 5 failed attempts
        if user.failed_login_attempts >= 5:
            user.is_locked = True
            from datetime import timedelta
            user.locked_until = datetime.now(timezone.utc) + timedelta(minutes=30)

        await db.commit()

        audit_logger.log_authentication(
            user_id=user.user_id,
            username=form_data.username,
            success=False,
            ip_address=client_ip,
            failure_reason="invalid_password",
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Check if user is active
    if not user.is_active:
        audit_logger.log_authentication(
            user_id=user.user_id,
            username=form_data.username,
            success=False,
            ip_address=client_ip,
            failure_reason="account_inactive",
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Account is inactive",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Reset failed attempts and update last login
    user.failed_login_attempts = 0
    user.last_login = datetime.now(timezone.utc)
    await db.commit()

    # Get permissions for roles
    checker = PermissionChecker(user.roles_list)

    # Create access token
    access_token = security.create_access_token(
        data={
            "sub": user.user_id,
            "username": user.username,
            "email": user.email,
            "roles": user.roles_list,
            "permissions": checker.user_permissions,
        }
    )

    audit_logger.log_authentication(
        user_id=user.user_id,
        username=user.username,
        success=True,
        ip_address=client_ip,
    )

    return Token(
        access_token=access_token,
        token_type="bearer",
        expires_in=settings.access_token_expire_minutes * 60,
    )


@router.get("/me", response_model=UserResponse)
async def get_current_user_info(
    current_user: Annotated[TokenData, Depends(get_current_active_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> UserResponse:
    """
    Get current authenticated user information.
    """
    query = select(User).where(User.user_id == current_user.user_id)
    result = await db.execute(query)
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    return UserResponse(
        user_id=user.user_id,
        username=user.username,
        email=user.email,
        full_name=user.full_name,
        roles=user.roles_list,
        is_active=user.is_active,
        is_verified=user.is_verified,
        last_login=user.last_login,
    )


@router.post("/logout")
async def logout(
    request: Request,
    current_user: Annotated[TokenData, Depends(get_current_active_user)],
) -> dict:
    """
    Logout current user.

    Note: With JWT tokens, actual token invalidation requires
    a token blacklist or short expiration times.
    """
    client_ip = request.client.host if request.client else "unknown"

    audit_logger.log_authentication(
        user_id=current_user.user_id,
        username=current_user.username,
        success=True,
        ip_address=client_ip,
        method="logout",
    )

    return {"message": "Successfully logged out"}


@router.post("/change-password")
async def change_password(
    request: Request,
    password_data: PasswordChange,
    current_user: Annotated[TokenData, Depends(get_current_active_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    """
    Change current user's password.
    """
    query = select(User).where(User.user_id == current_user.user_id)
    result = await db.execute(query)
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    # Verify current password
    if not security.verify_password(password_data.current_password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Current password is incorrect",
        )

    # Update password
    user.hashed_password = security.hash_password(password_data.new_password)
    user.password_changed_at = datetime.now(timezone.utc)
    user.must_change_password = False
    await db.commit()

    client_ip = request.client.host if request.client else "unknown"
    audit_logger.log_authentication(
        user_id=current_user.user_id,
        username=current_user.username,
        success=True,
        ip_address=client_ip,
        method="password_change",
    )

    return {"message": "Password changed successfully"}


@router.post("/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def register_user(
    user_data: UserCreate,
    current_user: Annotated[TokenData, Depends(require_roles("admin"))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> UserResponse:
    """
    Register a new user (admin only).
    """
    # Check if username already exists
    query = select(User).where(User.username == user_data.username)
    result = await db.execute(query)
    if result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username already registered",
        )

    # Check if email already exists
    query = select(User).where(User.email == user_data.email)
    result = await db.execute(query)
    if result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered",
        )

    # Validate roles
    valid_roles = {"admin", "radiologist", "technologist", "referring_physician", "researcher"}
    invalid_roles = set(user_data.roles) - valid_roles
    if invalid_roles:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid roles: {', '.join(invalid_roles)}",
        )

    # Create new user
    user = User(
        user_id=f"user_{uuid.uuid4().hex[:12]}",
        username=user_data.username,
        email=user_data.email,
        hashed_password=security.hash_password(user_data.password),
        full_name=user_data.full_name,
        roles=",".join(user_data.roles),
        is_active=True,
        is_verified=False,
    )
    db.add(user)
    await db.commit()

    audit_logger.log_access(
        user_id=current_user.user_id,
        resource_type="user",
        resource_id=user.user_id,
        action="CREATE",
        details={"username": user.username},
    )

    return UserResponse(
        user_id=user.user_id,
        username=user.username,
        email=user.email,
        full_name=user.full_name,
        roles=user.roles_list,
        is_active=user.is_active,
        is_verified=user.is_verified,
        last_login=user.last_login,
    )


async def init_default_users(db: AsyncSession) -> None:
    """Create default users if none exist."""
    query = select(User).limit(1)
    result = await db.execute(query)
    if result.scalar_one_or_none() is not None:
        return  # Users already exist

    # Create default admin user
    admin = User(
        user_id="user_admin001",
        username="admin",
        email="admin@horalix.local",
        hashed_password=security.hash_password("admin123"),
        full_name="System Administrator",
        roles="admin",
        is_active=True,
        is_verified=True,
    )

    # Create default radiologist user
    radiologist = User(
        user_id="user_rad001",
        username="radiologist",
        email="radiologist@horalix.local",
        hashed_password=security.hash_password("rad123"),
        full_name="Dr. Radiology",
        title="MD",
        department="Radiology",
        roles="radiologist",
        is_active=True,
        is_verified=True,
    )

    # Create default technologist user
    technologist = User(
        user_id="user_tech001",
        username="technologist",
        email="tech@horalix.local",
        hashed_password=security.hash_password("tech123"),
        full_name="Medical Technologist",
        department="Imaging",
        roles="technologist",
        is_active=True,
        is_verified=True,
    )

    db.add_all([admin, radiologist, technologist])
    await db.commit()
