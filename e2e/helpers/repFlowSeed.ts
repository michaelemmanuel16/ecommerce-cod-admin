import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';

export interface SeedResult {
  tenantId: string;
  adminEmail: string;
  repEmail: string;
  password: string;
  order1Id: number;
  order2Id: number;
  pkg1Id: number;
  pkg2Id: number;
  pkg3Id: number;
  addon1Id: number;
  addon2Id: number;
}

const ROOT = path.resolve(__dirname, '../..');
const BACKEND_DIR = path.join(ROOT, 'backend');
const ENV_TEST_PATH = path.join(BACKEND_DIR, '.env.test');

function getTestDatabaseUrl(): string {
  if (process.env.DATABASE_URL && process.env.DATABASE_URL.includes('ecommerce_cod_test_')) {
    return process.env.DATABASE_URL;
  }
  if (!fs.existsSync(ENV_TEST_PATH)) {
    throw new Error(`Cannot find .env.test at ${ENV_TEST_PATH}`);
  }
  const content = fs.readFileSync(ENV_TEST_PATH, 'utf-8');
  const match = content.match(/^DATABASE_URL=(.+)$/m);
  if (!match) {
    throw new Error('DATABASE_URL not found in backend/.env.test');
  }
  return match[1].trim().replace(/^["']|["']$/g, '');
}

export function seedRepFlow(): SeedResult {
  const dbUrl = getTestDatabaseUrl();
  const scriptPath = path.join(BACKEND_DIR, 'src/__tests__/e2e/repCallFlowSeed.ts');
  const cmd = `npx ts-node --transpile-only "${scriptPath}" seed`;
  const output = execSync(cmd, {
    cwd: BACKEND_DIR,
    env: {
      ...process.env,
      DATABASE_URL: dbUrl,
    },
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const lines = output.trim().split('\n');
  const jsonLine = lines.filter((l) => l.startsWith('{')).pop();
  if (!jsonLine) {
    throw new Error(`Failed to parse seed output:\n${output}`);
  }
  return JSON.parse(jsonLine) as SeedResult;
}

export function cleanupRepFlow(tenantId: string): void {
  const dbUrl = getTestDatabaseUrl();
  const scriptPath = path.join(BACKEND_DIR, 'src/__tests__/e2e/repCallFlowSeed.ts');
  const cmd = `npx ts-node --transpile-only "${scriptPath}" cleanup "${tenantId}"`;
  execSync(cmd, {
    cwd: BACKEND_DIR,
    env: {
      ...process.env,
      DATABASE_URL: dbUrl,
    },
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}
