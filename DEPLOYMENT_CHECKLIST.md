# Horalix AI - Deployment Checklist ✅

Use this checklist to verify everything is ready before deploying Horalix AI to production.

---

## Pre-Deployment Validation

### 1. System Requirements ✅

- [x] **Hardware**:
  - [x] 2× NVIDIA RTX 5080 GPUs (24 GB each)
  - [x] 128 GB RAM
  - [x] Windows 11 with WSL 2

- [x] **Software**:
  - [x] Docker Desktop with WSL 2 backend
  - [x] NVIDIA Container Toolkit
  - [x] Python 3.10+ (for validation scripts)

### 2. Model Weights Validated ✅

Run validation:
```bash
python scripts/validate_horalix_ai_setup.py
```

**Expected**: All [OK] checkmarks

**Weights inventory**:
- [x] **PanEcho**: 481.7 MB (`PanEcho/weights/panecho.pt`)
- [x] **EchoPrime Encoder**: 132.2 MB (`EchoPrime/model_data/weights/echo_prime_encoder.pt`)
- [x] **EchoPrime Text Encoder**: 419.3 MB (`EchoPrime/model_data/weights/echo_prime_text_encoder.pt`)
- [x] **View Classifier**: 334.2 MB (`EchoPrime/model_data/weights/view_classifier.pt`)
- [x] **9 Measurement Models**: 9 × 151.5 MB = 1364 MB (`measurements/weights/2D_models/`)
  - [x] IVS
  - [x] LVID
  - [x] LVPW
  - [x] Aorta
  - [x] Aortic Root
  - [x] LA
  - [x] RV Base
  - [x] PA
  - [x] IVC
- [x] **EchoNet-Dynamic**: 320.8 MB (`EchonetDynamic/output/segmentation/deeplabv3_resnet50_random/best.pt`)

**Total weights size**: ~3.0 GB

### 3. Configuration Files ✅

- [x] `.env` file exists with:
  ```bash
  HORALIX_AI_MODELS_HOST_PATH=C:/Users/kerim/OneDrive/Desktop/Echocardiology_App/backend/app/AI_models
  AI_HORALIX_AI_PRELOAD=true
  AI_HORALIX_AI_NUM_WORKERS=2
  AI_HORALIX_AI_ENABLE_ECHONET_DYNAMIC=true
  AI_HORALIX_AI_ENABLE_MEASUREMENTS_2D=true
  SECRET_KEY=<secure-key>
  ```

- [x] `docker-compose.yml` has worker services:
  - [x] `horalix-ai-worker-0` (GPU 0)
  - [x] `horalix-ai-worker-1` (GPU 1)
  - [x] `horalix-ai-job-queue` volume

### 4. Docker Environment ✅

Check Docker:
```bash
docker info
```

Verify NVIDIA runtime:
```bash
docker run --rm --gpus all nvidia/cuda:12.4.0-base-ubuntu22.04 nvidia-smi
```

**Expected**: GPU info displayed

---

## Deployment Steps

### Step 1: Start Services

```bash
cd docker
docker-compose up -d
```

**Verify all containers started**:
```bash
docker-compose ps
```

Expected 6 containers running:
- [ ] `backend` (Up, healthy after 60s)
- [ ] `horalix-ai-worker-0` (Up)
- [ ] `horalix-ai-worker-1` (Up)
- [ ] `postgres` (Up, healthy)
- [ ] `redis` (Up, healthy)
- [ ] `frontend` (Up)

### Step 2: Monitor Model Loading (35 seconds)

```bash
docker-compose logs -f horalix-ai-worker-0 horalix-ai-worker-1
```

**Checkpoints** (per worker):
- [ ] `Worker N initialized on device cuda:N`
- [ ] `Loading PanEcho...`
- [ ] `PanEcho model loaded successfully`
- [ ] `Loading EchoPrime...`
- [ ] `EchoPrime encoder loaded`
- [ ] `View classifier loaded`
- [ ] `Loading Measurements models...`
- [ ] `Loaded 9 measurement models`
- [ ] `Loading EchoNet-Dynamic...`
- [ ] `EchoNet model loaded`
- [ ] `Worker N: All models loaded successfully`
- [ ] `GPU N: XX.X GB allocated, XX.X GB reserved`
- [ ] `Worker N: Ready for jobs`

**GPU Memory Check**:
```bash
docker exec horalix-ai-worker-0 nvidia-smi
```

Expected: ~18-20 GB used per GPU

### Step 3: Verify Model Registration

```bash
curl http://localhost:8000/api/v1/ai/models
```

**Check response includes**:
- [ ] `"name": "horalix_ai"`
- [ ] `"version": "1.0.0"`
- [ ] `"model_type": "cardiac"`
- [ ] `"requires_gpu": true`

### Step 4: Frontend Access

Open browser:
- [ ] `http://localhost:3000` - Frontend loads
- [ ] `http://localhost:8000` - Backend responds
- [ ] `http://localhost:8000/docs` - API docs accessible

---

## Smoke Tests

### Test 1: Upload DICOM Study

- [ ] Upload test echo study via frontend
- [ ] Study appears in study list
- [ ] Can view study in viewer

### Test 2: AI Inference

