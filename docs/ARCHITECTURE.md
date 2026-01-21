# Horalix View - Architecture Documentation

## Overview

Horalix View is a multi-tier medical imaging application built with modern technologies for high performance, scalability, and maintainability.

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                                 PRESENTATION LAYER                               │
├─────────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │                         React Frontend (TypeScript)                      │   │
│  │  ┌───────────┐  ┌────────────┐  ┌──────────┐  ┌────────────────────┐   │   │
│  │  │  Pages    │  │ Components │  │ Contexts │  │     Services       │   │   │
│  │  │ Dashboard │  │  Viewer    │  │   Auth   │  │  API Client (Axios)│   │   │
│  │  │ Studies   │  │  Toolbar   │  │  Theme   │  │  React Query       │   │   │
│  │  │ Patients  │  │  Sidebar   │  │          │  │                    │   │   │
│  │  └───────────┘  └────────────┘  └──────────┘  └────────────────────┘   │   │
│  │  ┌────────────────────────────────────────────────────────────────┐    │   │
│  │  │              Cornerstone.js (DICOM Rendering)                  │    │   │
│  │  │  Image Loaders | Viewports | Tools | Synchronizers            │    │   │
│  │  └────────────────────────────────────────────────────────────────┘    │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        │ HTTP/REST/WebSocket
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                                  API LAYER                                       │
├─────────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │                      FastAPI Backend (Python)                            │   │
│  │  ┌────────────────────────────────────────────────────────────────┐     │   │
│  │  │                     API Endpoints (v1)                          │     │   │
│  │  │  /auth  /studies  /patients  /series  /annotations  /ai  /admin │     │   │
│  │  └────────────────────────────────────────────────────────────────┘     │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐      │   │
│  │  │   Security   │  │   Logging    │  │      Configuration       │      │   │
│  │  │ JWT/RBAC     │  │   Audit      │  │   Pydantic Settings      │      │   │
│  │  │ Password     │  │   Metrics    │  │   Env Validation         │      │   │
│  │  └──────────────┘  └──────────────┘  └──────────────────────────┘      │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                               SERVICE LAYER                                      │
├─────────────────────────────────────────────────────────────────────────────────┤
│  ┌────────────────────┐  ┌────────────────────┐  ┌────────────────────┐        │
│  │   DICOM Services   │  │    AI Services     │  │  Storage Services  │        │
│  │  ┌──────────────┐  │  │  ┌──────────────┐  │  │  ┌──────────────┐  │        │
│  │  │    Parser    │  │  │  │Model Registry│  │  │  │DICOM Storage │  │        │
│  │  │  pydicom     │  │  │  │   YOLOv8     │  │  │  │  File System │  │        │
│  │  └──────────────┘  │  │  │   MONAI      │  │  │  └──────────────┘  │        │
│  │  ┌──────────────┐  │  │  │   MedSAM     │  │  │  ┌──────────────┐  │        │
│  │  │ Networking   │  │  │  └──────────────┘  │  │  │  Annotation  │  │        │
│  │  │ pynetdicom   │  │  │  ┌──────────────┐  │  │  │   Storage    │  │        │
│  │  └──────────────┘  │  │  │ DICOM Loader │  │  │  └──────────────┘  │        │
│  └────────────────────┘  │  └──────────────┘  │  └────────────────────┘        │
│                          └────────────────────┘                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                                DATA LAYER                                        │
├─────────────────────────────────────────────────────────────────────────────────┤
│  ┌────────────────────┐  ┌────────────────────┐  ┌────────────────────┐        │
│  │    PostgreSQL      │  │       Redis        │  │    File System     │        │
│  │  ┌──────────────┐  │  │  ┌──────────────┐  │  │  ┌──────────────┐  │        │
│  │  │   patients   │  │  │  │    Cache     │  │  │  │ DICOM Files  │  │        │
│  │  │   studies    │  │  │  │   Sessions   │  │  │  │ AI Models    │  │        │
│  │  │   series     │  │  │  │   Job Queue  │  │  │  │ Temp Files   │  │        │
│  │  │   instances  │  │  │  └──────────────┘  │  │  └──────────────┘  │        │
│  │  │  annotations │  │  └────────────────────┘  └────────────────────┘        │
│  │  │    users     │  │                                                         │
│  │  │    jobs      │  │                                                         │
│  │  └──────────────┘  │                                                         │
│  └────────────────────┘                                                         │
└─────────────────────────────────────────────────────────────────────────────────┘
```

## Component Details

### Frontend (`/frontend`)

| Directory | Purpose |
|-----------|---------|
| `src/components/` | Reusable UI components |
| `src/pages/` | Page-level components (routing targets) |
| `src/contexts/` | React Context providers (Auth, Theme) |
| `src/services/` | API client and service functions |
| `src/hooks/` | Custom React hooks |
| `src/stores/` | State management (Zustand) |
| `src/themes/` | MUI theme configuration |
| `src/types/` | TypeScript type definitions |
| `src/utils/` | Utility functions |

### Backend (`/backend`)

| Directory | Purpose |
|-----------|---------|
| `app/api/v1/endpoints/` | REST API endpoint handlers |
| `app/core/` | Configuration, security, logging |
| `app/models/` | SQLAlchemy database models |
| `app/services/` | Business logic services |
| `app/services/ai/` | AI model implementations |
| `app/services/dicom/` | DICOM parsing and networking |
| `alembic/` | Database migrations |
| `tests/` | Test suites |

## Data Flow

### User Authentication Flow

```
┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
│  Client  │────▶│  /login  │────▶│ Validate │────▶│ Generate │
│          │     │          │     │ Password │     │   JWT    │
└──────────┘     └──────────┘     └──────────┘     └──────────┘
     │                                                   │
     │◀──────────────────────────────────────────────────┘
     │                 Return JWT Token
     ▼
