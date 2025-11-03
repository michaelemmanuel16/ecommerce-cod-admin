import { defineConfig, devices } from '@playwright/test';

/**
 * E2E Test Configuration for E-Commerce COD Admin Dashboard
 * Tests critical user flows including authentication, order management, and real-time updates
 */
export default defineConfig({
  testDir: './e2e',

  // Run tests sequentially to maintain state consistency
  fullyParallel: false,

  // Retry failed tests once
  retries: 1,

  // Use single worker for sequential execution
  workers: 1,

  // Reporter configuration
  reporter: [
    ['html', { outputFolder: 'playwright-report' }],
    ['json', { outputFile: 'test-results/results.json' }],
    ['list']
  ],

  // Global test timeout
  timeout: 60000,

  // Expect timeout for assertions
  expect: {
    timeout: 10000,
  },

  use: {
    // Base URL for navigation
    baseURL: 'http://localhost:5173',

    // Collect trace on first retry
    trace: 'on-first-retry',

    // Screenshot on failure
    screenshot: 'only-on-failure',

    // Record video on failure
    video: 'retain-on-failure',

    // Browser viewport
    viewport: { width: 1920, height: 1080 },

    // Action timeout
    actionTimeout: 15000,

    // Navigation timeout
    navigationTimeout: 30000,
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Enable console and network logging
        launchOptions: {
          args: ['--disable-blink-features=AutomationControlled']
        }
      },
    },
  ],

  // Web server configuration (optional - if you want Playwright to start servers)
  // Uncomment if you want Playwright to manage server startup
  // webServer: [
  //   {
  //     command: 'cd backend && npm run dev',
  //     port: 3000,
  //     timeout: 120000,
  //     reuseExistingServer: true,
  //   },
  //   {
  //     command: 'cd frontend && npm run dev',
  //     port: 5173,
  //     timeout: 120000,
  //     reuseExistingServer: true,
  //   },
  // ],
});
