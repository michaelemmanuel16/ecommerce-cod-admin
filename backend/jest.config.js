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
      branches: 77,     // Floor = M5 measured 77.80 rounded down (COD-55, T49); raise again at M11
      functions: 90,    // Floor = M5 measured 90.05 rounded down
      lines: 87,        // Floor = M5 measured 87.02 rounded down
      statements: 86,   // Floor = M5 measured 86.72 rounded down
    },
  },
  globals: {
    'ts-jest': {
      isolatedModules: true,
    },
  },
};
