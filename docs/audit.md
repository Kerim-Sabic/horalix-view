# Horalix View Audit (Phase 0)

Date: 2026-02-05
Scope: backend, frontend, models, docs

## Repo entry points

Backend
- App entry: `backend/app/main.py` (FastAPI lifecycle, DI, model registry preload, storage init)
- API router: `backend/app/api/v1/router.py`
- AI entry points: `backend/app/api/v1/endpoints/ai.py`, `backend/app/services/ai/model_registry.py`, `backend/app/services/ai/horalix_ai/worker.py`
- DICOM IO: `backend/app/api/v1/endpoints/studies.py`, `backend/app/api/v1/endpoints/instances.py`, `backend/app/services/dicom/storage.py`
- Export: `backend/app/services/dicom/export.py`

Frontend
- App entry: `frontend/src/main.tsx`
- Router/layout: `frontend/src/App.tsx`
- Viewer core: `frontend/src/pages/ViewerPage.tsx`
- AI results UI: `frontend/src/features/viewer/components/AIResultsPanel/AIResultsPanel.tsx`
- Measurements: `frontend/src/features/viewer/hooks/useMeasurementStore.ts`
- Segmentation overlays: `frontend/src/features/viewer/hooks/useSegmentationStore.ts`
- Export UI/logic: `frontend/src/features/viewer/services/exportService.ts`

## Top 10 largest source files (by size)

1) `frontend/src/pages/ViewerPage.tsx` (334 KB) - monolithic viewer logic (cine, overlays, tools, IO)
2) `models/horalix_ai/PanEcho/src/utils.py` (159 KB) - model training + utilities (likely not runtime)
3) `docs/horalix_ai_integration.md` (100 KB) - large doc, overlaps with other AI docs
4) `backend/app/services/ai/horalix_ai/worker.py` (93 KB) - full inference pipeline in one file
5) `backend/app/api/v1/endpoints/ai.py` (53 KB) - AI endpoints + utilities
6) `frontend/src/features/viewer/components/AIResultsPanel/AIResultsPanel.tsx` (52 KB) - large UI rendering logic
7) `backend/app/services/dicom/export.py` (41 KB) - SR/SEG export; needs modularization
8) `frontend/src/services/api.ts` (39 KB) - API types + client
9) `frontend/src/features/viewer/hooks/useMeasurementStore.ts` (32 KB) - measurement state + tracking
10) `backend/app/api/v1/endpoints/studies.py` (32 KB) - upload + listing + metadata updates

## Primary complexity sources

- Viewer monolith: `frontend/src/pages/ViewerPage.tsx` mixes state, IO, UI, caching, and tools.
- AI worker monolith: `backend/app/services/ai/horalix_ai/worker.py` mixes model loading, batching, inference, post-processing.
- Export pipeline: `backend/app/services/dicom/export.py` includes many responsibilities (SR/SEG/packaging).
- Measurement stores: `frontend/src/features/viewer/hooks/useMeasurementStore.ts`, `useSegmentationStore.ts` contain both domain and UI logic.

## Dead code / duplication candidates (needs verification)

- Model training utilities in `models/horalix_ai/PanEcho/src/*` and `models/horalix_ai/measurements/*` (training/inference scripts not used by runtime).
- Duplicate AI integration docs: `docs/horalix_ai_integration.md` and `docs/HORALIX_AI_INTEGRATION_COMPLETE.md`.
- Deprecated/unused components in `frontend/src/features/viewer/components` if not referenced from `ViewerPage.tsx` or `MPRLayout`.
- Legacy API endpoints in `backend/app/api/v1/endpoints` not called by frontend (requires request trace / usage map).

## Initial refactor milestones (strangler)

1) Viewer split:
   - Extract domain types + invariants (`frontend/src/features/viewer/domain/*`)
   - Extract cine engine + frame cache (`frontend/src/features/viewer/app/cine/*`)
   - Extract DICOM IO + decode (`frontend/src/features/viewer/infra/dicom/*`)
   - Extract overlay rendering (`frontend/src/features/viewer/ui/overlays/*`)
   - Extract tool controllers (`frontend/src/features/viewer/app/tools/*`)

2) AI worker split:
   - Model loading and cache (`backend/app/services/ai/horalix_ai/models/*`)
   - Pre/post-processors (`backend/app/services/ai/horalix_ai/pipeline/*`)
   - Pipeline orchestration (`backend/app/services/ai/horalix_ai/runtime/*`)

3) Export split:
   - SR builder, SEG builder, PR/GSPS builder, package builder

## Blocking issues to validate next

- Measurements persist but overlays do not render after return (state hydration + coordinate mapping).
- Imported measurements appear but do not render (scope/series mismatch).
- Cine switching latency (prefetch and decode pipeline).
- AI progress stalls at 68% (measurements stage batching + watchdog).

## Immediate audit tasks completed

- Located viewer/AI/export entry points.
- Confirmed monolith files and size distribution.
- Located AI runtime components and current pipeline integration.

Next: Phase 0.2 - Echocardiology_App reverse engineering mapping.
