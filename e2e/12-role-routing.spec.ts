import { test, expect, Page } from '@playwright/test';

/**
 * M3-T33 (F-102, F-103): role home, route guards and the "no access" page.
 * Needs dev-DB users e2e-finance / e2e-stock / e2e-manager / e2e-rep / e2e-agent (password123) and the
 * frontend with the repApp and agentApp flags off (default). Point E2E_BASE_URL at the Vite port.
 */
test.use({ baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173' });

const PASSWORD = 'password123';
const NO_ACCESS = 'You do not have access to this page';

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForFunction(() => !location.pathname.startsWith('/login'));
}

test.describe('role home and route guards', () => {
  test('finance clerk lands on Finance', async ({ page }) => {
    await signIn(page, 'e2e-finance@codadmin.com');
    await expect(page).toHaveURL(/\/finance$/);
    await expect(page.getByText(NO_ACCESS)).toHaveCount(0);
  });

  test('stock keeper lands on Products', async ({ page }) => {
    await signIn(page, 'e2e-stock@codadmin.com');
    await expect(page).toHaveURL(/\/products$/);
  });

  test('manager sees the Dashboard', async ({ page }) => {
    await signIn(page, 'e2e-manager@codadmin.com');
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible();
    await expect(page.getByText(NO_ACCESS)).toHaveCount(0);
  });

  test('a direct URL to a hidden page shows "no access" and keeps the URL', async ({ page }) => {
    await signIn(page, 'e2e-stock@codadmin.com');
    await page.goto('/finance');
    await expect(page.getByText(NO_ACCESS)).toBeVisible();
    await expect(page).toHaveURL(/\/finance$/);
    await expect(page.getByRole('link', { name: 'Go to Products' })).toBeVisible();
  });

  test('flags off: a call rep stays on the current page and cannot open Finance', async ({ page }) => {
    await signIn(page, 'e2e-rep@codadmin.com');
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByText(NO_ACCESS)).toHaveCount(0);
    await page.goto('/finance');
    await expect(page.getByText(NO_ACCESS)).toBeVisible();
  });

  test('flags off: a delivery agent stays on the current page', async ({ page }) => {
    await signIn(page, 'e2e-agent@codadmin.com');
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByText(NO_ACCESS)).toHaveCount(0);
    await expect(page).not.toHaveURL(/\/(agent|rep|m)\b/);
  });
});
