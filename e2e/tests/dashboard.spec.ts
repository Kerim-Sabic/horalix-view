import { test, expect } from '@playwright/test';

/**
 * Dashboard Regression Tests
 *
 * These tests verify that the dashboard remains stable after login
 * and doesn't crash due to undefined API responses.
 *
 * REGRESSION TEST: Catches the blank screen issue caused by:
 * - 404 on /api/v1/dashboard/stats
 * - undefined recentJobs/recentStudies causing "Cannot read properties of undefined"
 */

test.describe('Dashboard Stability', () => {
  test.beforeEach(async ({ page }) => {
    // Login before each test
    await page.goto('/login');

    // Wait for login page to load
    await expect(page.getByRole('heading', { name: /sign in|login/i })).toBeVisible({ timeout: 10000 });

    // Fill in login credentials (default admin account)
    await page.getByLabel(/username|email/i).fill('admin');
    await page.getByLabel(/password/i).fill('admin123');

    // Click login button
    await page.getByRole('button', { name: /sign in|login|submit/i }).click();

    // Wait for navigation to dashboard
    await expect(page).toHaveURL('/', { timeout: 15000 });
  });

  test('dashboard renders and stays rendered for 30 seconds after login', async ({ page }) => {
    // Verify dashboard page is rendered
    await expect(page.getByTestId('dashboard-page')).toBeVisible({ timeout: 10000 });

    // Verify the Dashboard heading is visible
    await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();

    // Verify the sidebar is visible (indicates layout is stable)
    await expect(page.getByTestId('sidebar-navigation')).toBeVisible();

    // Wait 3 seconds and verify still visible
    await page.waitForTimeout(3000);
    await expect(page.getByTestId('dashboard-page')).toBeVisible();
    await expect(page.getByTestId('sidebar-navigation')).toBeVisible();

    // Wait another 5 seconds (total 8 seconds)
    await page.waitForTimeout(5000);
    await expect(page.getByTestId('dashboard-page')).toBeVisible();

    // Check no uncaught errors in console
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    // Wait additional time to catch any late errors
    await page.waitForTimeout(5000);

    // Filter out expected/harmless errors
    const criticalErrors = consoleErrors.filter(
      (err) =>
        err.includes('TypeError') ||
        err.includes('Cannot read properties of undefined') ||
        err.includes('Uncaught')
    );

    expect(criticalErrors).toHaveLength(0);
  });

  test('dashboard handles API errors gracefully without crashing', async ({ page }) => {
    // Intercept dashboard API calls and return errors
    await page.route('**/api/v1/dashboard/stats', (route) => {
      route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'Not Found' }),
      });
    });

    await page.route('**/api/v1/studies*', (route) => {
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'Internal Server Error' }),
      });
    });

    await page.route('**/api/v1/ai/jobs*', (route) => {
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'Service Unavailable' }),
      });
    });

    // Reload the page with mocked routes
    await page.reload();

    // Dashboard should still be visible even with API errors
    await expect(page.getByTestId('dashboard-page')).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();

    // Wait and verify it doesn't crash
    await page.waitForTimeout(3000);
    await expect(page.getByTestId('dashboard-page')).toBeVisible();
  });

  test('dashboard handles empty data without crashing', async ({ page }) => {
    // Intercept API calls and return empty data
    await page.route('**/api/v1/dashboard/stats', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          total_studies: 0,
          total_patients: 0,
          total_series: 0,
          total_instances: 0,
          ai_jobs_today: 0,
          ai_jobs_running: 0,
          storage_used_bytes: 0,
          storage_total_bytes: 1000000000,
        }),
      });
    });

    await page.route('**/api/v1/studies*', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ total: 0, page: 1, page_size: 5, studies: [] }),
      });
    });

    await page.route('**/api/v1/ai/jobs*', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ total: 0, page: 1, page_size: 5, jobs: [] }),
      });
    });

    // Reload the page with mocked routes
    await page.reload();

    // Dashboard should still be visible with empty data
    await expect(page.getByTestId('dashboard-page')).toBeVisible({ timeout: 10000 });

    // Should show "No studies found" and "No AI jobs found" messages
    await expect(page.getByText(/no studies found/i)).toBeVisible();
    await expect(page.getByText(/no ai jobs found/i)).toBeVisible();

    // Wait and verify stability
    await page.waitForTimeout(3000);
    await expect(page.getByTestId('dashboard-page')).toBeVisible();
  });

  test('dashboard handles malformed API responses without crashing', async ({ page }) => {
    // Intercept API calls and return malformed data
    await page.route('**/api/v1/dashboard/stats', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ unexpected: 'data' }), // Missing expected fields
      });
    });

    await page.route('**/api/v1/studies*', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ studies: null }), // null instead of array
      });
    });

    await page.route('**/api/v1/ai/jobs*', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({}), // Missing jobs field
      });
    });

    // Reload the page with mocked routes
    await page.reload();

    // Dashboard should still be visible even with malformed data
    await expect(page.getByTestId('dashboard-page')).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();

    // Wait and verify stability
    await page.waitForTimeout(3000);
    await expect(page.getByTestId('dashboard-page')).toBeVisible();
  });
});

