# Security Documentation

## Overview

Horalix View is a medical imaging application that handles sensitive Protected Health Information (PHI). This document outlines security considerations, threat models, and best practices.

## Threat Model

### Assets to Protect

1. **Patient Data (PHI)**
   - DICOM images and metadata
   - Patient demographics
   - Study/series information
   - Annotations and reports

2. **System Credentials**
   - Database passwords
   - API keys
   - JWT secrets
   - Service account credentials

3. **Infrastructure**
   - Application servers
   - Database servers
   - Storage systems
   - Network endpoints

### Threat Actors

| Actor | Motivation | Capability |
|-------|-----------|------------|
| External Attackers | Data theft, ransomware | Medium-High |
| Insider Threats | Data exfiltration | High (authorized access) |
| Automated Bots | Credential stuffing, scanning | Low-Medium |
| Nation-State | Espionage, disruption | Very High |

### Attack Vectors

1. **Authentication Attacks**
   - Credential stuffing
   - Brute force attacks
   - Session hijacking
   - JWT token theft

2. **Injection Attacks**
   - SQL injection
   - Command injection
   - Path traversal
   - DICOM parsing exploits

3. **Network Attacks**
   - Man-in-the-middle
   - DNS poisoning
   - DDoS

4. **Application Vulnerabilities**
   - XSS (Cross-Site Scripting)
   - CSRF (Cross-Site Request Forgery)
   - Insecure deserialization

## Security Controls

### Authentication & Authorization

```
┌─────────────────────────────────────────────────────────────┐
│                    Authentication Flow                       │
├─────────────────────────────────────────────────────────────┤
│  User → Login Form → FastAPI Auth Endpoint                  │
│                           │                                  │
│                           ▼                                  │
│              Password Verification (bcrypt)                  │
│                           │                                  │
│                           ▼                                  │
│               JWT Token Generation                           │
│          (access_token + refresh_token)                      │
│                           │                                  │
│                           ▼                                  │
│              Secure Cookie Storage                           │
│           (HttpOnly, Secure, SameSite)                      │
└─────────────────────────────────────────────────────────────┘
```

**Implemented Controls:**
- Password hashing with bcrypt (work factor 12)
- JWT tokens with configurable expiration (default 60 minutes)
- Refresh token rotation
- Role-based access control (RBAC)
- Rate limiting on auth endpoints

### Roles and Token Expiry

Default roles include `admin`, `radiologist`, `technologist`, and `researcher`. Endpoint access is enforced by role checks.

Default development users are created only when `ENVIRONMENT` is not `production`. Production deployments must provision users explicitly.

Token expiry is controlled by `ACCESS_TOKEN_EXPIRE_MINUTES` and should be shortened in production environments.

### Secret Management

#### Development Environment

```bash
# Never commit .env files
# Use .env.example as template

# Required secrets:
SECRET_KEY=<generate with: openssl rand -hex 32>
DATABASE_URL=postgresql+asyncpg://user:pass@localhost/db
REDIS_URL=redis://localhost:6379/0
```

#### Production Environment

