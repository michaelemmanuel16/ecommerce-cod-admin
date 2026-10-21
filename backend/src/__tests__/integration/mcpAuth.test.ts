/**
 * MCP key auth. The key resolves to the key's user and role; the result is cached per key for 60 seconds, so a
 * revoked key, or a deactivated user, stops working within 60 seconds. Fake clock: only Date is faked.
 */
import { jest, describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
import '../mocks/logger.mock';
import { prismaBase } from '../../utils/prisma';
import { validateKey, clearAuthCache, disconnectPrisma } from '../../mcp/auth';
import { createTwoTenants, TwoTenants } from './helpers/twoTenants';
import { makeMcpKey } from './helpers/mcpKey';

jest.setTimeout(30_000);

let pair: TwoTenants;
const T0 = new Date('2026-10-21T10:00:00Z').getTime();
const FAKE_ONLY_DATE = ['hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame',
  'requestIdleCallback', 'cancelIdleCallback', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] as const;

/** A key for tenant A (or `tenantId`) with the given user: null for no user. */
async function newKey(userId: number | null, tenantId = pair.a.id) {
  const { key, keyId } = await makeMcpKey(tenantId, { slug: 'authtest', userId });
  return { key, id: keyId };
}

beforeAll(async () => {
  pair = await createTwoTenants('mcpauth');
}, 30_000);

afterAll(async () => {
  clearAuthCache();
  await pair.cleanup();
  await disconnectPrisma();
  await prismaBase.$disconnect();
});

beforeEach(() => {
  clearAuthCache();
  jest.useFakeTimers({ now: T0, doNotFake: [...FAKE_ONLY_DATE] });
});
afterEach(() => jest.useRealTimers());

describe('validateKey', () => {
  it('resolves tenant, key, user, user kind and role', async () => {
    const principal = await validateKey(pair.a.mcpKey);
    expect(principal).toMatchObject({
      tenantId: pair.a.id, userId: pair.a.ids.mcpUser, actorKind: 'ai_agent', roleId: pair.a.ids.legacyRole,
    });
  });

  it('refuses an unknown key and a key with no user', async () => {
    await expect(validateKey('mcp_unknown')).rejects.toThrow(/Invalid API key/);
    const { key } = await newKey(null);
    await expect(validateKey(key)).rejects.toThrow(/not linked to a user/);
  });

  it('refuses a key whose user belongs to another tenant', async () => {
    const { key } = await newKey(pair.b.ids.mcpUser, pair.a.id);
    await expect(validateKey(key)).rejects.toThrow(/not linked to a user/);
  });

  it('a revoked key fails within 60 seconds (fake clock)', async () => {
    const { key, id } = await newKey(pair.a.ids.mcpUser);
    await validateKey(key); // cached at T0
    await prismaBase.mcpApiKey.update({ where: { id }, data: { revokedAt: new Date() } });

    jest.setSystemTime(T0 + 59_000);
    await expect(validateKey(key)).resolves.toMatchObject({ tenantId: pair.a.id }); // still inside the cache window
    jest.setSystemTime(T0 + 60_001);
    await expect(validateKey(key)).rejects.toThrow(/revoked/);
  });

  it('keeps one cache entry per key: validating key B does not evict key A', async () => {
    const a = await newKey(pair.a.ids.mcpUser);
    const b = await newKey(pair.a.ids.mcpUser);
    await validateKey(a.key);
    await validateKey(b.key);
    // revoke both in the database: only a cached entry can still answer
    await prismaBase.mcpApiKey.updateMany({ where: { id: { in: [a.id, b.id] } }, data: { revokedAt: new Date() } });
    jest.setSystemTime(T0 + 30_000);
    await expect(validateKey(a.key)).resolves.toBeDefined();
    await expect(validateKey(b.key)).resolves.toBeDefined();
    jest.setSystemTime(T0 + 61_000);
    await expect(validateKey(a.key)).rejects.toThrow(/revoked/);
    await expect(validateKey(b.key)).rejects.toThrow(/revoked/);
  });

  it('a deactivated user stops the key after the cache window', async () => {
    const user = await prismaBase.user.create({
      data: { email: `deact-${pair.a.slug}@codadmin.test`, password: 'x', firstName: 'D', lastName: 'A', role: 'admin', kind: 'ai_agent', tenantId: pair.a.id },
    });
    const { key } = await newKey(user.id);
    await validateKey(key);
    await prismaBase.user.update({ where: { id: user.id }, data: { isActive: false } });
    jest.setSystemTime(T0 + 61_000);
    await expect(validateKey(key)).rejects.toThrow(/deactivated/);
  });
});
