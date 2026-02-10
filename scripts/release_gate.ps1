$ErrorActionPreference = 'Stop'

Write-Host '== Backend checks ==' -ForegroundColor Cyan
Push-Location backend
python -m black --check app tests
python -m ruff check app tests
python -m mypy app --ignore-missing-imports
python -m pytest -v
Pop-Location

Write-Host '== Frontend checks ==' -ForegroundColor Cyan
Push-Location frontend
npm run lint
npm run format:check
npm run type-check
npm run type-coverage:viewer
npm run deps:check
npm run deadcode:check
npm test -- --coverage
npm run build
Pop-Location
