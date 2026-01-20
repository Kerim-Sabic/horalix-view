# Horalix View Backend Setup Script for Windows (PowerShell)
# This script sets up the PostgreSQL database and runs migrations

$ErrorActionPreference = "Stop"

Write-Host "===================================" -ForegroundColor Cyan
Write-Host "Horalix View Backend Setup (Windows)" -ForegroundColor Cyan
Write-Host "===================================" -ForegroundColor Cyan
Write-Host ""

# Function to check if a command exists
function Test-CommandExists {
    param($command)
    $null = Get-Command $command -ErrorAction SilentlyContinue
    return $?
}

# Check if PostgreSQL is installed
Write-Host "Checking PostgreSQL installation..." -ForegroundColor Yellow
if (-not (Test-CommandExists "psql")) {
    Write-Host "ERROR: PostgreSQL is not installed or not in PATH." -ForegroundColor Red
    Write-Host ""
    Write-Host "Please install PostgreSQL 14+ from:" -ForegroundColor Yellow
    Write-Host "  https://www.postgresql.org/download/windows/" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Or use Chocolatey: choco install postgresql" -ForegroundColor Cyan
    Write-Host ""
    exit 1
}

# Check if .env file exists
if (-not (Test-Path ".env")) {
    Write-Host "Creating .env file from .env.example..." -ForegroundColor Yellow
    Copy-Item ".env.example" ".env"
    Write-Host "✓ Created .env file" -ForegroundColor Green
    Write-Host ""
    Write-Host "NOTE: Please edit .env file with your configuration if needed." -ForegroundColor Yellow
    Write-Host "      Especially set a strong SECRET_KEY for production!" -ForegroundColor Yellow
    Write-Host ""
}

# Load environment variables from .env file
Write-Host "Loading environment variables from .env..." -ForegroundColor Yellow
if (Test-Path ".env") {
    Get-Content ".env" | ForEach-Object {
        if ($_ -match '^([^#][^=]+)=(.+)$') {
            $key = $matches[1].Trim()
            $value = $matches[2].Trim()
            # Remove quotes if present
            $value = $value -replace '^"(.*)"$', '$1'
            $value = $value -replace "^'(.*)'$", '$1'
            [Environment]::SetEnvironmentVariable($key, $value, "Process")
        }
    }
    Write-Host "✓ Environment variables loaded" -ForegroundColor Green
} else {
    Write-Host "ERROR: .env file not found!" -ForegroundColor Red
    exit 1
}

# Get database credentials from environment
$DB_HOST = $env:DB_HOST
$DB_PORT = $env:DB_PORT
$DB_USER = $env:DB_USER
$DB_PASSWORD = $env:DB_PASSWORD
$DB_NAME = $env:DB_NAME

if (-not $DB_HOST) { $DB_HOST = "localhost" }
if (-not $DB_PORT) { $DB_PORT = "5432" }
if (-not $DB_USER) { $DB_USER = "horalix" }
if (-not $DB_PASSWORD) { $DB_PASSWORD = "horalix" }
if (-not $DB_NAME) { $DB_NAME = "horalix_view" }

Write-Host ""
Write-Host "Database Configuration:" -ForegroundColor Cyan
Write-Host "  Host: $DB_HOST" -ForegroundColor White
Write-Host "  Port: $DB_PORT" -ForegroundColor White
Write-Host "  User: $DB_USER" -ForegroundColor White
Write-Host "  Database: $DB_NAME" -ForegroundColor White
Write-Host ""

# Check if PostgreSQL service is running
Write-Host "Checking PostgreSQL service..." -ForegroundColor Yellow
$pgService = Get-Service -Name "postgresql*" -ErrorAction SilentlyContinue | Where-Object { $_.Status -eq "Running" } | Select-Object -First 1

if (-not $pgService) {
    Write-Host "WARNING: PostgreSQL service is not running." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Please start PostgreSQL service manually:" -ForegroundColor Yellow
    Write-Host "  1. Open Services (services.msc)" -ForegroundColor Cyan
    Write-Host "  2. Find 'postgresql-x64-XX' service" -ForegroundColor Cyan
    Write-Host "  3. Right-click and select 'Start'" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Or use command line:" -ForegroundColor Yellow
    Write-Host "  net start postgresql-x64-XX" -ForegroundColor Cyan
    Write-Host ""

    $response = Read-Host "Continue anyway? (y/n)"
    if ($response -ne "y" -and $response -ne "Y") {
        exit 1
    }
} else {
    Write-Host "✓ PostgreSQL service is running: $($pgService.DisplayName)" -ForegroundColor Green
}

Write-Host ""
Write-Host "Setting up PostgreSQL database..." -ForegroundColor Yellow
Write-Host ""

# Set PGPASSWORD environment variable for password authentication
$env:PGPASSWORD = $DB_PASSWORD

