# Quality Scorecard (Enforced)

This scorecard defines hard quality gates for Horalix View. Gates are enforced in CI and via `scripts/release_gate.*`.

## Type Safety
- TypeScript strict mode: **ON** (`tsconfig.json`).
- **No new `any`** in viewer core (`src/features/viewer/**`): enforced by ESLint.
- **No `@ts-ignore`** in viewer core: enforced by ESLint.
- **Type coverage**: enforced with `type-coverage` on viewer core.
  - Current enforced baseline: **>= 98%** for `src/features/viewer/**`.
  - Long-term target: **>= 98%** for all `src/**` (tracked in `docs/architecture.md`).

## Lint + Formatting
- ESLint: **zero warnings**.
- Prettier: enforced via `npm run format:check`.
- Import order: enforced via `simple-import-sort`.
- Unused exports: detected via `ts-prune` (fails CI if any are found).

## Complexity Gates (viewer core)
Enforced for `src/features/viewer/**`:
- Function length ≤ 60 LOC (`max-lines-per-function`).
- Nesting depth ≤ 3 (`max-depth`).
- Cyclomatic complexity ≤ 12 (`complexity`).
- File length ≤ 300 LOC for new/modified modules (review gate).

## Architecture Governance
Enforced via ESLint `no-restricted-imports`:
- `domain/**` cannot import `app/`, `infra/`, or `ui/`.
- `app/**` cannot import `ui/`.
- `ui/**` cannot import `infra/`.

Circular dependencies are **disallowed** and enforced via `dependency-cruiser`.

## Tests
- Frontend unit/integration tests: `npm test -- --coverage`.
- Backend unit/integration tests: `pytest` with coverage.
- Mutation testing proxy: targeted invariant tests in geometry/tracking modules (tracked in `docs/qa.md`).

## Performance Budgets (baseline)
- Cine playback: ≥ 24 FPS on 60-frame loop (GPU) / ≥ 15 FPS (CPU).
- Overlay render: ≤ 8 ms per frame.
- Tracking update: ≤ 10 ms per frame on viewer core.

Measured via `scripts/perf_viewer_gate.*` (to be added).

## Security
- `npm audit --audit-level=high` (fails CI on high/critical).
- `pip-audit` (fails CI on high/critical).
- Secret scanning: `gitleaks` CI job.

## How to Run Locally
From repo root:
1) `scripts/release_gate.ps1` (Windows) or `scripts/release_gate.sh`
2) `npm -C frontend run lint`
3) `npm -C frontend run type-coverage:viewer`
4) `npm -C frontend run deps:check`
5) `npm -C frontend run deadcode:check`

## Exceptions
Legacy modules outside `src/features/viewer/**` are grandfathered for strict no-`any` rules until refactor milestones land.
All new/modified viewer core modules must pass the full scorecard.
