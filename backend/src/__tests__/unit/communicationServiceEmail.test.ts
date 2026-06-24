import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { prismaMock } from '../mocks/prisma.mock';
import { tenantStorage } from '../../utils/tenantContext';
import { MessageStatus } from '@prisma/client';

// Mock the queue so we assert enqueue calls without Redis; keep the real
// placeholder constant so the eligibility filter assertion is meaningful.
jest.mock('../../queues/emailCampaignQueue', () => ({
  __esModule: true,
  enqueueCampaignRecipient: jest.fn(),
  PLACEHOLDER_EMAIL_DOMAIN: '@codadminpro.com',
}));

import { enqueueCampaignRecipient } from '../../queues/emailCampaignQueue';
import { communicationService } from '../../services/communicationService';

const mockedEnqueue = enqueueCampaignRecipient as jest.MockedFunction<typeof enqueueCampaignRecipient>;

const withTenant = <T>(fn: () => Promise<T>) => tenantStorage.run({ tenantId: 'tenant-a' }, fn);

describe('communicationService — bulk email (MAN-83)', () => {
  beforeEach(() => {
    mockedEnqueue.mockResolvedValue(undefined);
    (prismaMock.tenant.findUnique as any).mockResolvedValue({ name: 'Spur Shop' });
  });

  describe('bulkSendEmail', () => {
    it('snapshots denominators, creates a campaign, and enqueues one job per eligible recipient', async () => {
      // audienceTotal=10, noEmail=3, optedOut/placeholder=2 → 5 eligible.
      (prismaMock.customer.count as any)
        .mockResolvedValueOnce(10)
        .mockResolvedValueOnce(3)
        .mockResolvedValueOnce(2);
      (prismaMock.emailCampaign.create as any).mockResolvedValue({ id: 9 });
      (prismaMock.customer.findMany as any).mockResolvedValueOnce([
        { id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 },
      ]);
      (prismaMock.emailCampaign.update as any).mockResolvedValue({
        id: 9, totalRecipients: 5, status: 'sending',
      });

      const result = await withTenant(() =>
        communicationService.bulkSendEmail({
          title: 'June Promo',
          filter: { hasOrdered: true },
          subject: 'Hi {{customer_name}}',
          htmlBody: '<p>Hello {{customer_name}}</p>',
        }),
      );

      // Denominators captured on the campaign at send time.
      expect((prismaMock.emailCampaign.create as any).mock.calls[0][0].data).toMatchObject({
        title: 'June Promo',
        status: 'queued',
        audienceTotal: 10,
        noEmailCount: 3,
        optedOutCount: 2,
        totalRecipients: 0,
      });

      // One job per eligible recipient, each carrying the tenant + campaign id +
      // the once-resolved store name (so the worker skips a per-recipient lookup).
      expect(mockedEnqueue).toHaveBeenCalledTimes(5);
      expect(mockedEnqueue).toHaveBeenCalledWith({
        campaignId: 9, customerId: 1, tenantId: 'tenant-a', storeName: 'Spur Shop',
      });

      // Campaign flips to sending with the real enqueued count.
      expect((prismaMock.emailCampaign.update as any).mock.calls[0][0].data).toMatchObject({
        totalRecipients: 5,
        status: 'sending',
      });
      expect(result).toMatchObject({ status: 'sending', totalRecipients: 5 });
    });

    it('completes immediately (no jobs) when the audience has zero emailable recipients', async () => {
      (prismaMock.customer.count as any)
        .mockResolvedValueOnce(4)
        .mockResolvedValueOnce(4)
        .mockResolvedValueOnce(0);
      (prismaMock.emailCampaign.create as any).mockResolvedValue({ id: 12 });
      (prismaMock.customer.findMany as any).mockResolvedValueOnce([]);
      (prismaMock.emailCampaign.update as any).mockResolvedValue({ id: 12, status: 'completed' });

      await withTenant(() =>
        communicationService.bulkSendEmail({
          title: 'Empty', filter: { state: 'Greater Accra' }, subject: 'Hi', htmlBody: '<p>Hi</p>',
        }),
      );

      expect(mockedEnqueue).not.toHaveBeenCalled();
      expect((prismaMock.emailCampaign.update as any).mock.calls[0][0].data).toMatchObject({
        totalRecipients: 0, status: 'completed',
      });
    });

    it('rejects an inline send with no subject/body', async () => {
      await expect(
        withTenant(() => communicationService.bulkSendEmail({ title: 'x', filter: {} } as any)),
      ).rejects.toThrow(/subject and htmlBody/i);
    });
  });

  describe('getRecipients (email channel)', () => {
    it('filters to real, non-opted-out, non-placeholder addresses', async () => {
      (prismaMock.customer.findMany as any).mockResolvedValue([]);

      await withTenant(() => communicationService.getRecipients({ channel: 'email' }));

      const where = (prismaMock.customer.findMany as any).mock.calls[0][0].where;
      expect(where.email).toEqual({ not: null });
      expect(where.emailOptOut).toBe(false);
      expect(where.NOT).toEqual({ email: { endsWith: '@codadminpro.com' } });
    });
  });

  describe('getEmailAudience', () => {
    it('returns the four eligibility denominators with emailable as the remainder', async () => {
      // audienceTotal=20, noEmail=12, optedOut/placeholder=3 → emailable=5.
      (prismaMock.customer.count as any)
        .mockResolvedValueOnce(20)
        .mockResolvedValueOnce(12)
        .mockResolvedValueOnce(3);

      const result = await withTenant(() =>
        communicationService.getEmailAudience({ hasOrdered: true }),
      );

      expect(result).toEqual({ audienceTotal: 20, noEmail: 12, optedOut: 3, emailable: 5 });
    });
  });

  describe('getCampaign', () => {
    it('returns the eligibility breakdown from denominators + live MessageLog aggregation', async () => {
      (prismaMock.emailCampaign.findUnique as any).mockResolvedValue({
        id: 9, title: 'June Promo', audienceTotal: 10, noEmailCount: 3, optedOutCount: 2, totalRecipients: 5,
      });
      (prismaMock.messageLog.groupBy as any).mockResolvedValue([
        { status: MessageStatus.sent, _count: { _all: 4 } },
        { status: MessageStatus.failed, _count: { _all: 1 } },
      ]);

      const result = await withTenant(() => communicationService.getCampaign(9));

      expect(result?.stats).toEqual({
        audienceTotal: 10,
        noEmail: 3,
        optedOut: 2,
        emailable: 5,
        waiting: 0,
        sent: 4,
        delivered: 0,
        failed: 1,
        skipped: 0,
      });
    });

    it('returns null for an unknown campaign', async () => {
      (prismaMock.emailCampaign.findUnique as any).mockResolvedValue(null);
      const result = await withTenant(() => communicationService.getCampaign(999));
      expect(result).toBeNull();
    });
  });
});
