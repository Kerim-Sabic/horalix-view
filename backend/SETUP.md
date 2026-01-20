# Horalix View Backend - Setup Guide

This guide will help you set up and run the Horalix View backend on Linux, macOS, and Windows.

## Prerequisites

- Python 3.10 or higher
- PostgreSQL 12 or higher
- Redis 7+ (for caching and job queue)
- pip (Python package installer)

> **Windows Users:** For detailed Windows-specific setup instructions, including PostgreSQL and Redis installation, see [../WINDOWS_SETUP.md](../WINDOWS_SETUP.md).

## Quick Setup

We provide automated setup scripts for all platforms:

### Linux/macOS

```bash
cd backend
./setup.sh
```

### Windows (PowerShell)

```powershell
cd backend
.\setup.ps1
```

### Windows (Command Prompt)

```batch
cd backend
setup.bat
```

These scripts will:
1. Check if PostgreSQL is running
2. Create the database user and database
3. Grant necessary permissions
4. Install Python dependencies
5. Run database migrations

## Manual Setup

If you prefer to set up manually or need to customize the process:

### 1. Install Dependencies

**Linux/macOS:**
```bash
cd backend
pip3 install -e .
```

**Windows:**
```powershell
cd backend
pip install -e .
```

For AI features (optional):
```bash
# Linux/macOS
pip3 install -e ".[ai]"

# Windows
pip install -e ".[ai]"
```

**Note for Windows GPU users:** For CUDA support, install PyTorch separately first:
```powershell
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu121
pip install -e ".[ai]"
```

### 2. Configure Environment

Copy the example environment file:

**Linux/macOS:**
```bash
cp .env.example .env
```

**Windows (PowerShell):**
```powershell
copy .env.example .env
```

**Windows (cmd.exe):**
```batch
copy .env.example .env
```

