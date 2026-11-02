/**
 * Test database names, the safety guard and per-worker databases. One place, used by
 * src/__tests__/setup.ts (picks the worker's database) and by jest.integration.config.js plus
 * scripts/lib/testDbGlobalSetup.js (create them).
 *
 * `npm run test:integration:parallel` sets TEST_DB_PER_WORKER=1: Jest worker k then uses <base>_w<k>.
 */
const path = require('path');
const dotenv = require('dotenv');

/** Jest workers for the parallel integration run. `--maxWorkers=N` on the command line overrides it. */
const DEFAULT_PARALLEL_WORKERS = 3;

/** Same env loading as src/__tests__/setup.ts: .env.test first, .env as fallback. dotenv never overrides. */
function loadTestEnv() {
  dotenv.config({ path: path.join(__dirname, '../../.env.test') });
  dotenv.config({ path: path.join(__dirname, '../../.env') });
}

/** Why this URL must not be used for tests, or null when it is fine. */
function testDatabaseProblem(url) {
  if (!url.includes('_test')) return 'DATABASE_URL must contain "_test" to be used for testing.';
  if (url.includes('prod') || url.includes('production')) return 'DATABASE_URL looks like a production database.';
  return null;
}

/** <base url> with "_<suffix>" appended to the database name. */
function withDbSuffix(baseUrl, suffix) {
  const url = new URL(baseUrl);
  url.pathname = `${url.pathname}_${suffix}`;
  return url;
}

/** The URL Jest worker `workerId` uses. A small pool keeps N workers under the Postgres connection limit. */
function workerDatabaseUrl(baseUrl, workerId) {
  const url = withDbSuffix(baseUrl, `w${workerId}`);
  if (!url.searchParams.has('connection_limit')) url.searchParams.set('connection_limit', '10');
  return url.toString();
}

const templateDatabaseUrl = (baseUrl) => withDbSuffix(baseUrl, 'template').toString();

module.exports = {
  DEFAULT_PARALLEL_WORKERS,
  loadTestEnv,
  testDatabaseProblem,
  workerDatabaseUrl,
  templateDatabaseUrl,
};
