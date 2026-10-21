// `npm run test:integration -- <name> --forceExit`: the base config, limited to the integration folder.
// (A --testMatch / --testPathPattern flag in the script would also swallow the <name> given after `--`.)
const base = require('./jest.config');

module.exports = { ...base, testMatch: ['**/__tests__/integration/**/*.test.ts'] };