**Via Frontend**:
- [ ] Click "AI Analysis" in viewer
- [ ] Select "Horalix AI" model
- [ ] Job submits successfully
- [ ] Job status updates (PENDING → RUNNING → COMPLETED)
- [ ] Results appear (~30-60 seconds)
- [ ] Overlays render:
  - [ ] Green measurement lines visible
  - [ ] Red LV segmentation masks visible
  - [ ] EF curve displayed
  - [ ] Can toggle overlays on/off

**Via API**:
```bash
# Submit job
curl -X POST http://localhost:8000/api/v1/ai/infer \
  -H "Content-Type: application/json" \
  -d '{
    "study_uid": "<test-study-uid>",
    "model_name": "horalix_ai",
    "enable_echonet": true,
    "enable_measurements": true
  }'
```

- [ ] Job ID returned
- [ ] Job completes within 60 seconds
- [ ] Results contain:
  - [ ] `overlays` array with LineOverlay and MaskOverlay
  - [ ] `measurements` array with MeasurementRecord
  - [ ] `curves` array with CurveData (EF curve)
  - [ ] `findings` dict with PanEcho/EchoPrime results

### Test 3: Concurrent Inference

Submit 2 jobs simultaneously:
- [ ] Both jobs accepted
- [ ] Both jobs complete (may use different GPUs)
- [ ] Results are correct for each study

---

## Performance Validation

### Model Load Time
- [ ] Workers load models in <60 seconds
- [ ] No errors in logs

### Inference Time (Single Study)
- [ ] A4C view: 30-60 seconds
- [ ] PLAX view: 30-60 seconds
- [ ] Multi-series study: <2 minutes

### GPU Memory
- [ ] Worker 0: 18-20 GB / 24 GB
- [ ] Worker 1: 18-20 GB / 24 GB
- [ ] No OOM errors

### Throughput
- [ ] Can process 2 studies concurrently (1 per worker)
- [ ] Total throughput: ~120-240 studies/hour

---

## Production Readiness

### Security
- [ ] `SECRET_KEY` set to secure random value (not default)
- [ ] CORS configured for production domains
- [ ] HTTPS enabled (if production)
- [ ] Authentication enabled

### Monitoring
- [ ] Can view logs: `docker-compose logs -f`
- [ ] GPU monitoring works: `nvidia-smi`
- [ ] Health checks passing: `curl http://localhost:8000/health`

### Backup
- [ ] DICOM storage volume backed up
- [ ] Postgres data backed up
- [ ] Configuration files in version control

### Documentation
- [ ] Team trained on system usage
- [ ] Deployment guide available
- [ ] Troubleshooting procedures documented

---

## Rollback Plan

If deployment fails:

1. **Check logs**:
   ```bash
   docker-compose logs --tail 100
   ```

2. **Stop services**:
   ```bash
   docker-compose down
   ```

3. **Preserve data** (keeps volumes):
   - Volumes preserved by default with `docker-compose down`
   - DICOM storage: `/app/storage` volume
   - Database: `postgres-data` volume

4. **Investigate issues**:
   - Review worker logs for model loading errors
   - Check GPU availability
   - Verify weights paths

5. **Restart with fixes**:
   ```bash
   docker-compose up -d
   ```

---

## Post-Deployment Monitoring

### First 24 Hours

Monitor:
- [ ] Worker uptime (no crashes)
- [ ] Inference success rate (>95%)
- [ ] Average inference time (<60s)
- [ ] GPU memory stable (no leaks)
- [ ] Job queue not backing up

Check logs hourly:
```bash
docker-compose logs --since 1h horalix-ai-worker-0 horalix-ai-worker-1
```

### First Week

- [ ] No memory leaks detected
- [ ] No model loading failures
- [ ] Inference results validated against test dataset
- [ ] Performance meets expectations

---

## Acceptance Criteria ✅

All criteria from integration task:

- [x] **Models load at startup**: Workers preload all 4 models
- [x] **2-GPU concurrency**: 2 isolated worker containers, 1 per GPU
- [x] **Overlay-first output**: Full schema with MaskOverlay, LineOverlay, MeasurementRecord, CurveData
- [x] **Exact preprocessing**: ImageNet norm for PanEcho, custom norm for EchoPrime
- [x] **Coordinate transforms**: Bidirectional transforms with TransformMetadata
- [x] **DICOM integration**: Uses DicomLoader with proper metadata extraction
- [x] **Docker deployment**: docker-compose.yml with GPU support
- [x] **Documentation**: 4 comprehensive docs + README + QUICK_START

---

## Sign-Off

**Deployment Date**: _____________

**Deployed By**: _____________

**Validated By**: _____________

**Production-Ready**: ✅ / ❌

**Notes**:
_______________________________________________
_______________________________________________
_______________________________________________

---

## Quick Reference

**Start services**:
```bash
scripts\start_horalix_ai.bat
```

**Validate setup**:
```bash
python scripts/validate_horalix_ai_setup.py
```

**View logs**:
```bash
docker-compose logs -f horalix-ai-worker-0 horalix-ai-worker-1
```

**Stop services**:
```bash
docker-compose down
```

**GPU status**:
```bash
docker exec horalix-ai-worker-0 nvidia-smi
```

**Model registry**:
```bash
curl http://localhost:8000/api/v1/ai/models
```

---

**System Status**: 🟢 Ready for Deployment

All weights validated, configuration complete, and setup scripts ready. Run `scripts\start_horalix_ai.bat` to begin!
