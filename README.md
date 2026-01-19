# Horalix View

<p align="center">
  <img src="docs/assets/logo.png" alt="Horalix View Logo" width="120" height="120">
</p>

<p align="center">
  <strong>Advanced Open-Source DICOM Viewer with AI Capabilities</strong>
</p>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#architecture">Architecture</a> •
  <a href="#installation">Installation</a> •
  <a href="#usage">Usage</a> •
  <a href="#ai-models">AI Models</a> •
  <a href="#api-documentation">API</a> •
  <a href="#contributing">Contributing</a>
</p>

---

## Overview

Horalix View is a production-ready, open-source DICOM viewer designed for modern healthcare environments. It combines powerful imaging capabilities with state-of-the-art AI models for segmentation, detection, classification, and enhancement across radiology, pathology, and cardiology.

### Key Highlights

- **Multi-Modality Support**: CR, DX, MG, CT, MRI, PET-CT, Ultrasound, Angiography, Nuclear Medicine, Structured Reports, and Digital Pathology
- **AI-Powered Analysis**: Integrated segmentation (nnU-Net, MedSAM), detection (YOLOv8), classification (ViT), and enhancement (UniMIE)
- **3D Visualization**: Multiplanar reconstruction (MPR) and volume rendering
- **Enterprise Ready**: HIPAA compliant with audit logging, encryption, and role-based access control
- **Modern Architecture**: React + TypeScript frontend, FastAPI backend, modular plugin system

---

## Features

### Imaging Functionality

| Feature | Description |
|---------|-------------|
| **Multi-Modality** | Support for all major DICOM modalities including CT, MRI, PET, Ultrasound, X-Ray, Mammography, and Digital Pathology |
| **3D Visualization** | MPR (Axial, Coronal, Sagittal), Volume Rendering, Maximum Intensity Projection |
| **Measurement Tools** | Distance, angle, area, volume measurements with calibration |
| **Window/Level** | Preset and custom window/level with real-time adjustment |
| **Synchronized Scrolling** | Link multiple viewports for comparative analysis |
| **Overlay Comparison** | Blend and compare studies with fusion tools |

### AI Models

#### Segmentation
- **nnU-Net**: Self-configuring deep learning for medical image segmentation (Dice: 0.92)
- **MedUNeXt**: Next-generation U-Net with ConvNeXt blocks (Dice: 0.93)
- **MedSAM**: Foundation model for universal segmentation across 10+ modalities
- **SwinUNet**: Transformer-based segmentation with long-range context

#### Detection
- **YOLOv8**: Real-time object detection with single-stage pipeline (mAP: 0.85, 45 FPS)
- **Faster R-CNN**: Two-stage detector for high-precision requirements

#### Classification
- **Vision Transformer (ViT)**: State-of-the-art classification (AUROC: 0.94)
- **MedViT**: Medical-domain pretrained transformer
- **EchoCLR**: Self-supervised learning for echocardiography

#### Enhancement
- **UniMIE**: Training-free diffusion model for universal image enhancement (PSNR: 32.5)
- **GAN-based**: Denoising and super-resolution models

#### Digital Pathology
- **Prov-GigaPath**: Whole-slide foundation model (SOTA on 25/26 tasks)
- **HIPT**: Hierarchical Image Pyramid Transformer
- **CTransPath**: Contrastive learning for pathology
- **CHIEF**: Clinical Histopathology Image Evaluation Foundation model

### Cardiovascular Analysis
- Automatic cardiac chamber segmentation
- Ejection fraction calculation
- Strain analysis
- Standard view classification

### Integration & Compliance

- **DICOM Networking**: C-STORE, C-MOVE, C-FIND, C-ECHO
- **DICOMweb**: WADO-RS, QIDO-RS, STOW-RS
- **FHIR**: Integration with EHR systems
- **Anonymization**: De-identification tools for research
- **Encryption**: AES-256 for data at rest and in transit
- **Audit Logging**: Complete audit trail for HIPAA and 21 CFR Part 11

---

## Architecture

