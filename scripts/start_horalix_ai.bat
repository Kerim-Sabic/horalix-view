@echo off
REM Horalix AI Quick Start Script
REM Validates setup and starts Docker services

echo ======================================================================
echo                    Horalix AI Quick Start
echo ======================================================================
echo.

REM Step 1: Validate setup
echo [1/4] Validating setup...
python scripts\validate_horalix_ai_setup.py
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Validation failed! Please fix the issues above.
    pause
    exit /b 1
)

echo.
echo [OK] Validation passed!
echo.

REM Step 2: Check if .env exists
if not exist ".env" (
    echo [2/4] Creating .env from .env.example...
    copy .env.example .env
    echo [!] Please edit .env and set HORALIX_AI_MODELS_HOST_PATH
    echo [!] Then run this script again.
    pause
    exit /b 0
) else (
    echo [2/4] .env file found
)

REM Step 3: Check Docker Desktop
echo.
echo [3/4] Checking Docker Desktop...
docker info >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Docker Desktop is not running!
    echo Please start Docker Desktop and run this script again.
    pause
    exit /b 1
)
echo [OK] Docker Desktop is running

REM Step 4: Start services
echo.
echo [4/4] Starting Horalix services...
cd docker
docker-compose up -d

if %errorlevel% neq 0 (
    echo [ERROR] Failed to start services!
    pause
    exit /b 1
)

echo.
echo ======================================================================
echo                   Horalix AI Started Successfully
echo ======================================================================
echo.
echo Services starting... This will take ~35 seconds for model loading.
echo.
echo Worker logs:
echo   docker-compose logs -f horalix-ai-worker-0 horalix-ai-worker-1
echo.
echo Access points:
echo   Frontend:  http://localhost:3000
echo   Backend:   http://localhost:8000
echo   API Docs:  http://localhost:8000/docs
echo.
echo Check model status:
echo   curl http://localhost:8000/api/v1/ai/models
echo.
pause
