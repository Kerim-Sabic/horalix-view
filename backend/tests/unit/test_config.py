"""Tests for configuration module."""

from app.core.config import Settings, get_settings


class TestSettings:
    """Test Settings configuration."""

    def test_default_settings(self):
        """Test default settings values."""
        settings = Settings()
        assert settings.app_name == "Horalix View"
        assert settings.app_version == "1.0.0"
        assert settings.environment == "development"

    def test_dicom_settings(self):
        """Test DICOM settings."""
        settings = Settings()
        assert settings.dicom.ae_title == "HORALIX_VIEW"
        assert settings.dicom.port == 11112
        assert settings.dicom.dicomweb_enabled is True

    def test_ai_settings(self):
        """Test AI model settings."""
        settings = Settings()
        assert settings.ai.nnunet_enabled is True
        assert settings.ai.medsam_enabled is True
        assert settings.ai.yolov8_enabled is True

    def test_compliance_settings(self):
        """Test compliance settings."""
        settings = Settings()
        assert settings.compliance.hipaa_mode is True
        assert settings.compliance.audit_logging_enabled is True
        assert settings.compliance.encryption_at_rest is True

    def test_get_settings_cached(self):
        """Test settings are cached."""
        settings1 = get_settings()
        settings2 = get_settings()
        assert settings1 is settings2