```
horalix-view/
├── backend/                    # FastAPI Python backend
│   ├── alembic/               # Database migrations
│   │   └── versions/          # Migration scripts
│   ├── app/
│   │   ├── api/               # REST API endpoints
│   │   │   └── v1/
│   │   │       ├── endpoints/ # Endpoint modules
│   │   │       │   ├── auth.py       # Authentication & users
│   │   │       │   ├── studies.py    # DICOM study management
│   │   │       │   ├── series.py     # Series & frame data
│   │   │       │   ├── instances.py  # Instance pixel data
│   │   │       │   └── ai.py         # AI job management
│   │   │       └── router.py  # API router aggregation
│   │   ├── core/              # Configuration, security, logging
│   │   │   ├── config.py      # Settings with Pydantic
│   │   │   ├── security.py    # JWT, password hashing, RBAC
│   │   │   └── logging.py     # Structured logging & audit
│   │   ├── models/            # SQLAlchemy ORM models
│   │   │   ├── base.py        # Database engine & session
│   │   │   ├── patient.py     # Patient model
│   │   │   ├── study.py       # Study model with status
│   │   │   ├── series.py      # Series model
│   │   │   ├── instance.py    # Instance model
│   │   │   ├── user.py        # User model with roles
│   │   │   ├── job.py         # AI job model
│   │   │   └── audit.py       # Audit log model
│   │   ├── services/          # Business logic
│   │   │   ├── dicom/         # DICOM parsing (pydicom), storage
│   │   │   └── ai/            # AI model registry & inference
│   │   └── main.py            # FastAPI app with lifespan
│   └── pyproject.toml         # Python dependencies
├── frontend/                   # React TypeScript frontend
│   ├── src/
│   │   ├── components/        # UI components
│   │   │   ├── common/        # Shared components
│   │   │   └── layout/        # Layout components
│   │   ├── contexts/          # React context providers
│   │   ├── pages/             # Page components
│   │   │   ├── DashboardPage.tsx    # Dashboard with stats
│   │   │   ├── StudyListPage.tsx    # Study browser & upload
│   │   │   ├── ViewerPage.tsx       # DICOM viewer
│   │   │   ├── PatientListPage.tsx  # Patient browser
│   │   │   └── AIModelsPage.tsx     # AI model management
│   │   ├── services/          # API services
│   │   │   ├── api.ts         # Centralized typed API client
│   │   │   ├── apiClient.ts   # Axios instance with auth
│   │   │   └── authService.ts # Authentication service
│   │   ├── themes/            # Material-UI theming
│   │   └── utils/             # Utilities
│   └── package.json           # Node dependencies
├── docs/                       # Documentation
├── config/                     # Configuration files
├── docker/                     # Docker configurations
└── .github/workflows/          # CI/CD pipelines
```

### Technology Stack

| Layer | Technologies |
|-------|-------------|
| **Frontend** | React 18, TypeScript, Material-UI 5, Cornerstone.js, VTK.js |
| **Backend** | Python 3.10+, FastAPI, pydicom, pynetdicom, SQLAlchemy |
| **AI/ML** | PyTorch, MONAI, nnU-Net, Ultralytics, Transformers |
| **Database** | PostgreSQL, Redis |
| **Infrastructure** | Docker, Kubernetes, GitHub Actions |

---

## Installation

### Prerequisites

- Node.js 18+
- Python 3.10+
- PostgreSQL 14+
- Redis 7+
- Docker (optional)

### Quick Start with Docker

```bash
# Clone the repository
git clone https://github.com/horalix/horalix-view.git
cd horalix-view

# Start with Docker Compose
docker-compose up -d

# Access the application
open http://localhost:3000
```

### Manual Installation

#### Backend Setup

```bash
cd backend

# Create virtual environment
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -e ".[ai,dev]"

# Set environment variables
cp .env.example .env
# Edit .env with your configuration

# Initialize database with Alembic migrations
alembic upgrade head

# Create default users (optional - happens automatically on first startup)
python -c "from app.api.v1.endpoints.auth import init_default_users; import asyncio; asyncio.run(init_default_users())"

# Start the server
uvicorn app.main:app --reload --port 8000
```

#### Database Schema

The application uses PostgreSQL with SQLAlchemy async ORM. Key models:

| Model | Description |
|-------|-------------|
| **Patient** | DICOM patient demographics (patient_id, name, birth_date, sex) |
| **Study** | DICOM study records with status tracking (pending, processing, complete, error) |
| **Series** | DICOM series with imaging parameters (modality, spacing, window/level) |
| **Instance** | Individual DICOM SOP instances with file storage references |
| **User** | User accounts with roles and authentication (admin, radiologist, technologist) |
| **AIJob** | AI inference job tracking with status, progress, and results |
| **AuditLog** | Immutable audit trail for HIPAA compliance |

