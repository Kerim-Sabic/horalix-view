# Horalix View Architecture

Date: 2026-02-05

## Module Map (Target)

Frontend (`frontend/src/features/viewer`)
- `domain/` Pure types, invariants, geometry, and deterministic helpers.
- `app/` Orchestration and use-cases (cine engine, tool controllers, state machines).
- `infra/` IO + adapters (DICOM fetch/decode, storage, AI runtime client, export wiring).
- `ui/` React components (panels, toolbars, overlays, viewports).
- `tests/` Unit/integration tests for domain + app logic.

Backend (`backend/app`)
- `services/ai/horalix_ai/` Runtime pipeline and model orchestration.
- `services/dicom/` Storage + export services.
- `api/v1/` REST endpoints and orchestration.

## Boundary Rules

- `domain` must not import from `app`, `infra`, or `ui`.
- `app` may import `domain` and `infra`, never `ui`.
- `ui` depends on `app` and `domain` only.
- `infra` depends on `domain` only.

ESLint boundary rules are applied to new viewer modules. Legacy files will be migrated incrementally.

## Viewer Core (Target)

- Cine Engine: frame index, prefetch, decode, and playback scheduling.
- Measurements: legacy map adapters + render/interaction + hit-testing/selection (`app/measurements/*`) for lines/polygons.
- Overlay Engine: measurement + segmentation overlays with consistent coordinate mapping.
- Tooling: measurement creation/editing, polygon tracking, and persistence.
- Export: SR + SEG + optional PR/GSPS via backend export service.

## AI Runtime (Target)

- Model registry + preload lifecycle (load -> warmup -> steady-state -> shutdown).
- Batched inference for all frames (no sampling).
- Deterministic progress reporting per pipeline stage.
- Output normalized to overlay-first schema (instance_uid + frame index).

## Refactor Strategy

- Strangler: extract one subsystem at a time.
- Keep adapters until old paths are replaced.
- Ensure CI stays green after each extraction.
