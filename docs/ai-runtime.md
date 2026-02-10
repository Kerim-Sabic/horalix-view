# Horalix AI Runtime

Date: 2026-02-05

## Goals

- Single, deterministic inference pipeline (preload -> warmup -> steady-state)
- Models stay resident; no surprise unloads
- Batched inference for all frames (no sampling)
- Progress tied to real work units
- Explicit GPU affinity and throttling

## Current runtime (Horalix View)

Core components
- `backend/app/services/ai/model_registry.py`:
  - Discovers models and validates weights
  - Preload support
- `backend/app/services/ai/horalix_ai/worker.py`:
  - Queue-driven worker
  - 8-stage pipeline

Pipeline (current)
1) Ingest frames
2) View classification (EchoPrime view classifier)
3) PanEcho
4) EchoPrime + fused metrics
5) Measurements (DeepLabV3 keypoints) - batched per frame
6) EchoNet-Dynamic (LV contour + EF curve)
7) Normalize output (overlays + report)
8) Emit results

## Required parity with Echocardiology_App

- PanEcho
  - Use 16 frames per instance, 224x224, ImageNet normalization
  - Batch size from config (panecho)
- EchoPrime
  - `process_dicoms -> encode_study -> predict_metrics`
  - `get_views` for per-instance view labels
- Measurements
  - 640x480 resize; BGR->RGB
  - Batched inference across ALL frames
  - Model cache keyed by weights
- EchoNet-Dynamic
  - 112x112 input, batched inference, contour extraction
  - Only for A4C/A2C view families

## Runtime responsibilities

- Model residency
  - preload all available models at startup when `settings.ai.auto_load_models` is true
  - warmup optional per model
  - explicit shutdown: clear caches

- Execution
  - job queue with cancellation + timeouts
  - GPU-aware distribution (round-robin + memory throttle)
  - progress callbacks per stage

- Output
  - overlays contain target instance + frame index
  - measurements include frame + instance UID
  - report generated deterministically from findings

## Near-term refactor plan

- Split `worker.py` into:
  - `runtime/worker.py` (orchestration)
  - `models/` (loaders + caches)
  - `pipeline/` (pre/post processors)
  - `metrics/` (timing + progress)

- Add model manifest + checksum validation
- Add benchmark harness (already in `scripts/benchmark_horalix_ai.py`)

