# Horalix View - Windows Setup Guide

This guide provides complete instructions for setting up and running Horalix View on Windows 10/11.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Detailed Setup](#detailed-setup)
  - [Installing PostgreSQL](#installing-postgresql)
  - [Installing Redis](#installing-redis)
  - [Installing Python](#installing-python)
  - [Installing Node.js](#installing-nodejs)
- [Backend Setup](#backend-setup)
- [Frontend Setup](#frontend-setup)
- [Running the Application](#running-the-application)
- [Troubleshooting](#troubleshooting)
- [Development on Windows](#development-on-windows)

---

## Prerequisites

### Required Software

- **Windows 10** or **Windows 11** (64-bit)
- **Python 3.10, 3.11, or 3.12** (64-bit)
- **Node.js 18+** and **npm 9+**
- **PostgreSQL 14+**
- **Redis 7+** (or Redis on WSL/Docker)
- **Git for Windows** (optional but recommended)

### Hardware Requirements

**Minimum:**
- CPU: 4 cores (Intel i5 or AMD Ryzen 5)
- RAM: 8GB
- Storage: 50GB SSD
- Display: 1920x1080

**Recommended (with AI):**
- CPU: 8+ cores (Intel i7/i9 or AMD Ryzen 7/9)
- RAM: 16GB+
- GPU: NVIDIA GPU with 8GB+ VRAM (RTX 3060 or better)
- Storage: 500GB+ NVMe SSD
- Display: 2560x1440 or higher

---

## Quick Start

### Option 1: Using PowerShell (Recommended)

1. **Open PowerShell as Administrator**
   - Press `Win + X` and select "Windows PowerShell (Admin)" or "Windows Terminal (Admin)"

2. **Clone the repository:**
   ```powershell
   git clone https://github.com/horalix/horalix-view.git
   cd horalix-view\backend
   ```

3. **Run the setup script:**
   ```powershell
   .\setup.ps1
   ```

   If you get an execution policy error, run:
   ```powershell
   Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
   .\setup.ps1
   ```

4. **Start the backend:**
   ```powershell
   python -m app.main
   ```

5. **In a new terminal, start the frontend:**
   ```powershell
   cd ..\frontend
   npm install
   npm run dev
   ```

### Option 2: Using Command Prompt (cmd.exe)

1. **Open Command Prompt as Administrator**
   - Press `Win + R`, type `cmd`, press `Ctrl + Shift + Enter`

2. **Clone the repository:**
   ```batch
   git clone https://github.com/horalix/horalix-view.git
   cd horalix-view\backend
   ```

3. **Run the setup script:**
   ```batch
   setup.bat
   ```

4. **Start the backend:**
   ```batch
   python -m app.main
   ```

5. **In a new terminal, start the frontend:**
   ```batch
   cd ..\frontend
   npm install
   npm run dev
   ```

---

## Detailed Setup

### Installing PostgreSQL

1. **Download PostgreSQL:**
   - Visit: https://www.postgresql.org/download/windows/
   - Download the latest version (14.x or higher)

2. **Run the installer:**
   - Double-click the downloaded `.exe` file
   - **Important:** Remember the password you set for the `postgres` superuser!
   - Default port: `5432` (recommended)
   - Select components:
     - ✅ PostgreSQL Server
     - ✅ pgAdmin 4
     - ✅ Command Line Tools

3. **Add PostgreSQL to PATH:**
   - The installer should do this automatically
   - If not, add `C:\Program Files\PostgreSQL\15\bin` to your PATH:
     1. Press `Win + X` → System → Advanced system settings
     2. Click "Environment Variables"
     3. Under "System variables", find "Path", click "Edit"
     4. Click "New" and add: `C:\Program Files\PostgreSQL\15\bin`
     5. Click "OK" on all dialogs

4. **Verify installation:**
   ```powershell
   psql --version
   ```

5. **Configure PostgreSQL for local connections:**
   - Open `pg_hba.conf` (usually in `C:\Program Files\PostgreSQL\15\data\pg_hba.conf`)
   - Ensure there's a line like:
     ```
     host    all             all             127.0.0.1/32            scram-sha-256
     ```
   - Restart PostgreSQL service after changes

### Installing Redis

Redis doesn't have official Windows support, but there are several options:

#### Option 1: Redis on WSL2 (Recommended)

1. **Install WSL2:**
   ```powershell
   wsl --install
   ```

2. **Install Redis in WSL:**
   ```bash
   sudo apt update
   sudo apt install redis-server
   sudo service redis-server start
   ```

3. **Make Redis accessible from Windows:**
   - Redis will be available at `localhost:6379` from Windows

#### Option 2: Memurai (Redis-compatible for Windows)

1. **Download Memurai:**
   - Visit: https://www.memurai.com/get-memurai
   - Download the free developer edition

2. **Install Memurai:**
   - Run the installer
   - Memurai will run as a Windows service on port `6379`

3. **Verify installation:**
   ```powershell
   memurai-cli ping
   # Should return: PONG
   ```

#### Option 3: Docker Desktop

1. **Install Docker Desktop:**
   - Visit: https://www.docker.com/products/docker-desktop/
   - Download and install Docker Desktop for Windows

2. **Run Redis container:**
   ```powershell
   docker run -d -p 6379:6379 --name redis redis:7-alpine
   ```

### Installing Python

1. **Download Python:**
   - Visit: https://www.python.org/downloads/
   - Download Python 3.10, 3.11, or 3.12 (64-bit)

2. **Run the installer:**
   - **IMPORTANT:** Check "Add Python to PATH"
   - Click "Install Now"
   - Recommended: Install for all users

3. **Verify installation:**
   ```powershell
   python --version
   pip --version
   ```

4. **Upgrade pip (recommended):**
   ```powershell
   python -m pip install --upgrade pip
   ```

### Installing Node.js

1. **Download Node.js:**
   - Visit: https://nodejs.org/
   - Download the LTS version (18.x or higher)

2. **Run the installer:**
   - Accept defaults
   - Includes npm package manager

3. **Verify installation:**
   ```powershell
   node --version
   npm --version
   ```

---

## Backend Setup

### 1. Create Virtual Environment (Recommended)

```powershell
cd horalix-view\backend

# Create virtual environment
python -m venv venv

# Activate it (PowerShell)
.\venv\Scripts\Activate.ps1

# Or in cmd.exe
venv\Scripts\activate.bat
```

### 2. Install Dependencies

```powershell
# Core dependencies
pip install -e .

# With AI models (requires CUDA for GPU support)
pip install -e ".[ai]"

# Development tools
pip install -e ".[dev]"
```

### 3. Configure Environment

```powershell
# Copy example environment file
copy .env.example .env

# Edit .env with your favorite editor
notepad .env
```

**Important settings in `.env`:**

```bash
# Database (for local PostgreSQL)
DB_HOST=localhost
DB_PORT=5432
DB_USER=horalix
DB_PASSWORD=horalix
DB_NAME=horalix_view

# Redis (for local Redis/Memurai)
REDIS_HOST=localhost
REDIS_PORT=6379

# AI Settings (use 'cpu' if no NVIDIA GPU)
AI_DEVICE=cuda  # or 'cpu' for CPU-only
AI_MODELS_DIR=./models
AI_ENABLED=true

# Security (GENERATE A NEW KEY!)
SECRET_KEY=generate-with-openssl-rand-hex-32

# Development
DEBUG=true
ENVIRONMENT=development
```

### 4. Run Setup Script

**PowerShell:**
```powershell
.\setup.ps1
```

**Command Prompt:**
```batch
setup.bat
```

**Or manually:**
```powershell
# Create database and user
psql -U postgres -c "CREATE USER horalix WITH PASSWORD 'horalix';"
psql -U postgres -c "CREATE DATABASE horalix_view OWNER horalix;"
psql -U postgres -d horalix_view -c "GRANT ALL PRIVILEGES ON SCHEMA public TO horalix;"

# Run migrations
alembic upgrade head
```

### 5. Verify Setup

```powershell
# Check migration status
alembic current

# Should show the latest migration
```

---

## Frontend Setup

```powershell
cd horalix-view\frontend

# Install dependencies
npm install

# Or use npm ci for clean install
npm ci
```

---

## Running the Application

### Development Mode

**Terminal 1 - Backend:**
```powershell
cd horalix-view\backend

# Activate virtual environment if created
.\venv\Scripts\Activate.ps1

# Start backend with auto-reload
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

**Terminal 2 - Frontend:**
```powershell
cd horalix-view\frontend

# Start Vite dev server
npm run dev
```

**Access the application:**
- Frontend: http://localhost:5173
- Backend API: http://localhost:8000
- API Docs: http://localhost:8000/docs

### Production Mode (Windows Server)

**Backend (as Windows Service):**

1. **Install NSSM (Non-Sucking Service Manager):**
   ```powershell
   choco install nssm
   ```

2. **Create service:**
   ```powershell
   nssm install HoralixViewBackend "C:\Path\To\Python\python.exe" "-m app.main"
   nssm set HoralixViewBackend AppDirectory "C:\Path\To\horalix-view\backend"
   nssm set HoralixViewBackend AppEnvironmentExtra "ENVIRONMENT=production" "DEBUG=false"
   nssm start HoralixViewBackend
   ```

**Frontend (build and serve):**
```powershell
cd horalix-view\frontend

# Build production bundle
npm run build

# Serve with a web server (IIS, Nginx, or http-server)
npx http-server dist -p 3000
```

---

## Troubleshooting

### PostgreSQL Issues

#### "psql: error: connection to server at localhost (::1), port 5432 failed"

**Solution:**
1. Check if PostgreSQL service is running:
   ```powershell
   Get-Service -Name "postgresql*"
   ```

2. Start the service:
   ```powershell
   Start-Service postgresql-x64-15  # Adjust version number
   ```

3. Or use Services GUI (`services.msc`)

#### "password authentication failed for user postgres"

**Solution:**
```powershell
# Reset postgres password
# Edit pg_hba.conf and temporarily change 'scram-sha-256' to 'trust'
# Restart PostgreSQL service
# Then run:
psql -U postgres -c "ALTER USER postgres WITH PASSWORD 'newpassword';"
# Change pg_hba.conf back to 'scram-sha-256'
# Restart PostgreSQL service
```

### Redis Issues

#### "Error connecting to Redis: Connection refused"

**Solution:**
- If using WSL: `wsl sudo service redis-server start`
- If using Memurai: Check Memurai service is running in Services
- If using Docker: `docker start redis`

### Python Issues

#### "'python' is not recognized as an internal or external command"

**Solution:**
1. Reinstall Python and check "Add Python to PATH"
2. Or manually add Python to PATH:
   - Usually: `C:\Users\<YourUsername>\AppData\Local\Programs\Python\Python311`

#### "Microsoft Visual C++ 14.0 or greater is required"

**Solution:**
- Install Microsoft C++ Build Tools:
  - Visit: https://visualstudio.microsoft.com/visual-cpp-build-tools/
  - Download and install "Desktop development with C++"

### NVIDIA GPU / CUDA Issues

#### "torch.cuda.is_available() returns False"

**Solution:**
1. Install NVIDIA GPU drivers from: https://www.nvidia.com/download/index.aspx
2. Install CUDA Toolkit 11.8 or 12.1: https://developer.nvidia.com/cuda-downloads
3. Reinstall PyTorch with CUDA support:
   ```powershell
   pip uninstall torch torchvision
   pip install torch torchvision --index-url https://download.pytorch.org/whl/cu121
   ```

4. Verify:
   ```powershell
   python -c "import torch; print(torch.cuda.is_available())"
   # Should print: True
   ```

### Port Already in Use

#### "Error: [WinError 10048] Only one usage of each socket address"

**Solution:**
```powershell
# Find process using port 8000
netstat -ano | findstr :8000

# Kill the process (replace <PID> with actual Process ID)
taskkill /F /PID <PID>
```

### Long Path Issues

Windows has a 260-character path limit by default. To enable long paths:

1. **Enable via Registry:**
   - Press `Win + R`, type `regedit`
   - Navigate to: `HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Control\FileSystem`
   - Set `LongPathsEnabled` to `1`

2. **Enable via Group Policy:**
   - Press `Win + R`, type `gpedit.msc`
   - Navigate to: Computer Configuration → Administrative Templates → System → Filesystem
   - Enable "Enable Win32 long paths"

3. **Restart your computer**

---

## Development on Windows

### Recommended Tools

- **Windows Terminal** - Modern terminal with tabs and customization
- **Visual Studio Code** - Excellent Python and TypeScript support
- **PyCharm Professional** - Full-featured Python IDE (free for students)
- **Git for Windows** - Includes Git Bash for Unix-like commands

### VS Code Extensions

- Python (Microsoft)
- Pylance
- ESLint
- Prettier
- Docker (if using Docker)
- GitLens
- PostgreSQL (by Chris Kolkman)

### Environment Variables

Set environment variables for the current session:
```powershell
# PowerShell
$env:DB_HOST = "localhost"
$env:AI_DEVICE = "cuda"

# Cmd.exe
set DB_HOST=localhost
set AI_DEVICE=cuda
```

Permanently set system environment variables:
```powershell
[System.Environment]::SetEnvironmentVariable('DB_HOST', 'localhost', 'User')
```

### File Permissions

Windows doesn't use Unix-style permissions. The Python code automatically handles this with `pathlib`, which is cross-platform.

### Line Endings

Git on Windows may convert line endings (LF ↔ CRLF). Configure Git:

```powershell
# Recommended: Convert to LF on commit, CRLF on checkout
git config --global core.autocrlf true

# Or: Keep LF everywhere (like Linux)
git config --global core.autocrlf input
```

### Running Tests

```powershell
# Backend tests
cd horalix-view\backend
pytest

# Frontend tests
cd horalix-view\frontend
npm test
```

### Code Quality Tools

```powershell
# Backend
black app\ tests\
ruff check app\ tests\
mypy app\

# Frontend
npm run lint
npm run format
npm run type-check
```

---

## Performance Tips

1. **Use SSD for storage** - Dramatically faster than HDD
2. **Disable Windows Defender exclusions** - Add Python and Node.js directories
3. **Use native Python** - Don't run Python through WSL for the backend
4. **Enable GPU acceleration** - Install CUDA and cuDNN for AI features
5. **Increase PostgreSQL shared_buffers** - Edit `postgresql.conf`:
   ```
   shared_buffers = 2GB  # For systems with 8GB+ RAM
   effective_cache_size = 6GB
   ```

---

## Next Steps

After successful setup:

1. **Create an admin user** (when user management is implemented)
2. **Upload sample DICOM files** to test the viewer
3. **Download AI model weights** if using AI features (see main README)
4. **Configure CORS** if accessing from different domains
5. **Review security settings** before deploying to production

---

## Additional Resources

- **PostgreSQL on Windows:** https://www.postgresql.org/docs/current/install-windows.html
- **Python on Windows:** https://docs.python.org/3/using/windows.html
- **Node.js on Windows:** https://nodejs.org/en/download/package-manager/
- **CUDA on Windows:** https://docs.nvidia.com/cuda/cuda-installation-guide-microsoft-windows/

---

## Getting Help

- **GitHub Issues:** https://github.com/horalix/horalix-view/issues
- **Discussions:** https://github.com/horalix/horalix-view/discussions
- **Email Support:** support@horalix.io

---

**Windows-specific issues?** Please report them on GitHub with:
- Windows version (e.g., Windows 11 22H2)
- Python version
- Full error message
- Steps to reproduce
