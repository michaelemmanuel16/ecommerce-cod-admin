import { test, expect, Page } from '@playwright/test';
import { clearBrowserState } from './helpers/test-helpers';

/**
 * Test Suite: Tenant Registration & Onboarding Flow
 *
 * Tests the multi-tenant SaaS onboarding journey:
 * 1. New tenant registers (company name, admin name, email, password)
 * 2. Redirected to /onboarding — country & currency selection
 * 3. Submits onboarding → redirected to /dashboard
 *
 * Uses API route interception to avoid requiring live DB with seed data.
 */

const REGISTER_URL = '/register';
const ONBOARDING_URL = '/onboarding';

const TEST_TENANT = {
  companyName: 'Acme Deliveries Ltd.',
  adminName: 'Jane Doe',
  adminEmail: `e2e-${Date.now()}@acme-test.com`,
  adminPassword: 'SecurePass1',
};

/**
 * Mock the registration API to return a token immediately.
 * Avoids writing to a real database during E2E tests.
 */
async function mockRegistrationAPIs(page: Page) {
  // POST /api/auth/register → return access token + user
  await page.route('**/api/auth/register', async (route) => {
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        accessToken: 'mock-access-token-e2e',
        user: {
          id: 9999,
          email: TEST_TENANT.adminEmail,
          firstName: 'Jane',
          lastName: 'Doe',
          role: 'ADMIN',
          tenantId: 1,
          onboardingCompleted: false,
        },
      }),
    });
  });

  // POST /api/onboarding/setup → success
  await page.route('**/api/onboarding/setup', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Onboarding complete' }),
    });
  });

  // GET /api/auth/me → return current user (token refresh check)
  await page.route('**/api/auth/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 9999,
        email: TEST_TENANT.adminEmail,
        firstName: 'Jane',
        lastName: 'Doe',
        role: 'ADMIN',
        tenantId: 1,
        onboardingCompleted: true,
      }),
    });
  });

  // GET /api/dashboard/* → return empty data so dashboard loads
  await page.route('**/api/analytics/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({}),
    });
  });
}