# Check if user exists, create if not
Write-Host "Checking/creating PostgreSQL user..." -ForegroundColor Yellow
$userExists = & psql -h $DB_HOST -p $DB_PORT -U postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'" 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "ERROR: Could not connect to PostgreSQL." -ForegroundColor Red
    Write-Host ""
    Write-Host "Common issues:" -ForegroundColor Yellow
    Write-Host "  1. PostgreSQL service is not running" -ForegroundColor Cyan
    Write-Host "  2. 'postgres' user password is not set or incorrect" -ForegroundColor Cyan
    Write-Host "  3. PostgreSQL is not configured to accept local connections" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "To set postgres user password:" -ForegroundColor Yellow
    Write-Host "  psql -U postgres -c `"ALTER USER postgres WITH PASSWORD 'postgres';`"" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "You may need to edit pg_hba.conf to allow local connections." -ForegroundColor Yellow
    Write-Host ""
    exit 1
}

if ($userExists -ne "1") {
    Write-Host "Creating user '$DB_USER'..." -ForegroundColor Yellow
    & psql -h $DB_HOST -p $DB_PORT -U postgres -c "CREATE USER $DB_USER WITH PASSWORD '$DB_PASSWORD';" 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✓ User '$DB_USER' created" -ForegroundColor Green
    } else {
        Write-Host "ERROR: Failed to create user '$DB_USER'" -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "✓ User '$DB_USER' already exists" -ForegroundColor Green
}

# Check if database exists, create if not
Write-Host "Checking/creating database..." -ForegroundColor Yellow
$dbExists = & psql -h $DB_HOST -p $DB_PORT -U postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" 2>$null
if ($dbExists -ne "1") {
    Write-Host "Creating database '$DB_NAME'..." -ForegroundColor Yellow
    & psql -h $DB_HOST -p $DB_PORT -U postgres -c "CREATE DATABASE $DB_NAME OWNER $DB_USER;" 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✓ Database '$DB_NAME' created" -ForegroundColor Green
    } else {
        Write-Host "ERROR: Failed to create database '$DB_NAME'" -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "✓ Database '$DB_NAME' already exists" -ForegroundColor Green
}

# Grant privileges
Write-Host "Granting privileges..." -ForegroundColor Yellow
& psql -h $DB_HOST -p $DB_PORT -U postgres -d $DB_NAME -c "GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;" 2>&1 | Out-Null
& psql -h $DB_HOST -p $DB_PORT -U postgres -d $DB_NAME -c "GRANT ALL PRIVILEGES ON SCHEMA public TO $DB_USER;" 2>&1 | Out-Null
& psql -h $DB_HOST -p $DB_PORT -U postgres -d $DB_NAME -c "GRANT CREATE ON SCHEMA public TO $DB_USER;" 2>&1 | Out-Null
Write-Host "✓ Privileges granted" -ForegroundColor Green

# Ensure password is set correctly
Write-Host "Updating user password..." -ForegroundColor Yellow
& psql -h $DB_HOST -p $DB_PORT -U postgres -c "ALTER USER $DB_USER WITH PASSWORD '$DB_PASSWORD';" 2>&1 | Out-Null
Write-Host "✓ Password updated" -ForegroundColor Green

# Check if Python is installed
Write-Host ""
Write-Host "Checking Python installation..." -ForegroundColor Yellow
if (-not (Test-CommandExists "python")) {
    Write-Host "ERROR: Python is not installed or not in PATH." -ForegroundColor Red
    Write-Host ""
    Write-Host "Please install Python 3.10+ from:" -ForegroundColor Yellow
    Write-Host "  https://www.python.org/downloads/" -ForegroundColor Cyan
    Write-Host ""
    exit 1
}

$pythonVersion = & python --version 2>&1
Write-Host "✓ Python found: $pythonVersion" -ForegroundColor Green

# Check if pip is installed
if (-not (Test-CommandExists "pip")) {
    Write-Host "ERROR: pip is not installed." -ForegroundColor Red
    exit 1
}

# Install Python dependencies if alembic is not available
Write-Host ""
Write-Host "Checking Python dependencies..." -ForegroundColor Yellow
$alembicExists = & python -c "import alembic" 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "Installing Python dependencies..." -ForegroundColor Yellow
    Write-Host "This may take a few minutes..." -ForegroundColor Cyan
    & pip install -e . 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✓ Python dependencies installed" -ForegroundColor Green
    } else {
        Write-Host "ERROR: Failed to install Python dependencies" -ForegroundColor Red
        Write-Host "Try running manually: pip install -e ." -ForegroundColor Yellow
        exit 1
    }
} else {
    Write-Host "✓ Python dependencies already installed" -ForegroundColor Green
}

# Run migrations
Write-Host ""
Write-Host "Running database migrations..." -ForegroundColor Yellow
& alembic upgrade head
if ($LASTEXITCODE -eq 0) {
    Write-Host "✓ Database migrations completed" -ForegroundColor Green
} else {
    Write-Host "ERROR: Database migrations failed" -ForegroundColor Red
    exit 1
}

# Verify migration status
Write-Host ""
Write-Host "Current migration status:" -ForegroundColor Cyan
& alembic current

Write-Host ""
Write-Host "===================================" -ForegroundColor Green
Write-Host "Setup completed successfully!" -ForegroundColor Green
Write-Host "===================================" -ForegroundColor Green
Write-Host ""
Write-Host "Database: $DB_NAME" -ForegroundColor White
Write-Host "User: $DB_USER" -ForegroundColor White
Write-Host "Host: ${DB_HOST}:${DB_PORT}" -ForegroundColor White
Write-Host ""
Write-Host "To start the application, run:" -ForegroundColor Yellow
Write-Host "  python -m app.main" -ForegroundColor Cyan
Write-Host "or:" -ForegroundColor Yellow
Write-Host "  uvicorn app.main:app --reload" -ForegroundColor Cyan
Write-Host ""
Write-Host "API will be available at:" -ForegroundColor Yellow
Write-Host "  http://localhost:8000" -ForegroundColor Cyan
Write-Host "  http://localhost:8000/docs (API documentation)" -ForegroundColor Cyan
Write-Host ""

# Clear password from environment
$env:PGPASSWORD = $null
