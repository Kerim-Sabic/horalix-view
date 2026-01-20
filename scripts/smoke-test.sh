#!/bin/bash
# Horalix View Smoke Test Script
# ===============================
# Verifies that all services are running correctly after deployment.
#
# Usage:
#   ./scripts/smoke-test.sh
#   ./scripts/smoke-test.sh --verbose
#
# Requirements:
#   - curl
#   - jq (optional, for pretty JSON output)
#   - Services must be running (docker compose up)

set -e

# Configuration
BACKEND_URL="${BACKEND_URL:-http://localhost:8000}"
FRONTEND_URL="${FRONTEND_URL:-http://localhost:3000}"
VERBOSE="${1:-}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Counters
PASSED=0
FAILED=0

# Helper functions
print_header() {
    echo ""
    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}========================================${NC}"
}

print_test() {
    echo -e "${YELLOW}TEST:${NC} $1"
}

print_pass() {
    echo -e "${GREEN}PASS:${NC} $1"
    ((PASSED++))
}

print_fail() {
    echo -e "${RED}FAIL:${NC} $1"
    ((FAILED++))
}

print_info() {
    if [ "$VERBOSE" = "--verbose" ] || [ "$VERBOSE" = "-v" ]; then
        echo -e "${BLUE}INFO:${NC} $1"
    fi
}

# Test functions
test_backend_health() {
    print_test "Backend health endpoint"

    response=$(curl -s -w "\n%{http_code}" "$BACKEND_URL/health" 2>/dev/null || echo -e "\n000")
    body=$(echo "$response" | head -n -1)
    status=$(echo "$response" | tail -n 1)

    if [ "$status" = "200" ]; then
        print_pass "Backend is healthy (HTTP $status)"
        print_info "Response: $body"
        return 0
    else
        print_fail "Backend health check failed (HTTP $status)"
        print_info "Response: $body"
        return 1
    fi
}

test_backend_ready() {
    print_test "Backend readiness endpoint"

    response=$(curl -s -w "\n%{http_code}" "$BACKEND_URL/ready" 2>/dev/null || echo -e "\n000")
    body=$(echo "$response" | head -n -1)
    status=$(echo "$response" | tail -n 1)

    if [ "$status" = "200" ]; then
        print_pass "Backend is ready (HTTP $status)"
        print_info "Response: $body"
        return 0
    else
        print_fail "Backend readiness check failed (HTTP $status)"
        print_info "Response: $body"
        return 1
    fi
}

test_backend_docs() {
    print_test "Backend API documentation"

    response=$(curl -s -w "\n%{http_code}" "$BACKEND_URL/docs" 2>/dev/null || echo -e "\n000")
    status=$(echo "$response" | tail -n 1)

    if [ "$status" = "200" ]; then
        print_pass "API docs accessible (HTTP $status)"
        return 0
    else
        print_fail "API docs not accessible (HTTP $status)"
        return 1
    fi
}

test_login() {
    print_test "User authentication (admin login)"

    response=$(curl -s -w "\n%{http_code}" \
        -X POST "$BACKEND_URL/api/v1/auth/token" \
        -H "Content-Type: application/x-www-form-urlencoded" \
        -d "username=admin&password=admin123" 2>/dev/null || echo -e "\n000")

    body=$(echo "$response" | head -n -1)
    status=$(echo "$response" | tail -n 1)

    if [ "$status" = "200" ]; then
        # Extract token
        TOKEN=$(echo "$body" | grep -o '"access_token":"[^"]*"' | cut -d'"' -f4)
        if [ -n "$TOKEN" ]; then
            print_pass "Login successful (HTTP $status)"
            print_info "Token received (first 20 chars): ${TOKEN:0:20}..."
            echo "$TOKEN"
            return 0
        else
            print_fail "Login succeeded but no token in response"
            return 1
        fi
    else
        print_fail "Login failed (HTTP $status)"
        print_info "Response: $body"
        return 1
    fi
}

