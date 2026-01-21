# Horalix View - Operations Runbook

This document provides operational procedures for running Horalix View in production.

---

## Quick Reference

| Action | Command |
|--------|---------|
| Start all services | `docker compose up -d` |
| Stop all services | `docker compose down` |
| View logs | `docker compose logs -f backend` |
| Health check | `curl localhost:8000/health` |
| Database backup | `docker compose exec postgres pg_dump -U horalix horalix_view > backup.sql` |
| Run migrations | `docker compose exec backend alembic upgrade head` |

---

## Startup Procedure

### 1. Pre-flight Checks

```bash
# Verify Docker is running
docker info

# Check disk space (need >10GB free)
df -h

# Verify environment files exist
ls -la .env docker/.env backend/.env
```

### 2. Start Services

```bash
# From project root
docker compose -f docker/docker-compose.yml up -d

# Wait for services to be healthy
docker compose -f docker/docker-compose.yml ps
```

### 3. Verify Startup

```bash
# Check backend health
curl http://localhost:8000/health
# Expected: {"status":"healthy",...}

# Check database connectivity
curl http://localhost:8000/ready
# Expected: {"status":"ready",...}

# Check frontend
curl -I http://localhost:3000
# Expected: HTTP 200
```

---

## Shutdown Procedure

### Graceful Shutdown

```bash
# Stop services (preserves data)
docker compose -f docker/docker-compose.yml down

# Verify all containers stopped
docker ps
```

### Complete Shutdown (with volume removal)

```bash
# WARNING: This deletes all data
docker compose -f docker/docker-compose.yml down -v
```

---

## Monitoring

### Health Endpoints

| Endpoint | Purpose | Expected Response |
|----------|---------|-------------------|
| `/health` | Basic health | `{"status":"healthy"}` |
| `/ready` | Full readiness | `{"status":"ready"}` |
| `/metrics` | Prometheus metrics | Prometheus format |

### Log Monitoring

```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f backend

# With timestamps
docker compose logs -f --timestamps backend

# Last N lines
docker compose logs --tail=100 backend
```

### Key Metrics to Monitor

- Response time (P95 < 500ms)
- Error rate (< 1%)
- CPU usage (< 80%)
- Memory usage (< 80%)
- Database connections
- Redis memory usage

---

## Backup Procedures

### Database Backup

```bash
# Create backup
docker compose exec postgres pg_dump -U horalix horalix_view > backup_$(date +%Y%m%d_%H%M%S).sql

# Compressed backup
docker compose exec postgres pg_dump -U horalix horalix_view | gzip > backup_$(date +%Y%m%d_%H%M%S).sql.gz
```

### DICOM Files Backup

```bash
# Create tarball
tar -czvf dicom_backup_$(date +%Y%m%d).tar.gz storage/dicom/

# Using rsync
rsync -avz storage/dicom/ /backup/dicom/
```

### Full Backup Script

```bash
#!/bin/bash
BACKUP_DIR="/backup/horalix/$(date +%Y%m%d)"
mkdir -p $BACKUP_DIR

# Database
docker compose exec -T postgres pg_dump -U horalix horalix_view > $BACKUP_DIR/database.sql

# DICOM files
tar -czvf $BACKUP_DIR/dicom.tar.gz storage/dicom/

# AI models
tar -czvf $BACKUP_DIR/models.tar.gz models/

echo "Backup completed: $BACKUP_DIR"
```

---

## Restore Procedures

### Database Restore

```bash
# From SQL file
cat backup.sql | docker compose exec -T postgres psql -U horalix horalix_view

# From compressed
gunzip -c backup.sql.gz | docker compose exec -T postgres psql -U horalix horalix_view
```

### DICOM Files Restore

```bash
# Extract backup
tar -xzvf dicom_backup.tar.gz -C storage/

# Verify files
ls -la storage/dicom/
```

---

## Migration Procedures

### Apply Pending Migrations

```bash
# Check current state
docker compose exec backend alembic current

# Apply all pending
docker compose exec backend alembic upgrade head
```

### Rollback Migration

```bash
# Rollback one step
docker compose exec backend alembic downgrade -1

# Rollback to specific revision
docker compose exec backend alembic downgrade <revision_id>
```

---

## Scaling

### Horizontal Scaling (Backend)

```bash
# Scale to 3 instances
docker compose up -d --scale backend=3

# Note: Requires load balancer configuration
```

### Resource Limits

Edit `docker-compose.yml`:
```yaml
services:
  backend:
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 4G
        reservations:
          cpus: '0.5'
          memory: 1G
```

---

## Incident Response

### Service Down

1. Check container status: `docker compose ps`
2. Check logs: `docker compose logs --tail=100 <service>`
3. Restart service: `docker compose restart <service>`
4. If persists, check health endpoints
5. Check resource usage: `docker stats`

### Database Issues

1. Check PostgreSQL logs: `docker compose logs postgres`
2. Check connections: `docker compose exec postgres psql -U horalix -c "SELECT count(*) FROM pg_stat_activity;"`
3. If too many connections, consider connection pooling
4. Check disk space for database volume

### High Memory Usage

1. Check container memory: `docker stats`
2. Identify memory-hungry containers
3. Review for memory leaks in logs
4. Consider increasing limits or scaling out

### Slow Response Times

1. Check health endpoints for dependencies
2. Review database query performance
3. Check Redis cache hit rate
4. Review application logs for slow operations
5. Consider adding database indexes

---

## Security Procedures

### Rotate SECRET_KEY

```bash
# Generate new key
NEW_KEY=$(openssl rand -hex 32)

# Update .env file
sed -i "s/SECRET_KEY=.*/SECRET_KEY=$NEW_KEY/" .env

# Restart services (will invalidate existing tokens)
docker compose restart backend
```

### Update Passwords

```bash
# Create new admin user
docker compose exec backend python -m app.cli create-admin \
  --username newadmin \
  --email admin@example.com \
  --password new_secure_password

# Users should change passwords via UI
```

### SSL Certificate Update

1. Replace certificate files
2. Restart nginx: `docker compose restart nginx`
3. Verify: `curl -I https://your-domain.com`

---

## Maintenance Windows

### Pre-maintenance

```bash
# Notify users (implement in application)
# Disable new job submissions
# Wait for running jobs to complete
```

### During Maintenance

```bash
# Stop services
docker compose down

# Perform maintenance
# - Apply updates
# - Run migrations
# - Update configurations

# Start services
docker compose up -d

# Verify health
./scripts/smoke-test.sh
```

### Post-maintenance

- Verify all services healthy
- Check application logs for errors
- Notify users maintenance complete
- Monitor for issues

---

## Useful Commands

```bash
# Shell into container
docker compose exec backend bash

# Run one-off command
docker compose exec backend python -c "from app.core.config import settings; print(settings)"

# View resource usage
docker stats

# Clean up unused resources
docker system prune -f

# View container IPs
docker network inspect horalix-view_default
```
