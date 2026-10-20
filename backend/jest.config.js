module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/**/__tests__/**',
    '!src/server.ts',
    '!src/sockets/**',            // Socket.io infrastructure - covered by E2E tests
    '!src/queues/**',             // Bull queue workers - covered by integration tests
    '!src/migrations/**',         // Database migrations
    '!src/utils/prisma.ts',       // Prisma client initialization
    '!src/utils/redis.ts',        // Redis client initialization
    '!src/scripts/**',            // Utility scripts
    '!src/**/index.ts',           // Index files that just export
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  setupFilesAfterEnv: ['<rootDir>/src/__tests__/setup.ts'],
  testTimeout: 10000,
  verbose: true,
  clearMocks: true,
  resetMocks: true,
  restoreMocks: true,
  coverageThreshold: {
    global: {
      branches: 49,     // Floor = current 49.33 rounded down (COD-8); raise at M5 and M11
      functions: 60,    // Floor = current 60.30 rounded down
      lines: 62,        // Floor = current 62.57 rounded down
      statements: 62,   // Floor = current 62.87 rounded down
    },
  },
  globals: {
    'ts-jest': {
      isolatedModules: true,
    },
  },
};
