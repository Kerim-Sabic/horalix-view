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
        check_security
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
