"""Horalix View - Advanced DICOM Viewer with AI Capabilities

Main FastAPI application entry point.
"""

from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from prometheus_client import Counter, Histogram, make_asgi_app

from app.api.v1.router import api_router
from app.core.config import settings
from app.core.logging import get_logger, setup_logging

# Initialize logging
setup_logging(
    log_level="DEBUG" if settings.debug else "INFO",
    json_logs=settings.environment == "production",
)

logger = get_logger(__name__)

# Prometheus metrics
REQUEST_COUNT = Counter(
    "horalix_requests_total",
    "Total HTTP requests",
    ["method", "endpoint", "status"],
)
REQUEST_LATENCY = Histogram(
    "horalix_request_latency_seconds",
    "HTTP request latency",
    ["method", "endpoint"],
)


def _safe_request_path(request: Request) -> str:
    """Return a route template path to avoid logging PHI in URLs."""
    route = request.scope.get("route")
    if route and hasattr(route, "path"):
        return route.path
    return request.url.path


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Application lifespan manager for startup and shutdown events."""
    # Startup
    logger.info(
        "Starting Horalix View",
        version=settings.app_version,
        environment=settings.environment,
    )

    # Initialize database
    from app.models.base import async_session_maker, engine

    app.state.db_engine = engine
    app.state.db_session_maker = async_session_maker
    logger.info("Database connection pool initialized")

    # Initialize default users (development only unless explicitly enabled)
    if settings.environment != "production" or settings.init_default_users:
        try:
            from app.api.v1.endpoints.auth import init_default_users

            async with async_session_maker() as session:
                await init_default_users(session)
                logger.info(
                    "Default users initialized (or already exist)",
                    forced=settings.environment == "production" and settings.init_default_users,
                )
        except Exception as e:
            # Log but don't fail startup - users may be created later via CLI
            logger.warning(f"Could not initialize default users: {e}")
    else:
        logger.info("Skipping default user initialization in production")

    # Optional demo data seeding (development only)
    if settings.enable_demo_data:
        try:
            from app.services.demo_data import seed_demo_patients

            async with async_session_maker() as session:
                inserted = await seed_demo_patients(session)
                logger.warning("Demo data enabled", patients_seeded=inserted)
        except Exception as e:
            logger.warning(f"Could not seed demo data: {e}")

    # Initialize services
    from app.services.ai.model_registry import ModelRegistry
    from app.services.dicom.storage import DicomStorageService

    # Initialize DICOM storage
    storage_service = DicomStorageService(settings.dicom.storage_dir)
    await storage_service.initialize()
    app.state.dicom_storage = storage_service

    # Initialize AI model registry
    model_registry = ModelRegistry(settings.ai)
    await model_registry.initialize()
    app.state.model_registry = model_registry
    if settings.ai.auto_load_models:
        await model_registry.preload_available_models()

    logger.info("Horalix View started successfully")

    yield

    # Shutdown
    logger.info("Shutting down Horalix View")

    # Cleanup services
    if hasattr(app.state, "model_registry"):
        await app.state.model_registry.shutdown()

    # Close database connections
    if hasattr(app.state, "db_engine"):
        await app.state.db_engine.dispose()
        logger.info("Database connections closed")

    logger.info("Horalix View shutdown complete")


def create_application() -> FastAPI:
    """Create and configure the FastAPI application."""
    app = FastAPI(
        title=settings.app_name,
        description="""
        Horalix View is an advanced, open-source DICOM viewer with integrated AI capabilities.

        ## Features

        - **Multi-modality Support**: CR, DX, MG, CT, MRI, PET-CT, Ultrasound, and more
        - **AI-Powered Analysis**: Segmentation, detection, classification, and enhancement
        - **3D Visualization**: MPR, volume rendering, and cardiac analysis
        - **Digital Pathology**: Whole-slide imaging with foundation models
        - **DICOM Networking**: C-STORE, C-MOVE, C-FIND, DICOMweb
        - **Compliance**: HIPAA, 21 CFR Part 11 ready

        ## API Documentation

        - **Interactive docs**: `/docs` (Swagger UI)
        - **ReDoc**: `/redoc`
        - **OpenAPI spec**: `/openapi.json`
        """,
        version=settings.app_version,
        docs_url="/docs" if settings.debug else None,
        redoc_url="/redoc" if settings.debug else None,
        openapi_url="/openapi.json" if settings.debug else None,
        lifespan=lifespan,
    )

    # Add CORS middleware
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=settings.cors_allow_credentials,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["X-Request-ID", "X-Process-Time"],
    )

    # Add GZip compression
    app.add_middleware(GZipMiddleware, minimum_size=1000)

    # Add request logging middleware
    @app.middleware("http")
    async def log_requests(request: Request, call_next):
        """Log all incoming requests with timing."""
        import time
        import uuid

        request_id = str(uuid.uuid4())[:8]
        start_time = time.time()
        safe_path = _safe_request_path(request)

        # Add request ID to headers
        response = await call_next(request)
        process_time = time.time() - start_time

        # Update metrics
        REQUEST_COUNT.labels(
            method=request.method,
            endpoint=safe_path,
            status=response.status_code,
        ).inc()
        REQUEST_LATENCY.labels(
            method=request.method,
            endpoint=safe_path,
        ).observe(process_time)

        # Add custom headers
        response.headers["X-Request-ID"] = request_id
        response.headers["X-Process-Time"] = f"{process_time:.4f}"

        logger.info(
            "request_completed",
            request_id=request_id,
            method=request.method,
            path=safe_path,
            status_code=response.status_code,
            process_time=f"{process_time:.4f}s",
        )

        return response

    # Mount Prometheus metrics endpoint
    metrics_app = make_asgi_app()
    app.mount("/metrics", metrics_app)

    # Include API router
    app.include_router(api_router, prefix="/api/v1")

    # Health check endpoint
    @app.get("/health", tags=["Health"])
    async def health_check():
        """Health check endpoint for load balancers and monitoring."""
        return {
            "status": "healthy",
            "version": settings.app_version,
            "environment": settings.environment,
        }

    # Readiness check endpoint
    @app.get("/ready", tags=["Health"])
    async def readiness_check(request: Request):
        """Readiness check for Kubernetes deployments."""
        checks = {
            "database": False,
            "dicom_storage": False,
            "model_registry": False,
        }

        # Check database connectivity
        if hasattr(request.app.state, "db_session_maker"):
            try:
                async with request.app.state.db_session_maker() as session:
                    from sqlalchemy import text

                    await session.execute(text("SELECT 1"))
                    checks["database"] = True
            except Exception:
                checks["database"] = False

        if hasattr(request.app.state, "dicom_storage"):
            checks["dicom_storage"] = request.app.state.dicom_storage.is_ready()

        if hasattr(request.app.state, "model_registry"):
            checks["model_registry"] = request.app.state.model_registry.is_ready()

        all_ready = all(checks.values())
        return JSONResponse(
            status_code=200 if all_ready else 503,
            content={
                "ready": all_ready,
                "checks": checks,
            },
        )

    # Global exception handler
    @app.exception_handler(Exception)
    async def global_exception_handler(request: Request, exc: Exception):
        """Handle uncaught exceptions."""
        logger.error(
            "unhandled_exception",
            path=_safe_request_path(request),
            method=request.method,
            error=str(exc),
            exc_info=exc,
        )
        return JSONResponse(
            status_code=500,
            content={
                "detail": "Internal server error",
                "message": str(exc) if settings.debug else "An unexpected error occurred",
            },
        )

    return app


# Create application instance
app = create_application()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.debug,
        workers=1 if settings.debug else settings.workers,
        log_level="debug" if settings.debug else "info",
    )
