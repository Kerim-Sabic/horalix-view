#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE="all"

usage() {
  cat <<'EOF'
Usage: ./scripts/doctor.sh [--all|--quick|--check-env]

  --all        Run full pipeline (default)
  --quick      Skip Docker + Playwright checks
  --check-env  Only verify required tooling
EOF
}

check_cmd() {
  local cmd="$1"
  local label="$2"
  local required="$3"
  if command -v "$cmd" >/dev/null 2>&1; then
    echo "[OK] ${label}"
    return 0
  fi
  if [[ "$required" == "required" ]]; then
    echo "[MISSING] ${label}"
    return 1
  fi
  echo "[WARN] ${label} (optional)"
  return 0
}

has_docker_compose() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    return 0
  fi
  if command -v docker-compose >/dev/null 2>&1; then
    return 0
  fi
  return 1
}

docker_compose() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    docker compose "$@"
    return
  fi
  if command -v docker-compose >/dev/null 2>&1; then
    docker-compose "$@"
    return
  fi
  echo "docker compose is not available" >&2
  return 1
}

check_env() {
  local require_docker="$1"
  local missing=0

  check_cmd "python" "python" "required" || missing=1
  check_cmd "node" "node" "required" || missing=1
  check_cmd "npm" "npm" "required" || missing=1
  check_cmd "curl" "curl" "required" || missing=1

  if [[ "$require_docker" == "required" ]]; then
    check_cmd "docker" "docker" "required" || missing=1
    if has_docker_compose; then
      echo "[OK] docker compose"
    else
      echo "[MISSING] docker compose"
      missing=1
    fi
  else
    check_cmd "docker" "docker" "optional"
    if has_docker_compose; then
      echo "[OK] docker compose"
    else
      echo "[WARN] docker compose (optional)"
    fi
  fi

  return "$missing"
}

for arg in "$@"; do
  case "$arg" in
    --all)
      MODE="all"
      ;;
    --quick)
      MODE="quick"
      ;;
    --check-env)
      MODE="check-env"
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $arg"
      usage
      exit 1
      ;;
  esac
done

echo "== Environment check =="
if [[ "$MODE" == "check-env" ]]; then
  check_env "optional"
  exit $?
fi

if [[ "$MODE" == "all" ]]; then
  check_env "required"
else
  check_env "optional"
fi

echo "== Backend lint and tests =="
cd "$ROOT_DIR/backend"
python -m pip install -e ".[dev]"
black --check app tests
ruff check app tests
mypy app --ignore-missing-imports
python -m pytest -v

echo "== Frontend lint, typecheck, and tests =="
cd "$ROOT_DIR/frontend"
npm ci
npm run lint
npm run type-check
npm test

if [[ "$MODE" == "quick" ]]; then
  exit 0
fi

echo "== Start Docker stack =="
cd "$ROOT_DIR"
docker_compose -f docker/docker-compose.yml up -d --build

cleanup() {
  docker_compose -f docker/docker-compose.yml down
}
trap cleanup EXIT

echo "== Wait for backend =="
for _ in {1..60}; do
  if curl -fsS "http://localhost:8000/health" > /dev/null; then
    break
  fi
  sleep 2
done

echo "== Wait for frontend =="
for _ in {1..60}; do
  if curl -fsS "http://localhost:3000" > /dev/null; then
    break
  fi
  sleep 2
done

TOKEN="$(curl -fsS -X POST -d "username=admin&password=admin123" \
  "http://localhost:8000/api/v1/auth/token" | \
  python -c "import sys, json; print(json.load(sys.stdin).get('access_token', ''))")"

if [[ -z "$TOKEN" ]]; then
  echo "Failed to obtain auth token"
  exit 1
fi

echo "== Smoke API checks =="
curl -fsS -H "Authorization: Bearer ${TOKEN}" "http://localhost:8000/api/v1/dashboard/stats" > /dev/null
curl -fsS -H "Authorization: Bearer ${TOKEN}" "http://localhost:8000/api/v1/ai/models" > /dev/null

echo "== Playwright E2E =="
cd "$ROOT_DIR/e2e"
npm ci
npx playwright install --with-deps
BASE_URL="http://localhost:3000" npx playwright test
