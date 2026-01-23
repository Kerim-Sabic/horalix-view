"""Health and client error reporting endpoints."""

from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlparse

from fastapi import APIRouter, Request, status
from pydantic import BaseModel, Field

from app.core.logging import get_logger

logger = get_logger(__name__)
router = APIRouter()


class ClientErrorReport(BaseModel):
    """Client-side error report payload (no PHI)."""

    message: str = Field(..., description="Error message")
    stack: str | None = Field(None, description="Stack trace")
    url: str = Field(..., description="Full page URL")
    route: str | None = Field(None, description="App route")
    userAgent: str | None = Field(None, description="Browser user agent")
    timestamp: str | None = Field(None, description="Client timestamp (ISO 8601)")
    correlationId: str | None = Field(None, description="Client correlation id")
    userId: str | None = Field(None, description="Authenticated user id (if safe)")


def _sanitize_url(raw_url: str) -> str:
    """Strip query/fragment to avoid logging sensitive parameters."""
    try:
        parsed = urlparse(raw_url)
        return parsed.path
    except Exception:
        return raw_url.split("?", 1)[0]


@router.post("/health/client-error", status_code=status.HTTP_204_NO_CONTENT)
async def report_client_error(payload: ClientErrorReport, request: Request) -> None:
    """Receive client error reports for observability."""
    safe_url = _sanitize_url(payload.url)
    event: dict[str, Any] = {
        "event_type": "client_error",
        "message": payload.message[:2000],
        "route": payload.route or safe_url,
        "url": safe_url,
        "user_agent": payload.userAgent,
        "timestamp": payload.timestamp or datetime.now(timezone.utc).isoformat(),
        "correlation_id": payload.correlationId,
        "user_id": payload.userId,
        "client_ip": request.client.host if request.client else "unknown",
    }

    if payload.stack:
        event["stack"] = payload.stack[:5000]

    logger.warning("client_error_reported", **event)
    return None


@router.get("/health/client-error", status_code=status.HTTP_204_NO_CONTENT)
async def client_error_healthcheck() -> None:
    """Confirm the client-error endpoint is available."""
    return None
