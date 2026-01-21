# Blank Screen After Login - Root Cause Analysis

## Issue Summary

**Symptom:** After logging in, the frontend briefly shows the dashboard and then goes blank (white screen).

**Impact:** Critical - Users cannot access any functionality after authentication.

**Resolution Status:** RESOLVED

---

## Root Cause Analysis

### Primary Causes

#### 1. Missing `/dashboard/stats` Backend Endpoint (CRITICAL)

**Problem:** The frontend Dashboard page calls `GET /api/v1/dashboard/stats` to fetch statistics, but this endpoint did not exist in the backend.

**Location:**
- Frontend: `frontend/src/services/api.ts` line 489-491
- Backend: No corresponding endpoint in `backend/app/api/v1/router.py`

**Behavior:**
1. User logs in successfully
2. Dashboard page mounts and calls `api.dashboard.getStats()`
3. Backend returns HTTP 404 Not Found
4. `Promise.allSettled` catches the error but doesn't display it properly
5. Dashboard appears empty/blank due to missing stats data

**Fix Applied:**
- Created new endpoint file: `backend/app/api/v1/endpoints/dashboard.py`
- Registered endpoint in `backend/app/api/v1/router.py` under `/dashboard` prefix
- Returns `DashboardStats` with: total_studies, total_patients, ai_jobs_today, storage metrics

---

#### 2. Hard Page Redirect on 401 Errors (HIGH)

**Problem:** The Axios response interceptor used `window.location.href = '/login'` on 401 errors, causing a full page reload.

**Location:** `frontend/src/services/apiClient.ts` lines 38-42

**Behavior:**
1. If any API call returned 401 (token expired, invalid, etc.)
2. Browser performs hard redirect to `/login`
3. React state is completely lost
4. If login is valid, redirect back causes race condition
5. User sees blank screen during the redirect cycle

**Fix Applied:**
- Replaced hard redirect with custom event dispatch
- Created `AUTH_EVENTS.UNAUTHORIZED` and `AUTH_EVENTS.SESSION_EXPIRED` events
- `AuthContext` listens for these events and handles logout via React Router
- Navigation now uses `navigate('/login', { replace: true })` instead of `window.location.href`

---

#### 3. No React Error Boundary (MEDIUM)

**Problem:** No Error Boundary component existed to catch React rendering errors.

**Location:** Missing from `frontend/src/components/`

**Behavior:**
1. If any component threw during render (TypeError, ReferenceError, etc.)
2. React unmounted the entire component tree
3. User saw blank white screen with no error message
4. Console had error but user had no indication of what went wrong

**Fix Applied:**
- Created `frontend/src/components/common/ErrorBoundary.tsx`
- Wraps the entire app in `App.tsx`
- Displays user-friendly error UI with:
  - Error message summary
  - Stack trace (in development mode)
  - Reload/Go Home/Try Again buttons
  - Logs error to console and optionally to backend

---

#### 4. AI Jobs Endpoint Response Mismatch (LOW)

**Problem:** Frontend expected paginated response, backend returned raw list.

**Frontend Expected:**
```typescript
interface AIJobListResponse {
  total: number;
  page: number;
  page_size: number;
  jobs: AIJob[];
}
```

**Backend Returned:**
```python
list[InferenceJobResponse]  # Just a list, no pagination wrapper
```

**Fix Applied:**
- Added `JobListResponse` model to `backend/app/api/v1/endpoints/ai.py`
- Updated `list_jobs` endpoint to return paginated response
- Added `page` and `page_size` query parameters with proper offset/limit

---

## Files Modified

### Backend
| File | Change |
|------|--------|
| `backend/app/api/v1/endpoints/dashboard.py` | NEW - Dashboard stats endpoint |
| `backend/app/api/v1/router.py` | Added dashboard router |
| `backend/app/api/v1/endpoints/ai.py` | Fixed jobs pagination, added JobListResponse |

### Frontend
| File | Change |
|------|--------|
| `frontend/src/components/common/ErrorBoundary.tsx` | NEW - Error boundary component |
| `frontend/src/App.tsx` | Wrapped routes in ErrorBoundary |
| `frontend/src/services/apiClient.ts` | Replaced hard redirect with event dispatch |
| `frontend/src/contexts/AuthContext.tsx` | Added event listener for auth events, uses navigate() |
| `frontend/src/integration.test.tsx` | NEW - Integration tests for login flow |

---

## Verification Steps

### 1. Endpoint Verification
```bash
# Dashboard stats endpoint exists and returns data
curl -X GET http://localhost:8000/api/v1/dashboard/stats \
  -H "Authorization: Bearer <token>"

# Expected response:
{
  "total_studies": 0,
  "total_patients": 0,
  "ai_jobs_today": 0,
  "ai_jobs_running": 0,
  "storage_used_bytes": 0,
  "storage_total_bytes": 1000000000000
}
```

### 2. Frontend Build Verification
```bash
cd frontend
npm run type-check  # Should pass with no errors
npm run lint        # Should pass with no warnings
npm run build       # Should build successfully
npm run test        # All integration tests should pass
```

### 3. Manual Testing Checklist
- [ ] Login with valid credentials
- [ ] Dashboard loads and displays all 4 stat cards
- [ ] Dashboard shows "Recent Studies" and "AI Processing Queue" sections
- [ ] Navigate to Studies page - loads correctly
- [ ] Navigate to Patients page - loads correctly
- [ ] Navigate to AI Models page - loads correctly
- [ ] Navigate to Settings page - loads correctly
- [ ] Navigate to Admin page (if admin) - loads correctly
- [ ] Session expiry triggers graceful redirect to login
- [ ] No blank screens at any point

---

## Prevention Measures

### Code Level
1. **Error Boundaries:** Always wrap major route components
2. **API Contract Testing:** Verify frontend/backend response formats match
3. **Integration Tests:** Test login → dashboard → navigation flow
4. **Graceful Degradation:** Use `Promise.allSettled` and handle individual failures

### Process Level
1. **API Documentation:** Document all endpoints with request/response schemas
2. **Frontend-Backend Sync:** Use shared TypeScript/Pydantic types
3. **Pre-deploy Checklist:** Run integration tests before deployment
4. **Error Monitoring:** Log client-side errors to backend for monitoring

---

## Related Issues

- Initial login flow fix: Previously `POST /auth/token` didn't return user object
- Solution: Frontend now calls `GET /auth/me` after login to fetch user data

---

## Timeline

| Date | Action |
|------|--------|
| 2026-01-21 | Issue identified and diagnosed |
| 2026-01-21 | Root causes identified (4 issues) |
| 2026-01-21 | Fixes implemented and verified |
| 2026-01-21 | Integration tests added |
| 2026-01-21 | Documentation created |

---

## Contact

For questions about this fix, refer to:
- Backend endpoints: `backend/app/api/v1/endpoints/`
- Frontend auth: `frontend/src/contexts/AuthContext.tsx`
- Error boundary: `frontend/src/components/common/ErrorBoundary.tsx`
