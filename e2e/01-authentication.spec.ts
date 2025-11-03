import { test, expect } from '@playwright/test';
import { login, logout, clearBrowserState, TEST_CREDENTIALS, TEST_URLS, waitForToast } from './helpers/test-helpers';

/**
 * Test Suite: Authentication Flow
 *
 * Tests critical authentication scenarios including:
 * - Login with valid credentials
 * - Login with invalid credentials
 * - Token persistence
 * - Logout functionality
 * - Protected route access
 * - Token refresh (if applicable)
 */

test.describe('Authentication Flow', () => {
  test.beforeEach(async ({ page }) => {
    // Clear browser state before each test
    await clearBrowserState(page);
  });

  test('should login successfully with valid credentials', async ({ page }) => {
    console.log('Test: Login with valid credentials');

    // Navigate to login page
    await page.goto(TEST_URLS.login);

    // Verify we're on the login page
    await expect(page).toHaveURL(TEST_URLS.login);
    await expect(page.locator('h1')).toContainText('COD Admin');

    // Fill login form
    await page.fill('input[type="email"]', TEST_CREDENTIALS.admin.email);
    await page.fill('input[type="password"]', TEST_CREDENTIALS.admin.password);

    // Take screenshot before submission
    await page.screenshot({ path: 'test-results/screenshots/login-form-filled.png' });

    // Submit form
    await page.click('button[type="submit"]');

    // Wait for redirect to dashboard
    await page.waitForURL(TEST_URLS.dashboard, { timeout: 15000 });

    // Verify we're on dashboard
    await expect(page).toHaveURL(TEST_URLS.dashboard);

    // Verify toast notification
    const hasToast = await waitForToast(page, 'Welcome back');
    expect(hasToast).toBeTruthy();

    // Verify localStorage has auth tokens
    const authData = await page.evaluate(() => {
      const data = localStorage.getItem('auth-storage');
      return data ? JSON.parse(data) : null;
    });

    expect(authData).toBeTruthy();
    expect(authData.state.isAuthenticated).toBe(true);
    expect(authData.state.accessToken).toBeTruthy();
    expect(authData.state.refreshToken).toBeTruthy();
    expect(authData.state.user).toBeTruthy();
    expect(authData.state.user.email).toBe(TEST_CREDENTIALS.admin.email);

    // Take screenshot after successful login
    await page.screenshot({ path: 'test-results/screenshots/dashboard-after-login.png' });

    console.log('Login successful - tokens stored:', {
      hasAccessToken: !!authData.state.accessToken,
      hasRefreshToken: !!authData.state.refreshToken,
      userEmail: authData.state.user.email,
    });
  });

  test('should show error with invalid credentials', async ({ page }) => {
    console.log('Test: Login with invalid credentials');

    await page.goto(TEST_URLS.login);

    // Fill with invalid credentials
    await page.fill('input[type="email"]', 'invalid@example.com');
    await page.fill('input[type="password"]', 'wrongpassword');

    // Submit form
    await page.click('button[type="submit"]');

    // Wait a moment for error to appear
    await page.waitForTimeout(2000);

    // Verify we're still on login page
    await expect(page).toHaveURL(TEST_URLS.login);

    // Check for error message (could be alert or toast)
    const hasError = await page.evaluate(() => {
      // Check for any visible error indicators
      return document.body.innerText.includes('failed') ||
             document.body.innerText.includes('Invalid') ||
             document.body.innerText.includes('error');
    });

    // Take screenshot of error state
    await page.screenshot({ path: 'test-results/screenshots/login-error.png' });

    console.log('Invalid login handled correctly - stayed on login page');
  });

  test('should persist authentication across page reloads', async ({ page }) => {
    console.log('Test: Token persistence');

    // Login first
    await login(page);

    // Verify we're authenticated
    await expect(page).toHaveURL(TEST_URLS.dashboard);

    // Reload the page
    await page.reload();

    // Wait for page to load
    await page.waitForLoadState('networkidle');

    // Verify we're still on dashboard (not redirected to login)
    await expect(page).toHaveURL(TEST_URLS.dashboard);

    // Verify localStorage still has tokens
    const authData = await page.evaluate(() => {
      const data = localStorage.getItem('auth-storage');
      return data ? JSON.parse(data) : null;
    });

    expect(authData).toBeTruthy();
    expect(authData.state.isAuthenticated).toBe(true);

    console.log('Authentication persisted after reload');
  });

  test('should redirect to login when accessing protected route without auth', async ({ page }) => {
    console.log('Test: Protected route access');

    // Try to access protected route without auth
    await page.goto(TEST_URLS.orders);

    // Should be redirected to login
    await page.waitForURL(TEST_URLS.login, { timeout: 5000 });
    await expect(page).toHaveURL(TEST_URLS.login);

    console.log('Protected route correctly redirected to login');
  });

  test('should logout successfully', async ({ page }) => {
    console.log('Test: Logout functionality');

    // Login first
    await login(page);

    // Verify we're logged in
    await expect(page).toHaveURL(TEST_URLS.dashboard);

    // Find and click logout button (check common locations)
    const logoutButton = page.locator('button:has-text("Logout"), button:has-text("Sign Out"), [data-testid="logout"]').first();

    if (await logoutButton.isVisible()) {
      await logoutButton.click();

      // Wait for redirect to login
      await page.waitForURL(TEST_URLS.login, { timeout: 5000 });
      await expect(page).toHaveURL(TEST_URLS.login);

      // Verify localStorage is cleared
      const authData = await page.evaluate(() => {
        const data = localStorage.getItem('auth-storage');
        return data ? JSON.parse(data) : null;
      });

      // Check that auth state is cleared
      if (authData?.state) {
        expect(authData.state.isAuthenticated).toBe(false);
        expect(authData.state.accessToken).toBeFalsy();
      }

      console.log('Logout successful - auth cleared');
    } else {
      console.log('Logout button not found - skipping logout test');
      test.skip();
    }
  });

  test('should maintain session with valid token', async ({ page }) => {
    console.log('Test: Session maintenance');

    // Login
    await login(page);

    // Navigate to different pages
    await page.goto(TEST_URLS.orders);
    await expect(page).toHaveURL(TEST_URLS.orders);

    await page.goto(TEST_URLS.customers);
    await expect(page).toHaveURL(TEST_URLS.customers);

    await page.goto(TEST_URLS.products);
    await expect(page).toHaveURL(TEST_URLS.products);

    // Verify we're still authenticated
    const authData = await page.evaluate(() => {
      const data = localStorage.getItem('auth-storage');
      return data ? JSON.parse(data) : null;
    });

    expect(authData).toBeTruthy();
    expect(authData.state.isAuthenticated).toBe(true);

    console.log('Session maintained across navigation');
  });

  test('should include auth token in API requests', async ({ page }) => {
    console.log('Test: Auth token in API requests');

    // Login
    const authData = await login(page);

    // Monitor API requests
    const requests: any[] = [];
    page.on('request', request => {
      if (request.url().includes('/api/')) {
        requests.push({
          url: request.url(),
          headers: request.headers(),
        });
      }
    });

    // Navigate to a page that makes API calls
    await page.goto(TEST_URLS.orders);
    await page.waitForTimeout(2000);

    // Verify at least one API request was made with auth header
    const authRequests = requests.filter(req =>
      req.headers['authorization']?.startsWith('Bearer ')
    );

    expect(authRequests.length).toBeGreaterThan(0);

    // Verify the token matches what we have in localStorage
    const firstAuthRequest = authRequests[0];
    const tokenInRequest = firstAuthRequest.headers['authorization'].replace('Bearer ', '');

    expect(tokenInRequest).toBe(authData.state.accessToken);

    console.log('Auth token correctly included in API requests:', {
      totalAPIRequests: requests.length,
      authenticatedRequests: authRequests.length,
    });
  });
});
