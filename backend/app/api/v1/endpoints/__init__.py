"""API v1 endpoints."""

from app.api.v1.endpoints import (
    admin,
    ai,
    annotations,
    auth,
    dicomweb,
    export,
    instances,
    patients,
    series,
    studies,
)

__all__ = [
    "studies",
    "series",
    "instances",
    "patients",
    "ai",
    "dicomweb",
    "auth",
    "admin",
    "annotations",
    "export",
]
