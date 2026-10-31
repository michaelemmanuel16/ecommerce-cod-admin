import { jest, afterEach, afterAll } from '@jest/globals';

import * as dotenv from 'dotenv';
import path from 'path';

// Load test environment variables
dotenv.config({ path: path.join(__dirname, '../../.env.test') });
// Fallback to .env if .env.test is missing
dotenv.config({ path: path.join(__dirname, '../../.env') });

// Parallel local runs (`npm run test:integration:parallel`): every Jest worker gets its own database,
// chosen here before any test file imports Prisma (names and creation: scripts/lib/testDb.js).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { workerDatabaseUrl, testDatabaseProblem } = require('../../scripts/lib/testDb');
if (process.env.TEST_DB_PER_WORKER === '1' && process.env.DATABASE_URL) {
  process.env.DATABASE_URL = workerDatabaseUrl(process.env.DATABASE_URL, process.env.JEST_WORKER_ID || '1');
}

// Mock environment variables for testing
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-that-is-at-least-32-characters-long';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-secret-that-is-at-least-32-characters-long';
process.env.WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'test-webhook-secret-that-is-at-least-32-characters-long';

// Ensure we have a database URL, but warn if it looks like production
if (!process.env.DATABASE_URL) {
  console.warn('WARNING: DATABASE_URL not set for tests. Using fallback local database.');
  process.env.DATABASE_URL = 'postgresql://ecommerce_user:ecommerce_dev_password@localhost:5432/ecommerce_cod_test';
} else {
  // Strict safety check for tests
  const problem = testDatabaseProblem(process.env.DATABASE_URL);
  if (problem) {
    console.error(`CRITICAL: ${problem}`);
    process.exit(1);
  }
}

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
