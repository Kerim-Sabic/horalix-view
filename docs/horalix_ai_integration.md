# Horalix AI Integration Design Document

**Project**: Integration of Echocardiology_App AI models into Horalix-View
**Author**: Claude Code Integration Agent
**Date**: 2026-02-02
**Version**: 1.0

---

## Executive Summary

This document details the complete architecture design for integrating the Echocardiology_App AI pipeline (PanEcho + EchoPrime + Measurements + EchoNet-Dynamic) into the Horalix-View medical imaging platform as a single composite model named `horalix_ai`.

### Goals
- **Replicate Exact Workflow**: Preserve all inference logic, preprocessing, postprocessing, and thresholds from Echocardiology_App
- **Overlay-First Results**: Display AI outputs as interactive, toggleable overlays in the Horalix viewer (not burned-in videos)
- **Load at Startup**: Models preloaded to eliminate first-run latency
- **2-GPU Concurrency**: Support simultaneous inference jobs using both RTX 5080 GPUs
- **Docker Deployment**: Run in containers with mounted Windows weight directories
- **Hospital-Grade**: PACS-ready with DICOM SEG/SR export capability (Phase 2)

### Key Constraints
- **Hardware**: 2× RTX 5080 GPUs (16GB each), 128 GB RAM
- **Weights Location**: `C:\Users\kerim\OneDrive\Desktop\Echocardiology_App\backend\app\AI_models` (mounted read-only)
- **Container Path**: `/app/models/horalix_ai`
- **No Code Changes**: Reuse Echocardiology_App logic, no new ML logic

---

## Table of Contents

