"""API v1 Router - Aggregates all API endpoints."""

from fastapi import APIRouter

from app.api.v1.endpoints import (
    admin,
    ai,
    annotations,
    auth,
    dashboard,
    dicomweb,
    export,
    health,
    instances,
    patients,
    series,
    studies,
)

api_router = APIRouter()

# Authentication endpoints
api_router.include_router(
    auth.router,
    prefix="/auth",
    tags=["Authentication"],
)

# Patient management
api_router.include_router(
    patients.router,
    prefix="/patients",
    tags=["Patients"],
)

# Study management
api_router.include_router(
    studies.router,
    prefix="/studies",
    tags=["Studies"],
)

# Series management
api_router.include_router(
    series.router,
    prefix="/series",
    tags=["Series"],
)

# Instance management
api_router.include_router(
    instances.router,
    prefix="/instances",
    tags=["Instances"],
)

# AI inference endpoints
api_router.include_router(
    ai.router,
    prefix="/ai",
    tags=["AI Models"],
)

# Annotation endpoints
api_router.include_router(
    annotations.router,
    prefix="/annotations",
    tags=["Annotations"],
)

# Export endpoints
api_router.include_router(
    export.router,
    prefix="/export",
    tags=["Export"],
)

# DICOMweb endpoints
api_router.include_router(
    dicomweb.router,
    prefix="/dicomweb",
    tags=["DICOMweb"],
)

# Admin endpoints
api_router.include_router(
    admin.router,
    prefix="/admin",
    tags=["Administration"],
)

# Dashboard endpoints
api_router.include_router(
    dashboard.router,
    prefix="/dashboard",
    tags=["Dashboard"],
)

# Health / client error reporting
api_router.include_router(
    health.router,
    tags=["Health"],
)
