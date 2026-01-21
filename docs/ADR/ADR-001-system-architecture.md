# ADR-001: System Architecture - Microservices with Modular Monolith Backend

## Status

Accepted

## Date

2024-01-15

## Context

Horalix View is a medical imaging application that needs to:
- Handle DICOM image processing and viewing
- Provide AI-powered analysis capabilities
- Support multiple concurrent users
- Integrate with existing PACS systems
- Scale to handle growing data volumes

We needed to decide on the overall system architecture that would balance:
- Development velocity (small team)
- Operational complexity
- Scalability requirements
- Future extensibility

## Decision

We chose a **hybrid architecture**:

1. **Frontend**: Single-Page Application (React)
2. **Backend**: Modular Monolith (FastAPI)
3. **Services**: Containerized with Docker Compose
4. **Database**: PostgreSQL with Redis caching

```
┌─────────────────────────────────────────────────────────────┐
│                      Architecture                            │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────┐                                           │
│  │   Frontend   │  React SPA served by Vite/Nginx           │
│  │   (React)    │                                           │
│  └──────┬───────┘                                           │
│         │ HTTP/REST                                          │
│         ▼                                                    │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              Backend (FastAPI)                        │   │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐    │   │
│  │  │  Auth   │ │ Studies │ │  DICOM  │ │   AI    │    │   │
│  │  │ Module  │ │ Module  │ │ Module  │ │ Module  │    │   │
│  │  └─────────┘ └─────────┘ └─────────┘ └─────────┘    │   │
│  └──────────────────────────────────────────────────────┘   │
│         │                    │                               │
│         ▼                    ▼                               │
│  ┌──────────────┐    ┌──────────────┐                       │
│  │  PostgreSQL  │    │    Redis     │                       │
│  │   Database   │    │    Cache     │                       │
│  └──────────────┘    └──────────────┘                       │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Why Modular Monolith (not Microservices)?

| Aspect | Microservices | Modular Monolith (Chosen) |
|--------|---------------|---------------------------|
| Development Speed | Slower (service boundaries) | Faster (shared code) |
| Operational Complexity | High (many deployments) | Low (single deployment) |
| Debugging | Distributed tracing needed | Simple stack traces |
| Team Size Required | Larger | Small team friendly |
| Future Extraction | N/A | Modules can become services |

### Module Boundaries

The backend is organized into logical modules:
- `api/` - HTTP endpoints, routing
- `services/dicom/` - DICOM parsing, storage, networking
- `services/ai/` - AI model loading, inference
- `models/` - Database models
- `core/` - Configuration, security, logging

These modules communicate through Python imports but maintain clean interfaces, allowing future extraction to microservices if needed.

## Consequences

### Positive
- Fast development with single codebase
- Simple deployment (one container)
- Easy debugging and testing
- Low operational overhead
- Clear path to microservices if needed

### Negative
- Single point of failure (mitigated by container orchestration)
- Scaling requires scaling entire backend
- AI inference competes for resources with API requests

### Mitigations
- Use job queues (Redis) for async AI processing
- Horizontal scaling with multiple backend instances
- Read replicas for database scaling
- Future: Extract AI service when compute needs grow

## Related Decisions

- ADR-002: Technology Stack Choices
- ADR-003: AI Model Integration Approach
