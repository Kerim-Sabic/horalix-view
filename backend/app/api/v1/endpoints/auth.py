"""
Authentication endpoints for Horalix View.
"""

from datetime import timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status, Request
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from pydantic import BaseModel, EmailStr, Field

from app.core.config import settings
from app.core.security import SecurityManager, TokenData
from app.core.logging import audit_logger

router = APIRouter()

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/token")

# Initialize security manager
security_manager = SecurityManager(
    secret_key=settings.secret_key,
    algorithm=settings.algorithm,
    access_token_expire_minutes=settings.access_token_expire_minutes,
)


class UserCreate(BaseModel):
    """User creation request."""

    username: str = Field(..., min_length=3, max_length=50)
    email: EmailStr
    password: str = Field(..., min_length=8)
    full_name: str | None = None
    roles: list[str] = Field(default=["referring_physician"])


class UserResponse(BaseModel):
    """User response model."""

    id: str
    username: str
    email: str
    full_name: str | None
    roles: list[str]
    is_active: bool


class Token(BaseModel):
    """OAuth2 token response."""

    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user: UserResponse


class TokenRefresh(BaseModel):
    """Token refresh request."""

    refresh_token: str


# Simulated user database (replace with actual database in production)
USERS_DB: dict[str, dict] = {
    "admin": {
        "id": "user_001",
        "username": "admin",
        "email": "admin@horalix.io",
        "full_name": "System Administrator",
        "hashed_password": security_manager.hash_password("admin123"),
        "roles": ["admin"],
        "is_active": True,
    },
    "radiologist": {
        "id": "user_002",
        "username": "radiologist",
        "email": "radiologist@horalix.io",
        "full_name": "Dr. Jane Smith",
        "hashed_password": security_manager.hash_password("rad123"),
        "roles": ["radiologist"],
        "is_active": True,
    },
}


async def get_current_user(
    token: Annotated[str, Depends(oauth2_scheme)],
) -> TokenData:
    """
    Validate JWT token and return current user.

    Args:
        token: JWT token from Authorization header

    Returns:
        TokenData with user information

    Raises:
        HTTPException: If token is invalid or expired
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

    token_data = security_manager.decode_token(token)
    if token_data is None:
        raise credentials_exception

    return token_data


async def get_current_active_user(
    current_user: Annotated[TokenData, Depends(get_current_user)],
) -> TokenData:
    """
    Ensure current user is active.

    Args:
        current_user: Current authenticated user

    Returns:
        TokenData if user is active

    Raises:
        HTTPException: If user is inactive
    """
    # In production, check database for user status
    user = USERS_DB.get(current_user.username)
    if user and not user.get("is_active", False):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is inactive",
        )
    return current_user


def require_roles(*required_roles: str):
    """
    Dependency factory for role-based access control.

    Args:
        required_roles: Roles required for access

    Returns:
        Dependency function that validates user roles
    """

    async def role_checker(
        current_user: Annotated[TokenData, Depends(get_current_active_user)],
    ) -> TokenData:
        if not any(role in current_user.roles for role in required_roles):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Requires one of roles: {', '.join(required_roles)}",
            )
        return current_user

    return role_checker


@router.post("/token", response_model=Token)
async def login(
    request: Request,
    form_data: Annotated[OAuth2PasswordRequestForm, Depends()],
) -> Token:
    """
    OAuth2 compatible token login.

    Authenticates user with username/password and returns JWT token.
    """
    user = USERS_DB.get(form_data.username)
    client_ip = request.client.host if request.client else None

    if not user or not security_manager.verify_password(
        form_data.password, user["hashed_password"]
    ):
        audit_logger.log_authentication(
            user_id=None,
            username=form_data.username,
            success=False,
            ip_address=client_ip,
            failure_reason="Invalid username or password",
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not user.get("is_active", False):
        audit_logger.log_authentication(
            user_id=user["id"],
            username=form_data.username,
            success=False,
            ip_address=client_ip,
            failure_reason="Account inactive",
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is inactive",
        )

    # Create access token
    access_token = security_manager.create_access_token(
        data={
            "sub": user["id"],
            "username": user["username"],
            "roles": user["roles"],
        }
    )

    audit_logger.log_authentication(
        user_id=user["id"],
        username=form_data.username,
        success=True,
        ip_address=client_ip,
    )

    return Token(
        access_token=access_token,
        expires_in=settings.access_token_expire_minutes * 60,
        user=UserResponse(
            id=user["id"],
            username=user["username"],
            email=user["email"],
            full_name=user.get("full_name"),
            roles=user["roles"],
            is_active=user["is_active"],
        ),
    )


@router.post("/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def register(
    user_data: UserCreate,
    current_user: Annotated[TokenData, Depends(require_roles("admin"))],
) -> UserResponse:
    """
    Register a new user (admin only).

    Creates a new user account with specified roles.
    """
    if user_data.username in USERS_DB:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username already registered",
        )

    # Check for valid roles
    valid_roles = {"admin", "radiologist", "technologist", "referring_physician", "researcher"}
    invalid_roles = set(user_data.roles) - valid_roles
    if invalid_roles:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid roles: {', '.join(invalid_roles)}",
        )

    # Create user
    user_id = f"user_{len(USERS_DB) + 1:03d}"
    new_user = {
        "id": user_id,
        "username": user_data.username,
        "email": user_data.email,
        "full_name": user_data.full_name,
        "hashed_password": security_manager.hash_password(user_data.password),
        "roles": user_data.roles,
        "is_active": True,
    }
    USERS_DB[user_data.username] = new_user

    return UserResponse(
        id=new_user["id"],
        username=new_user["username"],
        email=new_user["email"],
        full_name=new_user.get("full_name"),
        roles=new_user["roles"],
        is_active=new_user["is_active"],
    )


@router.get("/me", response_model=UserResponse)
async def get_current_user_info(
    current_user: Annotated[TokenData, Depends(get_current_active_user)],
) -> UserResponse:
    """Get current authenticated user information."""
    user = USERS_DB.get(current_user.username)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    return UserResponse(
        id=user["id"],
        username=user["username"],
        email=user["email"],
        full_name=user.get("full_name"),
        roles=user["roles"],
        is_active=user["is_active"],
    )


@router.post("/logout")
async def logout(
    current_user: Annotated[TokenData, Depends(get_current_active_user)],
) -> dict:
    """
    Logout current user.

    Note: With JWT tokens, logout is primarily client-side.
    This endpoint can be used for audit logging and token blacklisting.
    """
    audit_logger.log_authentication(
        user_id=current_user.user_id,
        username=current_user.username,
        success=True,
        method="logout",
    )
    return {"message": "Successfully logged out"}


@router.post("/change-password")
async def change_password(
    current_password: str,
    new_password: str,
    current_user: Annotated[TokenData, Depends(get_current_active_user)],
) -> dict:
    """Change current user's password."""
    user = USERS_DB.get(current_user.username)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    if not security_manager.verify_password(current_password, user["hashed_password"]):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Current password is incorrect",
        )

    if len(new_password) < 8:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="New password must be at least 8 characters",
        )

    # Update password
    user["hashed_password"] = security_manager.hash_password(new_password)

    return {"message": "Password changed successfully"}