1. [Architecture Analysis](#1-architecture-analysis)
2. [Gap Analysis](#2-gap-analysis)
3. [Integration Architecture](#3-integration-architecture)
4. [Composite Model Pipeline](#4-composite-model-pipeline)
5. [Overlay-First Output Contract](#5-overlay-first-output-contract)
6. [Docker & GPU Configuration](#6-docker--gpu-configuration)
7. [Performance Optimization Strategy](#7-performance-optimization-strategy)
8. [Implementation Phases](#8-implementation-phases)
9. [Testing & Validation](#9-testing--validation)
10. [Security & Compliance](#10-security--compliance)

---

## 1. Architecture Analysis

### 1.1 Horalix-View Current Architecture

#### AI Model Management
- **Registry Pattern**: `ModelRegistry` singleton with factory-based registration
- **Base Classes**: `BaseAIModel` → `SegmentationModel`, `DetectionModel`, etc.
- **Lifecycle**: Lazy loading with explicit `load()`/`unload()` methods
- **External Commands**: `ExternalCommandModel` wrapper for subprocess-based models
- **Current Models**: YOLOv8, MedSAM, MONAI, stubs for Horalix AI components

#### DICOM Processing
- **DicomLoader**: Loads series/instances with metadata extraction
- **Frame Preparation**: Normalization, windowing, resizing via `prepare_for_inference()`
- **Caching**: No systematic caching currently implemented

#### API Layer
- **Endpoints**: `/models`, `/infer`, `/jobs/{job_id}`, `/results/{study_uid}`
- **Job System**: Background async jobs with status tracking (QUEUED/RUNNING/COMPLETED/FAILED)
- **Interactive Endpoint**: `/interactive/medsam` for prompt-based segmentation

#### Frontend Overlay System
- **Measurement Store**: Zustand-based state management with undo/redo
- **Overlay Types**: `line`, `polyline`, `polygon`, `ellipse`, `rectangle`, `freehand`
- **Scopes**: `frame` (single frame), `series` (all frames), `volume` (3D)
- **Rendering**: SVG-based with draggable handles and real-time calculations
- **Tracking**: Per-frame tracking data for cine measurements

#### Configuration
- **Env-Based**: Pydantic Settings with `.env` file support
- **Paths**: `models_dir`, `cache_dir`, `results_dir`
- **Flags**: `yolov8_enabled`, `medsam_enabled`, `horalix_ai_enabled`, etc.

### 1.2 Echocardiology_App AI Architecture

#### Model Components

**PanEcho** (View-Agnostic Multi-Task Model)
- **Architecture**: ConvNeXt Tiny + Transformer Encoder (4 layers, 8 heads)
- **Input**: (1, 3, 16, 224, 224) - 16 frames per cine
- **Tasks**: 39 reporting tasks (classification + regression)
- **Weights**: `PanEcho/weights/panecho.pt` (~2GB VRAM)
- **Preprocessing**:
  - 16 uniformly-sampled frames
  - Resize to 224×224
  - ImageNet normalization (mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])
- **Output**: Dict[task_name, prediction] (floats or prob lists)

**EchoPrime** (Multi-View Vision-Language Model)
- **Architecture**: MViT-v2 Small (video encoder) + Text Encoder + View Classifier (ConvNeXt Base)
- **Input**: 32 frames (stride=2, effective 16), 224×224
- **Tasks**: View classification (11 classes) + MIL-based anatomical predictions (16 sections)
- **Weights**:
  - `EchoPrime/model_data/weights/echo_prime_encoder.pt` (~4GB VRAM)
  - `EchoPrime/model_data/weights/echo_prime_text_encoder.pt` (~1GB VRAM)
  - `EchoPrime/model_data/weights/view_classifier.pt` (~1GB VRAM)
  - Candidate embeddings (2 parts, ~500MB each)
- **Preprocessing**:
  - Mask ultrasound region (circular wedge)
  - Crop with zoom=0.1 (10% edge crop)
  - Resize to 224×224
  - Custom normalization (mean=[29.11, 28.08, 29.10], std=[47.99, 46.46, 47.20])
- **Output**:
  - Metrics dict (per-section predictions)
  - Per-instance view labels + confidence scores

**Measurements Models** (2D Anatomical Keypoint Detection)
- **Architecture**: DeepLabV3 ResNet50 (segmentation-based keypoint extraction)
- **Input**: 640×480 RGB frames
- **Models**: 9 anatomical structures
  - `ivs_weights.ckpt` (Interventricular Septum)
  - `lvid_weights.ckpt` (LV Internal Diameter)
  - `lvpw_weights.ckpt` (LV Posterior Wall)
  - `aorta_weights.ckpt`, `aortic_root_weights.ckpt`
  - `la_weights.ckpt` (Left Atrium)
  - `rv_base_weights.ckpt` (Right Ventricle)
  - `pa_weights.ckpt` (Pulmonary Artery)
  - `ivc_weights.ckpt` (Inferior Vena Cava)
- **Preprocessing**:
  - Resize to 640×480
  - RGB normalization (0-1 range)
- **Postprocessing**:
  - Weighted centroid extraction from logits
  - Pixel → cm conversion using DICOM PixelSpacing or UltrasoundRegion tags
  - Min/max length across cardiac cycle
- **Output**:
  - Per-frame keypoints (2 endpoints × XY coords)
  - Length in cm
  - Annotated video (MP4) + CSV with per-frame data

**Doppler Measurements Models** (Not fully detailed, similar architecture)
- **Models**: 8 Doppler-based measurements
  - `avvmax_weights.ckpt`, `lvotvmax_weights.ckpt`, `trvmax_weights.ckpt`, etc.
- Same DeepLabV3 architecture as 2D models

**EchoNet-Dynamic** (LV Segmentation)
- **Architecture**: DeepLabV3 ResNet50
- **Input**: 112×112 grayscale frames
- **Weights**: `EchonetDynamic/output/segmentation/deeplabv3_resnet50_random/best.pt` (~2GB VRAM)
- **Preprocessing**:
  - Resize to 112×112
  - Normalize to 0-1 range
- **Postprocessing**:
  - Sigmoid threshold (0.5)
  - Morphological operations (open/close with 5×5 ellipse kernel)
  - Gaussian blur (7×7)
  - Contour extraction and smoothing
  - Green overlay on original frames
- **Output**:
  - Segmentation mask (binary)
  - Annotated video (MP4)

#### Inference Orchestration
- **API Endpoints**:
  - `POST /api/infer/panecho` - Study-level aggregated predictions
  - `POST /api/infer/echoprime` - Study-level + per-instance view labels
  - `POST /api/infer/measurements/2d?sop_instance_uid=...&model_weights=ivs` - Instance-level keypoint detection
  - `POST /api/infer/echonet-dynamic/LV-segmentation?sop_instance_uid=...` - Instance-level segmentation

- **Preload Strategy**:
  - Sequential preload at startup (guarded by VRAM checks)
  - Background preload for EchoPrime (non-blocking)
  - Optional warmup inference (dry run)

- **Device Strategy**:
  - Auto device selection: CUDA if available, else CPU
  - Per-model device override (config)
  - Fallback to CPU on OOM

- **Batching**:
  - PanEcho: batch_size=8 (instances)
  - EchoNet: batch_size=16 (frames)
  - Measurements: batch_size=16 (frames)

#### DICOM Processing
- **Frame Sampling**: `pick_frames_from_instance(instance_id, num_frames=16)`
  - Evenly-spaced 1-based indices
  - Fetch via Orthanc HTTP API (rendered PNG)
  - Resize to 224×224 with BILINEAR interpolation

- **Metadata Extraction**:
  - PixelSpacing (0x0028, 0x0030): [row_mm, col_mm]
  - UltrasoundRegion (0x0018, 0x6011): Physical deltas in cm/pixel
  - CineRate or FrameTime → FPS
  - Resize ratio tracking for coordinate scaling

- **Tensor Stacking**: `stack_to_tensor(frames_list)` → (1, 3, 16, 224, 224)

#### Output Format
- **DerivedResult** database records:
  - `type`: "PanEcho_AllTasks", "EchoPrime_AllTasks", "EchoNetMeasurements2D_ivs", "EchonetDynamic_LV_Segmentation"
  - `value_json`: Model-specific predictions or file paths
  - `model_name`, `model_version`, `created_at`

- **File Outputs**:
  - MP4 videos with burned-in overlays (measurements, segmentation contours)
  - CSV files with per-frame predictions

---

## 2. Gap Analysis

### 2.1 Critical Differences

| Aspect | Echocardiology_App | Horalix-View | Gap/Requirement |
|--------|-------------------|--------------|----------------|
| **Output Format** | Burned-in MP4 videos | Interactive SVG overlays | **Convert video annotations to overlay primitives** |
| **Model Loading** | Sequential preload at startup | Lazy loading | **Implement startup preload** |
| **Concurrency** | Single-device inference | Multi-GPU support needed | **Implement 2-GPU worker pool** |
| **DICOM Access** | Orthanc HTTP API | DicomLoader service | **Integrate Orthanc or use DicomLoader** |
| **Frame Sampling** | Via Orthanc rendered PNG | Direct pydicom pixel array | **Choose unified approach** |
| **Result Storage** | MP4 files + DerivedResult DB | NPZ masks + JSON + DerivedResult | **Dual storage: overlays + optional videos** |
| **Coordinate Spaces** | 640×480 (measurements), 112×112 (echonet), 224×224 (panecho/echoprime) | Original DICOM resolution | **Track all coordinate transforms** |
| **Caching** | Per-request (lockfile-based) | Not implemented | **Implement study/series/instance caching** |
| **Configuration** | Monolithic Settings class | Modular AIModelSettings | **Extend AIModelSettings** |

### 2.2 Integration Challenges

1. **Coordinate Transform Complexity**
   - Models work at different resolutions (112×112, 224×224, 640×480)
   - Frontend needs coordinates in original DICOM space
   - Need bidirectional transform pipeline

2. **Output Paradigm Shift**
   - Echocardiology_App: "Generate annotated video"
   - Horalix: "Generate overlay data + optional annotated video"
   - Must extract annotations *before* video encoding

3. **Preprocessing Divergence**
   - EchoPrime: Circular mask + zoom crop
   - PanEcho: Simple resize + ImageNet norm
   - Measurements: 640×480 resize + aspect-aware scaling
   - Must replicate exactly while maintaining efficiency

4. **Multi-Model Orchestration**
   - Echocardiology_App: Separate API endpoints
   - Horalix Goal: Single "horalix_ai" composite model
   - Need hierarchical pipeline orchestrator

5. **View-Dependent Execution**
   - Some measurements only valid for specific views (e.g., PLAX for IVS/LVID/LVPW)
   - EchoPrime provides view classification
   - Pipeline must gate measurements based on view

6. **GPU Memory Management**
   - Total VRAM required: ~14GB (PanEcho 2GB + EchoPrime 6GB + Measurements 2GB + EchoNet 2GB + overhead)
   - Single GPU (16GB): Tight fit, possible thrashing
   - Solution: Distribute models across 2 GPUs or load/unload dynamically

---

## 3. Integration Architecture

### 3.1 Architecture Decision: Dedicated Inference Workers

**Selected Approach**: **2-GPU Worker Pool Architecture**

**Rationale**:
1. **Startup Loading**: Workers load models once at process start
2. **Concurrency**: True parallel execution on separate GPUs
3. **Isolation**: Worker crash doesn't affect main backend
4. **Resource Control**: Explicit GPU pinning via `CUDA_VISIBLE_DEVICES`
5. **Scalability**: Can add more workers or scale to multi-node

**Rejected Alternatives**:
- ❌ **In-Process Model**: Risk of memory leaks, hard to isolate GPU usage, complex threading
- ❌ **Spawn-Per-Request**: Model reload overhead unacceptable for clinical use
- ❌ **HTTP Microservice**: Added latency, complexity for local deployment

### 3.2 System Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│                        Horalix Backend                            │
│                                                                    │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  FastAPI Application                                       │  │
│  │                                                             │  │
│  │  ┌─────────────────────────────────────────────────────┐  │  │
│  │  │  AI API Endpoints                                   │  │  │
│  │  │  - POST /api/v1/ai/infer (horalix_ai)              │  │  │
│  │  │  - GET /api/v1/ai/jobs/{job_id}                    │  │  │
│  │  │  - GET /api/v1/ai/results/{study_uid}              │  │  │
│  │  └─────────────────────────────────────────────────────┘  │  │
│  │          │                                                  │  │
│  │          ▼                                                  │  │
│  │  ┌─────────────────────────────────────────────────────┐  │  │
│  │  │  ModelRegistry                                      │  │  │
│  │  │  - Register: horalix_ai (CARDIAC type)             │  │  │
│  │  │  - Availability check: weights exist?              │  │  │
│  │  │  - Load: Spin up worker pool (if not running)     │  │  │
│  │  └─────────────────────────────────────────────────────┘  │  │
│  │          │                                                  │  │
│  │          ▼                                                  │  │
│  │  ┌─────────────────────────────────────────────────────┐  │  │
│  │  │  HoralixAIOrchestrator                              │  │  │
│  │  │  - Job queue (asyncio.Queue)                       │  │  │
│  │  │  - Worker pool manager                             │  │  │
│  │  │  - Result aggregation                              │  │  │
│  │  └─────────────────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────────────┘  │
│          │                           │                            │
│          │ Job Queue                 │ Result JSON                │
│          ▼                           ▼                            │
│  ┌────────────────────┐      ┌────────────────────┐             │
│  │  Shared Volume     │      │  Results Storage   │             │
│  │  /app/job_queue    │      │  /app/results/     │             │
│  └────────────────────┘      └────────────────────┘             │
└──────────────────────────────────────────────────────────────────┘
          ▲                           ▲
          │ Poll Jobs                 │ Write Results
          │                           │
┌─────────┴───────────┐   ┌───────────┴─────────────┐
│  Worker 0 (GPU 0)   │   │  Worker 1 (GPU 1)       │
│  CUDA_VISIBLE=0     │   │  CUDA_VISIBLE=1         │
│                     │   │                         │
│  ┌───────────────┐  │   │  ┌───────────────┐     │
│  │ Composite     │  │   │  │ Composite     │     │
│  │ horalix_ai    │  │   │  │ horalix_ai    │     │
│  │ Model         │  │   │  │ Model         │     │
│  │               │  │   │  │               │     │
│  │ - PanEcho     │  │   │  │ - PanEcho     │     │
│  │ - EchoPrime   │  │   │  │ - EchoPrime   │     │
│  │ - Measurements│  │   │  │ - Measurements│     │
│  │ - EchoNet     │  │   │  │ - EchoNet     │     │
│  └───────────────┘  │   │  └───────────────┘     │
│         │           │   │         │               │
│         ▼           │   │         ▼               │
│  /app/models/       │   │  /app/models/           │
│  horalix_ai/        │   │  horalix_ai/            │
│  (mounted RO)       │   │  (mounted RO)           │
└─────────────────────┘   └─────────────────────────┘
          │                           │
          └───────────┬───────────────┘
                      │
           Volume Mount (Read-Only)
                      │
                      ▼
    C:\Users\kerim\OneDrive\Desktop\
    Echocardiology_App\backend\app\AI_models\
```

### 3.3 Worker Process Design

**Worker Lifecycle**:
1. **Startup**:
   - Set `CUDA_VISIBLE_DEVICES` to assigned GPU index
   - Load all model weights (PanEcho, EchoPrime, Measurements, EchoNet)
   - Warm up with dummy inference (optional)
   - Signal "READY" to orchestrator
   - Enter job polling loop

2. **Inference Loop**:
   - Poll job queue (blocking with timeout)
   - Fetch job metadata from shared volume
   - Load DICOM study/series
   - Run composite pipeline (see Section 4)
   - Save overlay-first results to shared results volume
   - Update job status (COMPLETED/FAILED)
   - Log inference metrics (timings, GPU usage, memory)

3. **Shutdown**:
   - Graceful model unload on SIGTERM
   - Release GPU memory
   - Flush logs

**Communication Protocol**:
- **Job Queue**: Filesystem-based (JSON files in `/app/job_queue/pending/`)
- **Job Status**: Status files in `/app/job_queue/status/{job_id}.json`
- **Results**: JSON + NPZ in `/app/results/{study_uid}/horalix_ai/`
- **Logs**: Structured JSON logs to `/app/logs/worker_{gpu_id}.log`

**Concurrency Control**:
- Workers atomically "claim" jobs by moving files from `pending/` to `processing/`
- Lockfile per job to prevent duplicate execution
- Timeout-based orphan detection (cleanup stale processing jobs)

### 3.4 Model Distribution Strategy

**Option A: Full Model Duplication (Recommended for Phase 1)**
- Both workers load all 4 models (PanEcho, EchoPrime, Measurements, EchoNet)
- Pros: Simplicity, any worker can handle any job
- Cons: 2× VRAM usage (~28GB total, within 32GB budget)

**Option B: Model Sharding (Future Optimization)**
- Worker 0: PanEcho + EchoPrime + View Classifier
- Worker 1: Measurements (all 9 models) + EchoNet-Dynamic
- Requires job routing based on requested tasks
- Pros: Lower per-GPU VRAM (7-8GB each)
- Cons: Job routing complexity, uneven load distribution

**Selected for Implementation: Option A**

### 3.5 Configuration Schema Extension

Extend `backend/app/core/config.py` with:

```python
# Horalix AI Composite Model Settings
horalix_ai_enabled: bool = True
horalix_ai_models_root: Path = Field(default=Path("./models/horalix_ai"))
horalix_ai_num_workers: int = 2
horalix_ai_preload: bool = True
horalix_ai_warmup: bool = False

# Model-Specific Paths (relative to horalix_ai_models_root)
horalix_ai_panecho_weights: str = "PanEcho/weights/panecho.pt"
horalix_ai_echoprime_encoder: str = "EchoPrime/model_data/weights/echo_prime_encoder.pt"
horalix_ai_echoprime_text_encoder: str = "EchoPrime/model_data/weights/echo_prime_text_encoder.pt"
horalix_ai_view_classifier: str = "EchoPrime/model_data/weights/view_classifier.pt"
horalix_ai_measurements_dir: str = "measurements/weights"
horalix_ai_echonet_weights: str = "EchonetDynamic/output/segmentation/deeplabv3_resnet50_random/best.pt"

# Inference Parameters
horalix_ai_panecho_batch: int = 8
horalix_ai_measurements_batch: int = 16
horalix_ai_echonet_batch: int = 16
horalix_ai_echoprime_batch: int = 1  # Full study processed at once

# Feature Flags
horalix_ai_enable_echonet_dynamic: bool = True
horalix_ai_enable_measurements_2d: bool = True
horalix_ai_enable_measurements_doppler: bool = True

# Worker Communication
horalix_ai_job_queue_dir: Path = Field(default=Path("./job_queue"))
horalix_ai_worker_timeout: int = 1800  # 30 minutes max per job
horalix_ai_worker_poll_interval: float = 1.0  # seconds

# Optimization
horalix_ai_cache_enabled: bool = True
horalix_ai_cache_max_size_gb: int = 10
horalix_ai_mixed_precision: bool = True  # Use FP16 where safe
```

---

## 4. Composite Model Pipeline

### 4.1 Pipeline Stages

The `horalix_ai` composite model implements a sequential pipeline that replicates the Echocardiology_App workflow:

```
┌──────────────────────────────────────────────────────────────────┐
│  STAGE 0: Ingest                                                  │
│  Input: study_uid (+ optional series_uid, instance_uid)          │
│  Output: Cine bundles (frames + metadata per instance)           │
│                                                                    │
│  - Discover all instances in study/series                         │
│  - Load DICOM metadata (PixelSpacing, CineRate, Modality)        │
│  - Extract frames (all frames for cine, representative for 2D)   │
│  - Build mapping: instance_uid → FrameBundle                      │
└──────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────────┐
│  STAGE 1: View Classification                                     │
│  Model: EchoPrime View Classifier (ConvNeXt Base)                │
│  Input: First frame of each instance (224×224)                   │
│  Output: Per-instance view labels + confidence                    │
│                                                                    │
│  - Preprocess: mask wedge + crop + resize to 224×224             │
│  - Run view classifier on first frame                             │
│  - Store: instance_uid → (view_label, confidence)                │
│  - Use for gating measurements (e.g., IVS/LVID only for PLAX)    │
└──────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────────┐
│  STAGE 2: PanEcho Inference                                       │
│  Model: PanEcho (ConvNeXt + Transformer)                         │
│  Input: 16 uniformly-sampled frames per instance (224×224)       │
│  Output: 39 task predictions per instance                         │
│                                                                    │
│  - Sample 16 frames evenly across cine                            │
│  - Preprocess: resize + ImageNet normalization                    │
│  - Batch inference (batch_size=8 instances)                       │
│  - Aggregate predictions across all instances (mean)              │
│  - Store: study-level predictions dict                            │
└──────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────────┐
│  STAGE 3: EchoPrime Inference                                     │
│  Model: EchoPrime (MViT-v2 + Text Encoder + MIL)                 │
│  Input: 32 frames per instance (stride=2, effective 16)          │
│  Output: Study-level embeddings + anatomical section predictions │
│                                                                    │
│  - Preprocess: mask + crop + custom normalization                 │
│  - Encode all instances in study → study embedding               │
│  - Predict metrics for 16 anatomical sections                     │
│  - Store: study-level metrics dict                                │
└──────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────────┐
│  STAGE 4: Combine Predictions                                     │
│  Logic: Merge PanEcho + EchoPrime outputs                         │
│  Output: Unified findings object                                  │
│                                                                    │
│  - Apply Echocardiology_App thresholds (if any)                   │
│  - Resolve conflicts (EchoPrime view-aware > PanEcho view-agnostic)│
│  - Generate structured findings JSON                              │
└──────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────────┐
│  STAGE 5: 2D Measurements                                         │
│  Models: 9 DeepLabV3 ResNet50 models (per anatomical structure)  │
│  Input: All frames per instance (640×480)                        │
│  Output: Per-frame keypoints + length in cm                       │
│                                                                    │
│  For each instance with compatible view:                          │
│    - Select applicable measurement models (view-gated)            │
│    - Resize frames to 640×480                                     │
│    - Batch inference (batch_size=16 frames)                       │
│    - Extract keypoints from segmentation logits                   │
│    - Convert pixel → cm using PixelSpacing                        │
│    - Compute min/max lengths across cardiac cycle                 │
│    - Store: instance_uid → [Measurement objects]                  │
└──────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────────┐
│  STAGE 6 (Optional): EchoNet-Dynamic LV Segmentation             │
│  Model: DeepLabV3 ResNet50                                        │
│  Input: All frames per A4C instance (112×112)                    │
│  Output: LV mask per frame + volume/EF curve                      │
│                                                                    │
│  - Filter instances: only A4C views (from Stage 1)               │
│  - Resize frames to 112×112                                       │
│  - Batch inference (batch_size=16 frames)                         │
│  - Postprocess: sigmoid threshold + morphology + contour          │
│  - Compute volumes using Simpson's method (requires 2/4 chamber) │
│  - Extract ED/ES frames → EF calculation                          │
│  - Store: instance_uid → [Mask overlays, Volume curve]           │
└──────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────────┐
│  STAGE 7: Normalize to Overlay-First Schema                      │
│  Output: Unified result object (see Section 5)                    │
│                                                                    │
│  - Convert masks to overlay objects (frame-associated)            │
│  - Convert keypoints to vector overlays (lines/points)            │
│  - Build measurement table (name, value, unit, confidence)        │
│  - Generate curves (LV volume over time, if EchoNet enabled)     │
│  - Compile structured report text                                 │
│  - Map all overlays to DICOM coordinate space (original res)     │
└──────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────────┐
│  STAGE 8: Persist Results                                         │
│  Storage: Filesystem + Database                                   │
│                                                                    │
│  - Save overlay JSON: /app/results/{study_uid}/horalix_ai/result.json│
│  - Save masks: /app/results/{study_uid}/horalix_ai/masks/*.npz   │
│  - Save curves: /app/results/{study_uid}/horalix_ai/curves/*.csv │
│  - Optional: Generate annotated MP4s (for clinical review)        │
│  - Optional: Export DICOM SEG/SR (Phase 2)                        │
│  - Update database: DerivedResult record                          │
└──────────────────────────────────────────────────────────────────┘
```

### 4.2 Key Implementation Classes

**File Structure**:
```
backend/app/services/ai/
├── models/
│   └── horalix_ai_composite.py       # Main composite model class
├── horalix_ai/
│   ├── __init__.py
│   ├── orchestrator.py               # Worker pool manager
│   ├── worker.py                     # Inference worker process
│   ├── pipeline/
│   │   ├── __init__.py
│   │   ├── ingestion.py              # Stage 0: DICOM loading
│   │   ├── view_classification.py    # Stage 1: View classifier
│   │   ├── panecho.py                # Stage 2: PanEcho inference
│   │   ├── echoprime.py              # Stage 3: EchoPrime inference
│   │   ├── prediction_fusion.py      # Stage 4: Combine predictions
│   │   ├── measurements_2d.py        # Stage 5: Measurements
│   │   ├── echonet_dynamic.py        # Stage 6: EchoNet (optional)
│   │   └── output_normalizer.py      # Stage 7: Overlay schema
│   ├── preprocessing/
│   │   ├── __init__.py
│   │   ├── panecho_prep.py           # PanEcho preprocessing
│   │   ├── echoprime_prep.py         # EchoPrime preprocessing (mask + crop)
│   │   ├── measurements_prep.py      # Measurements preprocessing
│   │   └── echonet_prep.py           # EchoNet preprocessing
│   ├── postprocessing/
│   │   ├── __init__.py
│   │   ├── keypoint_extractor.py     # Weighted centroid from logits
│   │   ├── coordinate_transformer.py # Multi-resolution coordinate mapping
│   │   ├── measurement_converter.py  # Pixel → cm using DICOM metadata
│   │   └── contour_extractor.py      # Mask → vector contours
│   ├── models/
│   │   ├── __init__.py
│   │   ├── panecho_loader.py         # Load PanEcho via torch.hub
│   │   ├── echoprime_loader.py       # Load EchoPrime components
│   │   ├── measurements_loader.py    # Load 9 DeepLabV3 models
│   │   └── echonet_loader.py         # Load EchoNet model
│   ├── caching/
│   │   ├── __init__.py
│   │   ├── frame_cache.py            # LRU cache for decoded frames
│   │   └── embedding_cache.py        # Cache intermediate embeddings
│   └── utils/
│       ├── __init__.py
│       ├── dicom_metadata.py         # PixelSpacing, CineRate extraction
│       ├── view_gating.py            # View-based measurement filtering
│       └── logging_utils.py          # Structured logging
└── external_runners/
    └── horalix_ai.py                 # (Existing stub, now integrated)
```

**Core Classes**:

```python
# backend/app/services/ai/models/horalix_ai_composite.py

class HoralixAICompositeModel(BaseAIModel):
    """
    Composite AI model that orchestrates PanEcho, EchoPrime, Measurements,
    and EchoNet-Dynamic inference for comprehensive echocardiography analysis.

    This model acts as an orchestrator that submits jobs to a worker pool
    rather than running inference directly.
    """

    @property
    def metadata(self) -> ModelMetadata:
        return ModelMetadata(
            name="horalix_ai",
            version="1.0.0",
            model_type=ModelType.CARDIAC,
            modalities=["US"],  # Ultrasound
            description="Composite cardiac AI: PanEcho + EchoPrime + Measurements + EchoNet-Dynamic",
        )

    async def load(self, device: str = "cuda") -> None:
        """Start worker pool (if not already running)."""
        # Check if workers are already running
        # If not, spawn worker processes
        # Wait for "READY" signals from all workers
        pass

    async def predict(
        self,
        study_uid: str,
        series_uid: Optional[str] = None,
        instance_uid: Optional[str] = None,
        enable_echonet: bool = True,
        enable_measurements: bool = True,
    ) -> InferenceResult:
        """
        Submit job to worker pool and wait for results.

        Returns:
            InferenceResult with overlay-first output schema (see Section 5)
        """
        # Create job metadata
        # Write to job queue
        # Poll for completion or timeout
        # Load and return results
        pass
```

```python
# backend/app/services/ai/horalix_ai/worker.py

class HoralixAIWorker:
    """
    Inference worker process that loads models at startup and processes jobs.
    """

    def __init__(self, gpu_id: int, config: Settings):
        self.gpu_id = gpu_id
        self.config = config
        self.device = f"cuda:{gpu_id}"

        # Models (loaded at startup)
        self.panecho_model = None
        self.echoprime_model = None
        self.view_classifier = None
        self.measurements_models = {}  # Dict[str, nn.Module]
        self.echonet_model = None

        # Pipeline stages
        self.ingestion = IngestionStage(config)
        self.view_classification = ViewClassificationStage(self.device)
        self.panecho_stage = PanEchoStage(self.device)
        self.echoprime_stage = EchoPrimeStage(self.device)
        self.prediction_fusion = PredictionFusionStage()
        self.measurements_stage = Measurements2DStage(self.device)
        self.echonet_stage = EchoNetDynamicStage(self.device)
        self.output_normalizer = OutputNormalizerStage(config)

        # Caching
        self.frame_cache = FrameCache(max_size_gb=config.horalix_ai_cache_max_size_gb)
        self.embedding_cache = EmbeddingCache()

    def load_models(self):
        """Load all models into GPU memory."""
        logger.info(f"Worker {self.gpu_id}: Loading models...")

        # Set CUDA device
        os.environ["CUDA_VISIBLE_DEVICES"] = str(self.gpu_id)
        torch.cuda.set_device(0)  # Now mapped to our GPU

        # Load PanEcho
        self.panecho_model = load_panecho_model(
            weights_path=self.config.horalix_ai_models_root / self.config.horalix_ai_panecho_weights,
            device=self.device,
        )

        # Load EchoPrime
        self.echoprime_model, self.view_classifier = load_echoprime_models(
            encoder_path=self.config.horalix_ai_models_root / self.config.horalix_ai_echoprime_encoder,
            text_encoder_path=self.config.horalix_ai_models_root / self.config.horalix_ai_echoprime_text_encoder,
            view_classifier_path=self.config.horalix_ai_models_root / self.config.horalix_ai_view_classifier,
            device=self.device,
        )

        # Load Measurements models (9 models)
        measurements_dir = self.config.horalix_ai_models_root / self.config.horalix_ai_measurements_dir / "2D_models"
        for model_name in ["ivs", "lvid", "lvpw", "aorta", "aortic_root", "la", "rv_base", "pa", "ivc"]:
            self.measurements_models[model_name] = load_measurement_model(
                weights_path=measurements_dir / f"{model_name}_weights.ckpt",
                device=self.device,
            )

        # Load EchoNet-Dynamic (optional)
        if self.config.horalix_ai_enable_echonet_dynamic:
            self.echonet_model = load_echonet_model(
                weights_path=self.config.horalix_ai_models_root / self.config.horalix_ai_echonet_weights,
                device=self.device,
            )

        logger.info(f"Worker {self.gpu_id}: Models loaded successfully")

    def warmup(self):
        """Run dummy inference to warm up models."""
        logger.info(f"Worker {self.gpu_id}: Warming up models...")
        # Create dummy tensors and run inference
        pass

    def run(self):
        """Main worker loop."""
        logger.info(f"Worker {self.gpu_id}: Ready for jobs")

        while True:
            # Poll for jobs
            job = self.poll_job_queue(timeout=self.config.horalix_ai_worker_poll_interval)

            if job is None:
                continue

            try:
                # Process job
                result = self.process_job(job)

                # Save results
                self.save_results(job.job_id, result)

                # Update status
                self.update_job_status(job.job_id, "COMPLETED")

            except Exception as e:
                logger.error(f"Worker {self.gpu_id}: Job {job.job_id} failed: {e}", exc_info=True)
                self.update_job_status(job.job_id, "FAILED", error_message=str(e))

    def process_job(self, job: Job) -> HoralixAIOutput:
        """Execute full composite pipeline."""
        start_time = time.time()

        # Stage 0: Ingest
        cine_bundles = self.ingestion.load_study(job.study_uid, job.series_uid)

        # Stage 1: View Classification
        view_predictions = self.view_classification.classify_views(
            cine_bundles, self.view_classifier
        )

        # Stage 2: PanEcho Inference
        panecho_predictions = self.panecho_stage.run_inference(
            cine_bundles, self.panecho_model
        )

        # Stage 3: EchoPrime Inference
        echoprime_predictions = self.echoprime_stage.run_inference(
            cine_bundles, self.echoprime_model
        )

        # Stage 4: Combine Predictions
        combined_findings = self.prediction_fusion.merge(
            panecho_predictions, echoprime_predictions
        )

        # Stage 5: 2D Measurements
        measurements = []
        if job.enable_measurements:
            measurements = self.measurements_stage.run_all_measurements(
                cine_bundles, view_predictions, self.measurements_models
            )

        # Stage 6: EchoNet-Dynamic (optional)
        echonet_results = []
        if job.enable_echonet and self.echonet_model:
            echonet_results = self.echonet_stage.run_segmentation(
                cine_bundles, view_predictions, self.echonet_model
            )

        # Stage 7: Normalize to Overlay Schema
        output = self.output_normalizer.build_output(
            study_uid=job.study_uid,
            cine_bundles=cine_bundles,
            view_predictions=view_predictions,
            findings=combined_findings,
            measurements=measurements,
            echonet_results=echonet_results,
        )

        # Stage 8: (Handled by save_results)

        output.inference_time_ms = (time.time() - start_time) * 1000
        output.gpu_id = self.gpu_id

        return output
```

### 4.3 Preprocessing Replication

**Critical**: Must replicate Echocardiology_App preprocessing exactly to ensure model accuracy.

**PanEcho Preprocessing** (`panecho_prep.py`):
```python
def preprocess_for_panecho(frames: List[np.ndarray]) -> torch.Tensor:
    """
    Replicate PanEcho preprocessing:
    - Input: List of 16 frames (H, W, 3) RGB uint8
    - Output: (1, 3, 16, 224, 224) float32 tensor
    """
    # Resize to 224x224 (BILINEAR)
    resized = [cv2.resize(f, (224, 224), interpolation=cv2.INTER_LINEAR) for f in frames]

    # Convert to float [0, 1]
    normalized = [f.astype(np.float32) / 255.0 for f in resized]

    # Apply ImageNet normalization
    mean = np.array([0.485, 0.456, 0.406], dtype=np.float32)
    std = np.array([0.229, 0.224, 0.225], dtype=np.float32)
    normalized = [(f - mean) / std for f in normalized]

    # Stack and transpose to (1, 3, 16, 224, 224)
    stacked = np.stack(normalized, axis=0)  # (16, 224, 224, 3)
    tensor = torch.from_numpy(stacked).permute(3, 0, 1, 2).unsqueeze(0)  # (1, 3, 16, 224, 224)

    return tensor
```

**EchoPrime Preprocessing** (`echoprime_prep.py`):
```python
def preprocess_for_echoprime(frames: List[np.ndarray]) -> torch.Tensor:
    """
    Replicate EchoPrime preprocessing:
    - Input: List of 32 frames (H, W, 3) RGB uint8 (stride=2 sampling)
    - Output: (1, 3, 32, 224, 224) float32 tensor

    Steps (from Echocardiology_App):
    1. Mask ultrasound wedge (circular region)
    2. Crop with zoom=0.1 (10% inset from edges)
    3. Resize to 224x224
    4. Custom normalization (mean=[29.11, 28.08, 29.10], std=[47.99, 46.46, 47.20])
    """
    processed = []

    for frame in frames:
        # Mask outside ultrasound wedge (set to black)
        masked = apply_ultrasound_mask(frame)  # Circular mask

        # Zoom crop (10% inset)
        h, w = masked.shape[:2]
        crop_h, crop_w = int(h * 0.9), int(w * 0.9)
        top, left = (h - crop_h) // 2, (w - crop_w) // 2
        cropped = masked[top:top+crop_h, left:left+crop_w]

        # Resize to 224x224
        resized = cv2.resize(cropped, (224, 224), interpolation=cv2.INTER_LINEAR)

        # Convert to float [0, 1]
        normalized = resized.astype(np.float32) / 255.0

        # Custom normalization
        mean = np.array([29.11, 28.08, 29.10], dtype=np.float32) / 255.0
        std = np.array([47.99, 46.46, 47.20], dtype=np.float32) / 255.0
        normalized = (normalized - mean) / std

        processed.append(normalized)

    # Stack to (1, 3, 32, 224, 224)
    stacked = np.stack(processed, axis=0)  # (32, 224, 224, 3)
    tensor = torch.from_numpy(stacked).permute(3, 0, 1, 2).unsqueeze(0)

    return tensor

def apply_ultrasound_mask(frame: np.ndarray) -> np.ndarray:
    """
    Mask pixels outside ultrasound wedge (circular/sector region).
    Replicate logic from Echocardiology_App EchoPrime preprocessing.
    """
    # Implementation details from Echocardiology_App utils
    # (Typically: find bright region, fit circle/ellipse, mask outside)
    pass
```

**Measurements Preprocessing** (`measurements_prep.py`):
```python
def preprocess_for_measurements(frames: List[np.ndarray]) -> Tuple[torch.Tensor, TransformMetadata]:
    """
    Replicate Measurements 2D preprocessing:
    - Input: List of frames (H_orig, W_orig, 3) RGB uint8
    - Output: (N, 3, 480, 640) float32 tensor + transform metadata

    Must track resize ratios for coordinate scaling back to original resolution.
    """
    orig_h, orig_w = frames[0].shape[:2]
    target_h, target_w = 480, 640

    # Resize to 640x480
    resized = [cv2.resize(f, (target_w, target_h), interpolation=cv2.INTER_LINEAR) for f in frames]

    # Convert to float [0, 1]
    normalized = [f.astype(np.float32) / 255.0 for f in resized]

    # Convert to tensor (N, 3, 480, 640)
    stacked = np.stack(normalized, axis=0)  # (N, 480, 640, 3)
    tensor = torch.from_numpy(stacked).permute(0, 3, 1, 2)

    # Store transform metadata for coordinate scaling
    transform_meta = TransformMetadata(
        orig_h=orig_h,
        orig_w=orig_w,
        model_h=target_h,
        model_w=target_w,
        ratio_h=orig_h / target_h,
        ratio_w=orig_w / target_w,
    )

    return tensor, transform_meta
```

**EchoNet Preprocessing** (`echonet_prep.py`):
```python
def preprocess_for_echonet(frames: List[np.ndarray]) -> Tuple[torch.Tensor, TransformMetadata]:
    """
    Replicate EchoNet-Dynamic preprocessing:
    - Input: List of frames (H_orig, W_orig, 3) RGB uint8
    - Output: (N, 3, 112, 112) float32 tensor + transform metadata
    """
    orig_h, orig_w = frames[0].shape[:2]
    target_h, target_w = 112, 112

    # Resize to 112x112
    resized = [cv2.resize(f, (target_w, target_h), interpolation=cv2.INTER_LINEAR) for f in frames]

    # Convert to float [0, 1]
    normalized = [f.astype(np.float32) / 255.0 for f in resized]

    # Convert to tensor (N, 3, 112, 112)
    stacked = np.stack(normalized, axis=0)
    tensor = torch.from_numpy(stacked).permute(0, 3, 1, 2)

    transform_meta = TransformMetadata(
        orig_h=orig_h,
        orig_w=orig_w,
        model_h=target_h,
        model_w=target_w,
        ratio_h=orig_h / target_h,
        ratio_w=orig_w / target_w,
    )

    return tensor, transform_meta
```

### 4.4 Postprocessing Replication

**Keypoint Extraction** (`keypoint_extractor.py`):
```python
def extract_keypoints_from_logits(logits: torch.Tensor) -> np.ndarray:
    """
    Extract keypoints from DeepLabV3 segmentation logits (measurements models).

    Replicate logic from Echocardiology_App runner_2d.py:
    - Logits: (N, 2, H, W) - 2 classes (2 keypoints)
    - Output: (N, 2, 2) - 2 keypoints × (x, y) coordinates

    Method: Weighted centroid of each class logit map.
    """
    N, C, H, W = logits.shape
    keypoints = np.zeros((N, C, 2), dtype=np.float32)

    for n in range(N):
        for c in range(C):
            logit_map = logits[n, c].cpu().numpy()

            # Weighted centroid
            y_indices, x_indices = np.indices((H, W))
            total_weight = logit_map.sum()

            if total_weight > 0:
                x_center = (logit_map * x_indices).sum() / total_weight
                y_center = (logit_map * y_indices).sum() / total_weight
                keypoints[n, c] = [x_center, y_center]
            else:
                # Fallback: center of image
                keypoints[n, c] = [W / 2, H / 2]

    return keypoints
```

**Coordinate Transformation** (`coordinate_transformer.py`):
```python
class CoordinateTransformer:
    """
    Bidirectional coordinate transformation between model space and DICOM space.
    """

    def model_to_dicom(
        self,
        points: np.ndarray,  # (N, 2) or (N, M, 2)
        transform_meta: TransformMetadata,
    ) -> np.ndarray:
        """
        Transform points from model resolution to original DICOM resolution.

        Example: Measurements model output (640×480) → Original DICOM (800×600)
        """
        points_dicom = points.copy()
        points_dicom[..., 0] *= transform_meta.ratio_w  # X coordinate
        points_dicom[..., 1] *= transform_meta.ratio_h  # Y coordinate
        return points_dicom

    def dicom_to_model(self, points: np.ndarray, transform_meta: TransformMetadata) -> np.ndarray:
        """Inverse transform (for validation/debugging)."""
        points_model = points.copy()
        points_model[..., 0] /= transform_meta.ratio_w
        points_model[..., 1] /= transform_meta.ratio_h
        return points_model
```

**Measurement Conversion** (`measurement_converter.py`):
```python
def compute_length_cm(
    point1: np.ndarray,  # (2,) [x, y] in DICOM pixels
    point2: np.ndarray,  # (2,) [x, y] in DICOM pixels
    pixel_spacing: Tuple[float, float],  # (row_mm, col_mm) from DICOM
) -> float:
    """
    Convert pixel distance to cm using DICOM PixelSpacing.

    Replicate logic from Echocardiology_App runner_2d.py lines 354-446.
    """
    dx_px = point2[0] - point1[0]
    dy_px = point2[1] - point1[1]

    # Convert mm to cm
    col_cm = pixel_spacing[1] / 10.0
    row_cm = pixel_spacing[0] / 10.0

    # Euclidean distance in cm
    dx_cm = dx_px * col_cm
    dy_cm = dy_px * row_cm
    length_cm = np.sqrt(dx_cm**2 + dy_cm**2)

    return length_cm
```

**Contour Extraction** (`contour_extractor.py`):
```python
def extract_contours_from_mask(
    mask: np.ndarray,  # (H, W) binary mask
    min_area_px: int = 100,
) -> List[np.ndarray]:
    """
    Extract contours from binary mask.

    Replicate logic from Echocardiology_App EchoNet-Dynamic postprocessing.

    Returns:
        List of contours, each (N, 2) array of (x, y) coordinates
    """
    # Find contours
    contours, _ = cv2.findContours(
        mask.astype(np.uint8),
        cv2.RETR_EXTERNAL,
        cv2.CHAIN_APPROX_SIMPLE,
    )

    # Filter by area
    filtered = [cnt.squeeze() for cnt in contours if cv2.contourArea(cnt) >= min_area_px]

    # Sort by area (largest first)
    filtered.sort(key=lambda cnt: cv2.contourArea(cnt.reshape(-1, 1, 2)), reverse=True)

    return filtered
```

---

## 5. Overlay-First Output Contract

### 5.1 Output Schema

The `horalix_ai` model returns results in a unified, viewer-optimized schema:

```python
# backend/app/services/ai/horalix_ai/schema.py

from pydantic import BaseModel
from typing import List, Dict, Optional, Literal
from datetime import datetime

class Point2D(BaseModel):
    x: float
    y: float

class OverlayTarget(BaseModel):
    """Identifies which DICOM image the overlay applies to."""
    series_uid: str
    instance_uid: str
    frame_index: Optional[int] = None  # For multiframe, 0-indexed

class MaskOverlay(BaseModel):
    """Segmentation mask overlay."""
    id: str  # Unique ID (e.g., "lv_mask_instance123_frame5")
    type: Literal["mask"] = "mask"
    target: OverlayTarget
    label: str  # Human-readable (e.g., "LV Cavity")
    mask_path: str  # Relative path to .npz file
    default_visible: bool = True
    color_hint: str = "#4ade80"  # Hex color for UI
    opacity: float = 0.5

class PolylineOverlay(BaseModel):
    """Vector polyline/contour overlay."""
    id: str
    type: Literal["polyline"] = "polyline"
    target: OverlayTarget
    label: str  # e.g., "LV Endocardium Contour"
    points_px: List[Point2D]  # In original DICOM pixel space
    closed: bool = False  # True for contours, False for lines
    default_visible: bool = True
    color: str = "#3b82f6"
    line_width: int = 2

class PointOverlay(BaseModel):
    """Individual point overlay (landmark)."""
    id: str
    type: Literal["point"] = "point"
    target: OverlayTarget
    label: str  # e.g., "MV Hinge Point"
    point_px: Point2D
    default_visible: bool = True
    color: str = "#f59e0b"
    radius: int = 3

class LineOverlay(BaseModel):
    """Two-point line overlay (for measurements)."""
    id: str
    type: Literal["line"] = "line"
    target: OverlayTarget
    label: str  # e.g., "IVS Thickness"
    start_px: Point2D
    end_px: Point2D
    default_visible: bool = True
    color: str = "#ef4444"
    line_width: int = 2
    # Measurement value displayed as label
    measurement_value: Optional[float] = None  # e.g., 1.2
    measurement_unit: Optional[str] = None  # e.g., "cm"

OverlayUnion = MaskOverlay | PolylineOverlay | PointOverlay | LineOverlay

class MeasurementRecord(BaseModel):
    """Structured measurement (for table display)."""
    name: str  # e.g., "LVIDd" (LV Internal Diameter diastole)
    value: float
    unit: str  # "cm", "mm", "mL", etc.
    confidence: Optional[float] = None  # 0.0-1.0
    frame_ed: Optional[int] = None  # End-diastole frame index
    frame_es: Optional[int] = None  # End-systole frame index
    instance_uid: Optional[str] = None  # Source instance
    view: Optional[str] = None  # "A4C", "PLAX", etc.

class CurveData(BaseModel):
    """Time-series data (e.g., LV volume over time)."""
    name: str  # e.g., "LV Volume"
    unit: str  # e.g., "mL"
    instance_uid: str
    t_ms: List[float]  # Time axis in milliseconds
    y: List[float]  # Values
    markers: Optional[Dict[str, int]] = None  # e.g., {"ED": 12, "ES": 28}

class StructuredReport(BaseModel):
    """Structured report (machine-readable findings)."""
    sections: Dict[str, Dict[str, any]]  # e.g., {"Left Ventricle": {"Size": "Normal", "EF": 0.60}}
    text: str  # Human-readable summary (optional)

class HoralixAIOutput(BaseModel):
    """Complete output from horalix_ai composite model."""
    schema_version: str = "1.0"

    # Metadata
    study_uid: str
    model_name: str = "horalix_ai"
    model_version: str = "1.0.0"
    inference_time_ms: float
    gpu_id: int
    timestamp: datetime

    # Findings
    findings: Dict[str, any]  # Merged PanEcho + EchoPrime predictions

    # Overlays (interactive, toggleable)
    overlays: List[OverlayUnion]

    # Measurements Table
    measurements: List[MeasurementRecord]

    # Curves (time-series)
    curves: List[CurveData]

    # Report
    report: StructuredReport

    # File Outputs (optional, for clinical review)
    file_outputs: Dict[str, str] = {}  # e.g., {"lv_segmentation_video": "path/to/video.mp4"}

    # DICOM Exports (Phase 2)
    dicom_exports: Dict[str, str] = {}  # e.g., {"seg": "path/to/seg.dcm", "sr": "path/to/sr.dcm"}
```

### 5.2 Example Output

```json
{
  "schema_version": "1.0",
  "study_uid": "1.2.840.113619.2.55.3.123456789",
  "model_name": "horalix_ai",
  "model_version": "1.0.0",
  "inference_time_ms": 4523.6,
  "gpu_id": 0,
  "timestamp": "2026-02-02T14:32:10.123Z",

  "findings": {
    "lv_size": "Normal",
    "lv_systolic_function": "Normal",
    "ef_panecho": 0.62,
    "ef_echonet": 0.59,
    "view_summary": {
      "A4C": 3,
      "PLAX": 2,
      "PSAX": 1
    }
  },

  "overlays": [
    {
      "id": "lv_mask_instance456_frame12",
      "type": "mask",
      "target": {
        "series_uid": "1.2.840.113619.2.55.3.123456789.1",
        "instance_uid": "1.2.840.113619.2.55.3.123456789.1.456",
        "frame_index": 12
      },
      "label": "LV Cavity (ED)",
      "mask_path": "results/1.2.840.113619.2.55.3.123456789/horalix_ai/masks/lv_mask_instance456_frame12.npz",
      "default_visible": true,
      "color_hint": "#4ade80",
      "opacity": 0.5
    },
    {
      "id": "lvid_line_instance789_frame15",
      "type": "line",
      "target": {
        "series_uid": "1.2.840.113619.2.55.3.123456789.1",
        "instance_uid": "1.2.840.113619.2.55.3.123456789.1.789",
        "frame_index": 15
      },
      "label": "LVID (diastole)",
      "start_px": {"x": 245.3, "y": 312.8},
      "end_px": {"x": 398.7, "y": 318.2},
      "default_visible": true,
      "color": "#ef4444",
      "line_width": 2,
      "measurement_value": 4.8,
      "measurement_unit": "cm"
    },
    {
      "id": "lv_contour_instance456_frame28",
      "type": "polyline",
      "target": {
        "series_uid": "1.2.840.113619.2.55.3.123456789.1",
        "instance_uid": "1.2.840.113619.2.55.3.123456789.1.456",
        "frame_index": 28
      },
      "label": "LV Endocardium (ES)",
      "points_px": [
        {"x": 250.0, "y": 300.0},
        {"x": 255.0, "y": 280.0},
        ...
        {"x": 250.0, "y": 300.0}
      ],
      "closed": true,
      "default_visible": true,
      "color": "#3b82f6",
      "line_width": 2
    }
  ],

  "measurements": [
    {
      "name": "LVIDd",
      "value": 4.8,
      "unit": "cm",
      "confidence": 0.89,
      "frame_ed": 12,
      "instance_uid": "1.2.840.113619.2.55.3.123456789.1.789",
      "view": "PLAX"
    },
    {
      "name": "LVIDs",
      "value": 3.1,
      "unit": "cm",
      "confidence": 0.87,
      "frame_es": 28,
      "instance_uid": "1.2.840.113619.2.55.3.123456789.1.789",
      "view": "PLAX"
    },
    {
      "name": "IVSd",
      "value": 1.1,
      "unit": "cm",
      "confidence": 0.91,
      "frame_ed": 12,
      "instance_uid": "1.2.840.113619.2.55.3.123456789.1.789",
      "view": "PLAX"
    },
    {
      "name": "LVPWd",
      "value": 1.0,
      "unit": "cm",
      "confidence": 0.88,
      "frame_ed": 12,
      "instance_uid": "1.2.840.113619.2.55.3.123456789.1.789",
      "view": "PLAX"
    },
    {
      "name": "EF (EchoNet-Dynamic)",
      "value": 59.0,
      "unit": "%",
      "confidence": 0.85,
      "frame_ed": 12,
      "frame_es": 28,
      "instance_uid": "1.2.840.113619.2.55.3.123456789.1.456",
      "view": "A4C"
    }
  ],

  "curves": [
    {
      "name": "LV Volume",
      "unit": "mL",
      "instance_uid": "1.2.840.113619.2.55.3.123456789.1.456",
      "t_ms": [0, 33, 66, 100, ...],
      "y": [120.5, 118.3, 110.2, 95.4, ...],
      "markers": {
        "ED": 12,
        "ES": 28
      }
    }
  ],

  "report": {
    "sections": {
      "Left Ventricle": {
        "Size": "Normal",
        "Systolic Function": "Normal",
        "EF": "59-62%",
        "Wall Thickness": "Normal"
      },
      "Right Ventricle": {
        "Size": "Normal",
        "Systolic Function": "Normal"
      }
    },
    "text": "Normal left ventricular size and systolic function with an ejection fraction of 59-62%. Normal wall thickness. Normal right ventricular size and function."
  },

  "file_outputs": {
    "lv_segmentation_video": "results/1.2.840.113619.2.55.3.123456789/horalix_ai/videos/lv_segmentation_a4c.mp4",
    "ivs_measurement_video": "results/1.2.840.113619.2.55.3.123456789/horalix_ai/videos/ivs_plax.mp4"
  },

  "dicom_exports": {}
}
```

### 5.3 Frontend Integration Points

**Measurement Store Extension** (`useMeasurementStore.ts`):
```typescript
// Add new action to import AI-generated measurements
importAIMeasurements: (output: HoralixAIOutput) => {
  const aiMeasurements = convertOverlaysToMeasurements(output.overlays);

  // Add to store with special "AI-generated" flag
  aiMeasurements.forEach(m => {
    set(state => ({
      measurements: new Map(state.measurements).set(m.id, {
        ...m,
        aiGenerated: true,
        editable: true,  // User can still edit
      })
    }));
  });
}
```

**New AI Overlay Panel Component** (`features/viewer/components/AIOverlayPanel/AIOverlayPanel.tsx`):
```typescript
/**
 * Panel for displaying AI-generated overlays from horalix_ai.
 *
 * Features:
 * - Toggle visibility per overlay
 * - Show/hide all AI overlays
 * - Display measurement table
 * - Plot curves (LV volume over time)
 * - Show structured report
 * - Export to DICOM SEG/SR (Phase 2)
 */
```

**Viewer Page Integration** (`ViewerPage.tsx`):
```typescript
// Fetch AI results when study loads
useEffect(() => {
  if (studyUid) {
    fetchAIResults(studyUid).then(results => {
      // Filter for horalix_ai results
      const horalixResult = results.find(r => r.model_name === 'horalix_ai');

      if (horalixResult) {
        // Import overlays into measurement store
        measurementStore.importAIMeasurements(horalixResult);

        // Store curves and report in viewer state
        setAICurves(horalixResult.curves);
        setAIReport(horalixResult.report);
      }
    });
  }
}, [studyUid]);
```

---

## 6. Docker & GPU Configuration

### 6.1 docker-compose.yml Updates

```yaml
services:
  backend:
    build:
      context: .
      dockerfile: docker/Dockerfile.backend
    ports:
      - "8000:8000"
    volumes:
      # Weights volume (read-only mount from Windows)
      - type: bind
        source: C:/Users/kerim/OneDrive/Desktop/Echocardiology_App/backend/app/AI_models
        target: /app/models/horalix_ai
        read_only: true

      # Results storage (persistent)
      - type: volume
        source: horalix_results
        target: /app/results

      # Job queue (shared with workers)
      - type: volume
        source: horalix_job_queue
        target: /app/job_queue

      # Logs
      - type: volume
        source: horalix_logs
        target: /app/logs

      # Database (if using SQLite)
      - type: volume
        source: horalix_db
        target: /app/data

    environment:
      # GPU Configuration
      - HORALIX_AI_ENABLED=true
      - HORALIX_AI_MODELS_ROOT=/app/models/horalix_ai
      - HORALIX_AI_RESULTS_DIR=/app/results
      - HORALIX_AI_JOB_QUEUE_DIR=/app/job_queue
      - HORALIX_AI_NUM_WORKERS=2
      - HORALIX_AI_PRELOAD=true
      - HORALIX_AI_WARMUP=false

      # Model Feature Flags
      - HORALIX_AI_ENABLE_ECHONET_DYNAMIC=true
      - HORALIX_AI_ENABLE_MEASUREMENTS_2D=true
      - HORALIX_AI_ENABLE_MEASUREMENTS_DOPPLER=true

      # Optimization
      - HORALIX_AI_CACHE_ENABLED=true
      - HORALIX_AI_CACHE_MAX_SIZE_GB=10
      - HORALIX_AI_MIXED_PRECISION=true

      # Batch Sizes
      - HORALIX_AI_PANECHO_BATCH=8
      - HORALIX_AI_MEASUREMENTS_BATCH=16
      - HORALIX_AI_ECHONET_BATCH=16

    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: all
              capabilities: [gpu]

    depends_on:
      - horalix-ai-worker-0
      - horalix-ai-worker-1

  horalix-ai-worker-0:
    build:
      context: .
      dockerfile: docker/Dockerfile.horalix_ai_worker
    volumes:
      # Same mounts as backend
      - type: bind
        source: C:/Users/kerim/OneDrive/Desktop/Echocardiology_App/backend/app/AI_models
        target: /app/models/horalix_ai
        read_only: true
      - type: volume
        source: horalix_results
        target: /app/results
      - type: volume
        source: horalix_job_queue
        target: /app/job_queue
      - type: volume
        source: horalix_logs
        target: /app/logs

    environment:
      - CUDA_VISIBLE_DEVICES=0  # Pin to GPU 0
      - HORALIX_AI_WORKER_ID=0
      - HORALIX_AI_MODELS_ROOT=/app/models/horalix_ai
      - HORALIX_AI_RESULTS_DIR=/app/results
      - HORALIX_AI_JOB_QUEUE_DIR=/app/job_queue
      # ... (same config as backend)

    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              device_ids: ['0']
              capabilities: [gpu]

    restart: unless-stopped

  horalix-ai-worker-1:
    build:
      context: .
      dockerfile: docker/Dockerfile.horalix_ai_worker
    volumes:
      # Same mounts as backend
      - type: bind
        source: C:/Users/kerim/OneDrive/Desktop/Echocardiology_App/backend/app/AI_models
        target: /app/models/horalix_ai
        read_only: true
      - type: volume
        source: horalix_results
        target: /app/results
      - type: volume
        source: horalix_job_queue
        target: /app/job_queue
      - type: volume
        source: horalix_logs
        target: /app/logs

    environment:
      - CUDA_VISIBLE_DEVICES=1  # Pin to GPU 1
      - HORALIX_AI_WORKER_ID=1
      - HORALIX_AI_MODELS_ROOT=/app/models/horalix_ai
      - HORALIX_AI_RESULTS_DIR=/app/results
      - HORALIX_AI_JOB_QUEUE_DIR=/app/job_queue
      # ... (same config as backend)

    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              device_ids: ['1']
              capabilities: [gpu]

    restart: unless-stopped

volumes:
  horalix_results:
  horalix_job_queue:
  horalix_logs:
  horalix_db:
```

### 6.2 Dockerfile for Worker

```dockerfile
# docker/Dockerfile.horalix_ai_worker

FROM nvidia/cuda:12.1.0-cudnn8-runtime-ubuntu22.04

# System dependencies
RUN apt-get update && apt-get install -y \
    python3.10 \
    python3-pip \
    libgl1-mesa-glx \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Python dependencies
WORKDIR /app
COPY backend/pyproject.toml backend/poetry.lock ./
RUN pip install --no-cache-dir poetry && \
    poetry config virtualenvs.create false && \
    poetry install --no-dev --no-root

# Copy application code
COPY backend/app /app

# Entry point
CMD ["python3", "-m", "app.services.ai.horalix_ai.worker"]
```

### 6.3 GPU Prerequisites Documentation

**README Section**:
```markdown
## GPU Requirements

### NVIDIA Driver
- **Minimum Version**: 525.60.13 (for CUDA 12.x)
- Check version: `nvidia-smi`

### NVIDIA Container Toolkit
Required to expose GPUs to Docker containers.

**Installation on Windows (Docker Desktop)**:
1. Ensure Docker Desktop version ≥ 4.19 (with WSL 2 backend)
2. Install NVIDIA GPU driver on Windows host
3. Inside WSL 2, install NVIDIA Container Toolkit:
   ```bash
   distribution=$(. /etc/os-release;echo $ID$VERSION_ID)
   curl -s -L https://nvidia.github.io/nvidia-docker/gpgkey | sudo apt-key add -
   curl -s -L https://nvidia.github.io/nvidia-docker/$distribution/nvidia-docker.list | sudo tee /etc/apt/sources.list.d/nvidia-docker.list
   sudo apt-get update && sudo apt-get install -y nvidia-container-toolkit
   sudo nvidia-ctk runtime configure --runtime=docker
   sudo systemctl restart docker
   ```
4. Verify GPU access:
   ```bash
   docker run --rm --gpus all nvidia/cuda:12.1.0-base-ubuntu22.04 nvidia-smi
   ```

### Verify GPU Configuration in Horalix
After starting the stack:
```bash
docker compose logs horalix-ai-worker-0 | grep "GPU"
docker compose logs horalix-ai-worker-1 | grep "GPU"
```

Expected output:
```
Worker 0: GPU 0 (NVIDIA GeForce RTX 5080) detected, 16GB VRAM available
Worker 1: GPU 1 (NVIDIA GeForce RTX 5080) detected, 16GB VRAM available
```
```

---

## 7. Performance Optimization Strategy

### 7.1 Caching Architecture

**Frame Caching** (`frame_cache.py`):
```python
class FrameCache:
    """
    LRU cache for decoded DICOM frames.

    Key: (instance_uid, frame_index)
    Value: (frame_array, metadata)

    Max size: Configurable (default 10GB)
    Eviction: LRU
    """

    def __init__(self, max_size_gb: int = 10):
        self.max_size_bytes = max_size_gb * 1024**3
        self.cache = {}  # OrderedDict for LRU
        self.current_size_bytes = 0

    def get(self, instance_uid: str, frame_index: int) -> Optional[Tuple[np.ndarray, dict]]:
        key = (instance_uid, frame_index)
        if key in self.cache:
            # Move to end (most recently used)
            self.cache.move_to_end(key)
            return self.cache[key]
        return None

    def put(self, instance_uid: str, frame_index: int, frame: np.ndarray, metadata: dict):
        key = (instance_uid, frame_index)
        frame_size = frame.nbytes + sys.getsizeof(metadata)

        # Evict LRU entries if needed
        while self.current_size_bytes + frame_size > self.max_size_bytes and self.cache:
            evicted_key, evicted_val = self.cache.popitem(last=False)
            self.current_size_bytes -= evicted_val[0].nbytes

        self.cache[key] = (frame, metadata)
        self.current_size_bytes += frame_size
```

**Embedding Caching** (`embedding_cache.py`):
```python
class EmbeddingCache:
    """
    Cache for intermediate model outputs (embeddings, view predictions).

    Key: (study_uid, model_name, weights_hash)
    Value: embedding tensor or prediction dict

    Invalidation: On new model weights or config change
    Persistence: Optional disk-backed cache (pickle or HDF5)
    """

    def __init__(self, cache_dir: Path, enabled: bool = True):
        self.cache_dir = cache_dir
        self.enabled = enabled
        self.memory_cache = {}

        if enabled:
            self.cache_dir.mkdir(parents=True, exist_ok=True)

    def get(self, study_uid: str, model_name: str) -> Optional[any]:
        if not self.enabled:
            return None

        # Check memory cache first
        key = (study_uid, model_name)
        if key in self.memory_cache:
            return self.memory_cache[key]

        # Check disk cache
        cache_file = self.cache_dir / f"{study_uid}_{model_name}.pkl"
        if cache_file.exists():
            with open(cache_file, "rb") as f:
                data = pickle.load(f)
                self.memory_cache[key] = data
                return data

        return None

    def put(self, study_uid: str, model_name: str, data: any):
        if not self.enabled:
            return

        key = (study_uid, model_name)
        self.memory_cache[key] = data

        # Write to disk (async to avoid blocking)
        cache_file = self.cache_dir / f"{study_uid}_{model_name}.pkl"
        with open(cache_file, "wb") as f:
            pickle.dump(data, f)
```

### 7.2 Batching Strategy

**Dynamic Batch Size**:
- Start with config defaults (PanEcho=8, Measurements=16, EchoNet=16)
- Monitor GPU memory usage per batch
- Reduce batch size if OOM errors occur
- Log batch size adjustments for debugging

**Frame Batching**:
```python
def batch_inference(
    model: nn.Module,
    frames_list: List[torch.Tensor],
    batch_size: int,
    device: str,
) -> List[torch.Tensor]:
    """
    Run batched inference on list of frame tensors.

    Args:
        frames_list: List of tensors, each (N_frames, 3, H, W)
        batch_size: Max batch size
        device: CUDA device

    Returns:
        List of output tensors (one per input tensor)
    """
    results = []

    for frames in frames_list:
        # Split into batches
        num_batches = (len(frames) + batch_size - 1) // batch_size
        batch_outputs = []

        for i in range(num_batches):
            start = i * batch_size
            end = min(start + batch_size, len(frames))
            batch = frames[start:end].to(device)

            with torch.no_grad():
                output = model(batch)

            batch_outputs.append(output.cpu())

        # Concatenate batches
        results.append(torch.cat(batch_outputs, dim=0))

    return results
```

### 7.3 Mixed Precision (FP16)

**Automatic Mixed Precision** (torch.amp):
```python
def run_with_amp(
    model: nn.Module,
    input_tensor: torch.Tensor,
    device: str,
    use_amp: bool = True,
) -> torch.Tensor:
    """
    Run inference with automatic mixed precision (FP16).

    Safe for most models (ConvNets, Transformers).
    Caution: May reduce numerical stability for some operations.
    """
    if use_amp and device.startswith("cuda"):
        with torch.cuda.amp.autocast():
            output = model(input_tensor)
    else:
        output = model(input_tensor)

    return output
```

**Model Conversion** (manual FP16):
```python
def convert_model_to_fp16(model: nn.Module) -> nn.Module:
    """
    Convert model weights to FP16 (half precision).

    Reduces VRAM usage by ~50%.
    Slight accuracy trade-off (typically negligible for inference).
    """
    model = model.half()
    return model
```

**Implementation Strategy**:
1. Enable AMP by default (`HORALIX_AI_MIXED_PRECISION=true`)
2. Test accuracy on validation set (compare FP32 vs FP16 outputs)
3. If accuracy degradation < 1%, keep enabled
4. Log mixed precision usage in inference metadata

### 7.4 ONNX Export (Optional)

**Export Pipeline** (`scripts/export_to_onnx.py`):
```python
import torch
import onnx
from onnxruntime import InferenceSession

def export_model_to_onnx(
    model: nn.Module,
    dummy_input: torch.Tensor,
    output_path: str,
    dynamic_axes: Optional[Dict] = None,
):
    """
    Export PyTorch model to ONNX format.

    Args:
        model: PyTorch model (eval mode)
        dummy_input: Example input tensor (for shape inference)
        output_path: Output .onnx file path
        dynamic_axes: Dict specifying dynamic dimensions (e.g., batch size, sequence length)

    Example:
        dynamic_axes = {
            "input": {0: "batch_size", 2: "num_frames"},
            "output": {0: "batch_size"}
        }
    """
    model.eval()

    with torch.no_grad():
        torch.onnx.export(
            model,
            dummy_input,
            output_path,
            export_params=True,
            opset_version=17,
            do_constant_folding=True,
            input_names=["input"],
            output_names=["output"],
            dynamic_axes=dynamic_axes or {},
        )

    # Verify ONNX model
    onnx_model = onnx.load(output_path)
    onnx.checker.check_model(onnx_model)

    print(f"ONNX model exported to {output_path}")

def benchmark_onnx_vs_pytorch(
    pytorch_model: nn.Module,
    onnx_path: str,
    input_tensor: torch.Tensor,
    num_runs: int = 100,
):
    """
    Compare inference speed: PyTorch vs ONNX Runtime.
    """
    import time

    # PyTorch benchmark
    pytorch_model.eval()
    with torch.no_grad():
        start = time.time()
        for _ in range(num_runs):
            _ = pytorch_model(input_tensor)
        pytorch_time = (time.time() - start) / num_runs

    # ONNX benchmark
    session = InferenceSession(onnx_path, providers=["CUDAExecutionProvider"])
    input_name = session.get_inputs()[0].name
    input_np = input_tensor.cpu().numpy()

    start = time.time()
    for _ in range(num_runs):
        _ = session.run(None, {input_name: input_np})
    onnx_time = (time.time() - start) / num_runs

    print(f"PyTorch: {pytorch_time*1000:.2f} ms")
    print(f"ONNX:    {onnx_time*1000:.2f} ms")
    print(f"Speedup: {pytorch_time / onnx_time:.2f}x")
```

**Exportable Models**:
- ✅ View Classifier (ConvNeXt Base): Pure convolutions, should export cleanly
- ✅ Measurements Models (DeepLabV3 ResNet50): Standard architecture, well-supported
- ⚠️ PanEcho (ConvNeXt + Transformer): Transformer may require opset 17+, test carefully
- ⚠️ EchoPrime (MViT-v2): Complex multi-head attention, may need custom ops
- ✅ EchoNet-Dynamic (DeepLabV3 ResNet50): Same as measurements

**Phase 2 Task**: Selective ONNX export after validating accuracy and performance gains.

### 7.5 DICOM I/O Optimization

**Lazy Frame Loading**:
```python
class LazyFrameLoader:
    """
    Load DICOM frames on-demand instead of preloading entire series.

    Useful for large studies (>100 instances, >1000 frames).
    """

    def __init__(self, instance_path: Path):
        self.instance_path = instance_path
        self.ds = None  # pydicom dataset (lazy loaded)
        self.num_frames = None

    def __len__(self) -> int:
        if self.num_frames is None:
            self._load_metadata()
        return self.num_frames

    def __getitem__(self, frame_index: int) -> np.ndarray:
        if self.ds is None:
            self._load_metadata()

        # Extract single frame from PixelData
        if hasattr(self.ds, "NumberOfFrames") and self.ds.NumberOfFrames > 1:
            # Multiframe DICOM
            frame = self.ds.pixel_array[frame_index]
        else:
            # Single-frame DICOM
            frame = self.ds.pixel_array

        return frame

    def _load_metadata(self):
        self.ds = pydicom.dcmread(str(self.instance_path))
        self.num_frames = getattr(self.ds, "NumberOfFrames", 1)
```

**Parallel DICOM Parsing**:
```python
from concurrent.futures import ThreadPoolExecutor

def load_series_parallel(
    instance_paths: List[Path],
    num_workers: int = 4,
) -> List[Tuple[np.ndarray, dict]]:
    """
    Load multiple DICOM instances in parallel.

    Useful for studies with many instances (>10).
    """
    def load_instance(path):
        ds = pydicom.dcmread(str(path))
        frame = ds.pixel_array
        metadata = extract_metadata(ds)
        return (frame, metadata)

    with ThreadPoolExecutor(max_workers=num_workers) as executor:
        results = list(executor.map(load_instance, instance_paths))

    return results
```

### 7.6 Memory Management

**GPU Memory Profiling**:
```python
def log_gpu_memory(logger, prefix=""):
    """Log current GPU memory usage."""
    if torch.cuda.is_available():
        for i in range(torch.cuda.device_count()):
            allocated = torch.cuda.memory_allocated(i) / 1024**3
            reserved = torch.cuda.memory_reserved(i) / 1024**3
            logger.info(f"{prefix} GPU {i}: {allocated:.2f} GB allocated, {reserved:.2f} GB reserved")
```

**Explicit Memory Cleanup**:
```python
def clear_gpu_cache():
    """Force GPU memory cleanup (use sparingly)."""
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
        torch.cuda.synchronize()
```

**Best Practices**:
1. Call `torch.no_grad()` for all inference
2. Move tensors to CPU immediately after inference
3. Delete large tensors explicitly: `del tensor; gc.collect()`
4. Monitor memory usage with `nvidia-smi dmon -s mu -d 1` during testing
5. Set `PYTORCH_CUDA_ALLOC_CONF=max_split_size_mb:512` to reduce fragmentation

---

## 8. Implementation Phases

### Phase 1: Core Integration (Weeks 1-3)

**Deliverables**:
- ✅ Models load at worker startup
- ✅ Basic pipeline (Stages 0-7) functional
- ✅ Overlay-first output schema implemented
- ✅ Docker Compose with GPU support configured
- ✅ 2-GPU worker pool operational
- ✅ Basic caching (frame cache only)
- ✅ API endpoints functional
- ✅ Frontend displays overlays (minimal UI)

**Testing**:
- Unit tests for each pipeline stage
- Integration test: Full study inference
- Validation: Compare output with Echocardiology_App on same study

### Phase 2: Optimization (Weeks 4-5)

**Deliverables**:
- ✅ Embedding caching enabled
- ✅ Mixed precision (FP16) enabled and validated
- ✅ Dynamic batch sizing based on GPU memory
- ✅ ONNX export scripts (for eligible models)
- ✅ Performance benchmarks documented

**Testing**:
- Load testing: 10 concurrent inference jobs
- Memory profiling: Ensure no leaks over 100 inferences
- Accuracy validation: FP16 vs FP32 comparison

### Phase 3: Frontend Polish (Week 6)

**Deliverables**:
- ✅ AI Overlay Panel with full feature set
- ✅ Measurement table display
- ✅ LV volume curve plotting
- ✅ Structured report viewer
- ✅ Toggle visibility per overlay
- ✅ Export overlays to JSON/CSV

### Phase 4: Hospital-Grade Features (Weeks 7-8, Optional)

**Deliverables**:
- ✅ DICOM SEG export (masks → DICOM Segmentation objects)
- ✅ DICOM SR export (findings → Structured Report)
- ✅ STOW-RS integration (store SEG/SR to PACS)
- ✅ Audit logging (who ran inference, when, on which study)
- ✅ PHI scrubbing in logs and exports

**Testing**:
- Validate DICOM SEG/SR with DICOM validator tools
- Test PACS storage via STOW-RS

### Phase 5: Documentation & Deployment (Week 9)

**Deliverables**:
- ✅ Comprehensive README.md (see Section 10)
- ✅ API documentation (OpenAPI/Swagger)
- ✅ Troubleshooting guide
- ✅ Performance tuning guide
- ✅ Security checklist

---

## 9. Testing & Validation

### 9.1 Unit Tests

**Test Coverage**:
- ✅ Each preprocessing function (PanEcho, EchoPrime, Measurements, EchoNet)
- ✅ Each postprocessing function (keypoint extraction, coordinate transform, measurement conversion, contour extraction)
- ✅ Model loaders (verify weights load correctly)
- ✅ Caching (frame cache, embedding cache)
- ✅ Output schema validation (Pydantic models)

**Framework**: pytest

**Example Test** (`tests/test_preprocessing.py`):
```python
import numpy as np
import torch
from app.services.ai.horalix_ai.preprocessing.panecho_prep import preprocess_for_panecho

def test_panecho_preprocessing_shape():
    """Test that PanEcho preprocessing outputs correct shape."""
    # Create dummy frames (16 frames, 512x512 RGB)
    frames = [np.random.randint(0, 255, (512, 512, 3), dtype=np.uint8) for _ in range(16)]

    # Preprocess
    tensor = preprocess_for_panecho(frames)

    # Assert output shape
    assert tensor.shape == (1, 3, 16, 224, 224)
    assert tensor.dtype == torch.float32

def test_panecho_preprocessing_normalization():
    """Test that PanEcho preprocessing applies ImageNet normalization."""
    # Create constant frames (all gray, value 128)
    frames = [np.full((224, 224, 3), 128, dtype=np.uint8) for _ in range(16)]

    # Preprocess
    tensor = preprocess_for_panecho(frames)

    # Expected: (128/255 - mean) / std
    # For gray (R=G=B=128/255≈0.5), after normalization should be close to 0
    mean = torch.tensor([0.485, 0.456, 0.406]).view(3, 1, 1, 1)
    std = torch.tensor([0.229, 0.224, 0.225]).view(3, 1, 1, 1)
    expected = (0.5 - mean) / std

    # Check that mean across frames is close to expected
    assert torch.allclose(tensor.mean(dim=(2, 3, 4)), expected.squeeze(), atol=0.1)
```

### 9.2 Integration Tests

**Test Scenarios**:
1. **Full Pipeline Test**: Load real DICOM study, run full inference, validate output schema
2. **Worker Concurrency Test**: Submit 2 jobs simultaneously, verify both complete without errors
3. **Caching Test**: Run inference twice on same study, verify second run is faster (cache hit)
4. **Error Handling Test**: Submit invalid study_uid, verify graceful error response

**Example Test** (`tests/test_integration.py`):
```python
import pytest
from app.services.ai.models.horalix_ai_composite import HoralixAICompositeModel

@pytest.mark.asyncio
async def test_full_pipeline(test_study_uid):
    """Test full inference pipeline on real DICOM study."""
    model = HoralixAICompositeModel()
    await model.load(device="cuda")

    # Run inference
    result = await model.predict(study_uid=test_study_uid)

    # Validate output schema
    assert result.model_name == "horalix_ai"
    assert result.study_uid == test_study_uid
    assert result.inference_time_ms > 0
    assert len(result.overlays) > 0
    assert len(result.measurements) > 0

    # Validate specific overlay types
    has_mask = any(o.type == "mask" for o in result.overlays)
    has_line = any(o.type == "line" for o in result.overlays)
    assert has_mask or has_line  # At least one overlay type present

@pytest.mark.asyncio
async def test_concurrent_inference(test_study_uid_1, test_study_uid_2):
    """Test that 2 workers can handle concurrent jobs."""
    model = HoralixAICompositeModel()
    await model.load(device="cuda")

    # Submit 2 jobs concurrently
    import asyncio
    results = await asyncio.gather(
        model.predict(study_uid=test_study_uid_1),
        model.predict(study_uid=test_study_uid_2),
    )

    # Both should complete successfully
    assert len(results) == 2
    assert all(r.model_name == "horalix_ai" for r in results)

    # Should use different GPUs
    gpu_ids = [r.gpu_id for r in results]
    assert 0 in gpu_ids and 1 in gpu_ids  # Both GPUs used
```

### 9.3 Validation Against Echocardiology_App

**Goal**: Ensure Horalix integration produces identical results to Echocardiology_App.

**Method**:
1. Select 10 diverse test studies (different views, pathologies)
2. Run inference in Echocardiology_App, save outputs
3. Run inference in Horalix, save outputs
4. Compare:
   - PanEcho predictions (tolerance: ±0.01 for regression, exact for classification)
   - EchoPrime predictions (tolerance: ±0.05)
   - Measurements (tolerance: ±0.5mm)
   - Segmentation masks (Dice score > 0.99)

**Script** (`scripts/validate_against_echocardiology.py`):
```python
import json
import numpy as np
from pathlib import Path

def compare_outputs(echocardiology_output_path: Path, horalix_output_path: Path):
    """Compare outputs from both systems."""
    with open(echocardiology_output_path) as f:
        echo_output = json.load(f)

    with open(horalix_output_path) as f:
        horalix_output = json.load(f)

    # Compare PanEcho predictions
    for task_name, echo_value in echo_output["panecho"].items():
        horalix_value = horalix_output["findings"]["panecho"][task_name]

        if isinstance(echo_value, float):
            diff = abs(echo_value - horalix_value)
            assert diff < 0.01, f"{task_name}: {echo_value} vs {horalix_value} (diff: {diff})"
        else:
            assert echo_value == horalix_value, f"{task_name}: {echo_value} vs {horalix_value}"

    # Compare measurements
    for echo_meas in echo_output["measurements"]:
        horalix_meas = next(m for m in horalix_output["measurements"] if m["name"] == echo_meas["name"])
        diff_mm = abs(echo_meas["value_cm"] - horalix_meas["value"]) * 10  # Convert to mm
        assert diff_mm < 0.5, f"{echo_meas['name']}: {echo_meas['value_cm']} cm vs {horalix_meas['value']} cm (diff: {diff_mm} mm)"

    print("✅ Validation passed: Outputs match within tolerance")
```

### 9.4 Performance Benchmarks

**Metrics**:
- **Inference Time**: Total time from job submission to results ready
- **Throughput**: Studies per hour (with 2 GPUs)
- **GPU Utilization**: % time GPU is actively computing
- **Memory Usage**: Peak VRAM per worker
- **Cache Hit Rate**: % of frame cache hits

**Target Performance**:
- Inference time: < 30 seconds per study (avg 5-10 instances)
- Throughput: > 120 studies/hour (2 GPUs)
- GPU utilization: > 80%
- Memory: < 14 GB per worker
- Cache hit rate: > 50% for repeat studies

**Benchmark Script** (`scripts/benchmark_performance.py`):
```python
import time
import psutil
import GPUtil
from app.services.ai.models.horalix_ai_composite import HoralixAICompositeModel

def benchmark_inference(study_uids: List[str], num_runs: int = 10):
    """Benchmark inference performance."""
    model = HoralixAICompositeModel()
    model.load(device="cuda")

    # Warmup
    model.predict(study_uids[0])

    # Benchmark
    times = []
    for study_uid in study_uids[:num_runs]:
        start = time.time()
        result = model.predict(study_uid)
        elapsed = time.time() - start
        times.append(elapsed)

        # Log GPU usage
        gpus = GPUtil.getGPUs()
        for gpu in gpus:
            print(f"GPU {gpu.id}: {gpu.load*100:.1f}% utilization, {gpu.memoryUsed}MB / {gpu.memoryTotal}MB")

    # Report
    print(f"Avg inference time: {np.mean(times):.2f} s")
    print(f"Std dev: {np.std(times):.2f} s")
    print(f"Throughput: {3600 / np.mean(times):.1f} studies/hour (single GPU)")
    print(f"Throughput (2 GPUs): {2 * 3600 / np.mean(times):.1f} studies/hour")
```

---

## 10. Security & Compliance

### 10.1 PHI/PII Protection

**Data at Rest**:
- DICOM files stored with access controls (owner: horalix, mode: 0600)
- Results directory encrypted at filesystem level (BitLocker on Windows, dm-crypt on Linux)
- Database encryption: Use SQLCipher for SQLite or encrypted RDS for PostgreSQL

**Data in Transit**:
- Internal (backend ↔ workers): Unix domain sockets or localhost-only TCP (no encryption needed if single host)
- External (client ↔ backend): HTTPS with TLS 1.3 (see nginx config)

**Log Scrubbing**:
- Redact patient names, dates of birth, MRNs from logs
- Log only DICOM UIDs (which are non-PHI per HIPAA if de-identified)

**Access Control**:
- Implement RBAC (Role-Based Access Control) for API endpoints
- Admin-only: Model loading/unloading, job cancellation
- Clinician: Submit inference jobs, view results for their patients only

### 10.2 Audit Logging

**Audit Events**:
- Inference job submitted (user_id, study_uid, timestamp)
- Inference job completed (job_id, inference_time_ms, gpu_id)
- Model loaded/unloaded (model_name, timestamp, user_id)
- Results accessed (user_id, study_uid, timestamp)

**Storage**:
- Append-only log file or database table
- Retention: 7 years (HIPAA requirement)

**Schema**:
```python
class AuditLog(BaseModel):
    id: str  # UUID
    timestamp: datetime
    event_type: str  # "inference_submitted", "inference_completed", "results_accessed"
    user_id: Optional[str]
    study_uid: Optional[str]
    job_id: Optional[str]
    details: Dict[str, any]  # Event-specific metadata
```

### 10.3 Production Hardening Checklist

**Must-Have**:
- [ ] TLS/HTTPS enabled (nginx reverse proxy with Let's Encrypt cert)
- [ ] Authentication & authorization (OAuth 2.0 or SAML)
- [ ] Rate limiting (nginx: limit_req_zone, or API gateway)
- [ ] Input validation (Pydantic models for all API requests)
- [ ] SQL injection protection (use parameterized queries, ORM)
- [ ] XSS protection (Content-Security-Policy headers)
- [ ] CORS configuration (restrict allowed origins)
- [ ] Error handling (no stack traces in production responses)
- [ ] Secrets management (use Docker secrets or Azure Key Vault, not .env files)
- [ ] Regular updates (Docker base images, Python dependencies)
- [ ] Backup strategy (daily backups of database + results, test restores monthly)
- [ ] Monitoring & alerting (Prometheus + Grafana for metrics, PagerDuty for alerts)
- [ ] Disaster recovery plan (documented RTO/RPO, tested annually)

**Nice-to-Have**:
- [ ] Intrusion detection (fail2ban, OSSEC)
- [ ] Vulnerability scanning (Trivy for Docker images, Snyk for dependencies)
- [ ] Penetration testing (annual third-party assessment)
- [ ] HIPAA compliance certification (work with compliance consultant)

---

## 11. Known Limitations & Future Work

### 11.1 Current Limitations

1. **Single-Node Deployment**: Workers run on same machine as backend (suitable for workstation deployment, not hospital-scale PACS)
2. **No Load Balancing**: Job routing is FIFO, not intelligent (no priority queues beyond simple integer priority)
3. **Limited Error Recovery**: Worker crash requires manual restart (no auto-restart via systemd/k8s)
4. **No Multi-Study Batch Inference**: Each job processes one study (could batch multiple studies for efficiency)
5. **Doppler Measurements Not Implemented**: Only 2D measurements in Phase 1 (Doppler requires additional preprocessing logic)

### 11.2 Future Enhancements

**Phase 2+ Roadmap**:
1. **DICOM SEG/SR Export**: Enable PACS archival of AI results
2. **FHIR Integration**: DiagnosticReport generation for EHR integration
3. **Multi-Node Scaling**: Kubernetes deployment with horizontal pod autoscaling
4. **Model Versioning**: Support multiple model versions, A/B testing
5. **Feedback Loop**: Clinician corrections feed back into model retraining pipeline
6. **Real-Time Inference**: Stream inference results as they complete (WebSockets)
7. **Automated QA**: Flag low-confidence predictions for manual review
8. **Advanced Visualization**: 3D volume rendering, MPR (multi-planar reconstruction)

---

## 12. References

1. DICOM Standard PS3.18 (DICOMweb): https://dicom.nema.org/medical/dicom/current/output/chtml/part18/PS3.18.html
2. DICOM Segmentation Storage SOP: https://dicom.nema.org/medical/dicom/current/output/chtml/part03/sect_C.8.20.html
3. HL7 FHIR DiagnosticReport: https://hl7.org/fhir/diagnosticreport.html
4. PanEcho Paper (JAMA 2024): https://jamanetwork.com/journals/jama/fullarticle/2825896
5. EchoPrime Paper (Nature 2025): https://www.nature.com/articles/s41586-025-09850-x
6. Docker Compose GPU Support: https://docs.docker.com/compose/gpu-support/
7. NVIDIA Container Toolkit: https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html
8. PyTorch Automatic Mixed Precision: https://pytorch.org/docs/stable/amp.html
9. ONNX Export Guide: https://pytorch.org/docs/stable/onnx.html

---

## Appendix A: File Tree

```
horalix-view/
├── backend/
│   ├── app/
│   │   ├── api/
│   │   │   └── v1/
│   │   │       └── endpoints/
│   │   │           └── ai.py  # Extend with horalix_ai endpoints
│   │   ├── core/
│   │   │   └── config.py  # Extend with horalix_ai config
│   │   ├── services/
│   │   │   └── ai/
│   │   │       ├── base.py
│   │   │       ├── model_registry.py  # Register horalix_ai
│   │   │       ├── models/
│   │   │       │   └── horalix_ai_composite.py  # NEW
│   │   │       └── horalix_ai/  # NEW DIRECTORY
│   │   │           ├── __init__.py
│   │   │           ├── orchestrator.py
│   │   │           ├── worker.py
│   │   │           ├── schema.py
│   │   │           ├── pipeline/
│   │   │           │   ├── ingestion.py
│   │   │           │   ├── view_classification.py
│   │   │           │   ├── panecho.py
│   │   │           │   ├── echoprime.py
│   │   │           │   ├── prediction_fusion.py
│   │   │           │   ├── measurements_2d.py
│   │   │           │   ├── echonet_dynamic.py
│   │   │           │   └── output_normalizer.py
│   │   │           ├── preprocessing/
│   │   │           │   ├── panecho_prep.py
│   │   │           │   ├── echoprime_prep.py
│   │   │           │   ├── measurements_prep.py
│   │   │           │   └── echonet_prep.py
│   │   │           ├── postprocessing/
│   │   │           │   ├── keypoint_extractor.py
│   │   │           │   ├── coordinate_transformer.py
│   │   │           │   ├── measurement_converter.py
│   │   │           │   └── contour_extractor.py
│   │   │           ├── models/
│   │   │           │   ├── panecho_loader.py
│   │   │           │   ├── echoprime_loader.py
│   │   │           │   ├── measurements_loader.py
│   │   │           │   └── echonet_loader.py
│   │   │           ├── caching/
│   │   │           │   ├── frame_cache.py
│   │   │           │   └── embedding_cache.py
│   │   │           └── utils/
│   │   │               ├── dicom_metadata.py
│   │   │               ├── view_gating.py
│   │   │               └── logging_utils.py
│   │   └── database_models/
│   │       └── derived_results.py  # Extend if needed
│   ├── pyproject.toml  # Add new dependencies
│   └── tests/  # NEW
│       ├── test_preprocessing.py
│       ├── test_postprocessing.py
│       ├── test_pipeline.py
│       └── test_integration.py
├── frontend/
│   └── src/
│       ├── features/
│       │   └── viewer/
│       │       ├── components/
│       │       │   ├── AIOverlayPanel/  # NEW
│       │       │   │   ├── AIOverlayPanel.tsx
│       │       │   │   ├── AIOverlayListItem.tsx
│       │       │   │   ├── MeasurementTable.tsx
│       │       │   │   └── CurvePlot.tsx
│       │       │   └── MeasurementPanel/  # Extend
│       │       │       └── MeasurementPanel.tsx
│       │       ├── hooks/
│       │       │   └── useMeasurementStore.ts  # Extend
│       │       └── types/
│       │           └── measurement.types.ts  # Extend
│       └── services/
│           └── api.ts  # Add horalix_ai API calls
├── docker/
│   ├── Dockerfile.backend  # Update
│   ├── Dockerfile.horalix_ai_worker  # NEW
│   └── docker-compose.yml  # Update
├── docs/
│   ├── horalix_ai_integration.md  # THIS FILE
│   ├── api_documentation.md  # NEW
│   └── troubleshooting.md  # NEW
├── scripts/
│   ├── export_to_onnx.py  # NEW
│   ├── validate_against_echocardiology.py  # NEW
│   └── benchmark_performance.py  # NEW
└── README.md  # Update with comprehensive setup guide
```

---

## Appendix B: Coordinate Space Examples

**Scenario**: Measurements model outputs keypoints at 640×480 resolution, but DICOM is 800×600.

**Transform**:
```
Model output: [(320, 240), (480, 360)] (keypoints in 640×480 space)
Transform metadata: ratio_w = 800/640 = 1.25, ratio_h = 600/480 = 1.25
DICOM coordinates: [(320*1.25, 240*1.25), (480*1.25, 360*1.25)] = [(400, 300), (600, 450)]
```

**Display**: Frontend renders line from (400, 300) to (600, 450) in original DICOM image.

---

## Appendix C: View-Gated Measurements

**Logic**:
```python
VIEW_COMPATIBLE_MEASUREMENTS = {
    "PLAX": ["ivs", "lvid", "lvpw", "aortic_root"],
    "PSAX": ["rv_base"],
    "A4C": ["la"],
    "Subcostal": ["ivc"],
    # ... etc
}

def filter_measurements_by_view(instance_uid: str, view_label: str) -> List[str]:
    """Return list of measurement model names applicable to this view."""
    return VIEW_COMPATIBLE_MEASUREMENTS.get(view_label, [])
```

**Usage**: In Stage 5, only run measurements compatible with classified view.

---

## Appendix D: Error Codes & Troubleshooting

| Error Code | Message | Cause | Solution |
|------------|---------|-------|----------|
| `AI_WEIGHTS_NOT_FOUND` | Weights not found at path | Volume mount failed or path incorrect | Check `docker compose logs backend`, verify Windows path exists |
| `AI_GPU_NOT_AVAILABLE` | CUDA not available | NVIDIA drivers or container toolkit not installed | Run `nvidia-smi` on host, install NVIDIA Container Toolkit |
| `AI_OOM` | Out of memory | Batch size too large for GPU | Reduce `HORALIX_AI_*_BATCH` values in .env |
| `AI_WORKER_TIMEOUT` | Worker did not respond | Worker crashed or overloaded | Check worker logs: `docker compose logs horalix-ai-worker-0` |
| `AI_INVALID_STUDY` | Study UID not found | Study not ingested into Horalix | Upload DICOM study first |
| `AI_PREPROCESSING_ERROR` | Preprocessing failed | Unsupported DICOM encoding or corrupted file | Check DICOM file integrity with `pydicom` |

---

## Conclusion

This design document provides a complete blueprint for integrating the Echocardiology_App AI pipeline into Horalix-View as the `horalix_ai` composite model. The architecture prioritizes:

1. **Faithful Replication**: Exact preprocessing, postprocessing, and thresholds preserved
2. **Clinical Responsiveness**: <30s inference time, startup preloading, 2-GPU concurrency
3. **Viewer-First UX**: Interactive overlays, not burned-in videos
4. **Hospital-Grade Readiness**: DICOM SEG/SR export, audit logs, PHI protection (Phase 2)
5. **Maintainability**: Modular pipeline stages, comprehensive testing, clear documentation

**Next Steps**: Begin Phase 1 implementation following the file tree and code stubs provided.

---

**Document Status**: ✅ Complete, Ready for Implementation
**Last Updated**: 2026-02-02
**Author**: Claude Code Integration Agent
