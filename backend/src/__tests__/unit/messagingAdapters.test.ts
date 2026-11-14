import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { prismaMock } from '../mocks/prisma.mock';
import '../mocks/logger.mock';

const resendSend = jest.fn<(...args: any[]) => Promise<any>>();
jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({ emails: { send: resendSend } })),
}));
const sendMail = jest.fn<(...args: any[]) => Promise<any>>();
jest.mock('nodemailer', () => ({
  __esModule: true,
  default: { createTransport: jest.fn(() => ({ sendMail })) },
}));

import { Resend } from 'resend';
import { emailProvider, clearEmailConfigCache, resolveSenderIdentity, platformFromAddress, safeDisplayName } from '../../services/messaging/providers/emailProvider';
import { whatsappCloudProvider, whatsappFailureReason } from '../../services/messaging/providers/whatsappCloudProvider';
import { arkeselSmsProvider } from '../../services/messaging/providers/arkeselSmsProvider';

describe('email adapter: sender identity', () => {
  const saved = { ...process.env };
  beforeEach(() => {
    resendSend.mockReset().mockResolvedValue({ data: { id: 're_1' } });
    (Resend as unknown as jest.Mock).mockImplementation(() => ({ emails: { send: resendSend } }));
    clearEmailConfigCache();
    process.env.PLATFORM_EMAIL_PROVIDER = 'resend';
    process.env.PLATFORM_EMAIL_API_KEY = 'k';
    delete process.env.PLATFORM_EMAIL_FROM;
    process.env.RESEND_FROM_EMAIL = 'no-reply@codadminpro.com';
    (prismaMock.tenant.findUnique as any).mockResolvedValue({ name: 'Spur Shop' });
    (prismaMock.user.findFirst as any).mockResolvedValue({ email: 'owner@spur.com' });
  });
  afterEach(() => { process.env = { ...saved }; });

  it('sends from RESEND_FROM_EMAIL with the store name as display name and reply_to the owner', async () => {
    const r = await emailProvider.send({ tenantId: 't1', to: 'a@b.com', subject: 's', body: '<p>x</p>', sendAs: 'platform' });
    expect(r).toMatchObject({ accepted: true, providerMessageId: 're_1', provider: 'resend' });
    const arg = resendSend.mock.calls[0][0] as any;
    expect(arg.from).toBe('"Spur Shop" <no-reply@codadminpro.com>');
    expect(arg.replyTo).toBe('owner@spur.com');
  });

  it('falls back to no-reply@codadminpro.com when no env address is set', () => {
    delete process.env.RESEND_FROM_EMAIL;
    delete process.env.PLATFORM_EMAIL_FROM;
    expect(platformFromAddress()).toBe('no-reply@codadminpro.com');
  });

  it('reads the address out of a RESEND_FROM_EMAIL written as Name <address>, and prefers PLATFORM_EMAIL_FROM', () => {
    process.env.RESEND_FROM_EMAIL = 'COD Admin <no-reply@codadminpro.com>';
    delete process.env.PLATFORM_EMAIL_FROM;
    expect(platformFromAddress()).toBe('no-reply@codadminpro.com');
    process.env.PLATFORM_EMAIL_FROM = 'noreply@mail.codadminpro.com';
    expect(platformFromAddress()).toBe('noreply@mail.codadminpro.com');
  });

  it('keeps the tenant own from address on tenant SMTP and sets no reply_to', async () => {
    const id = await resolveSenderIdentity(
      { provider: 'smtp', apiKey: 'pw', fromEmail: 'orders@spur.com', fromName: 'Spur' }, 't1',
    );
    expect(id).toEqual({ from: '"Spur Shop" <orders@spur.com>' });
  });

  it('cleans a store name before it goes into the From header', async () => {
    (prismaMock.tenant.findUnique as any).mockResolvedValue({ name: 'Evil\r\nBcc: x@y.com" <boss@evil.com>, Shop;' });
    const id = await resolveSenderIdentity({ provider: 'resend', apiKey: 'k', fromEmail: 'no-reply@codadminpro.com', fromName: 'COD Admin' }, 't1');
    expect(id.from).not.toMatch(/[\r\n]/);
    expect(id.from).toBe('"Evil Bcc: x@y.com boss@evil.com Shop" <no-reply@codadminpro.com>');
    expect(safeDisplayName('a'.repeat(100))).toHaveLength(64);
  });

  it('falls back to the configured name when the store name is only unsafe characters', async () => {
    (prismaMock.tenant.findUnique as any).mockResolvedValue({ name: '<>"\r\n' });
    const id = await resolveSenderIdentity({ provider: 'resend', apiKey: 'k', fromEmail: 'no-reply@codadminpro.com', fromName: 'COD Admin' }, 't1');
    expect(id.from).toBe('"COD Admin" <no-reply@codadminpro.com>');
  });

  it('reports a Resend refusal as accepted: false', async () => {
    resendSend.mockResolvedValue({ error: { message: 'domain not verified' } });
    const r = await emailProvider.send({ tenantId: 't1', to: 'a@b.com', subject: 's', body: 'b', sendAs: 'platform' });
    expect(r.accepted).toBe(false);
    expect(r.error).toContain('domain not verified');
  });

  it('is not enabled as platform sender without a key', async () => {
    delete process.env.PLATFORM_EMAIL_API_KEY;
    expect(await emailProvider.isEnabled('t1', { sendAs: 'platform' })).toBe(false);
  });
});

