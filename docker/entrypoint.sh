#!/bin/sh
# Entrypoint script for Horalix View backend Docker container
# This script validates environment, runs database migrations, and starts the application.

set -e  # Exit on error

echo "==================================="
echo " Horalix View Backend Starting"
echo "==================================="

# -----------------------------------------------------------------------------
# Environment Validation
# -----------------------------------------------------------------------------

echo ""
echo "Checking environment configuration..."

# Check for SECRET_KEY
if [ -z "$SECRET_KEY" ]; then
    if [ "$ENVIRONMENT" = "production" ]; then
        echo "ERROR: SECRET_KEY environment variable is required in production!"
        echo ""
        echo "Generate a secure key with:"
        echo "  openssl rand -hex 32"
        echo ""
        echo "Then set it in your .env file or Docker environment."
        exit 1
    else
        echo "WARNING: SECRET_KEY not set. Using temporary development key."
        echo "         DO NOT use this in production!"
        export SECRET_KEY="dev-only-insecure-key-$(cat /dev/urandom | tr -dc 'a-zA-Z0-9' | fold -w 32 | head -n 1)"
    fi
else
    echo "  SECRET_KEY: [configured]"
fi

# Check DATABASE_URL
if [ -z "$DATABASE_URL" ]; then
    echo "  DATABASE_URL: [using default: postgres container]"
    export DATABASE_URL="postgresql+asyncpg://horalix:horalix@postgres:5432/horalix_view"
else
    echo "  DATABASE_URL: [configured]"
fi

# Display other key settings
echo "  ENVIRONMENT: ${ENVIRONMENT:-development}"
echo "  DEBUG: ${DEBUG:-true}"
echo "  AI_DEVICE: ${AI_DEVICE:-cpu}"

# -----------------------------------------------------------------------------
# Wait for PostgreSQL
# -----------------------------------------------------------------------------

echo ""
echo "Waiting for database to be ready..."

# Extract host from DATABASE_URL or use default
DB_HOST="${DB_HOST:-postgres}"
DB_USER="${DB_USER:-horalix}"
DB_NAME="${DB_NAME:-horalix_view}"

max_retries=30
retry_count=0

until PGPASSWORD="${DB_PASSWORD:-horalix}" psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -c '\q' 2>/dev/null; do
    retry_count=$((retry_count + 1))
    if [ "$retry_count" -ge "$max_retries" ]; then
        echo ""
        echo "ERROR: Database is not available after $max_retries attempts"
        echo ""
        echo "Troubleshooting:"
        echo "  1. Check if postgres container is running: docker compose ps"
        echo "  2. Check postgres logs: docker compose logs postgres"
        echo "  3. Verify DATABASE_URL is correct"
        echo "  4. Ensure postgres healthcheck is passing"
        exit 1
    fi
    echo "  Database not ready yet, waiting... ($retry_count/$max_retries)"
    sleep 2
done

echo "  Database is ready!"

# -----------------------------------------------------------------------------
# Run Database Migrations
# -----------------------------------------------------------------------------

echo ""
echo "Running database migrations..."
cd /app

if alembic upgrade head; then
    echo "  Migrations completed successfully"
else
    echo ""
    echo "ERROR: Database migrations failed!"
    echo ""
    echo "Troubleshooting:"
    echo "  1. Check migration files in alembic/versions/"
    echo "  2. Run manually: docker compose exec backend alembic history"
    echo "  3. Check for conflicting schema changes"
    exit 1
fi

# Show current migration status
echo ""
echo "Current migration status:"
alembic current

# -----------------------------------------------------------------------------
# Start Application
# -----------------------------------------------------------------------------

echo ""
echo "==================================="
echo " Starting application server..."
echo "==================================="
echo ""

# Execute the main command (passed as arguments to this script)
exec "$@"
