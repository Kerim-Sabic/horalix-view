# Horalix AI Integration - Setup Guide

**Comprehensive Echocardiography AI Suite**
- **PanEcho**: 39-task multi-task model for view-agnostic echo interpretation
- **EchoPrime**: Multi-view vision-language model with anatomical section predictions
- **Measurements**: 9 anatomical 2D measurement models (IVS, LVID, LVPW, etc.)
- **EchoNet-Dynamic**: LV segmentation with volume/EF curves

---

## Quick Start (Windows + Docker + 2× RTX 5080 GPUs)

### Prerequisites

1. **Windows 10/11** with WSL 2 enabled
2. **Docker Desktop** ≥ 4.19 with WSL 2 backend
3. **NVIDIA GPU Driver** ≥ 525.60 (for CUDA 12.x)
4. **NVIDIA Container Toolkit** (installed in WSL 2)
5. **Echocardiology_App weights** at:
   ```
   C:\Users\kerim\OneDrive\Desktop\Echocardiology_App\backend\app\AI_models\
   ```

### Verify GPU Access in Docker

```bash
# Inside WSL 2
docker run --rm --gpus all nvidia/cuda:12.1.0-base-ubuntu22.04 nvidia-smi
```

Expected: Should show both RTX 5080 GPUs

### Installation

1. **Clone Repository**:
   ```bash
   git clone <repo-url>
   cd horalix-view
   ```

2. **Configure Environment**:
   ```bash
   cp backend/.env.example backend/.env
   ```

   Edit `backend/.env` and set:
   ```env
   # Horalix AI Configuration
   AI_HORALIX_AI_ENABLED=true
   AI_HORALIX_AI_MODELS_ROOT=/app/models/horalix_ai
   AI_HORALIX_AI_NUM_WORKERS=2
   AI_HORALIX_AI_PRELOAD=true
   AI_HORALIX_AI_ENABLE_ECHONET_DYNAMIC=true
   AI_HORALIX_AI_ENABLE_MEASUREMENTS_2D=true

   # Batch Sizes (adjust based on GPU memory)
   AI_HORALIX_AI_PANECHO_BATCH=8
   AI_HORALIX_AI_MEASUREMENTS_BATCH=16
   AI_HORALIX_AI_ECHONET_BATCH=16

   # Optimization
   AI_HORALIX_AI_CACHE_ENABLED=true
   AI_HORALIX_AI_CACHE_MAX_SIZE_GB=10
   AI_HORALIX_AI_MIXED_PRECISION=true
   ```

3. **Update Docker Compose**:
   Verify `docker/docker-compose.yml` has correct volume mount:
   ```yaml
   volumes:
     - type: bind
       source: C:/Users/kerim/OneDrive/Desktop/Echocardiology_App/backend/app/AI_models
       target: /app/models/horalix_ai
       read_only: true
   ```

4. **Build and Start**:
   ```bash
   docker compose up --build
   ```

   Watch logs for workers:
   ```bash
   docker compose logs -f horalix-ai-worker-0
   docker compose logs -f horalix-ai-worker-1
   ```

   Expected output:
   ```
   Worker 0: GPU 0 (NVIDIA GeForce RTX 5080) detected, 16GB VRAM available
   Worker 0: Loading PanEcho model...
   Worker 0: Loading EchoPrime models...
   Worker 0: Loading 9 measurement models...
   Worker 0: Loading EchoNet-Dynamic model...
   Worker 0: Models loaded successfully, ready for jobs
   ```

### Run Sample Inference

**Via API (cURL)**:
```bash
curl -X POST http://localhost:8000/api/v1/ai/infer \
  -H "Content-Type: application/json" \
  -d '{
    "study_uid": "1.2.840.113619.2.55.3.123456789",
    "model_type": "horalix_ai",
    "task_type": "CARDIAC"
  }'
```

Response:
```json
{
  "job_id": "abc123-def456",
  "status": "QUEUED",
  "created_at": "2026-02-02T14:32:10Z"
}
```

**Check Job Status**:
```bash
curl http://localhost:8000/api/v1/ai/jobs/abc123-def456
```

**Get Results**:
```bash
curl http://localhost:8000/api/v1/ai/results/1.2.840.113619.2.55.3.123456789
```