Edit `.env` and configure your settings. Key variables:
- `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` - Database connection
- `REDIS_HOST`, `REDIS_PORT` - Redis connection
- `SECRET_KEY` - Generate with `openssl rand -hex 32` (or use Python's `secrets` module on Windows)
- `AI_DEVICE` - Use `cuda` for GPU, `cpu` for CPU-only
- `DEBUG` - Set to `false` in production

**Windows-specific notes:**
- Use `localhost` for `DB_HOST` and `REDIS_HOST` when running services locally
- For AI features, set `AI_DEVICE=cpu` if you don't have an NVIDIA GPU

### 3. Setup PostgreSQL

**Linux:**
```bash
# Start PostgreSQL
sudo service postgresql start

# Or on systemd-based systems
sudo systemctl start postgresql
```

**macOS:**
```bash
# If installed via Homebrew
brew services start postgresql@15
```

**Windows:**
```powershell
# Check if PostgreSQL service is running
Get-Service -Name "postgresql*"

# Start the service if needed
Start-Service postgresql-x64-15  # Adjust version number
```

Create database and user:

**Linux/macOS:**
```bash
sudo -u postgres psql << EOF
CREATE USER horalix WITH PASSWORD 'horalix';
CREATE DATABASE horalix_view OWNER horalix;
GRANT ALL PRIVILEGES ON DATABASE horalix_view TO horalix;
\c horalix_view
GRANT ALL PRIVILEGES ON SCHEMA public TO horalix;
GRANT CREATE ON SCHEMA public TO horalix;
EOF
```

**Windows:**
```powershell
# Connect as postgres superuser
psql -U postgres

# Then run these SQL commands:
# CREATE USER horalix WITH PASSWORD 'horalix';
# CREATE DATABASE horalix_view OWNER horalix;
# GRANT ALL PRIVILEGES ON DATABASE horalix_view TO horalix;
# \c horalix_view
# GRANT ALL PRIVILEGES ON SCHEMA public TO horalix;
# GRANT CREATE ON SCHEMA public TO horalix;
# \q
```

Or use a one-liner in PowerShell:
```powershell
psql -U postgres -c "CREATE USER horalix WITH PASSWORD 'horalix';"
psql -U postgres -c "CREATE DATABASE horalix_view OWNER horalix;"
psql -U postgres -d horalix_view -c "GRANT ALL PRIVILEGES ON SCHEMA public TO horalix; GRANT CREATE ON SCHEMA public TO horalix;"
```

### 4. Run Database Migrations

```bash
alembic upgrade head
```

Verify migrations:
```bash
alembic current
```

### 5. Start the Application

Development mode (with auto-reload):

**Linux/macOS:**
```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

**Windows:**
```powershell
# If using virtual environment, activate it first:
.\venv\Scripts\Activate.ps1

# Start server
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Production mode:

**Linux/macOS:**
```bash
python3 -m app.main
```

**Windows:**
```powershell
python -m app.main
```

Or with explicit uvicorn (production):
```bash
# Linux/macOS
uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 4

# Windows (workers parameter is ignored on Windows, use single process)
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

**Note:** Uvicorn's `--workers` parameter doesn't work on Windows. For production on Windows, use a process manager like NSSM or run multiple instances behind a load balancer.

## Verifying the Installation

Once the application is running, you can verify it's working:

1. **Health Check**:
   ```bash
   curl http://localhost:8000/health
   ```
   Should return: `{"status":"healthy","version":"1.0.0","environment":"development"}`

2. **Readiness Check**:
   ```bash
   curl http://localhost:8000/ready
   ```
   Should show database and service status.

3. **API Documentation**:
   Open in browser: `http://localhost:8000/docs`

4. **Check Database Tables**:
   ```bash
   sudo -u postgres psql -d horalix_view -c "\dt"
   ```
   Should show: patients, studies, series, instances, users, ai_jobs, audit_logs, annotations

## Database Management

### Check Migration Status
```bash
alembic current
```

### View Migration History
```bash
alembic history
```

### Upgrade to Latest Version
```bash
alembic upgrade head
```

### Downgrade One Version
```bash
alembic downgrade -1
```

### Reset Database (CAUTION: Deletes all data)
```bash
sudo -u postgres psql -d horalix_view -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
sudo -u postgres psql -d horalix_view -c "GRANT ALL PRIVILEGES ON SCHEMA public TO horalix; GRANT CREATE ON SCHEMA public TO horalix;"
alembic upgrade head
```

## Common Issues and Solutions

### Issue: `alembic: command not found`
**Solution**: Install dependencies: `pip3 install -e .`

### Issue: `password authentication failed for user "horalix"`
**Solution**:
1. Reset password: `sudo -u postgres psql -c "ALTER USER horalix WITH PASSWORD 'horalix';"`
2. Ensure `.env` file has correct `DB_PASSWORD=horalix`

### Issue: `no schema has been selected to create in`
**Solution**: Grant schema permissions:
```bash
sudo -u postgres psql -d horalix_view -c "GRANT ALL PRIVILEGES ON SCHEMA public TO horalix; GRANT CREATE ON SCHEMA public TO horalix;"
```

### Issue: Environment variables not loading
**Solution**: The `.env` file is automatically loaded from the backend directory. If issues persist, verify:
1. `.env` file exists in the `backend/` directory
2. File is properly formatted (no extra quotes)
3. Run from the `backend/` directory

### Issue: Port already in use
**Solution**: Change port in `.env` file or stop the other service:
```bash
# Check what's using port 8000
lsof -i :8000
# Kill the process
kill -9 <PID>
```

## Project Structure

```
backend/
├── app/
│   ├── api/              # API endpoints
│   ├── core/             # Core configuration
│   ├── models/           # Database models
│   └── services/         # Business logic
├── alembic/              # Database migrations
├── tests/                # Test files
├── .env                  # Environment configuration
├── alembic.ini           # Alembic configuration
├── pyproject.toml        # Project dependencies
└── setup.sh              # Automated setup script
```

## Development

### Running Tests
```bash
pytest
```

### Code Formatting
```bash
black app/ tests/
```

### Linting
```bash
ruff check app/ tests/
```

### Type Checking
```bash
mypy app/
```

## Production Deployment

For production deployment:

1. Set environment variables:
   ```bash
   export ENVIRONMENT=production
   export DEBUG=false
   export SECRET_KEY=$(openssl rand -hex 32)
   ```

2. Use a production WSGI server (already configured with uvicorn)

3. Enable HTTPS/TLS

4. Configure proper database credentials

5. Set up monitoring and logging

6. Configure backup strategy for PostgreSQL

## Support

For issues or questions:
- Check the main README.md
- Review error logs in the application output
- Check database logs: `/var/log/postgresql/`

## Next Steps

After setup:
1. Create an admin user through the API
2. Configure DICOM storage paths
3. Set up AI model weights (optional)
4. Configure CORS origins for frontend
5. Review security settings for production
