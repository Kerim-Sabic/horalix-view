"""
Application configuration management using Pydantic Settings.

This module provides centralized configuration for the Horalix View backend,
supporting environment variables and .env files for different deployment environments.
"""

from functools import lru_cache
from pathlib import Path
from typing import Any, Literal

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class AIModelSettings(BaseSettings):
    """Configuration for AI model settings."""

    model_config = SettingsConfigDict(env_prefix="AI_")

    # Model paths and configurations
    models_dir: Path = Field(default=Path("./models"), description="Directory for AI model weights")
    cache_dir: Path = Field(default=Path("./cache/models"), description="Model cache directory")

    # Segmentation models
    nnunet_enabled: bool = Field(default=True, description="Enable nnU-Net segmentation")
    medunet_enabled: bool = Field(default=True, description="Enable MedUNeXt segmentation")
    medsam_enabled: bool = Field(default=True, description="Enable MedSAM segmentation")
    swinunet_enabled: bool = Field(default=True, description="Enable SwinUNet segmentation")

    # Detection models
    yolov8_enabled: bool = Field(default=True, description="Enable YOLOv8 detection")
    faster_rcnn_enabled: bool = Field(default=False, description="Enable Faster R-CNN detection")

    # Classification models
    vit_enabled: bool = Field(default=True, description="Enable Vision Transformer classification")
    medvit_enabled: bool = Field(default=True, description="Enable MedViT classification")
    echoclr_enabled: bool = Field(default=True, description="Enable EchoCLR for echocardiography")

    # Enhancement models
    unimie_enabled: bool = Field(default=True, description="Enable UniMIE diffusion enhancement")
    gan_enhancement_enabled: bool = Field(default=False, description="Enable GAN enhancement")

    # Pathology models
    gigapath_enabled: bool = Field(default=True, description="Enable Prov-GigaPath")
    hipt_enabled: bool = Field(default=True, description="Enable HIPT")
    ctranspath_enabled: bool = Field(default=True, description="Enable CTransPath")
    chief_enabled: bool = Field(default=True, description="Enable CHIEF")

    # Inference settings
    device: str = Field(default="cuda", description="Device for inference (cuda/cpu)")
    batch_size: int = Field(default=4, ge=1, le=64, description="Batch size for inference")
    num_workers: int = Field(default=4, ge=0, le=16, description="Number of data loader workers")
    mixed_precision: bool = Field(default=True, description="Enable mixed precision inference")


class DICOMSettings(BaseSettings):
    """Configuration for DICOM networking and processing."""

    model_config = SettingsConfigDict(env_prefix="DICOM_")

    # DICOM AE settings
    ae_title: str = Field(default="HORALIX_VIEW", max_length=16, description="Application Entity Title")
    port: int = Field(default=11112, ge=1, le=65535, description="DICOM port")

    # Storage paths
    storage_dir: Path = Field(default=Path("./storage/dicom"), description="DICOM storage directory")
    temp_dir: Path = Field(default=Path("./temp"), description="Temporary file directory")

    # DICOMweb settings
    dicomweb_enabled: bool = Field(default=True, description="Enable DICOMweb services")
    wado_rs_enabled: bool = Field(default=True, description="Enable WADO-RS")
    qido_rs_enabled: bool = Field(default=True, description="Enable QIDO-RS")
    stow_rs_enabled: bool = Field(default=True, description="Enable STOW-RS")

    # Transfer settings
    max_pdu_length: int = Field(default=16384, description="Maximum PDU length")
    max_associations: int = Field(default=10, description="Maximum concurrent associations")
    association_timeout: int = Field(default=30, description="Association timeout in seconds")

    # Processing settings
    parallel_downloads: int = Field(default=4, ge=1, le=16, description="Parallel download threads")
    prefetch_enabled: bool = Field(default=True, description="Enable prefetching")
    cache_size_gb: float = Field(default=10.0, ge=1.0, description="Cache size in GB")


class ComplianceSettings(BaseSettings):
    """Configuration for compliance and security features."""

    model_config = SettingsConfigDict(env_prefix="COMPLIANCE_")

    # Anonymization
    anonymization_enabled: bool = Field(default=True, description="Enable anonymization tools")
    retain_patient_characteristics: bool = Field(
        default=True, description="Retain age/sex in anonymization"
    )

    # Encryption
    encryption_at_rest: bool = Field(default=True, description="Encrypt stored data")
    encryption_in_transit: bool = Field(default=True, description="Encrypt data in transit")
    encryption_algorithm: str = Field(default="AES-256-GCM", description="Encryption algorithm")

    # Audit logging
    audit_logging_enabled: bool = Field(default=True, description="Enable audit logging")
    audit_log_retention_days: int = Field(default=365, ge=30, description="Audit log retention")

    # Compliance standards
    hipaa_mode: bool = Field(default=True, description="Enable HIPAA compliance mode")
    cfr_part_11_mode: bool = Field(default=False, description="Enable 21 CFR Part 11 mode")


