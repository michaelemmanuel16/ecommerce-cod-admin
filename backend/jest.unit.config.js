// `npm run test:unit -- <name> --forceExit`: the base config, minus the integration folder. That is every
// other test: __tests__/unit plus the __tests__ folders beside utils, controllers and validators.
const base = require('./jest.config');

module.exports = { ...base, testPathIgnorePatterns: ['/node_modules/', '/__tests__/integration/'] };
