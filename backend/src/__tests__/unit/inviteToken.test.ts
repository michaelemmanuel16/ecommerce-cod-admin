import { describe, it, expect } from '@jest/globals';
import { INVITE_TTL_DAYS, hashInviteToken, isInviteExpired, newInviteToken } from '../../utils/inviteToken';

describe('invite token (M6-T06)', () => {
  it('is 32 random bytes; only the SHA-256 hash is derived from it; no two tokens match', () => {
    const a = newInviteToken();
    const b = newInviteToken();
    expect(a.raw).toMatch(/^[0-9a-f]{64}$/);
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.hash).not.toBe(a.raw);
    expect(a.hash).toBe(hashInviteToken(a.raw));
    expect(a.raw).not.toBe(b.raw);
  });

  it('expires 7 days after it is made', () => {
    const now = new Date('2026-11-01T10:00:00Z');
    expect(INVITE_TTL_DAYS).toBe(7);
    expect(newInviteToken(now).expiresAt.toISOString()).toBe('2026-11-08T10:00:00.000Z');
  });

  it('is valid until the expiry moment, expired from it on; a missing date is expired', () => {
    const expiresAt = new Date('2026-11-08T10:00:00Z');
    expect(isInviteExpired(expiresAt, new Date('2026-11-08T09:59:59Z'))).toBe(false);
    expect(isInviteExpired(expiresAt, new Date('2026-11-08T10:00:00Z'))).toBe(true);
    expect(isInviteExpired(expiresAt, new Date('2026-11-09T00:00:00Z'))).toBe(true);
    expect(isInviteExpired(null)).toBe(true);
  });
});
