/**
 * Load Test: 100 Concurrent Agents + 500 Orders
 *
 * Sprint 3 requirement: verify the backend can handle simultaneous agent
 * sessions submitting orders without errors, connection pool exhaustion,
 * or unacceptable latency.
 *
 * Run against a live backend:
 *   BASE_URL=http://localhost:3000 npx ts-node src/__tests__/load/load-test.ts
 *
 * Or with environment defaults (localhost:3000):
 *   npx ts-node src/__tests__/load/load-test.ts
 */

import https from 'https';
import http from 'http';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const CONCURRENT_AGENTS = parseInt(process.env.CONCURRENT_AGENTS || '100', 10);
const TOTAL_ORDERS = parseInt(process.env.TOTAL_ORDERS || '500', 10);
const REQUEST_TIMEOUT_MS = parseInt(process.env.REQUEST_TIMEOUT_MS || '15000', 10);

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

interface HttpResponse {
  status: number;
  body: string;
  durationMs: number;
}

function request(
  method: string,
  path: string,
  body?: object,
  token?: string
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const payload = body ? JSON.stringify(body) : undefined;

    const options: http.RequestOptions = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload).toString() } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    };

    const transport = url.protocol === 'https:' ? https : http;

    const startMs = Date.now();
    const req = transport.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        resolve({
          status: res.statusCode ?? 0,
          body: data,
          durationMs: Date.now() - startMs,
        });
      });
    });

    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy();
      reject(new Error(`Request timeout after ${REQUEST_TIMEOUT_MS}ms: ${method} ${path}`));
    });

    req.on('error', reject);

    if (payload) req.write(payload);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Load test helpers
// ---------------------------------------------------------------------------

interface AgentSession {
  agentId: number;
  token: string;
}

interface OrderResult {
  agentId: number;
  success: boolean;
  status: number;
  durationMs: number;
  error?: string;
}

interface LoadTestReport {
  totalOrders: number;
  successCount: number;
  failureCount: number;
  avgLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  maxLatencyMs: number;
  minLatencyMs: number;
  durationSec: number;
  throughputOps: number;
  errorRatePct: number;
}

/** Percentile from sorted array */
function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}

// ---------------------------------------------------------------------------
// Phase 1: Authenticate agents
// ---------------------------------------------------------------------------

