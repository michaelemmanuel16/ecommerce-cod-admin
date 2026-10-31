/**
 * Jest globalSetup for `npm run test:integration:parallel`: make one database per worker.
 *
 * <base>_template is migrated once (`prisma migrate deploy` creates it and applies only what is pending).
 * <base>_w1..N are copies of it (CREATE DATABASE ... TEMPLATE). A copy is rebuilt only when the number
 * of migrations changed since it was made; the count is stored as the database comment.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { loadTestEnv, testDatabaseProblem, workerDatabaseUrl, templateDatabaseUrl } = require('./testDb');

// Before @prisma/client: it reads backend/.env on load, and dotenv never overrides, so .env.test must go first.
loadTestEnv();
const { PrismaClient } = require('@prisma/client');

const backendDir = path.join(__dirname, '../..');

const dbNameOf = (url) => new URL(url).pathname.slice(1);

module.exports = async function globalSetup(globalConfig) {
  if (process.env.TEST_DB_PER_WORKER !== '1') return;

  const baseUrl = process.env.DATABASE_URL;
  if (!baseUrl) throw new Error('testDb: DATABASE_URL is not set (backend/.env.test has none)');
  const problem = testDatabaseProblem(baseUrl);
  if (problem) throw new Error(`testDb: ${problem}`);

  const templateUrl = templateDatabaseUrl(baseUrl);
  execFileSync(path.join(backendDir, 'node_modules/.bin/prisma'), ['migrate', 'deploy'], {
    cwd: backendDir,
    env: { ...process.env, DATABASE_URL: templateUrl },
    stdio: 'pipe',
  });

  const migrationCount = String(
    fs.readdirSync(path.join(backendDir, 'prisma/migrations'), { withFileTypes: true }).filter((e) => e.isDirectory()).length,
  );
  const admin = new URL(baseUrl);
  admin.pathname = '/postgres';
  const db = new PrismaClient({ datasources: { db: { url: admin.toString() } } });
  try {
    const templateName = dbNameOf(templateUrl);
    for (let k = 1; k <= globalConfig.maxWorkers; k++) {
      const name = dbNameOf(workerDatabaseUrl(baseUrl, k));
      if (!/^[A-Za-z0-9_]+$/.test(name)) throw new Error(`testDb: unsafe database name ${name}`);
      const rows = await db.$queryRawUnsafe(
        `SELECT shobj_description(oid, 'pg_database') AS comment FROM pg_database WHERE datname = '${name}'`,
      );
      if (rows.length > 0 && rows[0].comment === migrationCount) continue;
      await db.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await db.$executeRawUnsafe(`CREATE DATABASE "${name}" TEMPLATE "${templateName}"`);
      await db.$executeRawUnsafe(`COMMENT ON DATABASE "${name}" IS '${migrationCount}'`);
    }
  } finally {
    await db.$disconnect();
  }
};
