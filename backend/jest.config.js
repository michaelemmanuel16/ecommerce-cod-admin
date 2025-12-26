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
      branches: 25,     // Pragmatic threshold - branch coverage is hardest
      functions: 29,    // Match current coverage - focus on critical functions
      lines: 37,        // Match current coverage - improved from initial 34%
      statements: 38,   // Match current coverage - reasonable for complex codebase
    },
  },
  globals: {
    'ts-jest': {
      isolatedModules: true,
    },
  },
};