describe('WhatsApp adapter', () => {
  it('parses statuses and maps a failure code to readable text', () => {
    const body = { entry: [{ changes: [{ field: 'messages', value: { statuses: [
      { id: 'w1', status: 'delivered', timestamp: '1700000000' },
      { id: 'w2', status: 'failed', timestamp: '1700000001', errors: [{ code: 131047, title: 'Re-engagement' }] },
    ] } }] }] };
    const out = whatsappCloudProvider.parseStatusCallback({ body });
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ providerMessageId: 'w1', status: 'delivered' });
    expect(out[0].occurredAt.getTime()).toBe(1700000000 * 1000);
    expect(out[1].failureReason).toMatch(/24 hours/);
  });

  it('falls back to the provider title for an unknown code', () => {
    expect(whatsappFailureReason([{ code: 999999, title: 'Odd thing' }])).toBe('Odd thing');
    expect(whatsappFailureReason(undefined)).toMatch(/could not deliver/);
  });

  it('parses inbound text and button messages', () => {
    const body = { entry: [{ changes: [{ field: 'messages', value: { messages: [
      { id: 'm1', from: '233241234567', type: 'text', text: { body: 'YES' }, context: { id: 'w9' }, timestamp: '1700000000' },
      { id: 'm2', from: '233241234567', type: 'button', button: { text: 'Confirm', payload: 'yes' } },
    ] } }] }] };
    const out = whatsappCloudProvider.parseInbound!({ body });
    expect(out[0]).toMatchObject({ providerMessageId: 'm1', text: 'YES', contextMessageId: 'w9' });
    expect(out[1]).toMatchObject({ buttonPayload: 'yes', text: 'Confirm' });
  });
});

describe('Arkesel adapter', () => {
  it('maps delivered and rejected, ignores unknown words', () => {
    expect(arkeselSmsProvider.parseStatusCallback({ body: { messageId: 'a1', status: 'DELIVERED' } })[0])
      .toMatchObject({ providerMessageId: 'a1', status: 'delivered' });
    const failed = arkeselSmsProvider.parseStatusCallback({ body: { messageId: 'a2', status: 'rejected' } })[0];
    expect(failed.status).toBe('failed');
    expect(failed.failureReason).toMatch(/rejected/i);
    expect(arkeselSmsProvider.parseStatusCallback({ body: { messageId: 'a3', status: 'weird' } })).toEqual([]);
    expect(arkeselSmsProvider.parseStatusCallback({ body: {} })).toEqual([]);
  });
});