Migrations are managed with Alembic:

```bash
# Create a new migration
alembic revision --autogenerate -m "description"

# Apply migrations
alembic upgrade head

# Rollback one migration
alembic downgrade -1
```

#### Frontend Setup

```bash
cd frontend

# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build
```

### Environment Variables

```env
# Backend
SECRET_KEY=your-secret-key-here
DATABASE_URL=postgresql+asyncpg://user:pass@localhost:5432/horalix
REDIS_URL=redis://localhost:6379/0
AI_DEVICE=cuda  # or cpu
DICOM_AE_TITLE=HORALIX_VIEW
DICOM_PORT=11112

# Frontend
VITE_API_URL=http://localhost:8000/api/v1
```

---

## Usage

### Default Credentials

| Username | Password | Role |
|----------|----------|------|
| admin | admin123 | Administrator |
| radiologist | rad123 | Radiologist |

### Uploading Studies

1. Navigate to **Studies** → **Upload DICOM**
2. Drag and drop DICOM files or click to browse
3. Studies are automatically organized by patient/study/series

### Viewing Studies

1. Click on a study in the study list
2. Use toolbar tools for navigation and measurement
3. Keyboard shortcuts:
   - `W`: Window/Level tool
   - `Z`: Zoom tool
   - `P`: Pan tool
   - `M`: Measure tool
   - `Arrow Up/Down`: Scroll through slices
   - `R`: Reset viewport

### Running AI Analysis

1. Open a study in the viewer
2. Click **AI Tools** in the toolbar
3. Select the desired model (e.g., nnU-Net for segmentation)
4. Review results in the AI panel
5. Confirm or adjust AI-detected regions

---

## AI Models

### Adding New Models

Horalix View provides a plugin interface for adding custom AI models:

```python
from app.services.ai.base import SegmentationModel, ModelMetadata, InferenceResult

class MyCustomModel(SegmentationModel):
    @property
    def metadata(self) -> ModelMetadata:
        return ModelMetadata(
            name="my_custom_model",
            version="1.0.0",
            model_type=ModelType.SEGMENTATION,
            description="My custom segmentation model",
            supported_modalities=["CT", "MR"],
        )

    async def load(self, device: str = "cuda") -> None:
        self.model = torch.load("path/to/weights.pth")
        self._loaded = True

    async def predict(self, image: np.ndarray, **kwargs) -> InferenceResult:
        # Run inference
        output = self.model(image)
        return InferenceResult(
            model_name=self.metadata.name,
            model_version=self.metadata.version,
            inference_time_ms=elapsed_ms,
            output=output,
        )
```

### Downloading Pre-trained Weights

```bash
# Download model weights
python scripts/download_models.py

# Or download specific models
python scripts/download_models.py --model nnunet
python scripts/download_models.py --model medsam
python scripts/download_models.py --model yolov8
```

### Model Performance

| Model | Task | Metric | Value | Reference |
|-------|------|--------|-------|-----------|
| nnU-Net | Segmentation | Dice | 0.92 | Isensee et al., Nature Methods 2021 |
| MedUNeXt | Segmentation | Dice | 0.93 | Roy et al., 2023 |
| MedSAM | Segmentation | Dice | 0.89 | Ma et al., Nature Communications 2024 |
| YOLOv8 | Detection | mAP | 0.85 | Ultralytics 2023 |
| ViT | Classification | AUROC | 0.94 | Dosovitskiy et al., ICLR 2021 |
| UniMIE | Enhancement | PSNR | 32.5 | UniMIE 2024 |
| GigaPath | Pathology | AUROC | 0.94 | Microsoft Research 2024 |

---

## AI Setup

> **IMPORTANT**: Horalix View performs **REAL AI inference only**. There are no simulated, placeholder, or fake outputs. If model weights are not available, endpoints will return clear error messages explaining how to set up the models.

### Prerequisites for AI

1. **Install AI dependencies**:
   ```bash
   cd backend

   # For CUDA support (recommended for production)
   pip install torch torchvision --index-url https://download.pytorch.org/whl/cu121
   pip install -e ".[ai]"

   # For CPU only
   pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
   pip install -e ".[ai]"
   ```

2. **Create models directory**:
   ```bash
   mkdir -p models/{yolov8,medsam,monai_segmentation,liver_segmentation,spleen_segmentation}
   ```

### Model Weights Setup

