# Incident Report

## Scope
- Target: Horalix View (frontend + backend + Docker)
- Mandatory failures: AI Models crash, missing client-error endpoint, DICOM upload 413, mock patients

## Console Errors (Observed)
- TypeError: Cannot convert undefined or null to object
  - Location: `frontend/src/pages/AIModelsPage.tsx:213`
  - Expression: `Object.keys(model.metrics)`

## Reproduction - Docker

### A) AI Models crash precondition
Request:
```
GET http://localhost:8000/api/v1/ai/models
Authorization: Bearer <token>
```
Response (truncated):
```json
{
  "models": [
    {
      "name": "yolov8",
      "version": "8.1.0",
      "model_type": "detection",
      "description": "YOLOv8: Real-time object detection for medical imaging",
      "supported_modalities": ["DX", "CR", "CT", "MR", "US"],
      "performance_metrics": { "mAP": 0.85, "fps": 45.0 },
      "reference": "Ultralytics 2023",
      "available": false,
      "enabled": true,
      "weights_path": "models/yolov8"
    }
  ],
  "total_registered": 5,
  "total_available": 0,
  "message": "No AI models available. Place model weights in the models directory. Models directory: models"
}
```
Impact: frontend expects `metrics` and calls `Object.keys(model.metrics)` which throws when `metrics` is `undefined`.

### B) Missing endpoint
Request:
```
GET http://localhost:8000/api/v1/health/client-error
```
Response:
```json
{"detail":"Not Found"}
```

### C) DICOM upload 413
Request:
```
POST http://localhost:3000/api/v1/studies/upload
Content-Type: multipart/form-data
files=@<2MB test file>
```
Response (Nginx):
```
HTTP/1.1 413 Request Entity Too Large
Content-Type: text/html
...
<h1>413 Request Entity Too Large</h1>
```

### D) Mock patients
Request:
```
GET http://localhost:8000/api/v1/patients
Authorization: Bearer <token>
```
Response (truncated):
```json
{
  "total": 3,
  "patients": [
    { "patient_id": "PAT002", "patient_name": "Jane Smith" },
    { "patient_id": "PAT001", "patient_name": "John Doe" },
    { "patient_id": "PAT003", "patient_name": "Robert Johnson" }
  ]
}
```

## Reproduction - Dev Mode (local backend + local DB)

### A) AI Models crash precondition
Request:
```
GET http://localhost:8000/api/v1/ai/models
Authorization: Bearer <token>
```
Response mirrors Docker and includes `performance_metrics` with no `metrics` field.

### B) Missing endpoint
Request:
```
GET http://localhost:8000/api/v1/health/client-error
```
Response:
```json
{"detail":"Not Found"}
```

### C) DICOM upload failure (route mismatch)
Request:
```
POST http://localhost:8000/api/v1/studies/upload
Authorization: Bearer <token>
```
Response:
```json
{"detail":"Method Not Allowed"}
```
Note: `POST /api/v1/studies` is the actual upload endpoint. The frontend posts to `/api/v1/studies/upload`.

### D) Mock patients
Request:
```
GET http://localhost:8000/api/v1/patients
Authorization: Bearer <token>
```
Response includes the same 3 hard-coded patients.

## Root Cause Statements (A-D)

### A) AI Models page crash
- Root cause: `frontend/src/pages/AIModelsPage.tsx:213` calls `Object.keys(model.metrics)` but backend returns `performance_metrics` and does not provide `metrics`, `model_id`, or `is_loaded`. `model.metrics` is `undefined`, causing a crash.

### B) Missing endpoint
- Root cause: Frontend ErrorBoundary posts to `/api/v1/health/client-error`, but no backend route exists under `app/main.py` or `app/api/v1` for that path.

### C) DICOM upload 413
- Root cause 1: Docker Nginx config (`frontend/docker/nginx.conf`) does not set `client_max_body_size`, so large uploads (>1MB default) are rejected with 413 before reaching the backend.
- Root cause 2: Frontend posts to `/api/v1/studies/upload`, but backend upload route is `POST /api/v1/studies` (so `/upload` resolves to the `/{study_uid}` GET route and returns 405 in dev).
- Root cause 3: Backend upload handler reads entire file into memory (`await file.read()`), which is unsafe for large studies and risks memory blowups.

### D) Mock/fake patients
- Root cause: demo patient seed logic ran on startup without an explicit opt-in, inserting 3 demo patients into the database and surfacing them in `/api/v1/patients`. Source: `backend/app/services/demo_data.py` + `backend/app/main.py`.

## Secondary Issues Discovered

- Upload 500 on missing SOPClassUID: `upload_study` assumed `ds.SOPClassUID` existed; now validates required UIDs and falls back to `file_meta.MediaStorageSOPClassUID`, returning 400 for malformed inputs.
- Client error endpoint logging crash: structlog reserved `event` key collided with kwargs; renamed to `event_type` to avoid logger errors.

## Relevant Code Locations
- AI Models UI: `frontend/src/pages/AIModelsPage.tsx`
- AI Models API: `backend/app/api/v1/endpoints/ai.py` (`GET /api/v1/ai/models`)
- Upload endpoint: `backend/app/api/v1/endpoints/studies.py` (`POST /api/v1/studies`)
- Frontend upload call: `frontend/src/services/api.ts` (`/studies/upload`)
- Nginx config (Docker build): `frontend/docker/nginx.conf`
- Additional Nginx config: `docker/nginx.conf`
- Mock patients: `backend/app/services/demo_data.py`, `backend/app/main.py`
