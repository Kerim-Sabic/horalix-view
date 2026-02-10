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
    echo [2/4] Creating ./.env from .env.example...
    copy .env.example .env
    echo [!] Please edit ./.env for your runtime mode before starting:
    echo [!] CPU: AI_DEVICE=cpu, WORKER_0_GPU_COUNT=0
    echo [!] GPU: AI_DEVICE=cuda:0, WORKER_0_GPU_COUNT=1
    pause
    exit /b 0
) else (
    echo [2/4] ./.env file found
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

set GPU_COUNT=0
set DUAL_GPU=0
for /f %%C in ('nvidia-smi --query-gpu=name --format=csv,noheader ^| find /c /v "" 2^>nul') do set GPU_COUNT=%%C

if "%GPU_COUNT%"=="" set GPU_COUNT=0
if %GPU_COUNT% GEQ 2 (
    set DUAL_GPU=1
    echo [INFO] Detected %GPU_COUNT% GPU(s) - starting dual-GPU profile
    docker compose --env-file ./.env -f docker/docker-compose.yml --profile gpu up -d --build
) else if %GPU_COUNT% GEQ 1 (
    echo [INFO] Detected %GPU_COUNT% GPU(s) - starting default stack (worker-0)
    docker compose --env-file ./.env -f docker/docker-compose.yml up -d --build
) else (
    echo [INFO] No NVIDIA GPUs detected - starting CPU mode
    docker compose --env-file ./.env -f docker/docker-compose.yml up -d --build
)

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
if "%DUAL_GPU%"=="1" (
    echo   docker compose --env-file ./.env -f docker/docker-compose.yml --profile gpu logs -f horalix-ai-worker-0 horalix-ai-worker-1
) else (
    echo   docker compose --env-file ./.env -f docker/docker-compose.yml logs -f horalix-ai-worker-0
)
echo.
echo Access points:
echo   Frontend:  http://localhost:3000
echo   Backend:   http://localhost:8000
echo   API Docs:  http://localhost:8000/docs
echo.
echo Check services:
if "%DUAL_GPU%"=="1" (
    echo   docker compose --env-file ./.env -f docker/docker-compose.yml --profile gpu ps
) else (
    echo   docker compose --env-file ./.env -f docker/docker-compose.yml ps
)
echo.
echo Check model status:
echo   curl http://localhost:8000/api/v1/ai/models
echo.
pause
