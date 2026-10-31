// `npm run test:integration -- <name> --forceExit`: the base config, limited to the integration folder.
// (A --testMatch / --testPathPattern flag in the script would also swallow the <name> given after `--`.)
//
// `npm run test:integration:parallel` sets TEST_DB_PER_WORKER=1: several workers, each on its own database
// (made by the globalSetup, chosen in src/__tests__/setup.ts). `--maxWorkers=N` overrides the default.
const base = require('./jest.config');
const { DEFAULT_PARALLEL_WORKERS } = require('./scripts/lib/testDb');

const perWorkerDb = process.env.TEST_DB_PER_WORKER === '1';

module.exports = {
  ...base,
  testMatch: ['**/__tests__/integration/**/*.test.ts'],
  ...(perWorkerDb && {
    maxWorkers: DEFAULT_PARALLEL_WORKERS,
    globalSetup: '<rootDir>/scripts/lib/testDbGlobalSetup.js',
  }),
};
