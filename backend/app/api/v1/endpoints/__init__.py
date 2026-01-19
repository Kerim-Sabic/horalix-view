"""API v1 endpoints."""

from app.api.v1.endpoints import (
    studies,
    series,
    instances,
    patients,
    ai,
    dicomweb,
    auth,
    admin,
    annotations,
    export,
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