class DatabaseSettings(BaseSettings):
    """Database configuration settings."""

    model_config = SettingsConfigDict(env_prefix="DB_")

    driver: str = Field(default="postgresql+asyncpg", description="Database driver")
    host: str = Field(default="localhost", description="Database host")
    port: int = Field(default=5432, description="Database port")
    user: str = Field(default="horalix", description="Database user")
    password: str = Field(default="", description="Database password")
    name: str = Field(default="horalix_view", description="Database name")
    pool_size: int = Field(default=10, ge=1, le=100, description="Connection pool size")
    max_overflow: int = Field(default=20, ge=0, le=100, description="Max pool overflow")

    @property
    def url(self) -> str:
        """Get database connection URL."""
        return f"{self.driver}://{self.user}:{self.password}@{self.host}:{self.port}/{self.name}"


class RedisSettings(BaseSettings):
    """Redis cache configuration settings."""

    model_config = SettingsConfigDict(env_prefix="REDIS_")

    host: str = Field(default="localhost", description="Redis host")
    port: int = Field(default=6379, description="Redis port")
    password: str = Field(default="", description="Redis password")
    db: int = Field(default=0, ge=0, le=15, description="Redis database number")
    ssl: bool = Field(default=False, description="Enable SSL for Redis")

    @property
    def url(self) -> str:
        """Get Redis connection URL."""
        protocol = "rediss" if self.ssl else "redis"
        auth = f":{self.password}@" if self.password else ""
        return f"{protocol}://{auth}{self.host}:{self.port}/{self.db}"


class Settings(BaseSettings):
    """Main application settings."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # Application settings
    app_name: str = Field(default="Horalix View", description="Application name")
    app_version: str = Field(default="1.0.0", description="Application version")
    environment: Literal["development", "staging", "production"] = Field(
        default="development", description="Deployment environment"
    )
    debug: bool = Field(default=False, description="Enable debug mode")

    # Server settings
    host: str = Field(default="0.0.0.0", description="Server host")
    port: int = Field(default=8000, ge=1, le=65535, description="Server port")
    workers: int = Field(default=4, ge=1, le=32, description="Number of workers")

    # Security settings
    secret_key: str = Field(
        default="change-this-in-production-use-openssl-rand-hex-32",
        min_length=32,
        description="Secret key for JWT tokens",
    )
    access_token_expire_minutes: int = Field(default=60, ge=5, description="Token expiration")
    algorithm: str = Field(default="HS256", description="JWT algorithm")

    # CORS settings
    cors_origins: list[str] = Field(
        default=["http://localhost:3000", "http://localhost:5173"],
        description="Allowed CORS origins",
    )
    cors_allow_credentials: bool = Field(default=True, description="Allow CORS credentials")

    # Nested settings
    ai: AIModelSettings = Field(default_factory=AIModelSettings)
    dicom: DICOMSettings = Field(default_factory=DICOMSettings)
    compliance: ComplianceSettings = Field(default_factory=ComplianceSettings)
    database: DatabaseSettings = Field(default_factory=DatabaseSettings)
    redis: RedisSettings = Field(default_factory=RedisSettings)

    # Integration settings
    fhir_server_url: str | None = Field(default=None, description="FHIR server URL")
    pacs_server_url: str | None = Field(default=None, description="PACS server URL")

    @field_validator("secret_key")
    @classmethod
    def validate_secret_key(cls, v: str) -> str:
        """Warn if using default secret key."""
        if "change-this" in v:
            import warnings
            warnings.warn(
                "Using default secret key! Set SECRET_KEY environment variable in production.",
                UserWarning,
                stacklevel=2,
            )
        return v

    @model_validator(mode="after")
    def validate_settings(self) -> "Settings":
        """Validate settings after initialization."""
        if self.environment == "production":
            if self.debug:
                raise ValueError("Debug mode must be disabled in production")
            if "change-this" in self.secret_key:
                raise ValueError("Must set a secure SECRET_KEY in production")
        return self


@lru_cache
def get_settings() -> Settings:
    """Get cached settings instance."""
    return Settings()


# Global settings instance
settings = get_settings()
