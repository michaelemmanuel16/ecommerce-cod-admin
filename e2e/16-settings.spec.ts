import { test, expect, Page } from '@playwright/test';

/**
 * M3-T63, T64 (F-1220 to F-1226): the Settings shell, Profile and Security tabs.
 * The account routes are served by routes inside each test, so no data changes. Needs the dev users
 * e2e-admin (role admin with the default settings:view), e2e-rep and admin@codadmin.com (owner), all password123,
 * and the frontend. Point E2E_BASE_URL at the Vite port.
 */

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

test.describe('T64 security', () => {
  test('a sales rep changes the password; "everywhere else" signs out the second session', async ({ browser }) => {
    const first = await browser.newContext();
    const second = await browser.newContext();
    const a = await first.newPage();
    const b = await second.newPage();
    await signIn(a, 'e2e-rep@codadmin.com');
    await signIn(b, 'e2e-rep@codadmin.com');

    // The password change is served here, so the dev user keeps its password
    let changed: Record<string, unknown> | undefined;
    await a.route('**/api/auth/change-password', async (route) => {
      changed = route.request().postDataJSON();
      return route.fulfill(json({ message: 'Password changed. Other devices were signed out.' }));
    });
    await a.goto('/settings?tab=security');
    await a.getByLabel('Current password').fill(PASSWORD);
    await a.getByLabel('New password', { exact: true }).fill('Newer#Pass9');
    await a.getByLabel('Repeat new password').fill('Newer#Pass9');
    await a.getByRole('button', { name: 'Change password' }).click();
    await expect(a.getByText('Password changed. Other devices are signed out.')).toBeVisible();
    expect(changed).toEqual({ currentPassword: PASSWORD, newPassword: 'Newer#Pass9' });

    // The real sessions route: two sessions, one marked "This device"
    await expect(a.getByText('This device')).toBeVisible();
    await a.getByRole('button', { name: 'Sign out everywhere else' }).click();
    await expect(a.getByText(/Signed out of \d+ other place/)).toBeVisible();

    // The second browser is signed out at its next refresh. Its access token lives 15 minutes, so let it expire first
    await b.goto('/settings?tab=security');
    await b.evaluate(() => {
      const raw = localStorage.getItem('auth-storage');
      if (!raw) return;
      const saved = JSON.parse(raw);
      saved.state.accessToken = 'expired';
      localStorage.setItem('auth-storage', JSON.stringify(saved));
    });
    await b.reload();
    await expect(b).toHaveURL(/\/login/);
    await first.close();
    await second.close();
  });

  test('Delete everything stays disabled until DELETE is typed', async ({ page }) => {
    await signIn(page, 'admin@codadmin.com');
    await page.goto('/settings?tab=security');
    await page.getByRole('button', { name: 'Delete account' }).click();
    const go = page.getByRole('button', { name: 'Delete everything' });
    await page.getByLabel('Your password').fill(PASSWORD);
    await expect(go).toBeDisabled();
    await page.getByLabel('Type DELETE to confirm').fill('DELET');
    await expect(go).toBeDisabled();
    await page.getByLabel('Type DELETE to confirm').fill('DELETE');
    await expect(go).toBeEnabled();
    await expect(page.getByText(/both stores/i)).toHaveCount(0);
    // Do not press it: this is the dev owner account
  });
});

test.describe('T66 old URLs and handover (F-1215, F-1237)', () => {
  test('/connections opens Integrations and keeps the section; the WhatsApp card uses up oauth', async ({ page }) => {
    await signIn(page, 'admin@codadmin.com');
    await page.goto('/connections?section=whatsapp&oauth=success');
    await expect(page).toHaveURL(/\/settings\?/);
    const url = new URL(page.url());
    expect(url.searchParams.get('tab')).toBe('integrations');
    expect(url.searchParams.get('section')).toBe('whatsapp');
    // The WhatsApp card consumes ?oauth= on purpose: it shows the toast and removes the parameter
    await expect(page.getByText('WhatsApp OAuth authorized!')).toBeVisible();
  });

  test('/settings?tab=integrations and ?oauth= stay on Integrations', async ({ page }) => {
    await signIn(page, 'admin@codadmin.com');
    await page.goto('/settings?tab=integrations&section=ai-assistant');
    await expect(page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Integrations' })).toHaveAttribute('aria-current', 'page');
    await page.goto('/settings?oauth=success&section=whatsapp');
    await expect(page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Integrations' })).toHaveAttribute('aria-current', 'page');
  });

  test('?tab=users and ?tab=roles open their tabs; ?tab=forms goes to Checkout forms with its parameters', async ({ page }) => {
    await signIn(page, 'admin@codadmin.com');
    await page.goto('/settings?tab=users');
    await expect(page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'User management' })).toHaveAttribute('aria-current', 'page');
    await page.goto('/settings?tab=roles');
    await expect(page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Role permissions' })).toHaveAttribute('aria-current', 'page');
    await page.goto('/settings?tab=forms&from=email');
    await expect(page).toHaveURL(/\/checkout-forms\?from=email/);
  });

  test('/settings/billing redirects to the Billing tab', async ({ page }) => {
    await signIn(page, 'admin@codadmin.com');
    await page.goto('/settings/billing');
    await expect(page).toHaveURL(/\/settings\?tab=billing/);
  });
});
