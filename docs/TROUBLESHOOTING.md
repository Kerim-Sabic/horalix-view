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

## Authentication Issues

### Login fails but no error message shows

**Symptom:** Login form submits but nothing happens, or user stays on login page.

**Cause:** Frontend may have an older version expecting `user` object directly in token response.

**Fix:**
1. Ensure `frontend/src/services/authService.ts` uses `TokenResponse` interface
2. Ensure `frontend/src/contexts/AuthContext.tsx` fetches user via `/auth/me` after storing token
3. Rebuild the frontend: `npm run build`

### "user is undefined" after login

**Symptom:** Login succeeds but dashboard shows blank user or errors.

**Cause:** Token stored but user data not fetched.

**Fix:**
```typescript
// In AuthContext.tsx login function:
const tokenResponse = await authService.login(credentials);
localStorage.setItem('access_token', tokenResponse.access_token);
const userData = await authService.getCurrentUser();  // Required!
setUser(userData);
```

### "Incorrect username or password" when credentials are correct

**Symptom:** Valid credentials rejected.

**Cause:** Default users may not be created, or password encoding issue.

**Fix:**
```bash
# Check if users exist
docker compose exec backend python -c "
from app.models.user import User
from app.models.base import async_session_maker
import asyncio

async def check():
    async with async_session_maker() as db:
        from sqlalchemy import select
        result = await db.execute(select(User))
        users = result.scalars().all()
        for u in users:
            print(f'{u.username}: {u.is_active}')
asyncio.run(check())
"

# Create admin manually if needed
docker compose exec backend python -m app.cli create-admin \
  --username admin --email admin@local.dev --password admin123
```

### "Account is temporarily locked"

**Symptom:** Cannot login even with correct password.

**Cause:** Too many failed login attempts (5+ triggers 30-minute lockout).

**Fix:**
```bash
# Wait 30 minutes, or reset via database
docker compose exec postgres psql -U horalix -d horalix_view -c \
  "UPDATE users SET is_locked=false, failed_login_attempts=0 WHERE username='admin';"
```

### Token expires too quickly

**Symptom:** User gets logged out frequently.

**Cause:** Short token expiration configured.

**Fix:**
```bash
# In .env, increase expiration (default is 60 minutes)
ACCESS_TOKEN_EXPIRE_MINUTES=480  # 8 hours
```

---

## Frontend Issues

### Blank Screen After Login

**Symptom:** After logging in successfully, the dashboard briefly appears then goes blank (white screen).

**Cause:** Multiple potential causes:
1. Missing `/dashboard/stats` backend endpoint returning 404
2. Hard page redirect on 401 errors losing React state
3. No error boundary to catch rendering errors
4. API response format mismatch between frontend/backend

**Fix:**
1. Ensure dashboard endpoint exists:
```bash
curl -X GET http://localhost:8000/api/v1/dashboard/stats \
  -H "Authorization: Bearer <your-token>"
```

2. Check browser console for JavaScript errors
3. Check network tab for failed API calls (404, 401 errors)
4. Verify the frontend build is up to date:
```bash
cd frontend
npm run build
```

5. If using development mode, restart the dev server:
```bash
npm run dev
```

**Detailed Analysis:** See [BLANK_SCREEN_ROOT_CAUSE.md](./BLANK_SCREEN_ROOT_CAUSE.md) for complete root cause analysis.

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

## DICOM Issues

### DICOM upload fails

**Symptom:** Upload returns error or times out.

**Cause:** File too large, invalid format, or storage not writable.

**Fix:**
```bash
# Check storage directory exists and is writable
docker compose exec backend ls -la /app/storage/dicom

# Check upload limits in nginx (if using)
# In nginx.conf: client_max_body_size 500M;

# Check DICOM file validity
python -c "import pydicom; ds = pydicom.dcmread('your_file.dcm'); print(ds.PatientName)"
```

### "Invalid DICOM file" error

**Symptom:** Backend rejects valid DICOM files.

**Cause:** File is corrupted or missing required tags.

**Fix:**
```bash
# Validate DICOM file
python -c "
import pydicom
ds = pydicom.dcmread('file.dcm')
required = ['PatientName', 'PatientID', 'StudyInstanceUID', 'SeriesInstanceUID', 'SOPInstanceUID']
for tag in required:
    print(f'{tag}: {getattr(ds, tag, \"MISSING\")}')"
```

### DICOM viewer shows blank or wrong images

**Symptom:** Images don't render correctly in viewer.

**Cause:** Pixel data encoding issues or transfer syntax not supported.

**Fix:**
1. Check browser console for errors
2. Verify transfer syntax is supported:
```bash
python -c "
import pydicom
ds = pydicom.dcmread('file.dcm')
print(f'Transfer Syntax: {ds.file_meta.TransferSyntaxUID}')"
```
3. Ensure Cornerstone codecs are loaded for compressed transfer syntaxes

### Study not appearing in list after upload

**Symptom:** Upload succeeds but study isn't visible.

**Cause:** Database record not created or query filter mismatch.

**Fix:**
```bash
# Check study exists in database
docker compose exec postgres psql -U horalix -d horalix_view -c \
  "SELECT study_instance_uid, patient_name, study_date FROM studies ORDER BY created_at DESC LIMIT 5;"

# Check backend logs for errors
docker compose logs backend | grep -i error
```

### Window/Level appears wrong

**Symptom:** Image too dark, too bright, or no contrast.

**Cause:** DICOM has unusual rescale slope/intercept or no window center/width.

**Fix:**
```bash
# Check DICOM window values
python -c "
import pydicom
ds = pydicom.dcmread('file.dcm')
print(f'WindowCenter: {getattr(ds, \"WindowCenter\", \"Not set\")}')
print(f'WindowWidth: {getattr(ds, \"WindowWidth\", \"Not set\")}')
print(f'RescaleSlope: {getattr(ds, \"RescaleSlope\", 1)}')
print(f'RescaleIntercept: {getattr(ds, \"RescaleIntercept\", 0)}')"
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