---

## Architecture Overview

```
┌─────────────────────────────────────────┐
│  Horalix Backend (FastAPI)              │
│  ┌─────────────────────────────────┐    │
│  │  ModelRegistry                  │    │
│  │  - horalix_ai registered        │    │
│  └────────────┬────────────────────┘    │
│               │ Job submission          │
│               ▼                          │
│  ┌─────────────────────────────────┐    │
│  │  HoralixAIOrchestrator          │    │
│  │  - Manages worker pool          │    │
│  │  - Job queue (filesystem)       │    │
│  └────────────┬────────────────────┘    │
└───────────────┼──────────────────────────┘
                │
        Job Queue (shared volume)
                │
    ┌───────────┴───────────┐
    │                       │
    ▼                       ▼
┌─────────────────┐   ┌─────────────────┐
│ Worker 0        │   │ Worker 1        │
│ GPU 0           │   │ GPU 1           │
│                 │   │                 │
│ Models:         │   │ Models:         │
│ - PanEcho       │   │ - PanEcho       │
│ - EchoPrime     │   │ - EchoPrime     │
│ - Measurements  │   │ - Measurements  │
│ - EchoNet       │   │ - EchoNet       │
└─────────────────┘   └─────────────────┘
```

**8-Stage Pipeline** (per worker):
1. **Ingest**: Load DICOM study/series, extract frames + metadata
2. **View Classification**: Classify each instance (A4C, PLAX, etc.)
3. **PanEcho Inference**: 39-task predictions per instance, aggregate across study
4. **EchoPrime Inference**: Study-level embeddings + anatomical section predictions
5. **Prediction Fusion**: Merge PanEcho + EchoPrime with conflict resolution
6. **2D Measurements**: Keypoint detection → pixel-to-cm conversion (view-gated)
7. **EchoNet-Dynamic** (optional): LV segmentation + volume/EF curves (A4C only)
8. **Output Normalization**: Convert to overlay-first schema for viewer

**Output**: Interactive overlays (masks, contours, measurement lines) + measurement table + curves + structured report

---

## Configuration Reference

### Model Paths (relative to `AI_HORALIX_AI_MODELS_ROOT`)

```env
AI_HORALIX_AI_PANECHO_WEIGHTS=PanEcho/weights/panecho.pt
AI_HORALIX_AI_ECHOPRIME_ENCODER=EchoPrime/model_data/weights/echo_prime_encoder.pt
AI_HORALIX_AI_ECHOPRIME_TEXT_ENCODER=EchoPrime/model_data/weights/echo_prime_text_encoder.pt
AI_HORALIX_AI_VIEW_CLASSIFIER=EchoPrime/model_data/weights/view_classifier.pt
AI_HORALIX_AI_MEASUREMENTS_DIR=measurements/weights
AI_HORALIX_AI_ECHONET_WEIGHTS=EchonetDynamic/output/segmentation/deeplabv3_resnet50_random/best.pt
```

### Worker Configuration

```env
AI_HORALIX_AI_NUM_WORKERS=2                 # Number of worker processes
AI_HORALIX_AI_PRELOAD=true                  # Load models at startup
AI_HORALIX_AI_WARMUP=false                  # Run warmup inference (slower startup)
AI_HORALIX_AI_JOB_QUEUE_DIR=./job_queue     # Job queue directory
AI_HORALIX_AI_WORKER_TIMEOUT=1800           # Job timeout (seconds)
AI_HORALIX_AI_WORKER_POLL_INTERVAL=1.0      # Job polling interval (seconds)
```

### Feature Flags

```env
AI_HORALIX_AI_ENABLE_ECHONET_DYNAMIC=true   # Enable LV segmentation + EF curves
AI_HORALIX_AI_ENABLE_MEASUREMENTS_2D=true   # Enable anatomical measurements
AI_HORALIX_AI_ENABLE_MEASUREMENTS_DOPPLER=false  # Doppler measurements (Phase 2)
```

### Batch Sizes (adjust for GPU memory)

