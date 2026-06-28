import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { prismaMock } from '../mocks/prisma.mock';
import { tenantStorage } from '../../utils/tenantContext';
import { MessageChannel, MessageStatus } from '@prisma/client';

// Isolate the worker from the network + token plumbing.
jest.mock('../../services/emailService', () => ({
  __esModule: true,
  sendEmail: jest.fn(),
}));
jest.mock('../../services/unsubscribeService', () => ({
  __esModule: true,
  ensureUnsubscribeToken: jest.fn(),
  buildUnsubscribeUrl: jest.fn(),
  applyUnsubscribe: jest.fn(),
}));

import { sendEmail } from '../../services/emailService';
import {
  ensureUnsubscribeToken,
  buildUnsubscribeUrl,
  applyUnsubscribe,
} from '../../services/unsubscribeService';
import { processCampaignRecipient } from '../../queues/emailCampaignQueue';

const mockedSend = sendEmail as jest.MockedFunction<typeof sendEmail>;

const CAMPAIGN = {
  id: 1,
  title: 'June Promo',
  subject: 'Hi {{customer_name}} from {{store_name}}',
  body: '<p>Hello {{customer_name}}</p>',
};

const ELIGIBLE_CUSTOMER = {
  id: 7,
  firstName: 'Ama',
  lastName: 'Boateng',
  email: 'ama@example.com',
  emailOptOut: false,
};

const run = (data: any) =>
  tenantStorage.run({ tenantId: 'tenant-a' }, () => processCampaignRecipient(data));

const JOB = { campaignId: 1, customerId: 7, tenantId: 'tenant-a' };

describe('processCampaignRecipient (MAN-83)', () => {
  beforeEach(() => {
    (ensureUnsubscribeToken as any).mockResolvedValue('tok');
    (buildUnsubscribeUrl as any).mockReturnValue('http://localhost:3000/api/public/unsubscribe/tok');
    (applyUnsubscribe as any).mockImplementation((html: string) => ({
      html,
      headers: { 'List-Unsubscribe': '<http://localhost:3000/api/public/unsubscribe/tok>' },
    }));
    mockedSend.mockResolvedValue(undefined);

    (prismaMock.emailCampaign.findUnique as any).mockResolvedValue(CAMPAIGN);
    (prismaMock.customer.findUnique as any).mockResolvedValue(ELIGIBLE_CUSTOMER);
    (prismaMock.tenant.findUnique as any).mockResolvedValue({ name: 'Spur Shop' });
    (prismaMock.messageLog.findFirst as any).mockResolvedValue(null);
    (prismaMock.messageLog.create as any).mockResolvedValue({ id: 100 });
    (prismaMock.messageLog.update as any).mockResolvedValue({});
    (prismaMock.messageLog.count as any).mockResolvedValue(0);
    (prismaMock.emailCampaign.update as any).mockResolvedValue({});
  });

  it('sends an eligible recipient via the tenant provider and logs MessageLog(email) sent', async () => {
    const result = await run(JOB);

    expect(result).toEqual({ sent: true, messageLogId: 100 });

    // Marketing-class bulk send uses the tenant BYO provider, not the platform one.
    expect(mockedSend).toHaveBeenCalledTimes(1);
    const [opts, meta] = mockedSend.mock.calls[0] as any[];
    expect(meta).toEqual({ as: 'tenant' });
    expect(opts.to).toBe('ama@example.com');
    // Merge tags rendered; unsubscribe header attached.
    expect(opts.subject).toBe('Hi Ama Boateng from Spur Shop');
    expect(opts.html).toContain('Hello Ama Boateng');
    expect(opts.headers['List-Unsubscribe']).toBeTruthy();

    // A pending row keyed to the campaign was created, then marked sent.
    const createArg = (prismaMock.messageLog.create as any).mock.calls[0][0];
    expect(createArg.data).toMatchObject({
      campaignId: 1,
      customerId: 7,
      channel: MessageChannel.email,
      status: MessageStatus.pending,
    });
    expect((prismaMock.messageLog.update as any).mock.calls[0][0].data).toMatchObject({
      status: MessageStatus.sent,
    });
  });

  it('skips an opted-out customer with a skipped log and never sends', async () => {
    (prismaMock.customer.findUnique as any).mockResolvedValue({ ...ELIGIBLE_CUSTOMER, emailOptOut: true });

    const result = await run(JOB);

    expect(result).toMatchObject({ sent: false, skipped: true, reason: 'opted_out' });
    expect(mockedSend).not.toHaveBeenCalled();
    expect((prismaMock.messageLog.create as any).mock.calls[0][0].data).toMatchObject({
      status: MessageStatus.skipped,
      campaignId: 1,
    });
  });

  it('skips a synthesized @codadminpro.com placeholder address (never a marketing recipient)', async () => {
    (prismaMock.customer.findUnique as any).mockResolvedValue({
      ...ELIGIBLE_CUSTOMER,
      email: '0241234567@codadminpro.com',
    });

    const result = await run(JOB);

    expect(result).toMatchObject({ sent: false, skipped: true, reason: 'placeholder_email' });
    expect(mockedSend).not.toHaveBeenCalled();
  });

  it('is idempotent — a prior sent log short-circuits so a retry cannot double-send', async () => {
    (prismaMock.messageLog.findFirst as any).mockResolvedValue({ id: 55, status: MessageStatus.sent });

    const result = await run(JOB);

    expect(result).toMatchObject({ sent: false, skipped: true, reason: 'already_sent', messageLogId: 55 });
    expect(mockedSend).not.toHaveBeenCalled();
    expect(prismaMock.messageLog.create).not.toHaveBeenCalled();
  });
});