test_authenticated_endpoint() {
    local token="$1"
    print_test "Authenticated endpoint (/api/v1/auth/me)"

    response=$(curl -s -w "\n%{http_code}" \
        -H "Authorization: Bearer $token" \
        "$BACKEND_URL/api/v1/auth/me" 2>/dev/null || echo -e "\n000")

    body=$(echo "$response" | head -n -1)
    status=$(echo "$response" | tail -n 1)

    if [ "$status" = "200" ]; then
        print_pass "Authenticated request successful (HTTP $status)"
        print_info "Response: $body"
        return 0
    else
        print_fail "Authenticated request failed (HTTP $status)"
        print_info "Response: $body"
        return 1
    fi
}

test_frontend() {
    print_test "Frontend accessibility"

    response=$(curl -s -w "\n%{http_code}" "$FRONTEND_URL" 2>/dev/null || echo -e "\n000")
    status=$(echo "$response" | tail -n 1)

    if [ "$status" = "200" ]; then
        print_pass "Frontend is accessible (HTTP $status)"
        return 0
    else
        print_fail "Frontend not accessible (HTTP $status)"
        return 1
    fi
}

test_api_endpoints() {
    local token="$1"
    print_test "API endpoints (studies list)"

    response=$(curl -s -w "\n%{http_code}" \
        -H "Authorization: Bearer $token" \
        "$BACKEND_URL/api/v1/studies" 2>/dev/null || echo -e "\n000")

    body=$(echo "$response" | head -n -1)
    status=$(echo "$response" | tail -n 1)

    # 200 OK or 404 (no studies) are both acceptable
    if [ "$status" = "200" ] || [ "$status" = "404" ]; then
        print_pass "Studies endpoint accessible (HTTP $status)"
        print_info "Response: $body"
        return 0
    else
        print_fail "Studies endpoint failed (HTTP $status)"
        print_info "Response: $body"
        return 1
    fi
}

test_ai_models_endpoint() {
    local token="$1"
    print_test "AI models endpoint"

    response=$(curl -s -w "\n%{http_code}" \
        -H "Authorization: Bearer $token" \
        "$BACKEND_URL/api/v1/ai/models" 2>/dev/null || echo -e "\n000")

    body=$(echo "$response" | head -n -1)
    status=$(echo "$response" | tail -n 1)

    if [ "$status" = "200" ]; then
        print_pass "AI models endpoint accessible (HTTP $status)"
        print_info "Response: $body"
        return 0
    else
        print_fail "AI models endpoint failed (HTTP $status)"
        print_info "Response: $body"
        return 1
    fi
}

# Main execution
main() {
    print_header "Horalix View Smoke Test"

    echo ""
    echo "Testing backend at: $BACKEND_URL"
    echo "Testing frontend at: $FRONTEND_URL"
    echo ""

    # Basic health checks
    print_header "1. Health Checks"
    test_backend_health || true
    test_backend_ready || true
    test_backend_docs || true

    # Authentication tests
    print_header "2. Authentication"
    TOKEN=$(test_login) || true

    if [ -n "$TOKEN" ] && [ "$TOKEN" != "000" ]; then
        test_authenticated_endpoint "$TOKEN" || true
    else
        print_fail "Skipping authenticated tests (no token)"
        ((FAILED++))
    fi

    # API endpoint tests
    print_header "3. API Endpoints"
    if [ -n "$TOKEN" ] && [ "$TOKEN" != "000" ]; then
        test_api_endpoints "$TOKEN" || true
        test_ai_models_endpoint "$TOKEN" || true
    else
        print_fail "Skipping API tests (no token)"
        ((FAILED++))
        ((FAILED++))
    fi

    # Frontend test
    print_header "4. Frontend"
    test_frontend || true

    # Summary
    print_header "Test Summary"
    echo ""
    echo -e "Passed: ${GREEN}$PASSED${NC}"
    echo -e "Failed: ${RED}$FAILED${NC}"
    echo ""

    if [ $FAILED -eq 0 ]; then
        echo -e "${GREEN}All tests passed! Horalix View is ready.${NC}"
        exit 0
    else
        echo -e "${RED}Some tests failed. Please check the logs.${NC}"
        exit 1
    fi
}

# Run main function
main "$@"
