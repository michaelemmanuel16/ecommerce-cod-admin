/** M2-T05: redaction rules of the audit service (pure function, no database). */
import { describe, it, expect } from '@jest/globals';
import '../mocks/logger.mock';
import { redactSecrets, REDACTED } from '../../services/auditService';

describe('redactSecrets', () => {
  it('replaces values of secret-looking keys at any depth', () => {
    const out = redactSecrets({
      password: 'hunter2', apiKey: 'abc', api_key: 'abc', Authorization: 'x', clientSecret: 'x', access_token: 'x',
      nested: { refreshToken: 'x', list: [{ pwd: 'x' }] },
      orderId: 12, note: 'call back at 5pm', shipping: 'Accra',
    }) as any;
    expect(out.password).toBe(REDACTED);
    expect(out.apiKey).toBe(REDACTED);
    expect(out.api_key).toBe(REDACTED);
    expect(out.Authorization).toBe(REDACTED);
    expect(out.clientSecret).toBe(REDACTED);
    expect(out.access_token).toBe(REDACTED);
    expect(out.nested.refreshToken).toBe(REDACTED);
    expect(out.nested.list[0].pwd).toBe(REDACTED);
    // normal fields stay (a short key like "pin" must not match "shipping")
    expect(out.orderId).toBe(12);
    expect(out.note).toBe('call back at 5pm');
    expect(out.shipping).toBe('Accra');
  });

  it('replaces token-looking values under harmless keys', () => {
    const mcp = 'mcp_' + 'a1b2c3d4'.repeat(8);
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.abc123def456';
    const out = JSON.stringify(redactSecrets({
      a: mcp, b: `Authorization: Bearer ${jwt}`, c: 'sk-live_abcdefghijklmnop1234', d: 'AKIAABCDEFGHIJKLMNOP',
      e: 'https://user:s3cretpass@example.com/x', f: 'deadbeef'.repeat(8), g: 'sk_live_abcdefgh12345678',
    }));
    for (const secret of [mcp, jwt, 'abcdefghijklmnop1234', 'AKIAABCDEFGHIJKLMNOP', 's3cretpass', 'deadbeef'.repeat(8), 'abcdefgh12345678']) {
      expect(out).not.toContain(secret);
    }
  });

  it('keeps UUIDs, dates, numbers, and null', () => {
    const uuid = '3f2b8c1e-9d4a-4e6b-8a7c-1d2e3f4a5b6c';
    const out = redactSecrets({ tenant: uuid, at: new Date('2026-10-01T00:00:00Z'), n: 1.5, z: null, u: undefined }) as any;
    expect(out).toEqual({ tenant: uuid, at: '2026-10-01T00:00:00.000Z', n: 1.5, z: null });
  });

  it('redacts secrets inside an Error message', () => {
    expect(redactSecrets(new Error('failed with Bearer abcdefghijklmnop'))).toBe(`failed with ${REDACTED}`);
  });

  it('stops at a depth limit instead of looping on a cycle', () => {
    const a: any = { name: 'a' };
    a.self = a;
    expect(() => redactSecrets(a)).not.toThrow();
  });
});
