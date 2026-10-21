import Redis from 'ioredis';
import { RATE_LIMITS } from '../config/rateLimits';
import logger from '../utils/logger';

/**
 * M2-T06: Redis rate limiter (fixed window per counter). Counts live in Redis, so they survive
 * a restart of the process and are shared by every backend instance.
 *
 * Failure mode: FAIL OPEN. If Redis is down or slow, the call is allowed and an error is logged
 * (at most once a minute). The limiter guards against floods; auth, permissions and the audit row
 * are checked before and after it, so a Redis outage must not take the MCP server and chat down.
 */

export type LimitScope = 'key' | 'tenant' | 'user' | 'tenant-day';

export interface LimitResult {
  allowed: boolean;
  /** Which counter said no (only when allowed is false). */
  scope?: LimitScope;
  limit: number;
  remaining: number;
  /** Seconds until the counter that blocked the call resets. 0 when allowed. */
  retryAfterSeconds: number;
  /** True when Redis failed and the call was allowed without a count. */
  degraded?: boolean;
}

const COMMAND_TIMEOUT_MS = 750;
const LOG_THROTTLE_MS = 60_000;

// KEYS = counter names. ARGV = max, window in ms, for each counter in turn. INCRs in order and stops at
// the first counter over its max: returns { 1-based index of that counter, or 0; its count; ms left }.
const HIT_SCRIPT = `
local count, ttl = 0, 0
for i = 1, #KEYS do
  local max, window = tonumber(ARGV[2 * i - 1]), tonumber(ARGV[2 * i])
  count = redis.call('INCR', KEYS[i])
  if count == 1 then redis.call('PEXPIRE', KEYS[i], window) end
  ttl = redis.call('PTTL', KEYS[i])
  if ttl < 0 then redis.call('PEXPIRE', KEYS[i], window); ttl = window end
  if count > max then return { i, count, ttl } end
end
return { 0, count, ttl }
`;

type HitCommand = (numberOfKeys: number, ...keysAndArgs: (string | number)[]) => Promise<[number, number, number]>;
type RateClient = Redis & { rateHit: HitCommand };

let client: RateClient | null = null;
let lastLoggedAt = 0;

function getClient(): RateClient {
  if (!client) {
    // Own fail-fast client (not the shared cache client, whose retries would make fail-open slow).
    const redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      password: process.env.REDIS_PASSWORD,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      commandTimeout: COMMAND_TIMEOUT_MS,
      enableReadyCheck: false,
      retryStrategy: (times) => Math.min(times * 50, 1000),
    });
    // Without a listener ioredis prints every connection error; failures are reported by check().
    redis.on('error', () => {});
    redis.defineCommand('rateHit', { lua: HIT_SCRIPT });
    client = redis as RateClient;
  }
  return client;
}

/** Close the Redis connection (tests, graceful shutdown). The next call opens a new one. */
export async function closeRateLimiter(): Promise<void> {
  const c = client;
  client = null;
  if (c) await c.quit().catch(() => c.disconnect());
}

function logDown(error: unknown): void {
  const now = Date.now();
  if (now - lastLoggedAt < LOG_THROTTLE_MS) return;
  lastLoggedAt = now;
  logger.error('[rateLimiter] Redis unavailable, failing open (calls are allowed, not counted):', (error as Error)?.message ?? error);
}

interface Counter { name: string; scope: LimitScope; max: number; windowSeconds: number }

/** Count all counters in one Redis round trip; the first one over its limit blocks the call. */
async function check(counters: Counter[]): Promise<LimitResult> {
  try {
    const args = counters.flatMap((c) => [c.max, c.windowSeconds * 1000]);
    const [blocked, count, ttlMs] = await getClient().rateHit(counters.length, ...counters.map((c) => c.name), ...args);
    if (blocked > 0) {
      const c = counters[blocked - 1];
      return { allowed: false, scope: c.scope, limit: c.max, remaining: 0, retryAfterSeconds: Math.max(1, Math.ceil(ttlMs / 1000)) };
    }
    const last = counters[counters.length - 1];
    return { allowed: true, limit: last.max, remaining: last.max - count, retryAfterSeconds: 0 };
  } catch (error) {
    logDown(error);
    return { allowed: true, limit: 0, remaining: 0, retryAfterSeconds: 0, degraded: true };
  }
}

const { mcp, chat } = RATE_LIMITS;

/** One MCP tool call: 30 a minute per key, then 300 a minute per tenant (tenant optional until the key is validated). */
export function checkMcp(args: { keyId: string; tenantId?: string | null }): Promise<LimitResult> {
  const counters: Counter[] = [
    { name: `rl:mcp:key:${args.keyId}`, scope: 'key', max: mcp.perKeyPerMinute, windowSeconds: mcp.windowSeconds },
  ];
  if (args.tenantId) {
    counters.push({ name: `rl:mcp:tenant:${args.tenantId}`, scope: 'tenant', max: mcp.perTenantPerMinute, windowSeconds: mcp.windowSeconds });
  }
  return check(counters);
}

/** One chat message: 20 per 15 minutes per user, then the tenant's daily cap. */
export function checkChat(args: { userId: number; tenantId: string }): Promise<LimitResult> {
  return check([
    { name: `rl:chat:user:${args.tenantId}:${args.userId}`, scope: 'user', max: chat.perUserMessages, windowSeconds: chat.perUserWindowSeconds },
    { name: `rl:chat:tenant-day:${args.tenantId}`, scope: 'tenant-day', max: chat.perTenantPerDay, windowSeconds: chat.dayWindowSeconds },
  ]);
}
