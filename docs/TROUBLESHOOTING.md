# Horalix View - Troubleshooting Guide

A comprehensive guide for diagnosing and resolving common issues.

---

## Quick Diagnosis Commands

```bash
# Check all services are running
docker compose ps

# View backend logs
docker compose logs -f backend

# Check backend health
curl http://localhost:8000/health

# Check database connectivity
docker compose exec backend python -c "from app.core.config import settings; print(settings.database_url)"

# Run doctor script
./scripts/doctor.sh --check-env
```

---

## Installation Issues

### "SECRET_KEY is not set" or "Insecure SECRET_KEY"

**Symptom:** Backend refuses to start with security warning.

**Cause:** Missing or insecure SECRET_KEY environment variable.

**Fix:**
```bash
# Generate a secure key
openssl rand -hex 32

# Add to .env file
echo "SECRET_KEY=your-generated-key-here" >> .env
```

### "Module not found: pydicom"

**Symptom:** ImportError when starting backend.

**Cause:** Dependencies not installed.

**Fix:**
```bash
cd backend
pip install -e ".[dev]"
```

### npm install fails with ERESOLVE

**Symptom:** Peer dependency conflicts during npm install.

**Cause:** Conflicting package versions.

**Fix:**
```bash
cd frontend
rm -rf node_modules package-lock.json
npm install --legacy-peer-deps
```

---

## Database Issues

### "Connection refused" to PostgreSQL

**Symptom:** Backend can't connect to database.

**Cause:** PostgreSQL not running or wrong connection string.

**Fix:**
```bash
# Check if PostgreSQL is running
docker compose ps postgres
docker compose logs postgres

# If using local PostgreSQL
pg_isready -h localhost -p 5432

# Verify connection string in .env
DATABASE_URL=postgresql+asyncpg://user:password@localhost:5432/horalix_view
```

### "Relation does not exist"

**Symptom:** Database queries fail with missing table errors.

**Cause:** Migrations haven't been run.

**Fix:**
```bash
cd backend
alembic upgrade head
```

### Migration conflicts

**Symptom:** "Can't locate revision identified by" errors.

**Cause:** Migration history out of sync.

**Fix:**
```bash
# Check current state
alembic current

# Stamp to a known state (use with caution)
alembic stamp head

# Or recreate migrations
alembic downgrade base
alembic upgrade head
```

### "Index already exists" error

**Symptom:** Tests fail with duplicate index errors.

**Cause:** Duplicate index definitions in models (index=True on column + explicit Index in __table_args__).

**Fix:** This was fixed in the Annotation model. If you see similar issues, check for duplicate index definitions.

---

## Redis Issues

### "Connection refused" to Redis

**Symptom:** Redis operations fail.

**Cause:** Redis not running or wrong URL.

**Fix:**
```bash
# Check Redis status
docker compose ps redis
docker compose logs redis

# Test connection
redis-cli -h localhost ping

# Verify Redis URL in .env
REDIS_URL=redis://localhost:6379/0
```

### "Redis required for Windows"

**Symptom:** Can't run Redis natively on Windows.

**Cause:** Redis doesn't run natively on Windows.

**Fix:**
- Use Docker: `docker run -d -p 6379:6379 redis:7`
- Use WSL2 with Linux Redis
- Use Memurai (Windows Redis alternative)

---

## Frontend Issues

### "Module not found" errors during build

**Symptom:** Vite build fails with missing module.

**Cause:** Missing dependencies or import errors.

**Fix:**
```bash
cd frontend
rm -rf node_modules
npm install
npm run build
```

### TypeScript errors

**Symptom:** Type check fails.

**Cause:** Type mismatches or missing types.

**Fix:**
```bash
# Run type check to see errors
npm run type-check

# If types are genuinely wrong, fix them
# If external library types are missing:
npm install -D @types/package-name
```

### ESLint errors

**Symptom:** Lint check fails.

**Cause:** Code doesn't meet linting standards.

**Fix:**
```bash
# Auto-fix what can be fixed
npm run lint:fix

# Check remaining issues
npm run lint
```

### Tests fail with "useAuth must be used within an AuthProvider"

**Symptom:** Frontend tests fail with context errors.

**Cause:** Components using auth hook without provider.

**Fix:** Wrap test render with required providers:
```tsx
render(
  <QueryClientProvider client={queryClient}>
    <BrowserRouter>
      <AuthProvider>
        <YourComponent />
      </AuthProvider>
    </BrowserRouter>
  </QueryClientProvider>
);
```

---

## Backend Issues

### Import errors on startup

**Symptom:** Backend fails to import modules.

**Cause:** Dependencies not installed or Python version mismatch.

