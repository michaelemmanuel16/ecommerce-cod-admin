import { jest } from '@jest/globals';

// Silence the app logger. Import this module before the code under test.
jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