test.describe('Tenant Registration & Onboarding', () => {
  test.beforeEach(async ({ page }) => {
    await clearBrowserState(page);
  });

  test('registration page renders all required fields', async ({ page }) => {
    await page.goto(REGISTER_URL);

    await expect(page.locator('h1')).toContainText('COD Admin');
    await expect(page.locator('input[name="companyName"]')).toBeVisible();
    await expect(page.locator('input[name="adminName"]')).toBeVisible();
    await expect(page.locator('input[name="adminEmail"]')).toBeVisible();
    await expect(page.locator('input[name="adminPassword"]')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();

    await page.screenshot({ path: 'test-results/screenshots/register-page.png' });
  });

  test('shows validation errors for empty form submission', async ({ page }) => {
    await page.goto(REGISTER_URL);

    // Submit without filling anything
    await page.click('button[type="submit"]');

    // Zod/react-hook-form shows inline errors
    await expect(page.locator('text=Company name must be at least 2 characters')).toBeVisible();
    await expect(page.locator('text=Your name must be at least 2 characters')).toBeVisible();
  });

  test('shows password strength error for weak password', async ({ page }) => {
    await page.goto(REGISTER_URL);

    await page.fill('input[name="companyName"]', 'Test Co');
    await page.fill('input[name="adminName"]', 'Test User');
    await page.fill('input[name="adminEmail"]', 'test@example.com');
    await page.fill('input[name="adminPassword"]', 'weak');

    await page.click('button[type="submit"]');

    await expect(page.locator('text=Password must be at least 8 characters')).toBeVisible();
  });

  test('shows error for missing uppercase in password', async ({ page }) => {
    await page.goto(REGISTER_URL);

    await page.fill('input[name="companyName"]', 'Test Co');
    await page.fill('input[name="adminName"]', 'Test User');
    await page.fill('input[name="adminEmail"]', 'test@example.com');
    await page.fill('input[name="adminPassword"]', 'alllowercase1');

    await page.click('button[type="submit"]');

    await expect(page.locator('text=Must contain at least one uppercase letter')).toBeVisible();
  });

  test('successful registration redirects to onboarding', async ({ page }) => {
    await mockRegistrationAPIs(page);
    await page.goto(REGISTER_URL);

    await page.fill('input[name="companyName"]', TEST_TENANT.companyName);
    await page.fill('input[name="adminName"]', TEST_TENANT.adminName);
    await page.fill('input[name="adminEmail"]', TEST_TENANT.adminEmail);
    await page.fill('input[name="adminPassword"]', TEST_TENANT.adminPassword);

    await page.screenshot({ path: 'test-results/screenshots/register-form-filled.png' });

    await Promise.all([
      page.waitForURL('**/onboarding', { timeout: 15000 }),
      page.click('button[type="submit"]'),
    ]);

    await expect(page).toHaveURL(/\/onboarding/);
    await page.screenshot({ path: 'test-results/screenshots/onboarding-step1.png' });
  });

  test('onboarding page shows country and currency fields', async ({ page }) => {
    await mockRegistrationAPIs(page);

    // Manually set auth state so we can navigate directly to /onboarding
    await page.goto('/login');
    await page.evaluate((token) => {
      localStorage.setItem('auth-storage', JSON.stringify({
        state: {
          isAuthenticated: true,
          accessToken: token,
          user: {
            id: 9999,
            email: 'jane@acme.com',
            firstName: 'Jane',
            lastName: 'Doe',
            role: 'ADMIN',
            tenantId: 1,
            onboardingCompleted: false,
          },
        },
        version: 0,
      }));
    }, 'mock-access-token-e2e');

    await page.goto(ONBOARDING_URL);

    // Check heading
    await expect(page.locator('h1')).toContainText('Welcome, Jane!');

    // Check country select
    await expect(page.locator('select[name="country"]')).toBeVisible();

    // Check currency select
    await expect(page.locator('select[name="currency"]')).toBeVisible();

    // Check progress bar
    await expect(page.locator('.bg-blue-600')).toBeVisible();

    await page.screenshot({ path: 'test-results/screenshots/onboarding-loaded.png' });
  });

  test('selecting a country auto-populates currency', async ({ page }) => {
    await mockRegistrationAPIs(page);

    await page.goto('/login');
    await page.evaluate(() => {
      localStorage.setItem('auth-storage', JSON.stringify({
        state: {
          isAuthenticated: true,
          accessToken: 'mock-access-token-e2e',
          user: {
            id: 9999, email: 'jane@acme.com', firstName: 'Jane', lastName: 'Doe',
            role: 'ADMIN', tenantId: 1, onboardingCompleted: false,
          },
        },
        version: 0,
      }));
    });

    await page.goto(ONBOARDING_URL);

    // Select Ghana
    await page.selectOption('select[name="country"]', 'Ghana');

    // Currency should auto-update to GHS
    const currencyValue = await page.locator('select[name="currency"]').inputValue();
    expect(currencyValue).toBe('GHS');
  });

  test('selecting Nigeria auto-populates NGN currency', async ({ page }) => {
    await mockRegistrationAPIs(page);

    await page.goto('/login');
    await page.evaluate(() => {
      localStorage.setItem('auth-storage', JSON.stringify({
        state: {
          isAuthenticated: true,
          accessToken: 'mock-access-token-e2e',
          user: {
            id: 9999, email: 'jane@acme.com', firstName: 'Jane', lastName: 'Doe',
            role: 'ADMIN', tenantId: 1, onboardingCompleted: false,
          },
        },
        version: 0,
      }));
    });

    await page.goto(ONBOARDING_URL);
    await page.selectOption('select[name="country"]', 'Nigeria');

    const currencyValue = await page.locator('select[name="currency"]').inputValue();
    expect(currencyValue).toBe('NGN');
  });

  test('shows validation error if country not selected', async ({ page }) => {
    await mockRegistrationAPIs(page);

    await page.goto('/login');
    await page.evaluate(() => {
      localStorage.setItem('auth-storage', JSON.stringify({
        state: {
          isAuthenticated: true,
          accessToken: 'mock-access-token-e2e',
          user: {
            id: 9999, email: 'jane@acme.com', firstName: 'Jane', lastName: 'Doe',
            role: 'ADMIN', tenantId: 1, onboardingCompleted: false,
          },
        },
        version: 0,
      }));
    });

    await page.goto(ONBOARDING_URL);

    // Submit without selecting country
    await page.click('button[type="submit"]');

    await expect(page.locator('text=Please select a country')).toBeVisible();
  });

  test('completes onboarding and shows success screen', async ({ page }) => {
    await mockRegistrationAPIs(page);

    await page.goto('/login');
    await page.evaluate(() => {
      localStorage.setItem('auth-storage', JSON.stringify({
        state: {
          isAuthenticated: true,
          accessToken: 'mock-access-token-e2e',
          user: {
            id: 9999, email: 'jane@acme.com', firstName: 'Jane', lastName: 'Doe',
            role: 'ADMIN', tenantId: 1, onboardingCompleted: false,
          },
        },
        version: 0,
      }));
    });

    await page.goto(ONBOARDING_URL);

    // Select Ghana
    await page.selectOption('select[name="country"]', 'Ghana');

    // Submit
    await page.click('button[type="submit"]');

    // Should show "You're all set!" completion screen
    await expect(page.locator('text=You\'re all set!')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('button:has-text("Go to Dashboard")')).toBeVisible();

    await page.screenshot({ path: 'test-results/screenshots/onboarding-complete.png' });
  });

  test('unauthenticated access to /onboarding redirects to login', async ({ page }) => {
    // Don't set any auth state
    await page.goto(ONBOARDING_URL);

    // Should redirect to login (ProtectedRoute)
    await expect(page).toHaveURL(/\/login/, { timeout: 5000 });
  });

  test('full end-to-end: register → onboarding → dashboard button visible', async ({ page }) => {
    await mockRegistrationAPIs(page);
    await page.goto(REGISTER_URL);

    await page.fill('input[name="companyName"]', TEST_TENANT.companyName);
    await page.fill('input[name="adminName"]', TEST_TENANT.adminName);
    await page.fill('input[name="adminEmail"]', TEST_TENANT.adminEmail);
    await page.fill('input[name="adminPassword"]', TEST_TENANT.adminPassword);

    // Step 1: Register
    await Promise.all([
      page.waitForURL('**/onboarding', { timeout: 15000 }),
      page.click('button[type="submit"]'),
    ]);

    await expect(page).toHaveURL(/\/onboarding/);

    // Step 2: Select country
    await page.selectOption('select[name="country"]', 'Ghana');
    await page.click('button[type="submit"]');

    // Step 3: Completion screen
    await expect(page.locator('text=You\'re all set!')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('button:has-text("Go to Dashboard")')).toBeVisible();

    await page.screenshot({ path: 'test-results/screenshots/onboarding-e2e-complete.png' });
  });
});
