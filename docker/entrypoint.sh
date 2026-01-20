#!/bin/sh
# Entrypoint script for Horalix View backend Docker container
# This script runs database migrations before starting the application

set -e  # Exit on error

echo "==================================="
echo "Horalix View Backend Starting"
echo "==================================="

# Wait for database to be ready (docker-compose handles this, but extra safety)
echo "Waiting for database to be ready..."
max_retries=30
retry_count=0

until PGPASSWORD=horalix psql -h postgres -U horalix -d horalix_view -c '\q' 2>/dev/null; do
    retry_count=$((retry_count + 1))
    if [ "$retry_count" -ge "$max_retries" ]; then
        echo "Error: Database is not available after $max_retries attempts"
        exit 1
    fi
    echo "Database not ready yet, waiting... ($retry_count/$max_retries)"
    sleep 2
done

echo "Database is ready!"

# Run database migrations
echo "Running database migrations..."
cd /app
alembic upgrade head

# Check migration status
echo "Current migration status:"
alembic current

echo "==================================="
echo "Starting application server..."
echo "==================================="

# Execute the main command (passed as arguments to this script)
exec "$@"
