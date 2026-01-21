#!/usr/bin/env bash
#
# doctor.sh - Horalix View Health Check Script
#
# This script runs all quality checks for the Horalix View application.
# It verifies that the codebase is in a healthy, production-ready state.
#
# Usage:
#   ./scripts/doctor.sh --all       # Run full pipeline locally
#   ./scripts/doctor.sh --ci        # Run checks with CI-friendly output
#   ./scripts/doctor.sh --quick     # Run fastest subset only
#   ./scripts/doctor.sh --check-env # Check environment only
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Counters
CHECKS_PASSED=0
CHECKS_FAILED=0
CHECKS_SKIPPED=0

# Mode flags
CI_MODE=false
QUICK_MODE=false
CHECK_ENV_ONLY=false

# Log functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[PASS]${NC} $1"
    ((CHECKS_PASSED++))
}

log_warning() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[FAIL]${NC} $1"
    ((CHECKS_FAILED++))
}

log_skip() {
    echo -e "${YELLOW}[SKIP]${NC} $1"
    ((CHECKS_SKIPPED++))
}

log_header() {
    echo ""
    echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE} $1${NC}"
    echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
    echo ""
}

# Parse arguments
parse_args() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            --ci)
                CI_MODE=true
                shift
                ;;
            --quick)
                QUICK_MODE=true
                shift
                ;;
            --check-env)
                CHECK_ENV_ONLY=true
                shift
                ;;
            --all)
                shift
                ;;
            -h|--help)
                echo "Usage: $0 [OPTIONS]"
                echo ""
                echo "Options:"
                echo "  --all        Run full pipeline (default)"
                echo "  --ci         Run in CI mode with exit codes"
                echo "  --quick      Run fastest checks only"
                echo "  --check-env  Check environment only"
                echo "  -h, --help   Show this help"
                exit 0
                ;;
            *)
                echo "Unknown option: $1"
                exit 1
                ;;
        esac
    done
}

# Check system requirements
check_environment() {
    log_header "ENVIRONMENT CHECK"

    # Check Node.js
    if command -v node &> /dev/null; then
        NODE_VERSION=$(node -v)
        log_success "Node.js: $NODE_VERSION"
    else
        log_error "Node.js not found"
    fi

    # Check npm
    if command -v npm &> /dev/null; then
        NPM_VERSION=$(npm -v)
        log_success "npm: $NPM_VERSION"
    else
        log_error "npm not found"
    fi

    # Check Python
    if command -v python3 &> /dev/null; then
        PYTHON_VERSION=$(python3 --version)
        log_success "Python: $PYTHON_VERSION"
    else
        log_error "Python3 not found"
    fi

    # Check pip
    if command -v pip &> /dev/null || command -v pip3 &> /dev/null; then
        PIP_VERSION=$(pip3 --version 2>/dev/null || pip --version)
        log_success "pip: $PIP_VERSION"
    else
        log_error "pip not found"
    fi

    # Check Docker (optional)
    if command -v docker &> /dev/null; then
        DOCKER_VERSION=$(docker --version)
        log_success "Docker: $DOCKER_VERSION"
    else
        log_warning "Docker not found (optional)"
    fi

    # Check .env files
    if [ -f "$PROJECT_ROOT/.env" ] || [ -f "$PROJECT_ROOT/frontend/.env" ] || [ -f "$PROJECT_ROOT/backend/.env" ]; then
        log_success "Environment files present"
    else
        log_warning "No .env files found - using defaults"
    fi
}

# Frontend checks
check_frontend() {
    log_header "FRONTEND CHECKS"

    cd "$PROJECT_ROOT/frontend"

    # Install dependencies if node_modules doesn't exist
    if [ ! -d "node_modules" ]; then
        log_info "Installing frontend dependencies..."
        npm ci --silent || npm install --silent
    fi

    # Lint
    log_info "Running ESLint..."
    if npm run lint; then
        log_success "ESLint: No errors"
    else
        log_error "ESLint: Errors found"
    fi

    # Format check (if not quick mode)
    if [ "$QUICK_MODE" = false ]; then
        log_info "Checking formatting..."
        if npm run format:check; then
            log_success "Prettier: Code is formatted"
        else
            log_warning "Prettier: Code needs formatting (run npm run format)"
        fi
    fi

    # Type check
    log_info "Running TypeScript type check..."
    if npm run type-check; then
        log_success "TypeScript: No type errors"
    else
        log_error "TypeScript: Type errors found"
    fi

    # Build
    if [ "$QUICK_MODE" = false ]; then
        log_info "Building frontend..."
        if npm run build; then
            log_success "Build: Successful"
        else
            log_error "Build: Failed"
        fi
    fi

    # Tests
    log_info "Running frontend tests..."
    if npm run test; then
        log_success "Tests: All passed"
    else
        log_error "Tests: Some failed"
    fi

    cd "$PROJECT_ROOT"
}

