# Horalix View Smoke Test Script (Windows PowerShell)
# ====================================================
# Verifies that all services are running correctly after deployment.
#
# Usage:
#   .\scripts\smoke-test.ps1
#   .\scripts\smoke-test.ps1 -Verbose
#
# Requirements:
#   - PowerShell 5.1 or later
#   - Services must be running (docker compose up)

param(
    [switch]$Verbose
)

# Configuration
$BACKEND_URL = if ($env:BACKEND_URL) { $env:BACKEND_URL } else { "http://localhost:8000" }
$FRONTEND_URL = if ($env:FRONTEND_URL) { $env:FRONTEND_URL } else { "http://localhost:3000" }

# Counters
$script:Passed = 0
$script:Failed = 0

# Helper functions
function Write-Header {
    param([string]$Message)
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Blue
    Write-Host $Message -ForegroundColor Blue
    Write-Host "========================================" -ForegroundColor Blue
}

function Write-Test {
    param([string]$Message)
    Write-Host "TEST: $Message" -ForegroundColor Yellow
}

function Write-Pass {
    param([string]$Message)
    Write-Host "PASS: $Message" -ForegroundColor Green
    $script:Passed++
}

function Write-Fail {
    param([string]$Message)
    Write-Host "FAIL: $Message" -ForegroundColor Red
    $script:Failed++
}

function Write-Info {
    param([string]$Message)
    if ($Verbose) {
        Write-Host "INFO: $Message" -ForegroundColor Cyan
    }
}

# Test functions
function Test-BackendHealth {
    Write-Test "Backend health endpoint"

    try {
        $response = Invoke-WebRequest -Uri "$BACKEND_URL/health" -UseBasicParsing -ErrorAction Stop
        if ($response.StatusCode -eq 200) {
            Write-Pass "Backend is healthy (HTTP $($response.StatusCode))"
            Write-Info "Response: $($response.Content)"
            return $true
        }
    }
    catch {
        Write-Fail "Backend health check failed: $($_.Exception.Message)"
    }
    return $false
}

function Test-BackendReady {
    Write-Test "Backend readiness endpoint"

    try {
        $response = Invoke-WebRequest -Uri "$BACKEND_URL/ready" -UseBasicParsing -ErrorAction Stop
        if ($response.StatusCode -eq 200) {
            Write-Pass "Backend is ready (HTTP $($response.StatusCode))"
            Write-Info "Response: $($response.Content)"
            return $true
        }
    }
    catch {
        Write-Fail "Backend readiness check failed: $($_.Exception.Message)"
    }
    return $false
}

function Test-BackendDocs {
    Write-Test "Backend API documentation"

    try {
        $response = Invoke-WebRequest -Uri "$BACKEND_URL/docs" -UseBasicParsing -ErrorAction Stop
        if ($response.StatusCode -eq 200) {
            Write-Pass "API docs accessible (HTTP $($response.StatusCode))"
            return $true
        }
    }
    catch {
        Write-Fail "API docs not accessible: $($_.Exception.Message)"
    }
    return $false
}

