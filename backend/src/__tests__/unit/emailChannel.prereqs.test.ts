import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { prismaMock } from '../mocks/prisma.mock';
import { tenantStorage } from '../../utils/tenantContext';

// Mock the workflow queue so we can assert what gets enqueued (C1).
const queueAdd = jest.fn<(...args: any[]) => Promise<any>>().mockResolvedValue({});
jest.mock('../../queues/workflowQueue', () => {
  const actual = jest.requireActual('../../queues/workflowQueue') as any;
  return { ...actual, workflowQueue: { add: queueAdd } };
});

// Mock provider crypto so getDbEmailConfig can return decoded config (C2).
const decryptProviderSecrets = jest.fn();
jest.mock('../../utils/providerCrypto', () => ({
  decryptProviderSecrets: (...args: any[]) => (decryptProviderSecrets as any)(...args),
}));

// Mock Resend so the platform sender (C2b) doesn't hit the network.
const resendSend = jest.fn<(...args: any[]) => Promise<any>>().mockResolvedValue({});
jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({ emails: { send: resendSend } })),
}));

import { Resend } from 'resend';
import { WorkflowService } from '../../services/workflowService';
import { digitalDeliveryService } from '../../services/digitalDeliveryService';
import { executeAction } from '../../queues/workflowQueue';
import {
  getDbEmailConfig,
  clearEmailConfigCache,
  sendEmail,
} from '../../services/emailService';