# Backend checks
check_backend() {
    log_header "BACKEND CHECKS"

    cd "$PROJECT_ROOT/backend"

    # Check if package is installed
    if ! python3 -c "import app" 2>/dev/null; then
        log_info "Installing backend dependencies..."
        pip3 install -e ".[dev]" --quiet
    fi

    # Lint with ruff
    log_info "Running ruff linter..."
    if ruff check app tests; then
        log_success "Ruff: No errors"
    else
        log_error "Ruff: Errors found"
    fi

    # Format check with black
    if [ "$QUICK_MODE" = false ]; then
        log_info "Checking Black formatting..."
        if black --check app tests 2>/dev/null; then
            log_success "Black: Code is formatted"
        else
            log_warning "Black: Code needs formatting (run black app tests)"
        fi
    fi

    # Type check with mypy
    log_info "Running mypy type check..."
    if mypy app 2>/dev/null; then
        log_success "Mypy: No type errors"
    else
        log_error "Mypy: Type errors found"
    fi

    # Tests
    log_info "Running backend tests..."
    if python3 -m pytest -v -o addopts= --tb=short; then
        log_success "Tests: All passed"
    else
        log_error "Tests: Some failed"
    fi

    cd "$PROJECT_ROOT"
}

# AI Model checks
check_ai_models() {
    log_header "AI MODEL CHECKS"

    cd "$PROJECT_ROOT/backend"

    # Check if AI models directory exists
    MODELS_DIR="${AI_MODELS_DIR:-$PROJECT_ROOT/models}"
    log_info "Checking AI models directory: $MODELS_DIR"

    if [ -d "$MODELS_DIR" ]; then
        log_success "AI models directory exists"
    else
        log_warning "AI models directory not found (create with: mkdir -p $MODELS_DIR)"
    fi

    # Check for YOLOv8 weights
    log_info "Checking YOLOv8 model..."
    if [ -f "$MODELS_DIR/yolov8/model.pt" ]; then
        log_success "YOLOv8: Weights found"
    else
        log_warning "YOLOv8: Weights not found (expected at $MODELS_DIR/yolov8/model.pt)"
    fi

    # Check for MONAI weights
    log_info "Checking MONAI models..."
    if [ -d "$MODELS_DIR/monai_segmentation" ] || [ -d "$MODELS_DIR/spleen_segmentation" ] || [ -d "$MODELS_DIR/liver_segmentation" ]; then
        log_success "MONAI: At least one model found"
    else
        log_warning "MONAI: No segmentation models found"
    fi

    # Check for MedSAM weights
    log_info "Checking MedSAM model..."
    if [ -f "$MODELS_DIR/medsam/medsam_vit_b.pth" ] || [ -f "$MODELS_DIR/medsam/sam_vit_b_01ec64.pth" ]; then
        log_success "MedSAM: Weights found"
    else
        log_warning "MedSAM: Weights not found (expected at $MODELS_DIR/medsam/medsam_vit_b.pth)"
    fi

    # Check AI dependencies
    log_info "Checking AI dependencies..."
    if python3 -c "import torch; print(f'PyTorch: {torch.__version__}')" 2>/dev/null; then
        log_success "PyTorch installed"
    else
        log_warning "PyTorch not installed (install with: pip install torch)"
    fi

    cd "$PROJECT_ROOT"
}

