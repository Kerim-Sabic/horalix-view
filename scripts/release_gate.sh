#!/usr/bin/env bash
set -euo pipefail

echo "== Backend checks =="
pushd backend >/dev/null
python -m black --check app tests
python -m ruff check app tests
python -m mypy app --ignore-missing-imports
python -m pytest -v
popd >/dev/null

echo "== Frontend checks =="
pushd frontend >/dev/null
npm run lint
npm run format:check
npm run type-check
npm run type-coverage:viewer
npm run deps:check
npm run deadcode:check
npm test -- --coverage
npm run build
popd >/dev/null