```env
AI_HORALIX_AI_PANECHO_BATCH=8           # Instances per batch
AI_HORALIX_AI_MEASUREMENTS_BATCH=16     # Frames per batch
AI_HORALIX_AI_ECHONET_BATCH=16          # Frames per batch
AI_HORALIX_AI_ECHOPRIME_BATCH=1         # Study batch size
```

### Optimization

```env
AI_HORALIX_AI_CACHE_ENABLED=true            # Enable caching
AI_HORALIX_AI_CACHE_MAX_SIZE_GB=10          # Cache size limit
AI_HORALIX_AI_MIXED_PRECISION=true          # FP16 for faster inference
AI_HORALIX_AI_DYNAMIC_BATCH_SIZING=false    # Adjust batches based on GPU memory (experimental)
```

---

## Troubleshooting

### Workers Not Starting

**Check GPU Access**:
```bash
docker compose exec backend nvidia-smi
```

If GPUs not visible:
1. Verify NVIDIA Container Toolkit installed in WSL 2
2. Restart Docker Desktop
3. Check `docker-compose.yml` has `deploy.resources.reservations.devices`

**Check Logs**:
```bash
docker compose logs horalix-ai-worker-0 | grep -i error
```

### Models Not Loading

**Common Issue**: Weights path incorrect

**Check**:
```bash
docker compose exec horalix-ai-worker-0 ls -la /app/models/horalix_ai/PanEcho/weights/
```

Expected: Should see `panecho.pt`

**Fix**: Verify volume mount in `docker-compose.yml`:
```yaml
volumes:
  - type: bind
    source: C:/Users/kerim/OneDrive/Desktop/Echocardiology_App/backend/app/AI_models
    target: /app/models/horalix_ai
    read_only: true
```

### Out of Memory (OOM) Errors

**Symptoms**: Worker crashes, CUDA OOM errors in logs

**Solutions**:
1. Reduce batch sizes:
   ```env
   AI_HORALIX_AI_PANECHO_BATCH=4
   AI_HORALIX_AI_MEASUREMENTS_BATCH=8
   AI_HORALIX_AI_ECHONET_BATCH=8
   ```

2. Disable optional models:
   ```env
   AI_HORALIX_AI_ENABLE_ECHONET_DYNAMIC=false
   ```

3. Enable dynamic batching (experimental):
   ```env
   AI_HORALIX_AI_DYNAMIC_BATCH_SIZING=true
   ```

4. Monitor GPU memory:
   ```bash
   watch -n 1 nvidia-smi
   ```

### Slow Inference

**Expected Timings** (per study, 5-10 instances):
- First inference: 30-60 seconds (includes warmup)
- Subsequent inferences: 10-30 seconds (with caching)

**If slower**:
1. Check cache hit rate:
   ```bash
   docker compose logs horalix-ai-worker-0 | grep "cache hit"
   ```

2. Enable mixed precision:
   ```env
   AI_HORALIX_AI_MIXED_PRECISION=true
   ```

3. Increase cache size:
   ```env
   AI_HORALIX_AI_CACHE_MAX_SIZE_GB=20
   ```

### Inference Results Don't Match Echocardiology_App

**Critical**: Preprocessing must be identical

**Validate**:
```bash
python scripts/validate_against_echocardiology.py \
  --study-uid <test_study> \
  --echocardiology-output /path/to/echo_output.json \
  --horalix-output /path/to/horalix_output.json
```

**Common Issues**:
- Normalization values incorrect (check preprocessing modules)
- Frame sampling different (ensure 16 frames for PanEcho, 32 for EchoPrime)
- Coordinate transforms incorrect (validate with known measurements)

---

## Performance Tuning

### Target Performance

- **Inference Time**: < 30 seconds per study
- **Throughput**: > 120 studies/hour (2 GPUs)
- **GPU Utilization**: > 80%
- **Memory**: < 14 GB per worker
- **Cache Hit Rate**: > 50% for repeat studies

### Optimization Checklist

- [x] Models preloaded at startup (`AI_HORALIX_AI_PRELOAD=true`)
- [x] Mixed precision enabled (`AI_HORALIX_AI_MIXED_PRECISION=true`)
- [x] Caching enabled (`AI_HORALIX_AI_CACHE_ENABLED=true`)
- [ ] Batch sizes optimized for GPU memory
- [ ] Frame cache size appropriate for workload
- [ ] Concurrent job limit set (default: 2, one per GPU)