# DICOM checks
check_dicom() {
    log_header "DICOM CHECKS"

    cd "$PROJECT_ROOT/backend"

    # Check DICOM storage directory
    DICOM_STORAGE_DIR="${DICOM_STORAGE_DIR:-$PROJECT_ROOT/storage/dicom}"
    log_info "Checking DICOM storage directory: $DICOM_STORAGE_DIR"

    if [ -d "$DICOM_STORAGE_DIR" ]; then
        log_success "DICOM storage directory exists"
        # Check if writable
        if [ -w "$DICOM_STORAGE_DIR" ]; then
            log_success "DICOM storage is writable"
        else
            log_warning "DICOM storage is not writable"
        fi
    else
        log_warning "DICOM storage directory not found (will be created on first upload)"
    fi

    # Check DICOM dependencies
    log_info "Checking DICOM dependencies..."
    if python3 -c "import pydicom; print(f'pydicom: {pydicom.__version__}')" 2>/dev/null; then
        log_success "pydicom installed"
    else
        log_error "pydicom not installed"
    fi

    if python3 -c "import SimpleITK; print(f'SimpleITK: {SimpleITK.Version()}')" 2>/dev/null; then
        log_success "SimpleITK installed"
    else
        log_warning "SimpleITK not installed (optional, for advanced processing)"
    fi

    if python3 -c "import nibabel; print(f'nibabel: {nibabel.__version__}')" 2>/dev/null; then
        log_success "nibabel installed (NIfTI support)"
    else
        log_warning "nibabel not installed (optional, for NIfTI export)"
    fi

    cd "$PROJECT_ROOT"
}

# Docker and API endpoint checks
check_docker_api() {
    log_header "DOCKER & API ENDPOINT CHECKS"

    # Check if Docker is available
    if ! command -v docker &> /dev/null; then
        log_skip "Docker not installed - skipping container checks"
        return 0
    fi

    if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
        log_skip "Docker Compose not installed - skipping container checks"
        return 0
    fi

    cd "$PROJECT_ROOT"

    # Check if containers are running
    log_info "Checking Docker containers..."
    if docker compose ps --filter "status=running" 2>/dev/null | grep -q "backend"; then
        log_success "Backend container is running"
        BACKEND_RUNNING=true
    else
        log_warning "Backend container is not running (start with: docker compose up -d)"
        BACKEND_RUNNING=false
    fi

    if docker compose ps --filter "status=running" 2>/dev/null | grep -q "frontend"; then
        log_success "Frontend container is running"
        FRONTEND_RUNNING=true
    else
        log_warning "Frontend container is not running"
        FRONTEND_RUNNING=false
    fi

    # If containers are running, check API endpoints
    if [ "$BACKEND_RUNNING" = true ] && [ "$FRONTEND_RUNNING" = true ]; then
        log_info "Checking API endpoints..."

        # Check health endpoint
        HEALTH_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/v1/health 2>/dev/null || echo "000")
        if [ "$HEALTH_RESPONSE" = "200" ]; then
            log_success "Health endpoint: OK (200)"
        else
            log_error "Health endpoint: Failed (HTTP $HEALTH_RESPONSE)"
        fi

        # Check dashboard/stats endpoint (requires auth, so 401 is acceptable)
        STATS_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/v1/dashboard/stats 2>/dev/null || echo "000")
        if [ "$STATS_RESPONSE" = "200" ] || [ "$STATS_RESPONSE" = "401" ]; then
            log_success "Dashboard stats endpoint: Reachable (HTTP $STATS_RESPONSE)"
        elif [ "$STATS_RESPONSE" = "404" ]; then
            log_error "Dashboard stats endpoint: NOT FOUND (404) - REGRESSION DETECTED!"
        else
            log_warning "Dashboard stats endpoint: HTTP $STATS_RESPONSE"
        fi

        # Check auth endpoint
        AUTH_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/v1/auth/me 2>/dev/null || echo "000")
        if [ "$AUTH_RESPONSE" = "200" ] || [ "$AUTH_RESPONSE" = "401" ]; then
            log_success "Auth endpoint: Reachable (HTTP $AUTH_RESPONSE)"
        elif [ "$AUTH_RESPONSE" = "404" ]; then
            log_error "Auth endpoint: NOT FOUND (404) - Check routing!"
        else
            log_warning "Auth endpoint: HTTP $AUTH_RESPONSE"
        fi

        # Check that nginx doesn't serve index.html for API routes
        API_CONTENT_TYPE=$(curl -s -I http://localhost:3000/api/v1/dashboard/stats 2>/dev/null | grep -i "content-type" | head -1 || echo "")
        if echo "$API_CONTENT_TYPE" | grep -qi "text/html"; then
            log_error "API returning HTML instead of JSON - Check nginx config!"
        else
            log_success "API Content-Type is not HTML"
        fi
    else
        log_skip "Containers not running - skipping API endpoint checks"
    fi
}

