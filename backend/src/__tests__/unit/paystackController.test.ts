import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { prismaMock } from '../mocks/prisma.mock';

jest.mock('../../services/digitalDeliveryService', () => ({
  digitalDeliveryService: {
    generateDownloadToken: jest.fn(),
    sendDownloadLinks: jest.fn(),
  },
}));
jest.mock('../../services/glAutomationService', () => ({
  GLAutomationService: jest.fn().mockImplementation(() => ({
    createDigitalSaleEntry: jest.fn(),
  })),
}));
jest.mock('../../services/paystackService', () => ({
  paystackService: {
    validateWebhookSignature: jest.fn(),
    verifyTransaction: jest.fn(),
  },
}));

import { handleWebhook } from '../../controllers/paystackController';
import { paystackService } from '../../services/paystackService';

function makeRes() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  } as any;
}

describe('paystackController subscription webhooks', () => {
  beforeEach(() => {
    (paystackService.validateWebhookSignature as jest.Mock).mockResolvedValue(true as never);
  });

  it('stores Paystack subscription details on subscription.create', async () => {
    const req = {
      headers: { 'x-paystack-signature': 'valid' },
      rawBody: Buffer.from('{}'),
      body: {
        event: 'subscription.create',
        data: {
          subscription_code: 'SUB_test',
          email_token: 'email-token',
          next_payment_date: '2026-06-30T00:00:00Z',
          metadata: { tenantId: 'tenant-123', planId: 'plan-pro' },
          customer: { customer_code: 'CUS_test' },
          authorization: { authorization_code: 'AUTH_test' },
        },
      },
    } as any;
    const res = makeRes();

    await handleWebhook(req, res);

    expect(prismaMock.tenant.update).toHaveBeenCalledWith({
      where: { id: 'tenant-123' },
      data: expect.objectContaining({
        currentPlanId: 'plan-pro',
        subscriptionStatus: 'active',
        paystackSubscriptionCode: 'SUB_test',
        paystackSubscriptionToken: 'email-token',
        paystackCustomerCode: 'CUS_test',
        paystackAuthorizationCode: 'AUTH_test',
        subscriptionRenewsAt: new Date('2026-06-30T00:00:00Z'),
      }),
    });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('marks the tenant past_due on invoice.payment_failed', async () => {
    (prismaMock.tenant.findFirst as any).mockResolvedValue({ id: 'tenant-123' });

    const req = {
      headers: { 'x-paystack-signature': 'valid' },
      rawBody: Buffer.from('{}'),
      body: {
        event: 'invoice.payment_failed',
        data: {
          subscription_code: 'SUB_test',
        },
      },
    } as any;
    const res = makeRes();

    await handleWebhook(req, res);

    expect(prismaMock.tenant.findFirst).toHaveBeenCalledWith({
      where: { paystackSubscriptionCode: 'SUB_test' },
    });
    expect(prismaMock.tenant.update).toHaveBeenCalledWith({
      where: { id: 'tenant-123' },
      data: { subscriptionStatus: 'past_due' },
    });
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

