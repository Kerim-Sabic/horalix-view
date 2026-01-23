# Horalix View Architecture

## Overview
Horalix View is a web-based DICOM viewer and AI workstation built around a FastAPI backend and a React frontend. The frontend renders server-produced pixel images and overlays, while the backend handles DICOM ingestion, metadata indexing, and AI inference orchestration.

## System Components

```
Client (React + MUI)
  |
  |  HTTPS / REST
  v
Nginx (reverse proxy + static frontend)
  |
  |  /api/*
  v
FastAPI Backend
  |-- PostgreSQL (patients, studies, series, instances, jobs)
  |-- Redis (caching, job state)
  |-- Storage (DICOM files, AI weights, AI results)
```

Storage (bind mounts):
- `./storage` -> `/app/storage` (DICOM files)
- `./models` -> `/app/models` (AI weights)
- `./results` -> `/app/results` (AI outputs)

## Data Flow

### DICOM Upload
1. Client uploads DICOM via `POST /api/v1/studies/upload`.
2. Backend streams files to `/app/storage/dicom` and extracts metadata.
3. Metadata is written into Patients, Studies, Series, and Instances tables.

### Viewer Rendering
1. Client loads metadata from `/api/v1/studies/{uid}` and `/api/v1/series`.
2. For each frame, the viewer requests `/api/v1/instances/{uid}/pixel-data`.
3. The backend decodes pixel data and returns PNG/JPEG with window/level applied.
4. Frontend draws the image in an `<img>` and overlays AI/measurement layers in SVG.

### MPR (CT/MR/PT)
1. Client requests volume metadata from `/api/v1/series/{uid}/volume-info`.
2. MPR slices are rendered on demand via `/api/v1/series/{uid}/mpr`.

### AI Inference
1. Client submits jobs to `POST /api/v1/ai/infer`.
2. Backend loads series data, runs the selected model, and writes results under
   `results/{study_uid}/`.
3. Viewer fetches overlays using `/api/v1/ai/results/{study_uid}` and
   `/api/v1/ai/results/{study_uid}/masks/{file}/render`.

### Client Error Reporting
1. Frontend ErrorBoundary posts errors to `POST /api/v1/health/client-error`.
2. Backend logs structured, non-PHI error data for observability.

## AI Integration

Horalix View supports two model classes:
- Native Python models (YOLOv8, MONAI, MedSAM).
- External command models (EchoNet Measurements, Prov-GigaPath, HoVer-Net).

External command models are executed via `ExternalCommandModel` using configured
command templates:
- `AI_ECHONET_MEASUREMENTS_CMD`
- `AI_GIGAPATH_CMD`
- `AI_HOVERNET_CMD`

The runner receives input/output paths via environment variables (e.g.,
`HORALIX_INPUT_NPZ`, `HORALIX_OUTPUT_JSON`) and writes JSON to the output path.

## Key Backend Modules

- `app/api/v1/endpoints/` REST endpoints (auth, studies, series, instances, ai)
- `app/services/dicom/` DICOM parsing, storage, and networking
- `app/services/ai/` model registry, inference, external runners
- `app/core/` configuration, logging, security

## Security & Audit

- JWT authentication with RBAC.
- Audit events for login, study access, and AI inference.
- Client error reports strip PHI and are logged as structured JSON.

## Observability

- `/health` and `/ready` endpoints for health checks.
- `/metrics` for Prometheus-compatible metrics.
- Structured logs via `structlog` with request IDs.
