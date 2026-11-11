import { spawn, type ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';

const ROOT = path.resolve(__dirname, '../..');
const BACKEND_DIR = path.join(ROOT, 'backend');
const FRONTEND_DIR = path.join(ROOT, 'frontend');
const ENV_TEST_PATH = path.join(BACKEND_DIR, '.env.test');

let backendProcess: ChildProcess | null = null;
let frontendProcess: ChildProcess | null = null;

function getTestDatabaseUrl(): string {
  if (process.env.DATABASE_URL && process.env.DATABASE_URL.includes('ecommerce_cod_test_')) {
    return process.env.DATABASE_URL;
  }
  if (!fs.existsSync(ENV_TEST_PATH)) {
    throw new Error(`Cannot find .env.test at ${ENV_TEST_PATH}`);
  }
  const content = fs.readFileSync(ENV_TEST_PATH, 'utf-8');
  const match = content.match(/^DATABASE_URL=(.+)$/m);
  if (!match) throw new Error('DATABASE_URL not found in backend/.env.test');
  return match[1].trim().replace(/^["']|["']$/g, '');
}

async function isUrlResponding(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(1000) });
    return res.status < 500;
  } catch {
    return false;
  }
}

export async function ensureServersRunning(): Promise<void> {
  const backendUp = await isUrlResponding('http://localhost:3102/health');
  if (!backendUp) {
    const dbUrl = getTestDatabaseUrl();
    backendProcess = spawn(
      path.join(BACKEND_DIR, 'node_modules/.bin/ts-node'),
      ['--transpile-only', 'src/server.ts'],
      {
        cwd: BACKEND_DIR,
        env: {
          ...process.env,
          PORT: '3102',
          DATABASE_URL: dbUrl,
          NODE_ENV: 'development',
          FRONTEND_URL: 'http://localhost:5182',
        },
        stdio: 'ignore',
        detached: true,
      }
    );
  }

  const frontendUp = await isUrlResponding('http://localhost:5182/');
  if (!frontendUp) {
    frontendProcess = spawn(
      path.join(FRONTEND_DIR, 'node_modules/.bin/vite'),
      ['--port', '5182', '--strictPort'],
      {
        cwd: FRONTEND_DIR,
        env: {
          ...process.env,
          VITE_API_URL: 'http://localhost:3102',
          VITE_WS_URL: 'http://localhost:3102',
          VITE_PROXY_TARGET: 'http://localhost:3102',
          VITE_FEATURE_REP_APP: 'true',
        },
        stdio: 'ignore',
        detached: true,
      }
    );
  }

  const start = Date.now();
  while (Date.now() - start < 30000) {
    const bOk = await isUrlResponding('http://localhost:3102/health');
    const fOk = await isUrlResponding('http://localhost:5182/');
    if (bOk && fOk) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('Servers failed to start within 30 seconds');
}

export async function stopServersIfStarted(): Promise<void> {
  if (frontendProcess && frontendProcess.pid) {
    try {
      process.kill(-frontendProcess.pid, 'SIGKILL');
    } catch {
      try {
        frontendProcess.kill('SIGKILL');
      } catch {}
    }
    frontendProcess = null;
  }
  if (backendProcess && backendProcess.pid) {
    try {
      process.kill(-backendProcess.pid, 'SIGKILL');
    } catch {
      try {
        backendProcess.kill('SIGKILL');
      } catch {}
    }
    backendProcess = null;
  }
}
