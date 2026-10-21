/**
 * M2-T06: Redis rate limiter. Needs the local Redis (REDIS_HOST/PORT/PASSWORD from .env; CI has a service).
 * Counter names use random ids per run so a repeat run never meets old counts.
 */
import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import { randomBytes } from 'crypto';
import request from 'supertest';
import '../mocks/logger.mock';
import '../mocks/socketInstance.mock';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { clearAuthCache } from '../../mcp/auth';
import { RATE_LIMITS } from '../../config/rateLimits';
import { checkMcp, checkChat, closeRateLimiter } from '../../mcp/rateLimiter';
import { createTwoTenants, TwoTenants } from './helpers/twoTenants';

const rnd = () => randomBytes(8).toString('hex');

afterAll(async () => {
  await closeRateLimiter();
});

describe('limiter counts', () => {
  it('MCP: 30 calls pass, the 31st is limited with retryAfterSeconds; key B is not blocked', async () => {
    const a = rnd(), b = rnd();
    for (let i = 0; i < RATE_LIMITS.mcp.perKeyPerMinute; i++) {
      expect((await checkMcp({ keyId: a })).allowed).toBe(true);
    }
    const limited = await checkMcp({ keyId: a });
    expect(limited).toMatchObject({ allowed: false, scope: 'key', limit: 30, remaining: 0 });
    expect(limited.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(limited.retryAfterSeconds).toBeLessThanOrEqual(60);
    expect((await checkMcp({ keyId: b })).allowed).toBe(true);
  });

  it('MCP: the tenant limit (300 a minute) blocks across keys', async () => {
    const tenantId = rnd();
    let last = await checkMcp({ keyId: rnd(), tenantId });
    for (let i = 1; i < RATE_LIMITS.mcp.perTenantPerMinute; i++) last = await checkMcp({ keyId: rnd(), tenantId });
    expect(last.allowed).toBe(true);
    const over = await checkMcp({ keyId: rnd(), tenantId });
    expect(over).toMatchObject({ allowed: false, scope: 'tenant' });
    expect((await checkMcp({ keyId: rnd(), tenantId: rnd() })).allowed).toBe(true);
  }, 30000);

  it('a fresh limiter module instance keeps the count', async () => {
    const key = rnd();
    for (let i = 0; i < RATE_LIMITS.mcp.perKeyPerMinute - 1; i++) await checkMcp({ keyId: key });
    await closeRateLimiter();
    let fresh: typeof import('../../mcp/rateLimiter') | undefined;
    jest.isolateModules(() => { fresh = require('../../mcp/rateLimiter'); });
    try {
      expect((await fresh!.checkMcp({ keyId: key })).allowed).toBe(true); // call 30
      expect((await fresh!.checkMcp({ keyId: key })).allowed).toBe(false); // call 31
    } finally {
      await fresh!.closeRateLimiter();
    }
  });

  it('chat: 20 per user, then limited; another user is free', async () => {
    const tenantId = rnd();
    for (let i = 0; i < RATE_LIMITS.chat.perUserMessages; i++) {
      expect((await checkChat({ userId: 1, tenantId })).allowed).toBe(true);
    }
    const limited = await checkChat({ userId: 1, tenantId });
    expect(limited).toMatchObject({ allowed: false, scope: 'user' });
    expect(limited.retryAfterSeconds).toBeGreaterThan(60);
    expect((await checkChat({ userId: 2, tenantId })).allowed).toBe(true);
  });

  it('fails open when Redis is down: allowed, marked degraded', async () => {
    const saved = { host: process.env.REDIS_HOST, port: process.env.REDIS_PORT };
    process.env.REDIS_HOST = '127.0.0.1';
    process.env.REDIS_PORT = '1'; // nothing listens here
    let down: typeof import('../../mcp/rateLimiter') | undefined;
    jest.isolateModules(() => { down = require('../../mcp/rateLimiter'); });
    try {
      const res = await down!.checkMcp({ keyId: rnd() });
      expect(res).toMatchObject({ allowed: true, degraded: true });
    } finally {
      await down!.closeRateLimiter();
      process.env.REDIS_HOST = saved.host;
      process.env.REDIS_PORT = saved.port;
    }
  });
});

describe('POST /mcp', () => {
  let pair: TwoTenants;
  beforeAll(async () => {
    pair = await createTwoTenants('ratelimit');
    clearAuthCache();
  }, 30000);
  afterAll(async () => {
    await pair.cleanup();
    await prismaBase.$disconnect();
  });

  const call = (key: string) => request(app)
    .post('/mcp')
    .set('Authorization', `Bearer ${key}`)
    .set('Content-Type', 'application/json')
    .send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'products_inventory', arguments: {} } });

  // The MCP SDK turns an error inside a tool into a tool result, so the HTTP status stays 200 and the
  // limit shows as an MCP error with retryAfterSeconds (the plan allows either form).
  it('a limited tool call returns an MCP error with retryAfterSeconds, and another key still works', async () => {
    for (let i = 0; i < RATE_LIMITS.mcp.perKeyPerMinute; i++) {
      const ok = await call(pair.a.mcpKey);
      expect(ok.body.result?.isError).not.toBe(true);
    }
    const res = await call(pair.a.mcpKey);
    expect(res.body.result.isError).toBe(true);
    expect(res.body.result.structuredContent).toMatchObject({ code: 'RATE_LIMITED' });
    expect(res.body.result.structuredContent.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(res.body.result.content[0].text).toContain('Retry after');
    expect((await call(pair.b.mcpKey)).body.result?.isError).not.toBe(true);
  }, 60000);
});
