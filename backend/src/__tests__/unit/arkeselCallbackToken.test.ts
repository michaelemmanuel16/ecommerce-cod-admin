/** M9-T05 follow-up (COD-77): per-message callback_url and fail-closed webhook rules. */
import { jest, describe, it, expect, afterEach } from '@jest/globals';

jest.mock('../../utils/logger', () => ({ __esModule: true, default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

import { arkeselCallbackUrl, arkeselSmsProvider } from '../../services/messaging/providers/arkeselSmsProvider';
import { handleArkeselWebhook } from '../../controllers/smsController';

const res = () => {
  const r: any = { statusCode: 0 };
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.json = () => r;
  return r;
};
const env = { ...process.env };
afterEach(() => { process.env = { ...env }; });

describe('arkeselCallbackUrl', () => {
  it('is null without a token, and carries the token when set', () => {
    delete process.env.ARKESEL_CALLBACK_TOKEN;
    expect(arkeselCallbackUrl()).toBeNull();
    process.env.ARKESEL_CALLBACK_TOKEN = 'a b';
    process.env.BACKEND_URL = 'https://api.example.com/';
    expect(arkeselCallbackUrl()).toBe('https://api.example.com/api/sms/webhook?token=a%20b');
  });
});

describe('Arkesel webhook auth', () => {
  it('production without the token env: 401', async () => {
    delete process.env.ARKESEL_CALLBACK_TOKEN;
    process.env.NODE_ENV = 'production';
    const r = res();
    await handleArkeselWebhook({ query: {}, body: {} } as any, r);
    expect(r.statusCode).toBe(401);
  });
  it('test env without the token env: accepted', async () => {
    delete process.env.ARKESEL_CALLBACK_TOKEN;
    const r = res();
    await handleArkeselWebhook({ query: {}, body: {} } as any, r);
    expect(r.statusCode).toBe(200);
  });
  it('with the token set: wrong token 401, right token 200', async () => {
    process.env.ARKESEL_CALLBACK_TOKEN = 'secret1';
    const bad = res();
    await handleArkeselWebhook({ query: { token: 'nope' }, body: {} } as any, bad);
    expect(bad.statusCode).toBe(401);
    const ok = res();
    await handleArkeselWebhook({ query: { token: 'secret1' }, body: {} } as any, ok);
    expect(ok.statusCode).toBe(200);
  });
});

describe('Arkesel report parsing', () => {
  it('reads the documented query form (sms_id, status=DELIVERED)', () => {
    const [e] = arkeselSmsProvider.parseStatusCallback({ query: { sms_id: 'abc', status: 'DELIVERED' } });
    expect(e).toMatchObject({ providerMessageId: 'abc', status: 'delivered' });
  });
  it('the stored payload never carries the callback token', () => {
    const [e] = arkeselSmsProvider.parseStatusCallback({ query: { sms_id: 'abc', status: 'DELIVERED', token: 'secret1' }, body: { token: 'secret1' } });
    expect(JSON.stringify(e.payload)).not.toContain('secret1');
    expect(e.payload).toMatchObject({ sms_id: 'abc' });
  });
});
