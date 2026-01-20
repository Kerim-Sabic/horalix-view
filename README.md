# Horalix View

**Hospital-Grade DICOM Viewer and AI Platform**

Horalix View is a production-ready, hospital-grade DICOM viewer and AI inference platform designed for clinical environments. It provides advanced medical image visualization, AI-powered analysis, and HIPAA-compliant workflow management.

## ✨ Features

### Core DICOM Capabilities
- 📁 **Full DICOMweb Support** - WADO-RS, QIDO-RS, STOW-RS protocols
- 🔍 **Advanced Viewer** - Multi-series, cine playback, window/level, MPR, 3D volume rendering
- 📊 **Annotation Tools** - Measurements (length, angle, area, volume), ROIs, text labels with database persistence
- 🏥 **Study Management** - Patient demographics, study organization, series browsing
- 📤 **Export Formats** - DICOM, NIfTI, PNG with configurable parameters

### AI & Machine Learning
- 🤖 **Multiple AI Models** - YOLOv8 detection, MONAI segmentation, MedSAM interactive segmentation
- ⚡ **Async Job Processing** - Background inference with real-time status tracking
- 🎯 **Task-Specific Models** - Liver segmentation, spleen segmentation, pathology detection
- 📈 **Results Management** - Mask overlays, confidence scores, exportable reports

### Clinical Features
- 🔐 **HIPAA Compliant** - Audit logging, encryption at rest, role-based access control
- 👥 **Multi-User Support** - Radiologist, technician, admin roles with permissions
- 🔍 **Search & Filter** - Patient name, study date, modality, accession number
- 📋 **Workflow Management** - Study status tracking, assignment, reporting

### Technical Excellence
- ⚙️ **Modern Architecture** - FastAPI backend, React TypeScript frontend
- 🚀 **High Performance** - Async operations, connection pooling, Redis caching
- 🐳 **Docker Ready** - Complete containerization with docker-compose
- 📊 **Production Monitoring** - Prometheus metrics, structured logging, health checks
- 🧪 **Comprehensive Tests** - Unit tests, integration tests, E2E coverage

---

## 📋 Table of Contents