# E2E tests
check_e2e() {
    log_header "E2E TESTS"

    cd "$PROJECT_ROOT"

    # Check if E2E tests exist
    if [ ! -d "$PROJECT_ROOT/e2e" ]; then
        log_skip "E2E tests not found at $PROJECT_ROOT/e2e"
        return 0
    fi

    # Check if containers are running
    if ! docker compose ps --filter "status=running" 2>/dev/null | grep -q "frontend"; then
        log_skip "Containers not running - skipping E2E tests"
        return 0
    fi

    cd "$PROJECT_ROOT/e2e"

    # Install dependencies if needed
    if [ ! -d "node_modules" ]; then
        log_info "Installing E2E dependencies..."
        npm ci --silent || npm install --silent
        npx playwright install chromium --with-deps 2>/dev/null || true
    fi

    # Run E2E tests
    log_info "Running E2E tests..."
    if npm test 2>/dev/null; then
        log_success "E2E tests: All passed"
    else
        log_error "E2E tests: Some failed"
    fi

    cd "$PROJECT_ROOT"
}

# Security checks
check_security() {
    log_header "SECURITY CHECKS"

    # Frontend audit
    cd "$PROJECT_ROOT/frontend"
    log_info "Running npm audit..."
    AUDIT_OUTPUT=$(npm audit --json 2>/dev/null || true)
    CRITICAL_HIGH=$(echo "$AUDIT_OUTPUT" | python3 -c "import sys, json; d = json.load(sys.stdin); print(d.get('metadata', {}).get('vulnerabilities', {}).get('critical', 0) + d.get('metadata', {}).get('vulnerabilities', {}).get('high', 0))" 2>/dev/null || echo "0")
    if [ "$CRITICAL_HIGH" = "0" ]; then
        log_success "npm audit: No critical/high vulnerabilities"
    else
        log_warning "npm audit: $CRITICAL_HIGH critical/high vulnerabilities (review and accept risk)"
    fi
    cd "$PROJECT_ROOT"

    # Check for secrets in code
    log_info "Checking for hardcoded secrets..."
    if ! grep -r "password\s*=\s*['\"]" --include="*.py" --include="*.ts" --include="*.tsx" "$PROJECT_ROOT/backend" "$PROJECT_ROOT/frontend/src" 2>/dev/null | grep -v "password\s*=\s*['\"]['\"]" | grep -v "test" | grep -v ".test." | head -1; then
        log_success "No obvious hardcoded secrets found"
    else
        log_warning "Potential hardcoded secrets detected"
    fi

    # Check .env file security
    log_info "Checking .env file security..."
    if [ -f "$PROJECT_ROOT/.env" ]; then
        # Check if SECRET_KEY is set
        if grep -q "^SECRET_KEY=.\{32,\}" "$PROJECT_ROOT/.env" 2>/dev/null; then
            log_success "SECRET_KEY is set with adequate length"
        else
            log_warning "SECRET_KEY may be insecure (should be 32+ chars)"
        fi
    else
        log_warning "No .env file found at project root"
    fi
}

# Print summary
print_summary() {
    log_header "SUMMARY"

    TOTAL=$((CHECKS_PASSED + CHECKS_FAILED + CHECKS_SKIPPED))

    echo "Total checks: $TOTAL"
    echo -e "  ${GREEN}Passed:  $CHECKS_PASSED${NC}"
    echo -e "  ${RED}Failed:  $CHECKS_FAILED${NC}"
    echo -e "  ${YELLOW}Skipped: $CHECKS_SKIPPED${NC}"
    echo ""

    if [ $CHECKS_FAILED -gt 0 ]; then
        echo -e "${RED}❌ Some checks failed. Please fix the issues above.${NC}"
        return 1
    else
        echo -e "${GREEN}✅ All checks passed!${NC}"
        return 0
    fi
}

# Main
main() {
    parse_args "$@"

    echo ""
    echo "╔═══════════════════════════════════════════════════════════════╗"
    echo "║           HORALIX VIEW - DOCTOR HEALTH CHECK                  ║"
    echo "╚═══════════════════════════════════════════════════════════════╝"
    echo ""

    cd "$PROJECT_ROOT"

    # Always check environment
    check_environment

    if [ "$CHECK_ENV_ONLY" = true ]; then
        print_summary
        exit $?
    fi

    # Run checks
    check_frontend
    check_backend

    if [ "$QUICK_MODE" = false ]; then
        check_ai_models
        check_dicom
        check_docker_api
        check_security
        check_e2e
    fi

    # Print summary and exit
    print_summary
    EXIT_CODE=$?

    if [ "$CI_MODE" = true ]; then
        exit $EXIT_CODE
    fi

    return $EXIT_CODE
}

main "$@"