describe('Email channel prerequisites (MAN-77)', () => {
  beforeEach(() => {
    // jest config sets resetMocks:true, which wipes implementations before each
    // test — re-establish them here.
    queueAdd.mockReset().mockResolvedValue({});
    resendSend.mockReset().mockResolvedValue({});
    (Resend as unknown as jest.Mock).mockImplementation(() => ({ emails: { send: resendSend } }));
    (decryptProviderSecrets as any).mockReset();
    clearEmailConfigCache();
    delete process.env.PLATFORM_EMAIL_API_KEY;
    delete process.env.PLATFORM_EMAIL_PROVIDER;
    delete process.env.PLATFORM_EMAIL_FROM;
  });

  // ---------------- C1: tenant context on order_created enqueue ----------------
  describe('C1 — order_created jobs carry tenantId', () => {
    it('threads the active tenantId into the enqueued job', async () => {
      const workflow = { id: 'wf-1', triggerType: 'order_created', isActive: true, actions: [], conditions: {} };
      (prismaMock.workflow.findMany as any).mockResolvedValue([workflow]);
      (prismaMock.order.findUnique as any).mockResolvedValue({
        id: 42, orderItems: [], customer: { id: 7 },
      });
      (prismaMock.workflowExecution.create as any).mockResolvedValue({ id: 'exec-1' });

      const service = new WorkflowService();
      await tenantStorage.run({ tenantId: 'tenant-a' }, () =>
        service.triggerOrderCreatedWorkflows({ id: 42 })
      );

      expect(queueAdd).toHaveBeenCalledTimes(1);
      const [, jobData] = queueAdd.mock.calls[0] as [string, any];
      expect(jobData.tenantId).toBe('tenant-a');
      expect(jobData.executionId).toBe('exec-1');
    });
  });

  // ---------------- C1: worker fails closed without tenant ----------------
  describe('C1 — worker refuses a tenant-scoped send with no tenant context', () => {
    it('throws for send_email when tenantId is null', async () => {
      await expect(
        executeAction({ type: 'send_email', config: { to: 'x@y.com', subject: 'hi' } }, {})
      ).rejects.toThrow(/no tenant context/i);
    });

    it('does not throw the guard when run inside tenant context', async () => {
      await tenantStorage.run({ tenantId: 'tenant-a' }, async () => {
        // send_email is still a stub in MAN-77; the guard must not fire here.
        const result = await executeAction(
          { type: 'send_email', config: { to: 'x@y.com', subject: 'hi' } },
          {}
        );
        expect(result).toEqual({ sent: true });
      });
    });

    it('allows non-send actions with no tenant context', async () => {
      // http_request is not tenant-scoped — guard must not block it.
      const result = await executeAction({ type: 'http_request', config: { url: 'https://x' } }, {});
      expect(result).toEqual({ success: true });
    });
  });

  // ---------------- C2: tenant-keyed config cache isolation ----------------
  describe('C2 — email config cache is tenant-keyed', () => {
    it('serves each tenant its own config and never crosses the cache', async () => {
      (prismaMock.systemConfig.findFirst as any).mockResolvedValue({ emailProvider: {} });
      (decryptProviderSecrets as any)
        .mockReturnValueOnce({ provider: 'resend', apiKey: 'key-A', fromEmail: 'a@a.com', fromName: 'A' })
        .mockReturnValueOnce({ provider: 'resend', apiKey: 'key-B', fromEmail: 'b@b.com', fromName: 'B' });

      const a = await tenantStorage.run({ tenantId: 'tenant-a' }, () => getDbEmailConfig());
      const b = await tenantStorage.run({ tenantId: 'tenant-b' }, () => getDbEmailConfig());

      expect(a?.apiKey).toBe('key-A');
      expect(b?.apiKey).toBe('key-B');
      // Two distinct tenants → two DB reads (no shared cache slot).
      expect((prismaMock.systemConfig.findFirst as any)).toHaveBeenCalledTimes(2);

      // Re-reading tenant A stays cached — A is never re-fetched, never returns B's key.
      const aAgain = await tenantStorage.run({ tenantId: 'tenant-a' }, () => getDbEmailConfig());
      expect(aAgain?.apiKey).toBe('key-A');
      expect((prismaMock.systemConfig.findFirst as any)).toHaveBeenCalledTimes(2);
    });
  });

  // ---------------- C2b: platform transactional sender ----------------
  describe('C2b — platform sender uses PLATFORM_EMAIL_* and not tenant config', () => {
    it('sends from the platform identity without reading tenant DB config', async () => {
      process.env.PLATFORM_EMAIL_PROVIDER = 'resend';
      process.env.PLATFORM_EMAIL_API_KEY = 'platform-key';
      process.env.PLATFORM_EMAIL_FROM = 'noreply@mail.codadminpro.com';

      await sendEmail(
        { to: 'cust@example.com', subject: 'Order confirmed', html: '<p>hi</p>' },
        { as: 'platform' }
      );

      expect(resendSend).toHaveBeenCalledTimes(1);
      const sendArg = resendSend.mock.calls[0][0] as any;
      expect(sendArg.from).toContain('noreply@mail.codadminpro.com');
      // Platform path must NOT consult per-tenant DB config.
      expect((prismaMock.systemConfig.findFirst as any)).not.toHaveBeenCalled();
    });

    it('throws PLATFORM_EMAIL_NOT_CONFIGURED when the platform key is unset', async () => {
      await expect(
        sendEmail({ to: 'c@e.com', subject: 's', html: 'h' }, { as: 'platform' })
      ).rejects.toThrow(/PLATFORM_EMAIL_NOT_CONFIGURED/);
    });
  });

  // ---------------- C4: hasBeenDelivered idempotency guard ----------------
  describe('C4 — digitalDeliveryService.hasBeenDelivered', () => {
    it('returns true when a sent digital_delivery MessageLog exists', async () => {
      (prismaMock.messageLog.findFirst as any).mockResolvedValue({ id: 5 });
      expect(await digitalDeliveryService.hasBeenDelivered(42)).toBe(true);
      // Short-circuits before checking tokens.
      expect((prismaMock.downloadToken.findFirst as any)).not.toHaveBeenCalled();
    });

    it('returns true when a live (non-revoked, unexpired) token exists', async () => {
      (prismaMock.messageLog.findFirst as any).mockResolvedValue(null);
      (prismaMock.downloadToken.findFirst as any).mockResolvedValue({ id: 9 });
      expect(await digitalDeliveryService.hasBeenDelivered(42)).toBe(true);
    });

    it('returns false when neither a sent log nor a live token exists', async () => {
      (prismaMock.messageLog.findFirst as any).mockResolvedValue(null);
      (prismaMock.downloadToken.findFirst as any).mockResolvedValue(null);
      expect(await digitalDeliveryService.hasBeenDelivered(42)).toBe(false);
    });
  });
});
