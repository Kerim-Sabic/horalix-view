"""
Structured logging configuration for Horalix View.

Provides consistent, structured logging with support for different
output formats and log levels based on environment.
"""

import logging
import sys
from typing import Any

import structlog
from structlog.types import EventDict, Processor


def add_app_context(
    logger: logging.Logger, method_name: str, event_dict: EventDict
) -> EventDict:
    """Add application context to log entries."""
    event_dict["app"] = "horalix-view"
    return event_dict


def setup_logging(
    log_level: str = "INFO",
    json_logs: bool = False,
    log_file: str | None = None,
) -> None:
    """
    Configure structured logging for the application.

    Args:
        log_level: Minimum log level (DEBUG, INFO, WARNING, ERROR, CRITICAL)
        json_logs: If True, output logs as JSON (for production)
        log_file: Optional file path for log output
    """
    # Configure standard library logging
    logging.basicConfig(
        format="%(message)s",
        stream=sys.stdout,
        level=getattr(logging, log_level.upper(), logging.INFO),
    )

    # Shared processors for all outputs
    shared_processors: list[Processor] = [
        structlog.contextvars.merge_contextvars,
        structlog.stdlib.add_log_level,
        structlog.stdlib.add_logger_name,
        structlog.stdlib.PositionalArgumentsFormatter(),
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.UnicodeDecoder(),
        add_app_context,
    ]

    if json_logs:
        # JSON output for production
        processors: list[Processor] = shared_processors + [
            structlog.processors.format_exc_info,
            structlog.processors.JSONRenderer(),
        ]
    else:
        # Human-readable output for development
        processors = shared_processors + [
            structlog.dev.ConsoleRenderer(colors=True),
        ]

    structlog.configure(
        processors=processors,
        wrapper_class=structlog.stdlib.BoundLogger,
        context_class=dict,
        logger_factory=structlog.stdlib.LoggerFactory(),
        cache_logger_on_first_use=True,
    )

    # Configure file handler if specified
    if log_file:
        file_handler = logging.FileHandler(log_file)
        file_handler.setLevel(getattr(logging, log_level.upper(), logging.INFO))
        if json_logs:
            file_handler.setFormatter(logging.Formatter("%(message)s"))
        else:
            file_handler.setFormatter(
                logging.Formatter("%(asctime)s - %(name)s - %(levelname)s - %(message)s")
            )
        logging.getLogger().addHandler(file_handler)


def get_logger(name: str | None = None) -> structlog.stdlib.BoundLogger:
    """
    Get a structured logger instance.

    Args:
        name: Logger name (typically __name__)

    Returns:
        Configured structlog BoundLogger
    """
    return structlog.get_logger(name)


class AuditLogger:
    """
    Specialized logger for audit trail compliance.

    Provides methods for logging security-relevant events in a format
    suitable for HIPAA and 21 CFR Part 11 compliance.
    """

    def __init__(self):
        """Initialize audit logger."""
        self.logger = get_logger("audit")

    def log_access(
        self,
        user_id: str,
        resource_type: str,
        resource_id: str,
        action: str,
        success: bool = True,
        details: dict[str, Any] | None = None,
    ) -> None:
        """
        Log a resource access event.

        Args:
            user_id: ID of the user accessing the resource
            resource_type: Type of resource (e.g., "study", "patient")
            resource_id: ID of the accessed resource
            action: Action performed (e.g., "VIEW", "EXPORT")
            success: Whether the action succeeded
            details: Additional details
        """
        self.logger.info(
            "resource_access",
            user_id=user_id,
            resource_type=resource_type,
            resource_id=resource_id,
            action=action,
            success=success,
            details=details or {},
            audit_type="access",
        )

    def log_authentication(
        self,
        user_id: str | None,
        username: str,
        success: bool,
        method: str = "password",
        ip_address: str | None = None,
        failure_reason: str | None = None,
    ) -> None:
        """
        Log an authentication event.

        Args:
            user_id: ID of the authenticated user (None if failed)
            username: Username attempted
            success: Whether authentication succeeded
            method: Authentication method used
            ip_address: Client IP address
            failure_reason: Reason for failure (if applicable)
        """
        log_method = self.logger.info if success else self.logger.warning
        log_method(
            "authentication",
            user_id=user_id,
            username=username,
            success=success,
            method=method,
            ip_address=ip_address,
            failure_reason=failure_reason,
            audit_type="authentication",
        )

    def log_data_export(
        self,
        user_id: str,
        export_type: str,
        resource_ids: list[str],
        format: str,
        anonymized: bool = False,
        destination: str | None = None,
    ) -> None:
        """
        Log a data export event.

        Args:
            user_id: ID of the user exporting data
            export_type: Type of export (e.g., "study", "report")
            resource_ids: IDs of exported resources
            format: Export format (e.g., "DICOM", "PDF")
            anonymized: Whether data was anonymized
            destination: Export destination (if applicable)
        """
        self.logger.info(
            "data_export",
            user_id=user_id,
            export_type=export_type,
            resource_count=len(resource_ids),
            resource_ids=resource_ids[:10],  # Limit logged IDs
            format=format,
            anonymized=anonymized,
            destination=destination,
            audit_type="export",
        )

    def log_configuration_change(
        self,
        user_id: str,
        setting_name: str,
        old_value: Any,
        new_value: Any,
        component: str,
    ) -> None:
        """
        Log a configuration change.

        Args:
            user_id: ID of the user making the change
            setting_name: Name of the setting changed
            old_value: Previous value
            new_value: New value
            component: Component/module affected
        """
        self.logger.info(
            "configuration_change",
            user_id=user_id,
            setting_name=setting_name,
            old_value=str(old_value)[:100],  # Truncate for safety
            new_value=str(new_value)[:100],
            component=component,
            audit_type="configuration",
        )

    def log_ai_inference(
        self,
        user_id: str,
        model_name: str,
        study_id: str,
        inference_type: str,
        duration_ms: float,
        success: bool = True,
        error: str | None = None,
    ) -> None:
        """
        Log an AI inference event.

        Args:
            user_id: ID of the user requesting inference
            model_name: Name of the AI model used
            study_id: ID of the study analyzed
            inference_type: Type of inference (e.g., "segmentation", "detection")
            duration_ms: Inference duration in milliseconds
            success: Whether inference succeeded
            error: Error message if failed
        """
        log_method = self.logger.info if success else self.logger.error
        log_method(
            "ai_inference",
            user_id=user_id,
            model_name=model_name,
            study_id=study_id,
            inference_type=inference_type,
            duration_ms=duration_ms,
            success=success,
            error=error,
            audit_type="ai",
        )


# Global audit logger instance
audit_logger = AuditLogger()
