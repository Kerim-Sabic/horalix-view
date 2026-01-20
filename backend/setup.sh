#!/bin/bash
# Horalix View Backend Setup Script
# This script sets up the PostgreSQL database and runs migrations

set -e  # Exit on error

echo "==================================="
echo "Horalix View Backend Setup"
echo "==================================="

# Check if PostgreSQL is running
echo "Checking PostgreSQL service..."
if ! pg_isready -q; then
    echo "PostgreSQL is not running. Starting PostgreSQL..."
    service postgresql start || {
        echo "Failed to start PostgreSQL. Please start it manually."
        exit 1
    }
    sleep 2
fi

# Check if .env file exists
if [ ! -f ".env" ]; then
    echo "Creating .env file from .env.example..."
    cp .env.example .env
    echo "Please edit .env file with your configuration if needed."
fi

# Source environment variables
export $(grep -v '^#' .env | xargs)

# Create PostgreSQL user if it doesn't exist
echo "Setting up PostgreSQL user..."
sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'" | grep -q 1 || \
    sudo -u postgres psql -c "CREATE USER ${DB_USER} WITH PASSWORD '${DB_PASSWORD}';"

# Create database if it doesn't exist
echo "Setting up PostgreSQL database..."
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1 || \
    sudo -u postgres psql -c "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};"

# Grant privileges
echo "Granting privileges..."
sudo -u postgres psql -d ${DB_NAME} -c "GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};"
sudo -u postgres psql -d ${DB_NAME} -c "GRANT ALL PRIVILEGES ON SCHEMA public TO ${DB_USER};"
sudo -u postgres psql -d ${DB_NAME} -c "GRANT CREATE ON SCHEMA public TO ${DB_USER};"

# Ensure password is set correctly
sudo -u postgres psql -c "ALTER USER ${DB_USER} WITH PASSWORD '${DB_PASSWORD}';"

# Install Python dependencies if not already installed
echo "Checking Python dependencies..."
if ! python3 -c "import alembic" 2>/dev/null; then
    echo "Installing Python dependencies..."
    pip3 install -e .
fi

# Run migrations
echo "Running database migrations..."
alembic upgrade head

# Verify migration status
echo ""
echo "Current migration status:"
alembic current

echo ""
echo "==================================="
echo "Setup completed successfully!"
echo "==================================="
echo ""
echo "Database: ${DB_NAME}"
echo "User: ${DB_USER}"
echo "Host: ${DB_HOST}:${DB_PORT}"
echo ""
echo "To start the application, run:"
echo "  python3 -m app.main"
echo "or:"
echo "  uvicorn app.main:app --reload"
echo ""
