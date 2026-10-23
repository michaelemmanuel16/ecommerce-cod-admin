import { test, expect } from '@playwright/test';

/**
 * Test Suite: SaaS signup switched off (M3-T37, F-123, F-120)
 *
 * The default: VITE_SAAS_SIGNUP_ENABLED is not set on the frontend.
 *   - /register and /pricing redirect to /login
 *   - the login page has no sign-up link
 *   - a wrong password and an unknown email show the same text
 *
 * The API is intercepted, so no live backend is needed. Skipped when the flag is on (E2E_SAAS_SIGNUP=true).
 */

test.skip(process.env.E2E_SAAS_SIGNUP === 'true', 'Runs with SaaS signup off');

test.describe('SaaS signup off', () => {
  test('/register redirects to /login', async ({ page }) => {
    await page.goto('/register');
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  });

  test('/pricing redirects to /login', async ({ page }) => {
    await page.goto('/pricing');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('the login page has no sign-up link', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('link', { name: /sign up/i })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Forgot password?' })).toBeVisible();
  });

  test('wrong password and unknown email show the same text', async ({ page }) => {
    let calls = 0;
    await page.route('**/api/auth/login', async (route) => {
      calls += 1;
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ message: calls === 1 ? 'Invalid credentials' : 'No such user' }),
      });
    });
    await page.goto('/login');

    await page.getByLabel('Email').fill('owner@shop.test');
    await page.getByLabel('Password').fill('WrongPass1!');
    await page.getByRole('button', { name: 'Sign in' }).click();
    const wrongPassword = await page.getByRole('alert').textContent();

    await page.getByLabel('Email').fill('nobody@shop.test');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect.poll(() => calls).toBe(2);
    await expect(page.getByRole('alert')).toHaveText(wrongPassword ?? '');
    expect(wrongPassword).toBe('Email or password is wrong');
  });
});