| Secret | Storage Method | Rotation Frequency |
|--------|---------------|-------------------|
| SECRET_KEY | Environment variable / Vault | 90 days |
| DATABASE_URL | Environment variable / Vault | On compromise |
| API Keys | Environment variable / Vault | 30 days |
| TLS Certificates | Certificate manager | Auto (Let's Encrypt) |

**Best Practices:**
- Never hardcode secrets in source code
- Use secret scanning in CI/CD (gitleaks)
- Rotate secrets regularly
- Use different secrets per environment
- Audit secret access logs

### Data Protection

#### At Rest
- Database encryption (PostgreSQL TDE or disk encryption)
- Encrypted backups
- Secure file storage for DICOM files

#### In Transit
- TLS 1.3 for all connections
- Certificate pinning for mobile apps
- Encrypted inter-service communication

#### PHI Handling
- Minimum necessary access principle
- Audit logging for all PHI access
- Data anonymization for development/testing
- Secure deletion procedures

### Network Security

```
┌──────────────────────────────────────────────────────────────┐
│                    Network Architecture                       │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  Internet                                                     │
│      │                                                        │
│      ▼                                                        │
│  ┌──────────┐                                                │
│  │   WAF    │  ← Rate limiting, SQL injection prevention     │
│  └────┬─────┘                                                │
│       │                                                       │
│       ▼                                                       │
│  ┌──────────┐                                                │
│  │  Nginx   │  ← TLS termination, load balancing            │
│  └────┬─────┘                                                │
│       │                                                       │
│  ═════╧═══════════════════════════════════════════════════   │
│  │    Private Network (Docker/K8s)                       │   │
│  │                                                       │   │
│  │  ┌─────────┐   ┌─────────┐   ┌─────────┐            │   │
│  │  │ FastAPI │   │  Redis  │   │ Postgres│            │   │
│  │  │ Backend │───│  Cache  │   │   DB    │            │   │
│  │  └─────────┘   └─────────┘   └─────────┘            │   │
│  │                                                       │   │
│  ═══════════════════════════════════════════════════════════ │
│                                                               │
└──────────────────────────────────────────────────────────────┘
```

### Input Validation

All user input is validated:
- Pydantic models for request validation
- SQL parameterized queries (SQLAlchemy ORM)
- Path traversal prevention in file operations
- DICOM file validation before processing

### Logging & Monitoring

**Security Events Logged:**
- Authentication attempts (success/failure)
- Authorization failures
- PHI access events
- Configuration changes
- API rate limit hits

**Client Error Reporting:**
- Frontend errors are reported to `POST /api/v1/health/client-error`.
- Payloads include message, stack, route, and user agent only.
- PHI is explicitly excluded from error reports.
- Server logs include correlation IDs via `X-Request-ID` headers.

**Log Format:**
```json
{
  "timestamp": "2024-01-15T10:30:00Z",
  "level": "WARNING",
  "event": "auth_failure",
  "user": "unknown",
  "ip": "192.168.1.100",
  "user_agent": "...",
  "details": "Invalid password attempt"
}
```

## Vulnerability Disclosure

### Reporting Security Issues

If you discover a security vulnerability:

1. **DO NOT** create a public GitHub issue
2. Email security concerns to the repository maintainers
3. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

### Response Timeline

| Severity | Initial Response | Fix Target |
|----------|-----------------|------------|
| Critical | 24 hours | 48 hours |
| High | 48 hours | 7 days |
| Medium | 7 days | 30 days |
| Low | 14 days | 90 days |

## Security Checklist

### Development
- [ ] No secrets in code or version control
- [ ] Input validation on all endpoints
- [ ] Parameterized database queries
- [ ] Secure session management
- [ ] HTTPS in development (for cookie testing)

### Pre-Deployment
- [ ] Security scan passed (npm audit, pip-audit)
- [ ] Secret scanning passed (gitleaks)
- [ ] Dependency vulnerabilities addressed
- [ ] Security headers configured
- [ ] Rate limiting enabled

### Production
- [ ] TLS certificates valid and auto-renewing
- [ ] Database connections encrypted
- [ ] Secrets in secure vault
- [ ] Monitoring and alerting configured
- [ ] Backup encryption verified
- [ ] Incident response plan documented

## Compliance Considerations

### HIPAA (If applicable)
- Access controls and audit logs
- Encryption at rest and in transit
- Business Associate Agreements
- Risk assessment documentation
- Incident response procedures

### GDPR (If applicable)
- Data minimization
- Right to erasure implementation
- Data portability
- Consent management
- Privacy impact assessment

## Security Headers

Recommended HTTP security headers (configure in Nginx/reverse proxy):

```nginx
# Security headers
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "DENY" always;
add_header X-XSS-Protection "1; mode=block" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self';" always;
add_header Permissions-Policy "geolocation=(), microphone=(), camera=()" always;
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
```

## Incident Response

### Detection
1. Monitor security logs for anomalies
2. Set up alerts for authentication failures
3. Track API rate limit violations
4. Monitor for unusual data access patterns

### Containment
1. Isolate affected systems
2. Revoke compromised credentials
3. Block malicious IPs
4. Preserve evidence for analysis

### Recovery
1. Restore from clean backups
2. Rotate all secrets
3. Patch vulnerabilities
4. Verify system integrity

### Post-Incident
1. Document timeline and actions
2. Conduct root cause analysis
3. Update security controls
4. Notify affected parties (if required)

## Updates

This document should be reviewed and updated:
- Quarterly (minimum)
- After any security incident
- When significant changes are made to the system
- When new threats are identified
