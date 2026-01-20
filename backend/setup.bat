@echo off
REM Horalix View Backend Setup Script for Windows (Batch)
REM This script sets up the PostgreSQL database and runs migrations

setlocal enabledelayedexpansion

echo ===================================
echo Horalix View Backend Setup (Windows)
echo ===================================
echo.

REM Check if PostgreSQL is installed
echo Checking PostgreSQL installation...
where psql >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: PostgreSQL is not installed or not in PATH.
    echo.
    echo Please install PostgreSQL 14+ from:
    echo   https://www.postgresql.org/download/windows/
    echo.
    echo Or use Chocolatey: choco install postgresql
    echo.
    exit /b 1
)
echo [OK] PostgreSQL found
echo.

REM Check if .env file exists
if not exist ".env" (
    echo Creating .env file from .env.example...
    copy ".env.example" ".env" >nul
    echo [OK] Created .env file
    echo.
    echo NOTE: Please edit .env file with your configuration if needed.
    echo       Especially set a strong SECRET_KEY for production!
    echo.
)

REM Load environment variables from .env file
echo Loading environment variables from .env...
if exist ".env" (
    for /f "usebackq tokens=1,* delims==" %%a in (".env") do (
        set "line=%%a"
        if not "!line:~0,1!"=="#" (
            if not "%%a"=="" (
                set "%%a=%%b"
            )
        )
    )
    echo [OK] Environment variables loaded
) else (
    echo ERROR: .env file not found!
    exit /b 1
)

REM Set default values if not specified
if "%DB_HOST%"=="" set DB_HOST=localhost
if "%DB_PORT%"=="" set DB_PORT=5432
if "%DB_USER%"=="" set DB_USER=horalix
if "%DB_PASSWORD%"=="" set DB_PASSWORD=horalix
if "%DB_NAME%"=="" set DB_NAME=horalix_view

echo.
echo Database Configuration:
echo   Host: %DB_HOST%
echo   Port: %DB_PORT%
echo   User: %DB_USER%
echo   Database: %DB_NAME%
echo.

REM Check if PostgreSQL service is running
echo Checking PostgreSQL service...
sc query "postgresql-x64-15" | find "RUNNING" >nul 2>&1
if %errorlevel% neq 0 (
    sc query "postgresql-x64-14" | find "RUNNING" >nul 2>&1
    if !errorlevel! neq 0 (
        echo WARNING: PostgreSQL service may not be running.
        echo.
        echo Please ensure PostgreSQL service is started:
        echo   1. Open Services (services.msc^)
        echo   2. Find 'postgresql-x64-XX' service
        echo   3. Right-click and select 'Start'
        echo.
        echo Or use command line (as Administrator^):
        echo   net start postgresql-x64-XX
        echo.
        choice /C YN /M "Continue anyway"
        if errorlevel 2 exit /b 1
    )
)
echo [OK] PostgreSQL service is running
echo.

REM Set PGPASSWORD for authentication
set PGPASSWORD=%DB_PASSWORD%

echo Setting up PostgreSQL database...
echo.

REM Check if user exists
echo Checking/creating PostgreSQL user...
psql -h %DB_HOST% -p %DB_PORT% -U postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname='%DB_USER%'" >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo ERROR: Could not connect to PostgreSQL.
    echo.
    echo Common issues:
    echo   1. PostgreSQL service is not running
    echo   2. 'postgres' user password is not set or incorrect
    echo   3. PostgreSQL is not configured to accept local connections
    echo.
    echo To set postgres user password:
    echo   psql -U postgres -c "ALTER USER postgres WITH PASSWORD 'postgres';"
    echo.
    echo You may need to edit pg_hba.conf to allow local connections.
    echo.
    exit /b 1
)

REM Create user if doesn't exist
psql -h %DB_HOST% -p %DB_PORT% -U postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname='%DB_USER%'" > temp_user_check.txt 2>&1
set /p USER_EXISTS=<temp_user_check.txt
del temp_user_check.txt

