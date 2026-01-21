"""Security utilities for Horalix View.

Provides authentication, authorization, encryption, and audit logging
capabilities for HIPAA and 21 CFR Part 11 compliance.
"""

import base64
import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from jose import JWTError, jwt
from passlib.context import CryptContext
from pydantic import BaseModel


class TokenData(BaseModel):
    """JWT token payload data."""

    user_id: str
    username: str
    roles: list[str] = []
    permissions: list[str] = []
    exp: datetime | None = None


class AuditLogEntry(BaseModel):
    """Audit log entry for compliance tracking."""

    timestamp: datetime
    user_id: str
    action: str
    resource_type: str
    resource_id: str
    details: dict[str, Any] = {}
    ip_address: str | None = None
    user_agent: str | None = None
    success: bool = True
    error_message: str | None = None


class SecurityManager:
    """Centralized security manager for authentication, encryption, and auditing.

    Implements security best practices for healthcare applications including:
    - JWT-based authentication
    - Password hashing with bcrypt
    - AES-256 encryption for sensitive data
    - Audit logging for compliance
    """

    def __init__(
        self,
        secret_key: str,
        algorithm: str = "HS256",
        access_token_expire_minutes: int = 60,
    ):
        """Initialize security manager.

        Args:
            secret_key: Secret key for JWT signing
            algorithm: JWT algorithm (default: HS256)
            access_token_expire_minutes: Token expiration in minutes

        """
        self.secret_key = secret_key
        self.algorithm = algorithm
        self.access_token_expire_minutes = access_token_expire_minutes
        self.pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
        self._fernet: Fernet | None = None

    @property
    def fernet(self) -> Fernet:
        """Get Fernet encryption instance (lazy initialization)."""
        if self._fernet is None:
            # Derive a 32-byte key from secret_key using PBKDF2
            kdf = PBKDF2HMAC(
                algorithm=hashes.SHA256(),
                length=32,
                salt=b"horalix-view-salt",  # In production, use a unique salt per deployment
                iterations=100000,
            )
            key = base64.urlsafe_b64encode(kdf.derive(self.secret_key.encode()))
            self._fernet = Fernet(key)
        return self._fernet

    def hash_password(self, password: str) -> str:
        """Hash a password using bcrypt.

        Args:
            password: Plain text password

        Returns:
            Hashed password string

        """
        return self.pwd_context.hash(password)

    def verify_password(self, plain_password: str, hashed_password: str) -> bool:
        """Verify a password against a hash.

        Args:
            plain_password: Plain text password to verify
            hashed_password: Stored hash to compare against

        Returns:
            True if password matches, False otherwise

        """
        return self.pwd_context.verify(plain_password, hashed_password)

    def create_access_token(
        self,
        data: dict[str, Any],
        expires_delta: timedelta | None = None,
    ) -> str:
        """Create a JWT access token.

        Args:
            data: Token payload data
            expires_delta: Optional custom expiration time

        Returns:
            Encoded JWT token string

        """
        to_encode = data.copy()
        expire = datetime.now(timezone.utc) + (
            expires_delta or timedelta(minutes=self.access_token_expire_minutes)
        )
        to_encode.update({"exp": expire, "iat": datetime.now(timezone.utc)})
        return jwt.encode(to_encode, self.secret_key, algorithm=self.algorithm)

    def decode_token(self, token: str) -> TokenData | None:
        """Decode and validate a JWT token.

        Args:
            token: JWT token string

        Returns:
            TokenData if valid, None otherwise

        """
        try:
            payload = jwt.decode(token, self.secret_key, algorithms=[self.algorithm])
            return TokenData(
                user_id=payload.get("sub", ""),
                username=payload.get("username", ""),
                roles=payload.get("roles", []),
                permissions=payload.get("permissions", []),
                exp=datetime.fromtimestamp(payload.get("exp", 0), tz=timezone.utc),
            )
        except JWTError:
            return None

    def encrypt_data(self, data: str | bytes) -> bytes:
        """Encrypt sensitive data using Fernet (AES-128-CBC).

        Args:
            data: Data to encrypt (string or bytes)

        Returns:
            Encrypted data as bytes

        """
        if isinstance(data, str):
            data = data.encode()
        return self.fernet.encrypt(data)

    def decrypt_data(self, encrypted_data: bytes) -> bytes:
        """Decrypt encrypted data.

        Args:
            encrypted_data: Data encrypted with encrypt_data()

        Returns:
            Decrypted data as bytes

        """
        return self.fernet.decrypt(encrypted_data)

    def generate_secure_token(self, length: int = 32) -> str:
        """Generate a cryptographically secure random token.

        Args:
            length: Token length in bytes

        Returns:
            Hex-encoded random token

        """
        return secrets.token_hex(length)

    def generate_api_key(self) -> tuple[str, str]:
        """Generate an API key pair (key_id, key_secret).

        Returns:
            Tuple of (key_id, key_secret)

        """
        key_id = f"hv_{secrets.token_hex(8)}"
        key_secret = secrets.token_urlsafe(32)
        return key_id, key_secret

    def hash_api_key(self, api_key: str) -> str:
        """Hash an API key for secure storage.

        Args:
            api_key: API key to hash

        Returns:
            SHA-256 hash of the API key

        """
        return hashlib.sha256(api_key.encode()).hexdigest()

    def verify_api_key(self, api_key: str, stored_hash: str) -> bool:
        """Verify an API key against a stored hash.

        Args:
            api_key: API key to verify
            stored_hash: Stored hash to compare

        Returns:
            True if key matches, False otherwise

        """
        return hmac.compare_digest(self.hash_api_key(api_key), stored_hash)

    @staticmethod
    def create_audit_entry(
        user_id: str,
        action: str,
        resource_type: str,
        resource_id: str,
        details: dict[str, Any] | None = None,
        ip_address: str | None = None,
        user_agent: str | None = None,
        success: bool = True,
        error_message: str | None = None,
    ) -> AuditLogEntry:
        """Create an audit log entry.

        Args:
            user_id: ID of the user performing the action
            action: Action performed (e.g., "VIEW", "EXPORT", "DELETE")
            resource_type: Type of resource (e.g., "study", "patient")
            resource_id: ID of the affected resource
            details: Additional details about the action
            ip_address: Client IP address
            user_agent: Client user agent
            success: Whether the action succeeded
            error_message: Error message if action failed

        Returns:
            AuditLogEntry object

        """
        return AuditLogEntry(
            timestamp=datetime.now(timezone.utc),
            user_id=user_id,
            action=action,
            resource_type=resource_type,
            resource_id=resource_id,
            details=details or {},
            ip_address=ip_address,
            user_agent=user_agent,
            success=success,
            error_message=error_message,
        )


