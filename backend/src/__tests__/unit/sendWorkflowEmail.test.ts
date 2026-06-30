import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { prismaMock } from '../mocks/prisma.mock';
import { tenantStorage } from '../../utils/tenantContext';
import { MessageChannel, MessageStatus } from '@prisma/client';

// Mock Resend so the platform transactional sender doesn't hit the network.
const resendSend = jest.fn<(...args: any[]) => Promise<any>>().mockResolvedValue({});
jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({ emails: { send: resendSend } })),
}));

import { Resend } from 'resend';
import { sendWorkflowEmail, clearEmailConfigCache } from '../../services/emailService';

const ORDER = {
  id: 42,
  totalAmount: 240,
  customer: {
    id: 7,
    firstName: 'Ama',
    lastName: 'Boateng',
    email: 'ama@example.com',
    emailOptOut: false,
  },
};

/** Drive sendWorkflowEmail inside an active tenant context. */
const run = (config: any, context: any) =>
  tenantStorage.run({ tenantId: 'tenant-a' }, () => sendWorkflowEmail(config, context));

describe('sendWorkflowEmail (MAN-79)', () => {
  beforeEach(() => {
    // jest config resetMocks:true wipes implementations before each test.
    resendSend.mockReset().mockResolvedValue({});
    (Resend as unknown as jest.Mock).mockImplementation(() => ({ emails: { send: resendSend } }));
    clearEmailConfigCache();
    process.env.PLATFORM_EMAIL_PROVIDER = 'resend';
    process.env.PLATFORM_EMAIL_API_KEY = 'platform-key';
    process.env.PLATFORM_EMAIL_FROM = 'noreply@mail.codadminpro.com';

    // Defaults shared by the happy-path tests; individual tests override.
    (prismaMock.order.findUnique as any).mockResolvedValue(ORDER);
    (prismaMock.tenant.findUnique as any).mockResolvedValue({ name: 'Spur Shop' });
    (prismaMock.systemConfig.findFirst as any).mockResolvedValue({ currency: 'GHS' });
    (prismaMock.messageLog.findFirst as any).mockResolvedValue(null);
    (prismaMock.messageLog.create as any).mockResolvedValue({ id: 100 });
    (prismaMock.messageLog.update as any).mockResolvedValue({});
  });

  afterEach(() => {
    delete process.env.PLATFORM_EMAIL_API_KEY;
    delete process.env.PLATFORM_EMAIL_PROVIDER;
    delete process.env.PLATFORM_EMAIL_FROM;
  });

  it('renders a picked template, sends it, and logs MessageLog(email) sent', async () => {
    (prismaMock.emailTemplate.findUnique as any).mockResolvedValue({
      id: 3,
      name: 'Order Confirmation',
      subject: 'Order {{order_number}} — {{store_name}}',
      body: '<p>Hi {{customer_name}}, total {{order_total}}.</p>',
    });

    const result = await run({ templateId: 3 }, { orderId: 42 });

    expect(result).toEqual({ sent: true, messageLogId: 100 });

    // Merge tags rendered into the actual outgoing email.
    expect(resendSend).toHaveBeenCalledTimes(1);
    const sendArg = resendSend.mock.calls[0][0] as any;
    expect(sendArg.subject).toBe('Order 42 — Spur Shop');
    expect(sendArg.html).toContain('Hi Ama Boateng');
    expect(sendArg.html).toContain('GHS 240.00');
    expect(sendArg.to).toBe('ama@example.com');

    // MessageLog written for the email channel, pending → sent.
    const createData = (prismaMock.messageLog.create as any).mock.calls[0][0].data;
    expect(createData.channel).toBe(MessageChannel.email);
    expect(createData.templateName).toBe('Order Confirmation');
    expect(createData.status).toBe(MessageStatus.pending);
    const updateData = (prismaMock.messageLog.update as any).mock.calls[0][0].data;
    expect(updateData.status).toBe(MessageStatus.sent);
  });

  it('sends inline subject/body (config.body)', async () => {
    const result = await run(
      { subject: 'Hi {{customer_name}}', body: '<p>Order {{order_number}}</p>' },
      { orderId: 42 },
    );

    expect(result.sent).toBe(true);
    const sendArg = resendSend.mock.calls[0][0] as any;
    expect(sendArg.subject).toBe('Hi Ama Boateng');
    expect(sendArg.html).toContain('Order 42');
    // Inline send is logged as the 'inline' template.
    expect((prismaMock.messageLog.create as any).mock.calls[0][0].data.templateName).toBe('inline');
  });

  it('falls back to the legacy config.message field when body is absent', async () => {
    await run({ subject: 's', message: '<p>legacy {{order_number}}</p>' }, { orderId: 42 });
    expect((resendSend.mock.calls[0][0] as any).html).toContain('legacy 42');
  });

  it('skips an opted-out customer and logs MessageStatus.skipped (no send)', async () => {
    (prismaMock.order.findUnique as any).mockResolvedValue({
      ...ORDER,
      customer: { ...ORDER.customer, emailOptOut: true },
    });
    (prismaMock.messageLog.create as any).mockResolvedValue({ id: 101 });

    const result = await run({ subject: 's', body: 'b' }, { orderId: 42 });

    expect(result).toMatchObject({ sent: false, skipped: true, reason: 'opted_out' });
    expect(resendSend).not.toHaveBeenCalled();
    expect((prismaMock.messageLog.create as any).mock.calls[0][0].data.status).toBe(
      MessageStatus.skipped,
    );
  });

  it('is idempotent — a prior sent log short-circuits a retry (no re-send)', async () => {
    (prismaMock.emailTemplate.findUnique as any).mockResolvedValue({
      id: 3, name: 'Order Confirmation', subject: 's', body: 'b',
    });
    (prismaMock.messageLog.findFirst as any).mockResolvedValue({ id: 55 });

    const result = await run({ templateId: 3 }, { orderId: 42 });

    expect(result).toMatchObject({ sent: false, skipped: true, reason: 'already_sent' });
    expect(resendSend).not.toHaveBeenCalled();
    expect((prismaMock.messageLog.create as any)).not.toHaveBeenCalled();
  });

  it('skips cleanly when the recipient has no email (no log, no send)', async () => {
    (prismaMock.order.findUnique as any).mockResolvedValue({
      ...ORDER,
      customer: { ...ORDER.customer, email: null },
    });

    const result = await run({ subject: 's', body: 'b' }, { orderId: 42 });

    expect(result).toMatchObject({ sent: false, skipped: true, reason: 'no_recipient' });
    expect(resendSend).not.toHaveBeenCalled();
    expect((prismaMock.messageLog.create as any)).not.toHaveBeenCalled();
  });

  it('sets RFC 8058 List-Unsubscribe headers and appends a footer (MAN-81)', async () => {
    (prismaMock.customer.update as any).mockResolvedValue({});

    await run({ subject: 's', body: '<p>Hello {{customer_name}}</p>' }, { orderId: 42 });

    const sendArg = resendSend.mock.calls[0][0] as any;
    // One-click unsubscribe headers point at the public route.
    expect(sendArg.headers['List-Unsubscribe']).toMatch(/^<.*\/api\/public\/unsubscribe\/.+>$/);
    expect(sendArg.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    // Template didn't place the tag, so a visible footer link is appended.
    expect(sendArg.html).toContain('Hello Ama Boateng');
    expect(sendArg.html).toContain('Unsubscribe');
    // Token was minted + persisted for the customer.
    expect((prismaMock.customer.update as any).mock.calls[0][0]).toMatchObject({
      where: { id: 7 },
    });
  });

  it('records failed (and does not throw) when the provider send fails', async () => {
    resendSend.mockRejectedValue(new Error('provider boom'));

    const result = await run({ subject: 's', body: 'b' }, { orderId: 42 });

    expect(result).toMatchObject({ sent: false, messageLogId: 100, reason: 'send_failed' });
    const updateData = (prismaMock.messageLog.update as any).mock.calls[0][0].data;
    expect(updateData.status).toBe(MessageStatus.failed);
  });
});
