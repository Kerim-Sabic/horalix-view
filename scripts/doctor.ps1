#
# doctor.ps1 - Horalix View Health Check Script (Windows)
#
# This script runs all quality checks for the Horalix View application.
#
# Usage:
#   .\scripts\doctor.ps1 -All       # Run full pipeline
#   .\scripts\doctor.ps1 -CI        # Run in CI mode
#   .\scripts\doctor.ps1 -Quick     # Run fastest checks only
#   .\scripts\doctor.ps1 -CheckEnv  # Check environment only
#

param(
    [switch]$All,
    [switch]$CI,
    [switch]$Quick,
    [switch]$CheckEnv,
    [switch]$Help
)

$ErrorActionPreference = "Continue"

# Script directory
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir

# Counters
$script:ChecksPassed = 0
$script:ChecksFailed = 0
$script:ChecksSkipped = 0

function Write-Header {
    param([string]$Message)
    Write-Host ""
    Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Blue
    Write-Host " $Message" -ForegroundColor Blue
    Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Blue
    Write-Host ""
}

function Write-Pass {
    param([string]$Message)
    Write-Host "[PASS] " -ForegroundColor Green -NoNewline
    Write-Host $Message
    $script:ChecksPassed++
}

function Write-Fail {
    param([string]$Message)
    Write-Host "[FAIL] " -ForegroundColor Red -NoNewline
    Write-Host $Message
    $script:ChecksFailed++
}

function Write-Warn {
    param([string]$Message)
    Write-Host "[WARN] " -ForegroundColor Yellow -NoNewline
    Write-Host $Message
}

function Write-Info {
    param([string]$Message)
    Write-Host "[INFO] " -ForegroundColor Blue -NoNewline
    Write-Host $Message
}

function Write-Skip {
    param([string]$Message)
    Write-Host "[SKIP] " -ForegroundColor Yellow -NoNewline
    Write-Host $Message
    $script:ChecksSkipped++
}

function Test-Environment {
    Write-Header "ENVIRONMENT CHECK"

    # Check Node.js
    $nodeVersion = & node -v 2>$null
    if ($nodeVersion) {
        Write-Pass "Node.js: $nodeVersion"
    } else {
        Write-Fail "Node.js not found"
    }

    # Check npm
    $npmVersion = & npm -v 2>$null
    if ($npmVersion) {
        Write-Pass "npm: $npmVersion"
    } else {
        Write-Fail "npm not found"
    }

    # Check Python
    $pythonVersion = & python --version 2>&1
    if ($pythonVersion -match "Python") {
        Write-Pass "Python: $pythonVersion"
    } else {
        Write-Fail "Python not found"
    }

    # Check Docker
    $dockerVersion = & docker --version 2>$null
    if ($dockerVersion) {
        Write-Pass "Docker: $dockerVersion"
    } else {
        Write-Warn "Docker not found (optional)"
    }
}

function Test-Frontend {
    Write-Header "FRONTEND CHECKS"

    Push-Location "$ProjectRoot\frontend"

    # Install dependencies if needed
    if (-not (Test-Path "node_modules")) {
        Write-Info "Installing frontend dependencies..."
        & npm ci --silent 2>$null || & npm install --silent
    }

    # Lint
    Write-Info "Running ESLint..."
    & npm run lint 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Pass "ESLint: No errors"
    } else {
        Write-Fail "ESLint: Errors found"
    }

    # Type check
    Write-Info "Running TypeScript type check..."
    & npm run type-check 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Pass "TypeScript: No type errors"
    } else {
        Write-Fail "TypeScript: Type errors found"
    }

    if (-not $Quick) {
        # Build
        Write-Info "Building frontend..."
        & npm run build 2>$null
        if ($LASTEXITCODE -eq 0) {
            Write-Pass "Build: Successful"
        } else {
            Write-Fail "Build: Failed"
        }
    }

    # Tests
    Write-Info "Running frontend tests..."
    & npm run test 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Pass "Tests: All passed"
    } else {
        Write-Fail "Tests: Some failed"
    }

    Pop-Location
}

function Test-Backend {
    Write-Header "BACKEND CHECKS"

    Push-Location "$ProjectRoot\backend"

    # Lint with ruff
    Write-Info "Running ruff linter..."
    & ruff check app tests 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Pass "Ruff: No errors"
    } else {
        Write-Fail "Ruff: Errors found"
    }

    # Type check with mypy
    Write-Info "Running mypy type check..."
    & mypy app 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Pass "Mypy: No type errors"
    } else {
        Write-Fail "Mypy: Type errors found"
    }

    # Tests
    Write-Info "Running backend tests..."
    & python -m pytest -v -o addopts= --tb=short 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Pass "Tests: All passed"
    } else {
        Write-Fail "Tests: Some failed"
    }

    Pop-Location
}

function Write-Summary {
    Write-Header "SUMMARY"

    $total = $script:ChecksPassed + $script:ChecksFailed + $script:ChecksSkipped

    Write-Host "Total checks: $total"
    Write-Host "  Passed:  $($script:ChecksPassed)" -ForegroundColor Green
    Write-Host "  Failed:  $($script:ChecksFailed)" -ForegroundColor Red
    Write-Host "  Skipped: $($script:ChecksSkipped)" -ForegroundColor Yellow
    Write-Host ""

    if ($script:ChecksFailed -gt 0) {
        Write-Host "Some checks failed. Please fix the issues above." -ForegroundColor Red
        return $false
    } else {
        Write-Host "All checks passed!" -ForegroundColor Green
        return $true
    }
}

# Main
function Main {
    if ($Help) {
        Write-Host "Usage: .\doctor.ps1 [OPTIONS]"
        Write-Host ""
        Write-Host "Options:"
        Write-Host "  -All        Run full pipeline (default)"
        Write-Host "  -CI         Run in CI mode with exit codes"
        Write-Host "  -Quick      Run fastest checks only"
        Write-Host "  -CheckEnv   Check environment only"
        Write-Host "  -Help       Show this help"
        return
    }

    Write-Host ""
    Write-Host "╔═══════════════════════════════════════════════════════════════╗"
    Write-Host "║           HORALIX VIEW - DOCTOR HEALTH CHECK                  ║"
    Write-Host "╚═══════════════════════════════════════════════════════════════╝"
    Write-Host ""

    Test-Environment

    if ($CheckEnv) {
        $success = Write-Summary
        if ($CI -and -not $success) { exit 1 }
        return
    }

    Test-Frontend
    Test-Backend

    $success = Write-Summary

    if ($CI -and -not $success) {
        exit 1
    }
}

Main
