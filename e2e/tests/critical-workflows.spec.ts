import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const fixturePath = path.resolve(__dirname, '../fixtures/sample.dcm');

const login = async (page: import('@playwright/test').Page) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: /sign in|login/i })).toBeVisible({ timeout: 10000 });
  await page.getByLabel(/username|email/i).fill('admin');
  await page.getByLabel(/password/i).fill('admin123');
  await page.getByRole('button', { name: /sign in|login|submit/i }).click();
  await expect(page).toHaveURL('/', { timeout: 15000 });
};

const captureConsoleErrors = (page: import('@playwright/test').Page) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      errors.push(msg.text());
    }
  });
  return errors;
};

const expectNoConsoleErrors = (errors: string[]) => {
  const critical = errors.filter(
    (err) =>
      err.includes('TypeError') ||
      err.includes('ReferenceError') ||
      err.includes('Unhandled') ||
      err.includes('Cannot read properties') ||
      err.includes('Uncaught')
  );
  expect(critical, `Console errors: ${critical.join(' | ')}`).toHaveLength(0);
};

test.describe('Critical workflows', () => {
  test('AI Models page renders without crashing', async ({ page }) => {
    const errors = captureConsoleErrors(page);
    await login(page);
    await page.getByRole('button', { name: /ai models/i }).click();
    await expect(page).toHaveURL(/\/ai-models/);
    await expect(page.getByRole('heading', { name: /ai|models/i })).toBeVisible();
    expectNoConsoleErrors(errors);
  });

  test('Patients page shows empty state on fresh DB', async ({ page }) => {
    const errors = captureConsoleErrors(page);
    await login(page);
    await page.getByRole('button', { name: /patients/i }).click();
    await expect(page).toHaveURL(/\/patients/);
    await expect(page.getByRole('heading', { name: /patients/i })).toBeVisible();
    await expect(page.getByText(/no patients found/i)).toBeVisible();
    expectNoConsoleErrors(errors);
  });

  test('Upload DICOM and open viewer', async ({ page }) => {
    const errors = captureConsoleErrors(page);
    await login(page);
    await page.getByRole('button', { name: /studies/i }).click();
    await expect(page).toHaveURL(/\/studies/);

    await page.getByRole('button', { name: /upload dicom/i }).click();
    await expect(page.getByRole('dialog', { name: /upload dicom files/i })).toBeVisible();
    await page.locator('input[type="file"]').setInputFiles(fixturePath);

    await expect(page.getByRole('dialog', { name: /upload dicom files/i })).toBeHidden({
      timeout: 60000,
    });

    const patientRow = page.getByText(/test\^patient/i);
    await expect(patientRow).toBeVisible({ timeout: 60000 });
    await patientRow.click();

    await expect(page).toHaveURL(/\/viewer\//);
    const image = page.locator('img[alt^=\"Slice\"]');
    await expect(image).toBeVisible({ timeout: 20000 });

    const naturalWidth = await image.evaluate((img) => (img as HTMLImageElement).naturalWidth);
    expect(naturalWidth).toBeGreaterThan(0);

    await page.getByLabel('Zoom').click();
    const zoomLabel = page.getByText(/Zoom: \\d+%/);
    const beforeZoom = await zoomLabel.innerText();
    await page.mouse.wheel(0, -300);
    await expect(zoomLabel).not.toHaveText(beforeZoom);

    await page.getByLabel('Window/Level').click();
    const wlLabel = page.getByText(/W: .* L: .*/);
    const beforeWL = await wlLabel.innerText();
    const box = await image.boundingBox();
    if (!box) throw new Error('Image not found for interaction');
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;
    await page.mouse.move(centerX, centerY);
    await page.mouse.down();
    await page.mouse.move(centerX + 60, centerY - 40);
    await page.mouse.up();
    await expect(wlLabel).not.toHaveText(beforeWL);

    expectNoConsoleErrors(errors);
  });
});