async function authenticateAgent(agentIndex: number): Promise<AgentSession | null> {
  // In a real load test environment, each agent would use their own credentials.
  // For the test harness, we accept a token override from environment, or use
  // the admin credentials to simulate multiple sessions (acceptable for load testing
  // since we are measuring server throughput, not auth isolation).
  const email = process.env.LOAD_TEST_EMAIL || 'admin@example.com';
  const password = process.env.LOAD_TEST_PASSWORD || 'admin123';

  try {
    const res = await request('POST', '/api/auth/login', { email, password });
    if (res.status === 200 || res.status === 201) {
      const data = JSON.parse(res.body);
      return { agentId: agentIndex + 1, token: data.accessToken };
    }
    console.error(`Agent ${agentIndex + 1} auth failed: HTTP ${res.status}`);
    return null;
  } catch (err: any) {
    console.error(`Agent ${agentIndex + 1} auth error: ${err.message}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Phase 2: Place an order
// ---------------------------------------------------------------------------

async function placeOrder(session: AgentSession, orderIndex: number): Promise<OrderResult> {
  const orderPayload = {
    // Minimal order payload — adjust field names to match your order schema
    customerId: 1,
    products: [{ productId: 1, quantity: 1 }],
    totalAmount: 150,
    notes: `Load test order ${orderIndex} by agent ${session.agentId}`,
    // COD-specific
    paymentMethod: 'COD',
  };

  const start = Date.now();
  try {
    const res = await request('POST', '/api/orders', orderPayload, session.token);
    const durationMs = Date.now() - start;

    const success = res.status === 200 || res.status === 201;
    return {
      agentId: session.agentId,
      success,
      status: res.status,
      durationMs,
      error: success ? undefined : `HTTP ${res.status}: ${res.body.slice(0, 120)}`,
    };
  } catch (err: any) {
    return {
      agentId: session.agentId,
      success: false,
      status: 0,
      durationMs: Date.now() - start,
      error: err.message,
    };
  }
}

// ---------------------------------------------------------------------------
// Main load test orchestrator
// ---------------------------------------------------------------------------

async function runLoadTest(): Promise<LoadTestReport> {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`CodAdmin Load Test`);
  console.log(`${'='.repeat(60)}`);
  console.log(`Target:          ${BASE_URL}`);
  console.log(`Concurrent agents: ${CONCURRENT_AGENTS}`);
  console.log(`Total orders:    ${TOTAL_ORDERS}`);
  console.log(`Request timeout: ${REQUEST_TIMEOUT_MS}ms`);
  console.log(`${'='.repeat(60)}\n`);

  // ── Phase 1: Authenticate all agents concurrently ──────────────────────
  console.log(`[Phase 1] Authenticating ${CONCURRENT_AGENTS} agent sessions...`);
  const authStart = Date.now();

  const authPromises = Array.from({ length: CONCURRENT_AGENTS }, (_, i) =>
    authenticateAgent(i)
  );
  const sessions = (await Promise.all(authPromises)).filter(
    (s): s is AgentSession => s !== null
  );

  const authDurationSec = (Date.now() - authStart) / 1000;
  console.log(
    `  Authenticated: ${sessions.length}/${CONCURRENT_AGENTS} sessions in ${authDurationSec.toFixed(2)}s`
  );

  if (sessions.length === 0) {
    throw new Error(
      'All authentication attempts failed. Ensure the backend is running and credentials are correct.\n' +
      'Set LOAD_TEST_EMAIL and LOAD_TEST_PASSWORD env vars if needed.'
    );
  }

  // ── Phase 2: Distribute TOTAL_ORDERS across available sessions ─────────
  console.log(`\n[Phase 2] Placing ${TOTAL_ORDERS} orders across ${sessions.length} sessions...`);
  const ordersStart = Date.now();

  // Create order tasks, round-robin assigned to sessions
  const orderTasks: Array<() => Promise<OrderResult>> = Array.from(
    { length: TOTAL_ORDERS },
    (_, i) => () => placeOrder(sessions[i % sessions.length], i + 1)
  );

  // Execute in batches equal to the number of active sessions for true concurrency
  const results: OrderResult[] = [];
  const batchSize = sessions.length;

  for (let i = 0; i < orderTasks.length; i += batchSize) {
    const batch = orderTasks.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map((fn) => fn()));
    results.push(...batchResults);

    const completed = Math.min(i + batchSize, TOTAL_ORDERS);
    process.stdout.write(`\r  Progress: ${completed}/${TOTAL_ORDERS} orders`);
  }
  console.log(); // newline after progress

  const totalDurationSec = (Date.now() - ordersStart) / 1000;

  // ── Phase 3: Compute statistics ────────────────────────────────────────
  const successCount = results.filter((r) => r.success).length;
  const failureCount = results.length - successCount;
  const latencies = results.map((r) => r.durationMs).sort((a, b) => a - b);

  const report: LoadTestReport = {
    totalOrders: results.length,
    successCount,
    failureCount,
    avgLatencyMs: latencies.reduce((s, v) => s + v, 0) / latencies.length,
    p50LatencyMs: percentile(latencies, 50),
    p95LatencyMs: percentile(latencies, 95),
    p99LatencyMs: percentile(latencies, 99),
    maxLatencyMs: latencies[latencies.length - 1],
    minLatencyMs: latencies[0],
    durationSec: totalDurationSec,
    throughputOps: results.length / totalDurationSec,
    errorRatePct: (failureCount / results.length) * 100,
  };

  return report;
}

// ---------------------------------------------------------------------------
// Report printer
// ---------------------------------------------------------------------------

function printReport(report: LoadTestReport): void {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Load Test Results`);
  console.log(`${'='.repeat(60)}`);
  console.log(`Total orders attempted:  ${report.totalOrders}`);
  console.log(`Successes:               ${report.successCount}`);
  console.log(`Failures:                ${report.failureCount}`);
  console.log(`Error rate:              ${report.errorRatePct.toFixed(2)}%`);
  console.log(`Total duration:          ${report.durationSec.toFixed(2)}s`);
  console.log(`Throughput:              ${report.throughputOps.toFixed(1)} orders/sec`);
  console.log(`\nLatency (order requests):`);
  console.log(`  Min:   ${report.minLatencyMs}ms`);
  console.log(`  Avg:   ${report.avgLatencyMs.toFixed(0)}ms`);
  console.log(`  p50:   ${report.p50LatencyMs}ms`);
  console.log(`  p95:   ${report.p95LatencyMs}ms`);
  console.log(`  p99:   ${report.p99LatencyMs}ms`);
  console.log(`  Max:   ${report.maxLatencyMs}ms`);

  // ── Pass/Fail thresholds (Sprint 3 acceptance criteria) ─────────────────
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Acceptance criteria:`);

  const checks: Array<{ label: string; pass: boolean }> = [
    { label: 'Error rate < 1%', pass: report.errorRatePct < 1 },
    { label: 'p95 latency < 2000ms', pass: report.p95LatencyMs < 2000 },
    { label: 'p99 latency < 5000ms', pass: report.p99LatencyMs < 5000 },
    { label: 'Throughput > 10 orders/sec', pass: report.throughputOps > 10 },
  ];

  let allPassed = true;
  for (const check of checks) {
    const icon = check.pass ? '✅' : '❌';
    console.log(`  ${icon}  ${check.label}`);
    if (!check.pass) allPassed = false;
  }

  console.log(`\n${'='.repeat(60)}`);
  if (allPassed) {
    console.log('RESULT: PASSED — all acceptance criteria met');
  } else {
    console.log('RESULT: FAILED — one or more criteria not met');
  }
  console.log(`${'='.repeat(60)}\n`);

  if (!allPassed) {
    process.exitCode = 1;
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

runLoadTest()
  .then(printReport)
  .catch((err) => {
    console.error(`\nLoad test aborted: ${err.message}`);
    process.exit(1);
  });
