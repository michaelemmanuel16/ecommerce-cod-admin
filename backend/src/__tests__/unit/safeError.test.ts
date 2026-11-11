import { safeErrorMessage } from '../../utils/safeError';

describe('safeErrorMessage', () => {
  it('removes token query values and Meta tokens', () => {
    const err = new Error('fetch failed: https://graph.facebook.com/v25.0/me?fields=id&access_token=EAAtestSECRET123&x=1 (token EAAotherSECRET456)');
    const out = safeErrorMessage(err)!;
    expect(out).not.toContain('EAAtestSECRET123');
    expect(out).not.toContain('EAAotherSECRET456');
    expect(out).not.toContain('access_token');
    expect(out).toContain('&[redacted]');
    expect(out).toContain('fields=id');
  });
  it('keeps plain messages and handles non-errors', () => {
    expect(safeErrorMessage(new Error('Meta is down'))).toBe('Meta is down');
    expect(safeErrorMessage(undefined)).toBeUndefined();
  });
});