┌──────────┐     ┌──────────┐     ┌──────────┐
│ Request  │────▶│  Verify  │────▶│ Execute  │
│ + JWT    │     │   JWT    │     │ Endpoint │
└──────────┘     └──────────┘     └──────────┘
```

### DICOM Upload Flow

```
┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
│  Upload  │────▶│  Parse   │────▶│  Store   │────▶│ Database │
│  DICOM   │     │ pydicom  │     │  Files   │     │  Update  │
└──────────┘     └──────────┘     └──────────┘     └──────────┘
                      │
                      ▼
              ┌──────────────┐
              │   Extract    │
              │   Metadata   │
              │  (Patient,   │
              │   Study,     │
              │   Series)    │
              └──────────────┘
```

### AI Inference Flow

```
┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
│  Submit  │────▶│  Create  │────▶│  Queue   │────▶│  Worker  │
│   Job    │     │   Job    │     │  Redis   │     │ Process  │
└──────────┘     └──────────┘     └──────────┘     └──────────┘
     │                                                   │
     │◀──────────────────────────────────────────────────┘
     │              Poll Status / WebSocket
     ▼
┌──────────┐     ┌──────────┐     ┌──────────┐
│ Retrieve │◀────│  Store   │◀────│  Model   │
│ Results  │     │ Results  │     │ Infer    │
└──────────┘     └──────────┘     └──────────┘
```

## Database Schema

### Core Entities

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│     patients    │────▶│     studies     │────▶│     series      │
├─────────────────┤     ├─────────────────┤     ├─────────────────┤
│ id              │     │ study_instance_uid│   │ series_instance_uid│
│ patient_id      │     │ patient_id_fk   │     │ study_uid_fk    │
│ patient_name    │     │ study_date      │     │ modality        │
│ birth_date      │     │ description     │     │ series_number   │
│ sex             │     │ modalities      │     │ description     │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                                │
                                ▼
                        ┌─────────────────┐     ┌─────────────────┐
                        │   annotations   │     │    instances    │
                        ├─────────────────┤     ├─────────────────┤
                        │ annotation_uid  │     │ sop_instance_uid│
                        │ study_uid       │     │ series_uid_fk   │
                        │ annotation_type │     │ instance_number │
                        │ geometry (JSON) │     │ file_path       │
                        │ created_by      │     │ rows, columns   │
                        └─────────────────┘     └─────────────────┘
```

## Security Architecture

### Authentication

- JWT-based authentication with configurable expiration
- Password hashing using bcrypt
- Refresh token support (planned)

### Authorization

- Role-Based Access Control (RBAC)
- Roles: `admin`, `radiologist`, `technologist`, `researcher`
- Endpoint-level permission checks

### Audit Logging

- All data access is logged
- User actions are tracked
- HIPAA compliance support

## Deployment Architecture

### Docker Compose (Development/Small Scale)

```
┌─────────────────────────────────────────────────────────────┐
│                      Docker Host                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │  frontend   │  │   backend   │  │  postgres   │         │
│  │   :3000     │  │   :8000     │  │   :5432     │         │
│  └─────────────┘  └─────────────┘  └─────────────┘         │
│                                                              │
│  ┌─────────────┐  ┌─────────────────────────────────┐       │
│  │    redis    │  │         volumes                 │       │
│  │   :6379     │  │  dicom_storage | ai_models     │       │
│  └─────────────┘  └─────────────────────────────────┘       │
└─────────────────────────────────────────────────────────────┘
```

## Performance Considerations

### Caching Strategy

- Redis for session caching
- Query result caching for frequently accessed data
- Browser-side caching for static assets

### Database Optimization

- Proper indexing on frequently queried columns
- Connection pooling with SQLAlchemy
- Async database operations

### Image Loading

- Lazy loading of DICOM images
- Progressive rendering
- Web workers for image processing

## Error Handling

### API Error Responses

All API errors follow a consistent format:

```json
{
  "detail": "Error description",
  "code": "ERROR_CODE",
  "timestamp": "2024-01-15T10:30:00Z"
}
```

### Error Categories

| HTTP Code | Category | Example |
|-----------|----------|---------|
| 400 | Bad Request | Invalid input data |
| 401 | Unauthorized | Invalid/expired token |
| 403 | Forbidden | Insufficient permissions |
| 404 | Not Found | Resource doesn't exist |
| 422 | Validation Error | Schema validation failed |
| 500 | Server Error | Unexpected error |

## Future Considerations

- **Kubernetes deployment** for horizontal scaling
- **Message queue** (RabbitMQ/Kafka) for async processing
- **Distributed caching** for multi-instance deployments
- **CDC (Change Data Capture)** for real-time sync
