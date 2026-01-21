# ADR-002: Technology Stack Choices

## Status

Accepted

## Date

2024-01-15

## Context

We needed to select technologies for building a medical imaging application that requires:
- High-performance image rendering
- Real-time user interactions
- Robust data processing
- AI/ML inference capabilities
- DICOM standard compliance

## Decision

### Frontend Stack

| Component | Choice | Alternatives Considered |
|-----------|--------|------------------------|
| Framework | React 18 | Vue 3, Angular, Svelte |
| Language | TypeScript | JavaScript |
| Build Tool | Vite | Webpack, Create React App |
| UI Library | Material-UI | Chakra, Ant Design |
| State Management | TanStack Query | Redux, Zustand |
| Medical Imaging | Cornerstone.js | OHIF, dwv |

**Rationale:**

- **React 18**: Mature ecosystem, excellent TypeScript support, large talent pool
- **TypeScript**: Type safety critical for medical applications, better maintainability
- **Vite**: Fast development builds, modern ESM-first approach
- **Material-UI**: Comprehensive component library, good accessibility
- **TanStack Query**: Excellent async state management, caching, optimistic updates
- **Cornerstone.js**: Industry standard for web DICOM viewing, active development

### Backend Stack

| Component | Choice | Alternatives Considered |
|-----------|--------|------------------------|
| Framework | FastAPI | Django, Flask, Express |
| Language | Python 3.10+ | Node.js, Go, Rust |
| ORM | SQLAlchemy 2.0 | Django ORM, Tortoise |
| Database | PostgreSQL 14+ | MySQL, MongoDB |
| Cache | Redis 7+ | Memcached |
| Task Queue | Redis (via asyncio) | Celery, RabbitMQ |

**Rationale:**

- **FastAPI**: Async-first, automatic OpenAPI docs, Pydantic validation, excellent performance
- **Python**: Best ecosystem for medical imaging (pydicom) and AI/ML (PyTorch)
- **SQLAlchemy 2.0**: Async support, mature ORM, complex query capabilities
- **PostgreSQL**: ACID compliance, JSON support, excellent for complex queries
- **Redis**: Caching + lightweight task queue + session storage

### AI/ML Stack

| Component | Choice | Purpose |
|-----------|--------|---------|
| Framework | PyTorch | Model inference |
| Medical AI | MONAI | Medical imaging AI toolkit |
| Segmentation | MedSAM | Medical image segmentation |
| Detection | YOLOv8 | Object detection |

**Rationale:**

- **PyTorch**: Dominant in research, best model availability
- **MONAI**: Purpose-built for medical imaging, pre-trained models
- **Model variety**: Different models for different clinical tasks

### Infrastructure

| Component | Choice | Purpose |
|-----------|--------|---------|
| Containers | Docker | Consistent environments |
| Orchestration | Docker Compose | Development & simple deployment |
| Reverse Proxy | Nginx | TLS termination, load balancing |
| CI/CD | GitHub Actions | Automation |

## Consequences

### Positive

- **Python for backend**: Access to best DICOM and AI libraries
- **TypeScript for frontend**: Type safety, better IDE support
- **FastAPI**: Modern async patterns, automatic documentation
- **Cornerstone.js**: Industry-proven medical imaging
- **PostgreSQL**: Reliable, scalable, feature-rich

### Negative

- **Python GIL**: CPU-bound AI tasks block event loop (mitigated by process pools)
- **Cornerstone.js learning curve**: Complex API for advanced features
- **Multiple languages**: Context switching between Python and TypeScript

### Trade-offs Accepted

1. **Python performance**: AI library ecosystem outweighs raw performance
2. **Not serverless**: Need persistent connections for DICOM and streaming
3. **Docker Compose over K8s**: Simpler for current scale, can migrate later

## Version Pinning Strategy

```
# Frontend (package.json)
- Pin major.minor: "react": "^18.2.0"
- Lock file committed: package-lock.json

# Backend (pyproject.toml)
- Pin major: python = ">=3.10,<4.0"
- Pin ranges for deps: "fastapi>=0.100.0,<1.0.0"
```

## Upgrade Policy

- Security patches: Immediate
- Minor versions: Monthly review
- Major versions: Quarterly evaluation with testing

## Related Decisions

- ADR-001: System Architecture
- ADR-003: AI Model Integration Approach