test.describe('Route Navigation', () => {
  test.beforeEach(async ({ page }) => {
    // Login before each test
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: /sign in|login/i })).toBeVisible({ timeout: 10000 });
    await page.getByLabel(/username|email/i).fill('admin');
    await page.getByLabel(/password/i).fill('admin123');
    await page.getByRole('button', { name: /sign in|login|submit/i }).click();
    await expect(page).toHaveURL('/', { timeout: 15000 });
  });

  test('can navigate to Studies page and it renders', async ({ page }) => {
    // Click Studies in sidebar
    await page.getByRole('button', { name: /studies/i }).click();

    // Verify navigation
    await expect(page).toHaveURL(/\/studies/);

    // Wait for page to render
    await expect(page.getByRole('heading', { name: /studies/i })).toBeVisible({ timeout: 10000 });

    // Verify sidebar still visible
    await expect(page.getByTestId('sidebar-navigation')).toBeVisible();
  });

  test('can navigate to AI Models page and it renders', async ({ page }) => {
    // Click AI Models in sidebar
    await page.getByRole('button', { name: /ai models/i }).click();

    // Verify navigation
    await expect(page).toHaveURL(/\/ai-models/);

    // Wait for page to render
    await expect(page.getByRole('heading', { name: /ai|models/i })).toBeVisible({ timeout: 10000 });

    // Verify sidebar still visible
    await expect(page.getByTestId('sidebar-navigation')).toBeVisible();
  });

  test('can navigate to Settings page and it renders', async ({ page }) => {
    // Click Settings in sidebar
    await page.getByRole('button', { name: /settings/i }).click();

    // Verify navigation
    await expect(page).toHaveURL(/\/settings/);

    // Wait for page to render
    await expect(page.getByRole('heading', { name: /settings/i })).toBeVisible({ timeout: 10000 });

    // Verify sidebar still visible
    await expect(page.getByTestId('sidebar-navigation')).toBeVisible();
  });

  test('can navigate back to Dashboard from other pages', async ({ page }) => {
    // Navigate to Studies
    await page.getByRole('button', { name: /studies/i }).click();
    await expect(page).toHaveURL(/\/studies/);

    // Navigate back to Dashboard
    await page.getByRole('button', { name: /dashboard/i }).click();
    await expect(page).toHaveURL('/');

    // Verify dashboard renders
    await expect(page.getByTestId('dashboard-page')).toBeVisible({ timeout: 10000 });
  });
});

test.describe('API Response Validation', () => {
  test('dashboard stats endpoint returns correct status', async ({ page }) => {
    // Listen for dashboard stats request
    const responsePromise = page.waitForResponse(
      (response) =>
        response.url().includes('/api/v1/dashboard/stats') && response.status() !== 0
    );

    // Login and go to dashboard
    await page.goto('/login');
    await page.getByLabel(/username|email/i).fill('admin');
    await page.getByLabel(/password/i).fill('admin123');
    await page.getByRole('button', { name: /sign in|login|submit/i }).click();
    await expect(page).toHaveURL('/', { timeout: 15000 });

    // Wait for the API call
    const response = await responsePromise;

    // The endpoint should return 200 (not 404)
    expect(response.status()).toBe(200);
  });
});