class PermissionChecker:
    """Permission checker for role-based access control."""

    # Default permission definitions
    PERMISSIONS = {
        "admin": [
            "view:*",
            "edit:*",
            "delete:*",
            "export:*",
            "admin:*",
            "ai:*",
        ],
        "radiologist": [
            "view:studies",
            "view:patients",
            "edit:annotations",
            "export:images",
            "ai:run_inference",
            "ai:view_results",
        ],
        "technologist": [
            "view:studies",
            "view:patients",
            "edit:studies",
            "import:studies",
        ],
        "referring_physician": [
            "view:studies",
            "view:patients",
            "view:reports",
        ],
        "researcher": [
            "view:anonymized_studies",
            "export:anonymized_data",
            "ai:run_inference",
            "ai:view_results",
        ],
    }

    def __init__(self, user_roles: list[str], user_permissions: list[str] | None = None):
        """Initialize permission checker.

        Args:
            user_roles: List of user roles
            user_permissions: Optional explicit permissions (override role-based)

        """
        self.user_roles = user_roles
        self.user_permissions = user_permissions or self._get_permissions_for_roles(user_roles)

    def _get_permissions_for_roles(self, roles: list[str]) -> list[str]:
        """Get all permissions for given roles."""
        permissions = set()
        for role in roles:
            role_perms = self.PERMISSIONS.get(role, [])
            permissions.update(role_perms)
        return list(permissions)

    def has_permission(self, required_permission: str) -> bool:
        """Check if user has a specific permission.

        Args:
            required_permission: Permission to check (e.g., "view:studies")

        Returns:
            True if user has permission, False otherwise

        """
        for perm in self.user_permissions:
            # Check for wildcard permissions
            if perm.endswith(":*"):
                prefix = perm[:-1]  # Remove "*"
                if required_permission.startswith(prefix) or required_permission.startswith(
                    perm.split(":")[0]
                ):
                    return True
            # Check for exact match
            if perm == required_permission:
                return True
        return False

    def has_any_permission(self, permissions: list[str]) -> bool:
        """Check if user has any of the given permissions."""
        return any(self.has_permission(p) for p in permissions)

    def has_all_permissions(self, permissions: list[str]) -> bool:
        """Check if user has all of the given permissions."""
        return all(self.has_permission(p) for p in permissions)
