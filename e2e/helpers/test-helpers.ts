import { Page, expect } from '@playwright/test';

/**
 * Test helper utilities for E2E tests
 */

export const TEST_CREDENTIALS = {
  admin: {
    email: 'admin@example.com',
    password: 'admin123',
  },
  manager: {
    email: 'manager@example.com',
    password: 'manager123',
  },
  salesRep: {
    email: 'sales@example.com',
    password: 'sales123',
  },
};

export const TEST_URLS = {
  login: '/login',
  dashboard: '/',
  orders: '/orders',
  customers: '/customers',
  products: '/products',
  deliveryAgents: '/delivery-agents',
  customerReps: '/customer-reps',
  financial: '/financial',
  analytics: '/analytics',
  workflows: '/workflows',
  settings: '/settings',
};

/**
 * Login helper - performs login and verifies success
 */
export async function login(page: Page, email: string = TEST_CREDENTIALS.admin.email, password: string = TEST_CREDENTIALS.admin.password) {
  await page.goto(TEST_URLS.login);

  // Wait for login form to be visible
  await page.waitForSelector('input[type="email"]', { state: 'visible' });

  // Fill login form
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);

  // Click submit button
  await page.click('button[type="submit"]');

  // Wait for navigation to complete
  await page.waitForURL(TEST_URLS.dashboard, { timeout: 10000 });

  // Verify we're logged in by checking localStorage
  const authData = await page.evaluate(() => {
    const data = localStorage.getItem('auth-storage');
    return data ? JSON.parse(data) : null;
  });

  expect(authData).toBeTruthy();
  expect(authData.state.isAuthenticated).toBe(true);
  expect(authData.state.accessToken).toBeTruthy();

  return authData;
}

/**
 * Logout helper
 */
export async function logout(page: Page) {
  // Find and click logout button (usually in sidebar or header)
  await page.click('button:has-text("Logout"), button:has-text("Sign Out")');

  // Wait for redirect to login
  await page.waitForURL(TEST_URLS.login, { timeout: 5000 });

  // Verify localStorage is cleared
  const authData = await page.evaluate(() => {
    return localStorage.getItem('auth-storage');
  });

  expect(authData).toBeNull();
}

/**
 * Clear browser state between tests
 */
export async function clearBrowserState(page: Page) {
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  // Clear cookies
  await page.context().clearCookies();
}

/**
 * Wait for API call to complete
 */
export async function waitForAPICall(page: Page, urlPattern: string | RegExp, method: string = 'GET') {
  const responsePromise = page.waitForResponse(
    response => {
      const url = response.url();
      const matchesUrl = typeof urlPattern === 'string'
        ? url.includes(urlPattern)
        : urlPattern.test(url);
      return matchesUrl && response.request().method() === method;
    },
    { timeout: 10000 }
  );

  return responsePromise;
}

/**
 * Check for console errors
 */
export async function getConsoleErrors(page: Page): Promise<string[]> {
  const errors: string[] = [];

  page.on('console', msg => {
    if (msg.type() === 'error') {
      errors.push(msg.text());
    }
  });

  return errors;
}

/**
 * Take screenshot with timestamp
 */
export async function takeTimestampedScreenshot(page: Page, name: string) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  await page.screenshot({
    path: `test-results/screenshots/${name}-${timestamp}.png`,
    fullPage: true
  });
}

/**
 * Wait for Socket.io connection
 */
export async function waitForSocketConnection(page: Page, timeout: number = 5000): Promise<boolean> {
  return page.waitForFunction(
    () => {
      // Check if window.socket exists and is connected
      return (window as any).socket?.connected === true;
    },
    { timeout }
  ).then(() => true).catch(() => false);
}

/**
 * Check if element is visible
 */
export async function isElementVisible(page: Page, selector: string): Promise<boolean> {
  try {
    await page.waitForSelector(selector, { state: 'visible', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Fill form with data
 */
export async function fillForm(page: Page, formData: Record<string, string>) {
  for (const [field, value] of Object.entries(formData)) {
    const selector = `input[name="${field}"], select[name="${field}"], textarea[name="${field}"]`;
    await page.fill(selector, value);
  }
}

/**
 * Wait for toast notification
 */
export async function waitForToast(page: Page, expectedText?: string, timeout: number = 5000): Promise<boolean> {
  try {
    const toastSelector = '[role="status"], .toast, .notification';
    await page.waitForSelector(toastSelector, { state: 'visible', timeout });

    if (expectedText) {
      const toastText = await page.textContent(toastSelector);
      return toastText?.includes(expectedText) ?? false;
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Get all network requests made during test
 */
export async function captureNetworkRequests(page: Page): Promise<Array<{ url: string; method: string; status: number }>> {
  const requests: Array<{ url: string; method: string; status: number }> = [];

  page.on('response', response => {
    requests.push({
      url: response.url(),
      method: response.request().method(),
      status: response.status(),
    });
  });

  return requests;
}

/**
 * Performance metrics
 */
export async function getPerformanceMetrics(page: Page) {
  return page.evaluate(() => {
    const perfData = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
    return {
      domContentLoaded: perfData.domContentLoadedEventEnd - perfData.domContentLoadedEventStart,
      loadComplete: perfData.loadEventEnd - perfData.loadEventStart,
      responseTime: perfData.responseEnd - perfData.requestStart,
      domInteractive: perfData.domInteractive - perfData.fetchStart,
    };
  });
}
