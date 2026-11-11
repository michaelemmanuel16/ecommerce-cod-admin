import { redactFormat } from '../../utils/logger';

describe('logger redaction format', () => {
  it('removes tokens from the message, the stack and string meta values', () => {
    const token = 'EAAtestSECRET123456';
    const out: any = redactFormat().transform({
      level: 'error',
      message: `fetch failed: https://graph.facebook.com/me?access_token=${token}&x=1`,
      stack: `Error: boom ${token}\n    at x`,
      error: `bad token ${token}`,
      count: 3,
    } as any);
    const text = JSON.stringify(out);
    expect(text).not.toContain(token);
    expect(out.message).toContain('&x=1');
    expect(out.error).toBe('bad token [redacted]');
    expect(out.count).toBe(3);
  });
});