#### YOLOv8 Detection

```bash
# Option 1: Use pretrained COCO weights (for testing)
pip install ultralytics
python -c "from ultralytics import YOLO; m = YOLO('yolov8n.pt'); m.save('models/yolov8/model.pt')"

# Option 2: Fine-tune on medical data (recommended)
# See: https://docs.ultralytics.com/modes/train/

# Expected path: models/yolov8/model.pt
```

#### MedSAM Interactive Segmentation

```bash
# Download MedSAM weights (~375MB)
# From: https://github.com/bowang-lab/MedSAM

# Option 1: Download from official repo
wget -P models/medsam/ https://dl.fbaipublicfiles.com/segment_anything/sam_vit_b_01ec64.pth
mv models/medsam/sam_vit_b_01ec64.pth models/medsam/medsam_vit_b.pth

# Option 2: Use MedSAM fine-tuned weights (better for medical images)
# Download from: https://huggingface.co/bowang-lab/MedSAM
# Place at: models/medsam/medsam_vit_b.pth

# Expected path: models/medsam/medsam_vit_b.pth
```

#### MONAI Segmentation (e.g., Spleen CT)

```bash
# Download MONAI bundle
pip install monai[bundle]
python -c "from monai.bundle import download; download(name='spleen_ct_segmentation', bundle_dir='models/spleen_segmentation')"

# For liver segmentation
python -c "from monai.bundle import download; download(name='liver_and_tumor_ct_segmentation', bundle_dir='models/liver_segmentation')"

# Expected structure:
# models/spleen_segmentation/
#   ├── model.pt (or configs/...)
#   └── ...
```

### Verify Model Availability

```bash
# Check which models are available
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:8000/api/v1/ai/models | jq

# Response shows availability status:
# {
#   "models": [
#     {
#       "name": "yolov8",
#       "available": true,  # true if weights found
#       "enabled": true,
#       "weights_path": "models/yolov8"
#     },
#     ...
#   ],
#   "message": "2 model(s) ready for inference"
# }
```

### Running Inference

#### Detection with YOLOv8

```bash
# Submit detection job
curl -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "study_uid": "1.2.3.4.5",
    "series_uid": "1.2.3.4.5.6",
    "model_type": "yolov8",
    "task_type": "detection"
  }' \
  http://localhost:8000/api/v1/ai/infer

# Check job status
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:8000/api/v1/ai/jobs/{job_id}

# Get results
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:8000/api/v1/ai/jobs/{job_id}/result
```

#### Interactive Segmentation with MedSAM

```bash
# Run interactive segmentation with point prompts
curl -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "points": [[256, 256]],
    "point_labels": [1],
    "box": null
  }' \
  "http://localhost:8000/api/v1/ai/interactive/medsam?study_uid=1.2.3&series_uid=4.5.6&instance_uid=7.8.9"

# Or with bounding box
curl -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "points": [],
    "point_labels": [],
    "box": [100, 100, 300, 300]
  }' \
  "http://localhost:8000/api/v1/ai/interactive/medsam?study_uid=1.2.3&series_uid=4.5.6&instance_uid=7.8.9"
```

### Error Handling

If weights are not available, you'll receive a clear error:

```json
{
  "detail": "Model 'yolov8' weights not available.\nExpected weights at: models/yolov8\n\nTo enable this model:\n1. Download or train model weights\n2. Place weights at the path above\n3. Restart the service\n\nSee README AI Setup section for detailed instructions."
}
```

### Common Issues

| Issue | Solution |
|-------|----------|
| `CUDA out of memory` | Set `AI_DEVICE=cpu` or reduce `AI_BATCH_SIZE` |
| `Model weights not found` | Check `models/` directory structure matches expected paths |
| `ImportError: torch` | Install with `pip install -e ".[ai]"` |
| `No module named 'ultralytics'` | Run `pip install ultralytics>=8.1.0` |
| `No module named 'segment_anything'` | Run `pip install segment-anything>=1.0` |
| `No module named 'monai'` | Run `pip install monai>=1.3.0` |

### Environment Variables

