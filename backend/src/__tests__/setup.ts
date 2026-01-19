import { jest, afterEach, afterAll } from '@jest/globals';

// Mock environment variables for testing
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-that-is-at-least-32-characters-long';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-that-is-at-least-32-characters-long';
process.env.WEBHOOK_SECRET = 'test-webhook-secret-that-is-at-least-32-characters-long';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://ecommerce_user:ecommerce_dev_password@localhost:5432/ecommerce_cod';

// Global test timeout
jest.setTimeout(10000);

// Mock console methods to reduce noise in tests
global.console = {
  ...console,
  // log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: console.error, // Don't mock error completely so we can see what's wrong
};

// Clear all timers and mocks after each test to prevent leaks
afterEach(() => {
  jest.clearAllTimers();
  jest.clearAllMocks();
});

// Global cleanup after all tests
afterAll(async () => {
  // Import dynamically to avoid initialization issues
  try {
    const { default: prisma } = await import('../utils/prisma');
    await prisma.$disconnect();
  } catch (error) {
    // Database connection may not be initialized in all tests
  }

  // Clear all timers
  jest.clearAllTimers();

  // Give time for async operations to complete
  await new Promise(resolve => setTimeout(resolve, 100));
});
