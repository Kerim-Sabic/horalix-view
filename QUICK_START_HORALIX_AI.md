# Horalix AI - Quick Start Guide

Use this guide for first-time Docker startup of Horalix View + Horalix AI.

## Canonical Files
- Docker startup env: `./.env`
- Optional Docker-local env template: `./docker/.env.example`
- Local non-Docker backend env: `./backend/.env`

For Docker startup commands below, use `./.env` only.

## 1. Configure `./.env`

From repo root:

```powershell
Copy-Item .env.example .env
```

Generate a `SECRET_KEY`:

```powershell
python -c "import secrets; print(secrets.token_hex(32))"
```

Edit `./.env` and set at least:

```env
SECRET_KEY=<paste-generated-value>
HORALIX_AI_MODELS_HOST_PATH=../models/horalix_ai
AI_HORALIX_AI_PRELOAD=true
```

Choose one GPU profile in `./.env`:

```env
# Single GPU
AI_DEVICE=cuda:0
TORCH_INDEX_URL=https://download.pytorch.org/whl/cu124
NVIDIA_VISIBLE_DEVICES=all
CUDA_VISIBLE_DEVICES=0
WORKER_0_GPU_COUNT=1
AI_HORALIX_AI_NUM_WORKERS=1
```

```env
# Dual GPU (2x GPU host)
AI_DEVICE=cuda:0
TORCH_INDEX_URL=https://download.pytorch.org/whl/cu124
NVIDIA_VISIBLE_DEVICES=all
CUDA_VISIBLE_DEVICES=0,1
WORKER_0_GPU_COUNT=1
AI_HORALIX_AI_NUM_WORKERS=2
```

```env
# CPU only
AI_DEVICE=cpu
TORCH_INDEX_URL=https://download.pytorch.org/whl/cpu
NVIDIA_VISIBLE_DEVICES=void
CUDA_VISIBLE_DEVICES=
WORKER_0_GPU_COUNT=0
AI_HORALIX_AI_NUM_WORKERS=1
```

## 2. Validate Paths and Weights

From repo root:

```powershell
python scripts/validate_horalix_ai_setup.py
```

## 3. Start Services (Run from Repo Root)

CPU or single GPU:

```powershell
docker compose --env-file ./.env -f docker/docker-compose.yml up -d --build
```

Dual GPU (worker-0 + worker-1):

```powershell
docker compose --env-file ./.env -f docker/docker-compose.yml --profile gpu up -d --build
```

## 4. Verify Startup

```powershell
docker compose --env-file ./.env -f docker/docker-compose.yml ps
```

```powershell
docker compose --env-file ./.env -f docker/docker-compose.yml logs --tail=120 horalix-ai-worker-0
```

If dual GPU:

```powershell
docker compose --env-file ./.env -f docker/docker-compose.yml --profile gpu logs --tail=120 horalix-ai-worker-1
```

Run smoke test:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/smoke-test.ps1
```

## 5. Access
- Frontend: http://localhost:3000
- Backend: http://localhost:8000
- API docs: http://localhost:8000/docs

## 6. Stop / Reset

Stop services:

```powershell
docker compose --env-file ./.env -f docker/docker-compose.yml down --remove-orphans
```

Full reset (removes volumes, including DB data):

```powershell
docker compose --env-file ./.env -f docker/docker-compose.yml down -v --remove-orphans
```

## Common First-Run Issues
- `unknown device` for GPU 1: you are on single GPU; do not use `--profile gpu`.
- `MODEL_NAME variable is not set` warning: use current repo config and `--env-file ./.env` command shown above.
- Apt package fetch failures during build: retry build; current Dockerfile uses HTTPS + retries.