**Fix:**
```bash
# Verify Python version
python3 --version  # Should be 3.10+

# Reinstall dependencies
cd backend
pip install -e ".[dev]"
```

### "No module named 'aiosqlite'"

**Symptom:** Tests fail with aiosqlite import error.

**Cause:** Missing test dependency.

**Fix:**
```bash
pip install aiosqlite
```

### Ruff errors

**Symptom:** Ruff check fails.

**Cause:** Code doesn't meet linting standards.

**Fix:**
```bash
cd backend
# Auto-fix issues
ruff check app tests --fix

# Check remaining
ruff check app tests
```

### mypy errors

**Symptom:** Type checking fails.

**Cause:** Type annotation issues.

**Fix:**
```bash
# Check errors
mypy app

# Common fixes:
# - Add type annotations
# - Use proper Optional types
# - Add type: ignore comments for library issues
```

---

## AI/ML Issues

### "Model weights not found"

**Symptom:** AI endpoints return 424/503 errors.

**Cause:** Model weights not downloaded.

**Fix:**
```bash
# Create models directory
mkdir -p models/yolov8

# Download YOLOv8
pip install ultralytics
python -c "from ultralytics import YOLO; YOLO('yolov8n.pt')"
mv yolov8n.pt models/yolov8/model.pt

# Check AI_MODELS_DIR in .env
AI_MODELS_DIR=./models
```

### CUDA out of memory

**Symptom:** Inference fails with OOM errors.

**Cause:** GPU memory insufficient for model.

**Fix:**
```bash
# Reduce batch size in .env
AI_BATCH_SIZE=1

# Or use CPU
AI_DEVICE=cpu

# Or use mixed precision
AI_MIXED_PRECISION=true
```

---

## Docker Issues

### "Cannot connect to Docker daemon"

**Symptom:** Docker commands fail.

**Cause:** Docker daemon not running.

**Fix:**
```bash
# Linux
sudo systemctl start docker

# macOS
open -a Docker

# Windows
# Start Docker Desktop from Start Menu
```

### Container keeps restarting

**Symptom:** Service in restart loop.

**Cause:** Application crashing on startup.

**Fix:**
```bash
# Check logs
docker compose logs backend

# Common causes:
# - Missing environment variables
# - Database not ready
# - Port already in use
```

### Port already in use

**Symptom:** "Address already in use" errors.

**Cause:** Another process using the port.

**Fix:**
```bash
# Find process using port (Linux/macOS)
lsof -i :8000

# Kill the process
kill -9 <PID>

# Or change the port in docker-compose.yml
```

---

## Network Issues

### CORS errors

**Symptom:** Frontend can't reach backend, CORS errors in console.

**Cause:** CORS not configured for frontend origin.

**Fix:**
```bash
# In backend/.env
CORS_ORIGINS=["http://localhost:3000", "http://localhost:5173"]
```

### "fetch failed" errors

**Symptom:** Frontend API calls fail silently.

**Cause:** Backend not reachable or wrong API URL.

**Fix:**
```bash
# Check backend is running
curl http://localhost:8000/health

# Check frontend env
# frontend/.env
VITE_API_URL=http://localhost:8000
```

---

## Test Issues

### pytest-cov unrecognized argument

**Symptom:** pytest fails with "unrecognized arguments: --cov"

**Cause:** pytest-cov not installed or version mismatch.

**Fix:**
```bash
# Run without coverage options
python -m pytest -v -o addopts=

# Or install pytest-cov
pip install pytest-cov
```

### Tests hang indefinitely

**Symptom:** Tests never complete.

**Cause:** Async tests not properly configured or deadlock.

**Fix:**
```bash
# Add timeout
pytest --timeout=60

# Check for unclosed async resources
# Ensure fixtures properly clean up
```

---

## Performance Issues

### Slow image loading

**Symptom:** DICOM images take long to display.

**Cause:** Large images without optimization.

**Fix:**
- Enable image compression
- Use web workers for decoding
- Implement progressive loading
- Check network bandwidth

### High memory usage

**Symptom:** Application using too much RAM.

**Cause:** Loading too many images, memory leaks.

**Fix:**
- Implement virtual scrolling
- Limit concurrent image loads
- Review for memory leaks
- Increase container memory limits

---

## Getting Help

If you can't resolve your issue:

1. Check the logs thoroughly
2. Run `./scripts/doctor.sh --all`
3. Search existing [GitHub Issues](https://github.com/Kerim-Sabic/horalix-view/issues)
4. Create a new issue with:
   - Error message
   - Steps to reproduce
   - Environment details (OS, versions)
   - Relevant log output