- [Architecture](#-architecture)
- [Prerequisites](#-prerequisites)
- [Quick Start](#-quick-start)
- [Development Setup](#-development-setup)
- [AI Models Setup](#-ai-models-setup)
- [Database Migrations](#-database-migrations)
- [Configuration](#-configuration)
- [Deployment](#-deployment)
- [API Documentation](#-api-documentation)
- [Testing](#-testing)
- [Contributing](#-contributing)
- [License](#-license)

---

## 🏗 Architecture

### System Components

```
┌─────────────────┐      ┌──────────────────┐      ┌─────────────────┐
│  React Frontend │◄────►│  FastAPI Backend │◄────►│   PostgreSQL    │
│   (TypeScript)  │      │     (Python)     │      │    Database     │
└─────────────────┘      └──────────────────┘      └─────────────────┘
        │                         │                          │
        │                         ▼                          │
        │                  ┌─────────────┐                  │
        │                  │    Redis    │                  │
        │                  │   (Cache)   │                  │
        │                  └─────────────┘                  │
        │                         │                          │
        ▼                         ▼                          ▼
┌─────────────────────────────────────────────────────────────┐
│                     Docker Infrastructure                     │
│  ┌────────────┐  ┌─────────┐  ┌─────────┐  ┌───────────┐  │
│  │   Nginx    │  │  DICOM  │  │   AI    │  │  Storage  │  │
│  │   Proxy    │  │ Storage │  │ Models  │  │  Volume   │  │
│  └────────────┘  └─────────┘  └─────────┘  └───────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### Technology Stack

**Backend:**
- FastAPI 0.109+ (async web framework)
- SQLAlchemy 2.0+ (async ORM)
- PostgreSQL 14+ (primary database)
- Redis 7+ (caching & job queue)
- PyTorch 2.2+ (AI inference)
- Pydicom, MONAI, Ultralytics

**Frontend:**
- React 18 + TypeScript
- Material-UI 5 (component library)
- Cornerstone.js (DICOM rendering)
- VTK.js (3D visualization)
- TanStack Query (data fetching)
- Axios (HTTP client)

**Infrastructure:**
- Docker + Docker Compose
- Nginx (reverse proxy & static serving)
- Alembic (database migrations)
- Uvicorn (ASGI server)

---

## 📦 Prerequisites

### Required Software

- **Docker** 24.0+ and **Docker Compose** 2.0+ (recommended for all platforms)
- **Python** 3.10, 3.11, or 3.12 (for local development)
- **Node.js** 18+ and **npm** 9+ (for frontend development)
- **PostgreSQL** 14+ (if running without Docker)
- **Redis** 7+ (if running without Docker)

> **Windows Users:** Redis requires WSL2, Memurai, or Docker. See [WINDOWS_SETUP.md](WINDOWS_SETUP.md) for details.

### Hardware Requirements

**Minimum:**
- CPU: 4 cores
- RAM: 8GB
- Storage: 50GB SSD

**Recommended (with AI):**
- CPU: 8+ cores
- RAM: 16GB+
- GPU: NVIDIA GPU with 8GB+ VRAM (for AI inference)
- Storage: 500GB+ SSD (for DICOM storage)

---

## 🚀 Quick Start

### Using Docker Compose (Recommended)

1. **Clone the repository:**

```bash
git clone https://github.com/horalix/horalix-view.git
cd horalix-view
```

2. **Configure environment:**

```bash
# Copy the environment template to the repo root
cp .env.example .env

# Generate a secure SECRET_KEY
# Linux/macOS:
openssl rand -hex 32
# Windows PowerShell:
python -c "import secrets; print(secrets.token_hex(32))"

# Edit .env and paste the generated key into SECRET_KEY=...
```

3. **Build and start services:**

```bash
# From the repo root (recommended):
docker compose -f docker/docker-compose.yml up -d

# OR from the docker/ directory:
cd docker
docker compose up -d
```

The backend will automatically:
- Wait for PostgreSQL to be ready
- Run database migrations
- Create default users (admin/admin123, radiologist/rad123, technologist/tech123)

Wait for containers to be healthy (30-60 seconds):

```bash
docker compose -f docker/docker-compose.yml ps
```

4. **Access the application:**

- Frontend: http://localhost:3000
- Backend API: http://localhost:8000
- API Docs: http://localhost:8000/docs

5. **Login with default credentials:**

- Username: `admin`, Password: `admin123` (admin role)
- Username: `radiologist`, Password: `rad123` (radiologist role)
- Username: `technologist`, Password: `tech123` (technologist role)

**Important:** Change these passwords immediately in production!

6. **Create additional admin users (optional):**

```bash
# From repo root:
docker compose -f docker/docker-compose.yml exec backend python -m app.cli create-admin \
  --username myadmin \
  --email myadmin@example.com \
  --password your-secure-password

# OR from docker/ directory:
docker compose exec backend python -m app.cli create-admin \
  --username myadmin \
  --email myadmin@example.com \
  --password your-secure-password
```

---

## 💻 Development Setup

> **Windows Users:** See [WINDOWS_SETUP.md](WINDOWS_SETUP.md) for detailed Windows-specific instructions, including PostgreSQL, Redis, and troubleshooting.

### Backend Development

1. **Create virtual environment:**

```bash
cd backend
python -m venv venv

# Linux/macOS:
source venv/bin/activate

# Windows (PowerShell):
venv\Scripts\Activate.ps1

# Windows (cmd.exe):
venv\Scripts\activate.bat
```

2. **Install dependencies:**

```bash
# Core dependencies
pip install -e "."

# With AI models
pip install -e ".[ai]"

# Development tools
pip install -e ".[dev]"
```

3. **Configure environment:**

```bash
cp .env.example .env
# Edit .env with your local settings
```

4. **Start PostgreSQL and Redis:**

```bash
# Using Docker (Linux/macOS/Windows)
docker-compose up -d postgres redis

# Or on Windows, ensure services are running:
# - PostgreSQL service in Services (services.msc)
# - Redis/Memurai service or WSL Redis
```

5. **Setup database and run migrations:**

**Linux/macOS:**
```bash
./setup.sh
```

**Windows (PowerShell):**
```powershell
.\setup.ps1
```

**Windows (cmd.exe):**
```batch
setup.bat
```

**Or manually:**
```bash
alembic upgrade head
```

6. **Start development server:**

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### Frontend Development

1. **Install dependencies:**

```bash
cd frontend
npm install
```

2. **Start development server:**

```bash
npm run dev
```

The frontend will be available at http://localhost:5173 with hot module replacement.

### Running Tests

**Backend tests:**

```bash
cd backend
pytest                          # Run all tests
pytest --cov=app               # With coverage
pytest tests/services/ai/      # Specific tests
```

**Frontend tests:**

```bash
cd frontend
npm test                       # Run tests
npm run test:coverage          # With coverage
```

---

## 🤖 AI Models Setup

Horalix View supports multiple AI models for medical image analysis. Models must be downloaded separately and placed in the configured directory.

### Model Directory Structure

```
models/
├── yolov8/
│   └── model.pt              # YOLOv8 weights
├── monai_segmentation/
│   ├── model.pt              # MONAI model weights
│   └── config.json           # Model configuration
├── medsam/
│   └── medsam_vit_b.pth      # MedSAM weights
├── liver_segmentation/
│   ├── model.pt
│   └── config.json
└── spleen_segmentation/
    ├── model.pt
    └── config.json
```

### Downloading Model Weights

**YOLOv8 (Object Detection):**

```bash
pip install ultralytics
python -c "from ultralytics import YOLO; YOLO('yolov8n.pt')"
mkdir -p models/yolov8
mv yolov8n.pt models/yolov8/model.pt
```

**MONAI Models (Segmentation):**

```bash
pip install monai
python -m monai.bundle download \
  --name "spleen_ct_segmentation" \
  --bundle_dir models/spleen_segmentation
```

**MedSAM (Interactive Segmentation):**

```bash
mkdir -p models/medsam
wget -P models/medsam https://dl.fbaipublicfiles.com/segment_anything/sam_vit_b_01ec64.pth
mv models/medsam/sam_vit_b_01ec64.pth models/medsam/medsam_vit_b.pth
```

### Configuration

Set the models directory in `.env`:

```bash
AI_MODELS_DIR=./models
AI_DEVICE=cuda              # or 'cpu' for CPU inference
AI_ENABLED=true
AI_BATCH_SIZE=4
AI_MIXED_PRECISION=true
AI_CONFIDENCE_THRESHOLD=0.5
AI_MAX_CONCURRENT_JOBS=2
```

### Model Status Check

After starting the backend, check model status:

```bash
curl http://localhost:8000/api/v1/ai/models
```

If models are not loaded, check logs for errors. The API will return HTTP 424 or 503 with instructions if weights are missing:

```json
{
  "detail": "Model weights not found at models/yolov8/model.pt. Please download model weights and place them in the configured AI_MODELS_DIR."
}
```

---

## 🗄 Database Migrations

### Creating Migrations

When you modify database models:

```bash
cd backend
alembic revision --autogenerate -m "Description of changes"
```

Review the generated migration file in `alembic/versions/` before applying.

### Applying Migrations

**Development:**

```bash
alembic upgrade head
```

**Production (Docker):**

Migrations run automatically when the backend container starts. To manually run migrations:

```bash
docker-compose exec backend alembic upgrade head
```

### Rolling Back

```bash
alembic downgrade -1        # Rollback one version
alembic downgrade <revision>  # Rollback to specific version
```

### Migration History

```bash
alembic history            # View migration history
alembic current            # Show current version
```

---

## ⚙️ Configuration

### Environment Variables

Create `backend/.env` from `backend/.env.example`:

#### Core Settings

```bash
# Application
APP_NAME=Horalix View
ENVIRONMENT=production        # development, staging, production
DEBUG=false

# Security (CRITICAL: Generate strong secret key!)
SECRET_KEY=your-secret-key-here-generate-with-openssl-rand-hex-32
ACCESS_TOKEN_EXPIRE_MINUTES=60
ALGORITHM=HS256
```

#### Database

```bash
# Complete Database URL
DATABASE_URL=postgresql+asyncpg://user:password@host:port/database

# Or individual components
DB_HOST=postgres
DB_PORT=5432
DB_USER=horalix
DB_PASSWORD=horalix
DB_NAME=horalix_view
```

#### Redis

```bash
REDIS_URL=redis://redis:6379/0

# Or individual components
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_DB=0
```

#### DICOM Settings

```bash
DICOM_AE_TITLE=HORALIX_VIEW
DICOM_PORT=11112
DICOM_STORAGE_DIR=./storage/dicom
```

#### AI Configuration

```bash
AI_MODELS_DIR=./models
AI_DEVICE=cuda                    # cuda, cpu, or cuda:0
AI_BATCH_SIZE=4
AI_MIXED_PRECISION=true
AI_ENABLED=true
AI_CONFIDENCE_THRESHOLD=0.5
AI_MAX_CONCURRENT_JOBS=2
```

#### HIPAA Compliance

```bash
COMPLIANCE_HIPAA_MODE=true
COMPLIANCE_AUDIT_LOGGING_ENABLED=true
COMPLIANCE_ENCRYPTION_AT_REST=true
```

#### CORS (for development)

```bash
CORS_ORIGINS=["http://localhost:3000","http://localhost:5173"]
```

---

## 🚢 Deployment

### Production Deployment with Docker

1. **Prepare environment:**

```bash
cd horalix-view/backend
cp .env.example .env
# Edit .env with production values
# CRITICAL: Set a strong SECRET_KEY using: openssl rand -hex 32
```

2. **Configure Docker Compose:**

Edit `docker/docker-compose.yml` for production:

```yaml
services:
  backend:
    environment:
      - ENVIRONMENT=production
      - DEBUG=false
      - SECRET_KEY=${SECRET_KEY}  # From .env
      - DATABASE_URL=postgresql+asyncpg://horalix:${DB_PASSWORD}@postgres:5432/horalix
      - AI_DEVICE=cuda  # or cpu
```

3. **Build and start:**

```bash
# From repo root (recommended):
docker compose -f docker/docker-compose.yml build
docker compose -f docker/docker-compose.yml up -d

# The entrypoint script automatically:
# - Waits for PostgreSQL
# - Runs database migrations
# - Creates default users (if none exist)
```

4. **Verify services:**

```bash
docker compose -f docker/docker-compose.yml ps
docker compose -f docker/docker-compose.yml logs -f backend
```

5. **Create additional admin users (optional):**

```bash
docker compose -f docker/docker-compose.yml exec backend python -m app.cli create-admin \
  --username myadmin \
  --email myadmin@example.com \
  --password your-secure-password
```

### Reverse Proxy with HTTPS

**Using Nginx:**

```nginx
server {
    listen 443 ssl http2;
    server_name horalix.example.com;

    ssl_certificate /etc/ssl/certs/horalix.crt;
    ssl_certificate_key /etc/ssl/private/horalix.key;

    # Frontend
    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Backend API
    location /api {
        proxy_pass http://localhost:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
    }
}
```

### Monitoring & Logging

**View logs:**

```bash
docker-compose logs -f backend
docker-compose logs -f frontend
```

**Prometheus metrics:**

Access metrics at: http://localhost:8000/metrics

**Health checks:**

```bash
curl http://localhost:8000/health
```

### Backup & Restore

**Database backup:**

```bash
docker-compose exec postgres pg_dump -U horalix horalix_view > backup.sql
```

**Database restore:**

```bash
docker-compose exec -T postgres psql -U horalix horalix_view < backup.sql
```

**DICOM files backup:**

```bash
docker-compose exec backend tar -czf /tmp/dicom-backup.tar.gz storage/dicom
docker cp $(docker-compose ps -q backend):/tmp/dicom-backup.tar.gz ./dicom-backup.tar.gz
```

---

## 📚 API Documentation

### Interactive API Docs

- **Swagger UI:** http://localhost:8000/docs
- **ReDoc:** http://localhost:8000/redoc

### Key Endpoints

**Authentication:**
- `POST /api/v1/auth/login` - Obtain JWT token
- `GET /api/v1/auth/me` - Get current user info

**Studies:**
- `GET /api/v1/studies` - List studies
- `GET /api/v1/studies/{uid}` - Get study details
- `POST /api/v1/studies/upload` - Upload DICOM files
- `GET /api/v1/studies/{uid}/export` - Export study

**AI Inference:**
- `GET /api/v1/ai/models` - List available models
- `POST /api/v1/ai/infer` - Submit inference job
- `GET /api/v1/ai/jobs/{id}` - Get job status
- `POST /api/v1/ai/interactive/medsam` - Interactive MedSAM

**Annotations:**
- `GET /api/v1/annotations` - List annotations
- `POST /api/v1/annotations` - Create annotation
- `PUT /api/v1/annotations/{id}` - Update annotation
- `DELETE /api/v1/annotations/{id}` - Delete annotation
- `GET /api/v1/annotations/study/{uid}/export` - Export annotations

---

## 🔍 Smoke Testing

After deploying Horalix View, run the smoke test to verify all services are working:

**Linux/macOS:**

```bash
./scripts/smoke-test.sh
./scripts/smoke-test.sh --verbose  # For detailed output
```

**Windows (PowerShell):**

```powershell
.\scripts\smoke-test.ps1
.\scripts\smoke-test.ps1 -Verbose  # For detailed output
```

**Manual smoke test with curl:**

```bash
# 1. Check backend health
curl http://localhost:8000/health

# 2. Check backend readiness (database, services)
curl http://localhost:8000/ready

# 3. Login and get a token
TOKEN=$(curl -s -X POST http://localhost:8000/api/v1/auth/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=admin&password=admin123" | grep -o '"access_token":"[^"]*"' | cut -d'"' -f4)

# 4. Test authenticated endpoint
curl -H "Authorization: Bearer $TOKEN" http://localhost:8000/api/v1/auth/me

# 5. Check frontend
curl -I http://localhost:3000
```

---

## 🧪 Testing

### Running Tests

**Backend:**

```bash
cd backend

# All tests
pytest

# With coverage
pytest --cov=app --cov-report=html

# Specific test file
pytest tests/services/ai/test_ai_models.py

# Specific test
pytest tests/services/ai/test_ai_models.py::TestYoloV8Detector::test_load_model
```

**Frontend:**

```bash
cd frontend

# Run tests
npm test

# With coverage
npm run test:coverage

# Watch mode
npm run test:watch
```

### Test Structure

```
backend/tests/
├── unit/                    # Unit tests
│   ├── test_config.py
│   └── test_models.py
├── services/               # Service tests
│   ├── ai/
│   │   └── test_ai_models.py
│   └── dicom/
│       └── test_dicom_parser.py
└── integration/            # Integration tests
    ├── test_upload.py
    └── test_ai_inference.py
```

---

## 🤝 Contributing

We welcome contributions! Please see our [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

### Development Workflow

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Run tests (`pytest` and `npm test`)
5. Run linters (`ruff check app` and `npm run lint`)
6. Commit your changes (`git commit -m 'Add amazing feature'`)
7. Push to the branch (`git push origin feature/amazing-feature`)
8. Open a Pull Request

### Code Quality

**Backend:**

```bash
black app tests               # Format code
ruff check app tests          # Lint
mypy app                      # Type check
```

**Frontend:**

```bash
npm run lint                  # ESLint
npm run format                # Prettier
npm run type-check            # TypeScript
```

---

## 📄 License

This project is licensed under the Apache License 2.0 - see the [LICENSE](LICENSE) file for details.

---

## 🆘 Support

- **Documentation:** https://horalix.io/docs
- **Issues:** https://github.com/horalix/horalix-view/issues
- **Discussions:** https://github.com/horalix/horalix-view/discussions
- **Email:** support@horalix.io

---

## 🎯 Roadmap

- [ ] Real-time collaboration for annotations
- [ ] DICOM networking (C-MOVE, C-FIND)
- [ ] Advanced 3D rendering (volume ray casting)
- [ ] Report generation templates
- [ ] Mobile application
- [ ] FHIR integration
- [ ] Federated learning support

---

## 🙏 Acknowledgments

- **Cornerstone.js** - DICOM image rendering
- **MONAI** - Medical imaging AI framework
- **FastAPI** - Modern Python web framework
- **Material-UI** - React component library
- **PyDICOM** - DICOM file parsing

---

**Built with ❤️ for healthcare professionals**
