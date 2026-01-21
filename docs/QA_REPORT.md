# QA Report - Horalix View

**Report Generated**: 2026-01-21
**Report Status**: In Progress
**QA Engineer**: Claude (Principal Engineer + QA Director)

---

## Phase 0: Forensic Inventory

### Project Type
- **Type**: Multi-service web application (monorepo)
- **Architecture**: Microservices with Docker Compose orchestration
- **Components**:
  - Frontend: React 18 + TypeScript + Vite
  - Backend: FastAPI (Python 3.10-3.12)
  - Database: PostgreSQL 14+
  - Cache: Redis 7+
  - Infrastructure: Docker + Docker Compose

### Execution Matrix

| Attribute | Value |
|-----------|-------|
| Supported OS | Linux, macOS, Windows (with WSL2 for Redis) |
| Node.js | >=18.0.0 (per `engines` in package.json) |
| Python | 3.10, 3.11, 3.12 (per pyproject.toml) |
| PostgreSQL | 14+ |
| Redis | 7+ |
| Docker | 24.0+ |
| Docker Compose | 2.0+ |
| Package Manager (Frontend) | npm |
| Package Manager (Backend) | pip with pyproject.toml |

### Repo Map

| Directory | Purpose | Key Files |
|-----------|---------|-----------|
| `/` | Root config | `.env.example`, `README.md`, `.gitignore` |
| `/frontend` | React TypeScript app | `package.json`, `vite.config.ts`, `tsconfig.json` |
| `/frontend/src` | Frontend source | `App.tsx`, `main.tsx`, components, pages, services |
| `/frontend/docker` | Frontend Docker config | `nginx.conf` |
| `/backend` | FastAPI Python app | `pyproject.toml`, `setup.sh`, `alembic.ini` |
| `/backend/app` | Backend source | `main.py`, `cli.py`, api, models, services, core |
| `/backend/tests` | Backend tests | `unit/`, `services/ai/`, `api/` |
| `/backend/alembic` | DB migrations | `versions/` with 2 migrations |
| `/docker` | Docker Compose setup | `docker-compose.yml`, `Dockerfile.backend`, `Dockerfile.frontend`, `entrypoint.sh` |
| `/scripts` | Utility scripts | `smoke-test.sh`, `smoke-test.ps1` |
| `/.github/workflows` | CI/CD | `ci.yml` |

### Critical Files Catalog

| Category | Files |
|----------|-------|
| Package Manifests | `frontend/package.json`, `backend/pyproject.toml` |
| Lockfiles | **MISSING**: No `package-lock.json` (gitignored!) |
| Build Config | `vite.config.ts`, `tsconfig.json`, `tsconfig.node.json` |
| Env Examples | `.env.example`, `backend/.env.example`, `docker/.env.example` |
| Docker | `docker-compose.yml`, `Dockerfile.backend`, `Dockerfile.frontend` |
| CI Workflows | `.github/workflows/ci.yml` |
| Test Config | `pyproject.toml` (pytest config) |
| Lint Config | `pyproject.toml` (ruff, black, mypy) - **MISSING eslint.config.js for frontend** |

---

## Issues Found During Forensic Inventory

| ID | Category | Severity | Issue | Root Cause |
|----|----------|----------|-------|------------|
| INV-001 | Reproducibility | HIGH | `package-lock.json` is gitignored | Line 78 in `.gitignore` |
| INV-002 | Reproducibility | MEDIUM | No `.nvmrc` or `.python-version` files | Missing version pinning files |
| INV-003 | Lint Config | MEDIUM | No ESLint config file in frontend root | Missing `.eslintrc.cjs` or `eslint.config.js` |
| INV-004 | Test Config | LOW | No `conftest.py` for pytest fixtures | Missing shared test fixtures |
| INV-005 | Port Mismatch | LOW | Vite dev server uses port 3000, same as Docker frontend | Potential confusion during development |
| INV-006 | CI Coverage | MEDIUM | CI doesn't run smoke tests or E2E | Missing E2E test stage |

---

## Phase 1-10: Execution Status

### G1: Install (Reproducibility)
- [ ] Pin Node.js version with `.nvmrc`
- [ ] Pin Python version with `.python-version`
- [ ] Remove `package-lock.json` from `.gitignore`
- [ ] Generate and commit `package-lock.json`
- [ ] Verify backend `pip install -e .` works

### G2: Lint
- [ ] Frontend: Create ESLint config file
- [ ] Frontend: Run `npm run lint`
- [ ] Backend: Run `ruff check app tests`
- [ ] Backend: Run `black --check app tests`

### G3: Typecheck
- [ ] Frontend: Run `npm run type-check`
- [ ] Backend: Run `mypy app`

### G4: Unit Tests
- [ ] Backend: Run `pytest`
- [ ] Frontend: Run `npm test`

### G5: Build
- [ ] Frontend: Run `npm run build`
- [ ] Backend: (no separate build step - Python)

### G6: Runtime (Dev + Prod)
- [ ] Backend: Run `uvicorn app.main:app`
- [ ] Frontend: Run `npm run dev`
- [ ] Docker: Run `docker compose up`

### G7: E2E Smoke
- [ ] Run `/scripts/smoke-test.sh`
- [ ] Add Playwright for browser E2E

### G8: Security
- [ ] Run `npm audit`
- [ ] Run `pip-audit`
- [ ] Check for committed secrets
- [ ] Review CORS settings

### G9: CI Parity
- [ ] Create doctor script
- [ ] Update CI to use doctor script

### G10: Documentation
- [ ] Update README.md
- [ ] Create ARCHITECTURE.md
- [ ] Create RUNBOOK.md
- [ ] Create TROUBLESHOOTING.md
- [ ] Create SECURITY.md
- [ ] Create ADRs

---

## Detailed Fix Log

(Will be populated as fixes are applied)

| Timestamp | Issue ID | Fix Applied | Files Changed | Verification |
|-----------|----------|-------------|---------------|--------------|
| | | | | |

---

## Risk Acceptance Log

(For issues that cannot be fixed and require formal risk acceptance)

| Issue ID | Risk Description | Mitigation | Accepted By | Date |
|----------|------------------|------------|-------------|------|
| | | | | |

---

## Final Verification Checklist

- [ ] All gates (G1-G10) pass
- [ ] Doctor script runs without errors
- [ ] CI pipeline passes
- [ ] README instructions work on fresh clone
- [ ] No security vulnerabilities
- [ ] All documentation complete