```env
# AI Configuration
AI_DEVICE=cuda          # 'cuda', 'cuda:0', 'cuda:1', or 'cpu'
AI_MODELS_DIR=./models  # Directory containing model weights
AI_BATCH_SIZE=4         # Batch size for inference
AI_MIXED_PRECISION=true # Enable FP16 inference (faster on GPU)
AI_DETERMINISTIC=false  # Enable for reproducible results (slower)

# Model-specific settings
AI_YOLOV8_ENABLED=true
AI_YOLOV8_CONFIDENCE=0.25
AI_YOLOV8_IOU=0.45
AI_MEDSAM_ENABLED=true
AI_MEDSAM_MODEL_TYPE=vit_b
AI_NNUNET_ENABLED=true
```

### Directory Structure

```
models/
├── yolov8/
│   └── model.pt              # YOLOv8 weights
├── medsam/
│   └── medsam_vit_b.pth      # MedSAM checkpoint
├── monai_segmentation/
│   └── model.pt              # General MONAI model
├── liver_segmentation/
│   └── model.pt              # MONAI liver bundle
└── spleen_segmentation/
    └── model.pt              # MONAI spleen bundle
```

### No Fake Outputs Policy

This system **never** returns simulated or placeholder results:

- If model weights are missing → HTTP 424 (Failed Dependency) with setup instructions
- If inference fails → Job marked as FAILED with detailed error message
- If dependencies missing → ImportError with installation instructions

All results are from **real model inference** or clearly indicate failure.

---

## API Documentation

### REST API

The API documentation is available at:
- **Swagger UI**: `http://localhost:8000/docs`
- **ReDoc**: `http://localhost:8000/redoc`
- **OpenAPI**: `http://localhost:8000/openapi.json`

### Key Endpoints

```
POST   /api/v1/auth/token          # Login
GET    /api/v1/studies             # List studies
GET    /api/v1/studies/{uid}       # Get study details
POST   /api/v1/studies             # Upload study
GET    /api/v1/ai/models           # List AI models
POST   /api/v1/ai/infer            # Run AI inference
GET    /api/v1/dicomweb/studies    # QIDO-RS search
GET    /api/v1/dicomweb/.../rendered  # WADO-RS retrieve
```

### DICOMweb

Horalix View implements full DICOMweb compliance:

```bash
# QIDO-RS: Search for studies
curl "http://localhost:8000/api/v1/dicomweb/studies?PatientName=Doe*"

# WADO-RS: Retrieve rendered image
curl "http://localhost:8000/api/v1/dicomweb/studies/{study}/series/{series}/instances/{instance}/rendered"

# STOW-RS: Store instances
curl -X POST -H "Content-Type: multipart/related" \
  --data-binary @study.dcm \
  "http://localhost:8000/api/v1/dicomweb/studies"
```

---

## Testing

### Backend Tests

```bash
cd backend

# Run all tests
pytest

# Run with coverage
pytest --cov=app --cov-report=html

# Run specific test file
pytest tests/unit/test_dicom_parser.py
```

### Frontend Tests

```bash
cd frontend

# Run tests
npm test

# Run with coverage
npm run test:coverage
```

---

## Deployment

### Docker Compose (Development)

```bash
docker-compose up -d
```

### Kubernetes (Production)

```bash
# Apply Kubernetes manifests
kubectl apply -f k8s/

# Or use Helm
helm install horalix-view ./charts/horalix-view
```

### Environment Configuration

See `config/` directory for environment-specific configurations:
- `config/development.yaml`
- `config/staging.yaml`
- `config/production.yaml`

---

## Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

### Development Setup

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Make your changes
4. Run tests: `pytest` and `npm test`
5. Submit a pull request

### Code Style

- **Python**: Black, Ruff, MyPy
- **TypeScript**: ESLint, Prettier

---

## License

Horalix View is licensed under the [Apache License 2.0](LICENSE).

---

## Acknowledgments

- [pydicom](https://github.com/pydicom/pydicom) - DICOM file handling
- [Cornerstone.js](https://cornerstonejs.org/) - Medical imaging viewport
- [MONAI](https://monai.io/) - Medical AI framework
- [nnU-Net](https://github.com/MIC-DKFZ/nnUNet) - Segmentation framework
- [MedSAM](https://github.com/bowang-lab/MedSAM) - Foundation segmentation model
- [Ultralytics](https://ultralytics.com/) - YOLOv8

---

## Support

- **Documentation**: [https://horalix.io/docs](https://horalix.io/docs)
- **Issues**: [GitHub Issues](https://github.com/horalix/horalix-view/issues)
- **Discussions**: [GitHub Discussions](https://github.com/horalix/horalix-view/discussions)

---

<p align="center">
  Made with care for the healthcare community
</p>
