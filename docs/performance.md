# Performance Budgets & Profiling

Date: 2026-02-05

## Targets

AI
- Cold start (preload + warmup): < 60s on target GPU
- Warm run (no reload): < 5s overhead
- PanEcho + EchoPrime: ~12s baseline (reference)
- EchoNet Measurements + Dynamic: ~40s baseline (reference)

Viewer
- Cine switch: < 100ms for cached frames
- Decode budget: < 16ms/frame for 60 FPS target (accept 30 FPS on large studies)
- UI thread blocking: no > 50ms blocks during playback

## Instrumentation

Frontend
- Frame decode time (per frame and avg)
- Cine FPS and slow frame percent
- Cache hit/miss rates

Backend
- Model load time per model
- Per-stage inference time
- End-to-end job time
- Queue depth and GPU utilization

## Profiling Plan

- Use existing `scripts/benchmark_horalix_ai.py` for AI timing.
- Add viewer perf logger (already partially present) to emit decode + FPS stats.
- Record before/after budgets for each refactor milestone.