function Test-Login {
    Write-Test "User authentication (admin login)"

    try {
        $body = "username=admin&password=admin123"
        $headers = @{ "Content-Type" = "application/x-www-form-urlencoded" }

        $response = Invoke-RestMethod -Uri "$BACKEND_URL/api/v1/auth/token" `
            -Method POST -Body $body -Headers $headers -ErrorAction Stop

        if ($response.access_token) {
            Write-Pass "Login successful"
            Write-Info "Token received (first 20 chars): $($response.access_token.Substring(0, [Math]::Min(20, $response.access_token.Length)))..."
            return $response.access_token
        }
    }
    catch {
        Write-Fail "Login failed: $($_.Exception.Message)"
    }
    return $null
}

function Test-AuthenticatedEndpoint {
    param([string]$Token)
    Write-Test "Authenticated endpoint (/api/v1/auth/me)"

    try {
        $headers = @{ "Authorization" = "Bearer $Token" }
        $response = Invoke-RestMethod -Uri "$BACKEND_URL/api/v1/auth/me" -Headers $headers -ErrorAction Stop

        Write-Pass "Authenticated request successful"
        Write-Info "Response: $($response | ConvertTo-Json -Compress)"
        return $true
    }
    catch {
        Write-Fail "Authenticated request failed: $($_.Exception.Message)"
    }
    return $false
}

function Test-Frontend {
    Write-Test "Frontend accessibility"

    try {
        $response = Invoke-WebRequest -Uri $FRONTEND_URL -UseBasicParsing -ErrorAction Stop
        if ($response.StatusCode -eq 200) {
            Write-Pass "Frontend is accessible (HTTP $($response.StatusCode))"
            return $true
        }
    }
    catch {
        Write-Fail "Frontend not accessible: $($_.Exception.Message)"
    }
    return $false
}

function Test-ApiEndpoints {
    param([string]$Token)
    Write-Test "API endpoints (studies list)"

    try {
        $headers = @{ "Authorization" = "Bearer $Token" }
        $response = Invoke-WebRequest -Uri "$BACKEND_URL/api/v1/studies" -Headers $headers -UseBasicParsing -ErrorAction Stop

        Write-Pass "Studies endpoint accessible (HTTP $($response.StatusCode))"
        return $true
    }
    catch {
        $statusCode = $_.Exception.Response.StatusCode.Value__
        if ($statusCode -eq 404) {
            Write-Pass "Studies endpoint accessible (HTTP 404 - no studies)"
            return $true
        }
        Write-Fail "Studies endpoint failed: $($_.Exception.Message)"
    }
    return $false
}

function Test-AiModelsEndpoint {
    param([string]$Token)
    Write-Test "AI models endpoint"

    try {
        $headers = @{ "Authorization" = "Bearer $Token" }
        $response = Invoke-RestMethod -Uri "$BACKEND_URL/api/v1/ai/models" -Headers $headers -ErrorAction Stop

        Write-Pass "AI models endpoint accessible"
        return $true
    }
    catch {
        Write-Fail "AI models endpoint failed: $($_.Exception.Message)"
    }
    return $false
}

# Main execution
function Main {
    Write-Header "Horalix View Smoke Test"

    Write-Host ""
    Write-Host "Testing backend at: $BACKEND_URL"
    Write-Host "Testing frontend at: $FRONTEND_URL"
    Write-Host ""

    # Basic health checks
    Write-Header "1. Health Checks"
    $null = Test-BackendHealth
    $null = Test-BackendReady
    $null = Test-BackendDocs

    # Authentication tests
    Write-Header "2. Authentication"
    $token = Test-Login

    if ($token) {
        $null = Test-AuthenticatedEndpoint -Token $token
    }
    else {
        Write-Fail "Skipping authenticated tests (no token)"
    }

    # API endpoint tests
    Write-Header "3. API Endpoints"
    if ($token) {
        $null = Test-ApiEndpoints -Token $token
        $null = Test-AiModelsEndpoint -Token $token
    }
    else {
        Write-Fail "Skipping API tests (no token)"
        Write-Fail "Skipping AI models test (no token)"
    }

    # Frontend test
    Write-Header "4. Frontend"
    $null = Test-Frontend

    # Summary
    Write-Header "Test Summary"
    Write-Host ""
    Write-Host "Passed: $script:Passed" -ForegroundColor Green
    Write-Host "Failed: $script:Failed" -ForegroundColor Red
    Write-Host ""

    if ($script:Failed -eq 0) {
        Write-Host "All tests passed! Horalix View is ready." -ForegroundColor Green
        exit 0
    }
    else {
        Write-Host "Some tests failed. Please check the logs." -ForegroundColor Red
        exit 1
    }
}

# Run main function
Main