### Benchmarking

```bash
python scripts/benchmark_performance.py \
  --study-uids studies.txt \
  --num-runs 10 \
  --output benchmark_results.json
```

Output:
```
Avg inference time: 18.5 s
Std dev: 3.2 s
Throughput (2 GPUs): 156 studies/hour
GPU utilization: 85%
```

---

## Development

### Running Tests

**Unit Tests**:
```bash
cd backend
pytest tests/test_preprocessing.py -v
pytest tests/test_postprocessing.py -v
pytest tests/test_coordinate_transforms.py -v
```

**Integration Test**:
```bash
pytest tests/test_horalix_ai_integration.py -v
```

### Adding New Measurement Models

1. Add weights to `.../measurements/weights/2D_models/new_model_weights.ckpt`
2. Update `load_all_measurement_models()` in `measurements_loader.py`
3. Add view gating logic in `view_gating.py`
4. Update measurement table schema

### Debugging Worker

**Attach Debugger**:
```python
# Add to worker.py:main()
import debugpy
debugpy.listen(("0.0.0.0", 5678))
debugpy.wait_for_client()
```

**VSCode launch.json**:
```json
{
  "type": "python",
  "request": "attach",
  "connect": {"host": "localhost", "port": 5678},
  "pathMappings": [{"localRoot": "${workspaceFolder}/backend", "remoteRoot": "/app"}]
}
```

---

## Security & Compliance

### PHI Protection

- **Data at Rest**: Enable filesystem encryption (BitLocker/dm-crypt)
- **Data in Transit**: Use HTTPS with TLS 1.3 (configure nginx reverse proxy)
- **Logs**: PHI scrubbing enabled (only DICOM UIDs logged)
- **Access Control**: RBAC for API endpoints (configure in `auth.py`)

### Audit Logging

All AI inference jobs are audited:
```bash
# View audit log
docker compose exec backend cat /app/logs/audit.log
```

Log format:
```json
{
  "timestamp": "2026-02-02T14:32:10Z",
  "event": "inference_submitted",
  "user_id": "user@hospital.org",
  "study_uid": "1.2.840.113619.2.55.3.123456789",
  "job_id": "abc123-def456",
  "model": "horalix_ai"
}
```

### Production Hardening Checklist

- [ ] TLS/HTTPS enabled (nginx with Let's Encrypt)
- [ ] Authentication & authorization (OAuth 2.0 or SAML)
- [ ] Rate limiting (nginx: limit_req_zone)
- [ ] Input validation (Pydantic models)
- [ ] Secrets management (Docker secrets, not .env)
- [ ] Regular updates (Docker base images, Python dependencies)
- [ ] Backup strategy (daily backups, monthly restores tested)
- [ ] Monitoring & alerting (Prometheus + Grafana)

---

## Resources

### Documentation
- [horalix_ai_integration.md](docs/horalix_ai_integration.md) - Complete architecture design (30,000+ words)
- [IMPLEMENTATION_STATUS.md](docs/IMPLEMENTATION_STATUS.md) - Current implementation status + blueprints

### External References
- PanEcho Paper: https://jamanetwork.com/journals/jama/fullarticle/2825896
- EchoPrime Paper: https://www.nature.com/articles/s41586-025-09850-x
- DICOM Standard: https://dicom.nema.org/
- Docker GPU Support: https://docs.docker.com/compose/gpu-support/
- NVIDIA Container Toolkit: https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/

### Support
- Issues: <repo-url>/issues
- Documentation: <repo-url>/wiki
- Email: support@horalix.com

---

## License

[Your License Here]

---

## Acknowledgments

- **PanEcho**: CarDS Lab @ Yale (Gregory Holste, Rohan Khera, et al.)
- **EchoPrime**: Stanford/Yale Collaboration (Eman Alajrami, Matthew Christensen, et al.)
- **EchoNet-Dynamic**: Stanford ML Group (David Ouyang, Jeffrey Zou, et al.)

---

**Status**: Phase 1 - Foundation Complete, Pipeline Implementation In Progress
**Last Updated**: 2026-02-02