if not "%USER_EXISTS%"=="1" (
    echo Creating user '%DB_USER%'...
    psql -h %DB_HOST% -p %DB_PORT% -U postgres -c "CREATE USER %DB_USER% WITH PASSWORD '%DB_PASSWORD%';" >nul 2>&1
    if !errorlevel! equ 0 (
        echo [OK] User '%DB_USER%' created
    ) else (
        echo ERROR: Failed to create user '%DB_USER%'
        exit /b 1
    )
) else (
    echo [OK] User '%DB_USER%' already exists
)

REM Check if database exists
echo Checking/creating database...
psql -h %DB_HOST% -p %DB_PORT% -U postgres -tAc "SELECT 1 FROM pg_database WHERE datname='%DB_NAME%'" > temp_db_check.txt 2>&1
set /p DB_EXISTS=<temp_db_check.txt
del temp_db_check.txt

if not "%DB_EXISTS%"=="1" (
    echo Creating database '%DB_NAME%'...
    psql -h %DB_HOST% -p %DB_PORT% -U postgres -c "CREATE DATABASE %DB_NAME% OWNER %DB_USER%;" >nul 2>&1
    if !errorlevel! equ 0 (
        echo [OK] Database '%DB_NAME%' created
    ) else (
        echo ERROR: Failed to create database '%DB_NAME%'
        exit /b 1
    )
) else (
    echo [OK] Database '%DB_NAME%' already exists
)

REM Grant privileges
echo Granting privileges...
psql -h %DB_HOST% -p %DB_PORT% -U postgres -d %DB_NAME% -c "GRANT ALL PRIVILEGES ON DATABASE %DB_NAME% TO %DB_USER%;" >nul 2>&1
psql -h %DB_HOST% -p %DB_PORT% -U postgres -d %DB_NAME% -c "GRANT ALL PRIVILEGES ON SCHEMA public TO %DB_USER%;" >nul 2>&1
psql -h %DB_HOST% -p %DB_PORT% -U postgres -d %DB_NAME% -c "GRANT CREATE ON SCHEMA public TO %DB_USER%;" >nul 2>&1
echo [OK] Privileges granted

REM Update password
echo Updating user password...
psql -h %DB_HOST% -p %DB_PORT% -U postgres -c "ALTER USER %DB_USER% WITH PASSWORD '%DB_PASSWORD%';" >nul 2>&1
echo [OK] Password updated

REM Check Python installation
echo.
echo Checking Python installation...
where python >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Python is not installed or not in PATH.
    echo.
    echo Please install Python 3.10+ from:
    echo   https://www.python.org/downloads/
    echo.
    exit /b 1
)

for /f "tokens=*" %%v in ('python --version 2^>^&1') do set PYTHON_VERSION=%%v
echo [OK] Python found: %PYTHON_VERSION%

REM Check pip
where pip >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: pip is not installed.
    exit /b 1
)

REM Install dependencies if needed
echo.
echo Checking Python dependencies...
python -c "import alembic" >nul 2>&1
if %errorlevel% neq 0 (
    echo Installing Python dependencies...
    echo This may take a few minutes...
    pip install -e . >nul 2>&1
    if !errorlevel! equ 0 (
        echo [OK] Python dependencies installed
    ) else (
        echo ERROR: Failed to install Python dependencies
        echo Try running manually: pip install -e .
        exit /b 1
    )
) else (
    echo [OK] Python dependencies already installed
)

REM Run migrations
echo.
echo Running database migrations...
alembic upgrade head
if %errorlevel% equ 0 (
    echo [OK] Database migrations completed
) else (
    echo ERROR: Database migrations failed
    exit /b 1
)

REM Show migration status
echo.
echo Current migration status:
alembic current

echo.
echo ===================================
echo Setup completed successfully!
echo ===================================
echo.
echo Database: %DB_NAME%
echo User: %DB_USER%
echo Host: %DB_HOST%:%DB_PORT%
echo.
echo To start the application, run:
echo   python -m app.main
echo or:
echo   uvicorn app.main:app --reload
echo.
echo API will be available at:
echo   http://localhost:8000
echo   http://localhost:8000/docs (API documentation)
echo.

REM Clear password
set PGPASSWORD=

endlocal
