import { test, expect, Page } from '@playwright/test';

/**
 * M3-T67 (F-124): the first-run wizard. Close and resume keeps step data.
 * The onboarding API and the settings read are served by routes inside the test, backed by one in-memory store,
 * so the numbers do not depend on the dev database. Needs the dev users (password123) and the frontend.
 * Point E2E_BASE_URL at the Vite port.
 */
test.use({ baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173' });

async function signIn(page: Page, email = 'admin@codadmin.com') {
  await page.goto('/login');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', 'password123');
  await page.click('button[type="submit"]');
  await page.waitForFunction(() => !location.pathname.startsWith('/login'));
}

/** A tenant that has not finished setup. `saved` is what the server holds; it lives across page reloads. */
async function serve(page: Page) {
  const saved = { country: null as string | null, businessName: '', businessEmail: '', businessAddress: '', store: false, partner: false, skipped: false };
  const json = (route: import('@playwright/test').Route, body: unknown, status = 200) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

  await page.route('**/api/onboarding/status', (route) =>
    json(route, {
      onboardingCompleted: false,
      country: saved.country,
      currency: saved.country === 'Ghana' ? 'GHS' : null,
      steps: [
        { step: 1, key: 'store', done: saved.store },
        { step: 2, key: 'partner', done: saved.partner, skipped: saved.skipped },
      ],
    }),
  );
  await page.route('**/api/onboarding/setup', (route) => {
    const body = route.request().postDataJSON();
    if (body.step === 1) {
      Object.assign(saved, { country: body.country, businessName: body.businessName, businessEmail: body.businessEmail ?? '', businessAddress: body.businessAddress ?? '', store: true });
      return json(route, { message: 'ok' });
    }
    if (body.skip) saved.skipped = true;
    else saved.partner = true;
    return json(route, { message: 'ok' }, 201);
  });
  await page.route('**/api/admin/settings', (route) =>
    route.request().method() === 'GET'
      ? json(route, { id: 'cfg', currency: 'GHS', businessName: saved.businessName, businessEmail: saved.businessEmail, businessAddress: saved.businessAddress })
      : route.continue(),
  );
  return saved;
}

test.describe('T67 onboarding wizard', () => {
  test('close and resume keeps step data', async ({ page }) => {
    const saved = await serve(page);
    await signIn(page);
    await page.goto('/onboarding');

    await expect(page.getByRole('heading', { name: 'Your store' })).toBeVisible();
    // Steps 3 to 6 are disabled.
    await expect(page.locator('.step.off')).toHaveCount(4);

    await page.getByLabel('Selling country').selectOption('Ghana');
    await expect(page.getByLabel('Store currency')).toHaveValue(/GHS/);
    await page.getByLabel('Business name').fill('Resume Shop');
    await page.getByLabel(/Business email/).fill('hello@resume.test');
    await page.getByLabel(/Business address/).fill('1 Ring Road, Osu, Greater Accra');
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByRole('heading', { name: 'Connect your 3PL' })).toBeVisible();
    expect(saved.store).toBe(true);

    // Close the wizard (reload) and come back: it resumes at step 2 with step 1 shown as done.
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Connect your 3PL' })).toBeVisible();
    await expect(page.locator('.step.done')).toHaveCount(1);

    // Step 1 still holds the saved values.
    await page.getByRole('button', { name: /Your store/ }).click();
    await expect(page.getByLabel('Business name')).toHaveValue('Resume Shop');
    await expect(page.getByLabel('Selling country')).toHaveValue('Ghana');
    await expect(page.getByLabel(/Business email/)).toHaveValue('hello@resume.test');
    await expect(page.getByLabel(/Business address/)).toHaveValue('1 Ring Road, Osu, Greater Accra');
  });
});
