import { test, expect, Page } from '@playwright/test';

/**
 * M3-T63, T64 (F-1220 to F-1226): the Settings shell, Profile and Security tabs.
 * The account routes are served by routes inside each test, so no data changes. Needs the dev users
 * e2e-admin (role admin with the default settings:view), e2e-rep and admin@codadmin.com (owner), all password123,
 * and the frontend. Point E2E_BASE_URL at the Vite port.
 */
test.use({ baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173' });

const PASSWORD = 'password123';

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForFunction(() => !location.pathname.startsWith('/login'));
}

const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

test.describe('T63 settings shell and profile', () => {
  test('an admin sees the view-only tabs and cannot save', async ({ page }) => {
    await signIn(page, 'e2e-admin@codadmin.com');
    await page.goto('/settings');
    const menu = page.getByRole('navigation', { name: 'Settings sections' });
    await expect(menu.getByRole('button', { name: 'Business details' })).toBeVisible();
    await expect(menu.getByRole('button', { name: 'Billing & plans' })).toHaveCount(0);
    await menu.getByRole('button', { name: 'Business details' }).click();
    await expect(page.getByText(/view this section but not change it/)).toBeVisible();
    await expect(page.getByRole('button', { name: /^Save/ })).toHaveCount(0);
    // A direct URL to a tab that is hidden shows "No access"
    await page.goto('/settings?tab=billing');
    await expect(page.getByText('You do not have access to this page')).toBeVisible();
  });

  test('saving the profile updates the name in the header', async ({ page }) => {
    let sent: Record<string, unknown> | undefined;
    await page.route('**/api/users/me', async (route) => {
      if (route.request().method() !== 'PATCH') return route.continue();
      sent = route.request().postDataJSON();
      return route.fulfill(json({ user: { id: 1, email: 'rep@example.com', firstName: 'Adwoa', lastName: 'Mensah', displayName: 'Dee', phoneNumber: '+233245550182', photoUrl: null, role: 'sales_rep', createdAt: '2026-01-02T00:00:00.000Z' } }));
    });
    await signIn(page, 'e2e-rep@codadmin.com');
    await page.goto('/settings?tab=profile');
    await expect(page.getByLabel('Phone')).toHaveAttribute('placeholder', '+233 24 000 0000');
    await expect(page.getByLabel('Language')).toHaveValue('English');
    await page.getByLabel('Full name').fill('Adwoa Mensah');
    await page.getByRole('button', { name: 'Save profile' }).click();
    await expect(page.getByText('Profile saved')).toBeVisible();
    expect(sent).toMatchObject({ name: 'Adwoa Mensah' });
    await expect(page.locator('.me b')).toHaveText('Adwoa');
  });
});
