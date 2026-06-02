import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { Prisma } from '@prisma/client';

jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
}));

jest.mock('../../services/paystackService', () => ({
  paystackService: {
    validateWebhookSignature: jest.fn(),
    verifyTransaction: jest.fn(),
  },
}));

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

import { prismaMock } from '../mocks/prisma.mock';
import * as paystackServiceModule from '../../services/paystackService';
import { handleWebhook, handleLegacyWebhook } from '../../controllers/paystackController';

const mockedPaystack = paystackServiceModule.paystackService as jest.Mocked<
  typeof paystackServiceModule.paystackService
>;

function buildReq(rawBody: string, tenantSlug = 'tenant-1') {
  return {
    headers: { 'x-paystack-signature': 'sig-ok' },
    body: JSON.parse(rawBody),
    rawBody,
    params: { tenantSlug },
  } as any;
}

function buildRes() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  } as any;
}

describe('paystackController.handleWebhook — tenant scoping + idempotency', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedPaystack.validateWebhookSignature.mockResolvedValue(true);
    mockedPaystack.verifyTransaction.mockResolvedValue({
      data: {
        status: 'success',
        reference: 'ref_abc123',
        amount: 240_00,
        currency: 'GHS',
        metadata: { orderId: 42 },
      },
    } as any);
    // Default tenant lookup: slug → id
    (prismaMock.tenant.findUnique as any).mockResolvedValue({ id: 'tenant-1' });
    (prismaMock.order.findUnique as any).mockResolvedValue({ tenantId: 'tenant-1' });
    (prismaMock.$queryRaw as any).mockResolvedValue([{ id: 42 }]);
    (prismaMock.$transaction as any).mockImplementation(async (cb: any) =>
      typeof cb === 'function' ? cb(prismaMock) : cb,
    );
  });

  it('rejects with 404 when the tenant slug is unknown', async () => {
    (prismaMock.tenant.findUnique as any).mockResolvedValueOnce(null);
    const res = buildRes();
    await handleWebhook(buildReq(JSON.stringify({ event: 'charge.success', data: {} }), 'ghost'), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(mockedPaystack.validateWebhookSignature).not.toHaveBeenCalled();
  });

  it('rejects with 401 when HMAC signature is invalid', async () => {
    mockedPaystack.validateWebhookSignature.mockResolvedValueOnce(false);
    const res = buildRes();
    await handleWebhook(
      buildReq(JSON.stringify({ event: 'charge.success', data: { reference: 'r' } })),
      res,
    );
    expect(res.status).toHaveBeenCalledWith(401);
    expect(prismaMock.webhookEvent.create).not.toHaveBeenCalled();
  });

  it('validates HMAC against the resolved tenant id', async () => {
    const res = buildRes();
    (prismaMock.webhookEvent.create as any).mockResolvedValueOnce({} as any);
    await handleWebhook(
      buildReq(JSON.stringify({ event: 'charge.success', data: { reference: 'r1', amount: 1, fees: 0, currency: 'GHS', metadata: { orderId: 42 } } })),
      res,
    );
    expect(mockedPaystack.validateWebhookSignature).toHaveBeenCalledWith(
      'tenant-1',
      expect.any(String),
      'sig-ok',
    );
  });

  it('writes WebhookEvent with the tenant id from the URL slug', async () => {
    (prismaMock.webhookEvent.create as any).mockResolvedValueOnce({} as any);
    await handleWebhook(
      buildReq(JSON.stringify({ event: 'charge.success', data: { reference: 'r1', amount: 1, fees: 0, currency: 'GHS', metadata: { orderId: 42 } } })),
      buildRes(),
    );
    const createCall = (prismaMock.webhookEvent.create as any).mock.calls[0]?.[0];
    expect(createCall?.data?.tenantId).toBe('tenant-1');
    expect(createCall?.data?.provider).toBe('paystack');
    expect(createCall?.data?.eventType).toBe('charge.success');
    expect(createCall?.data?.reference).toBe('r1');
  });

  it('dedupes replays for the same (tenant, provider, eventType, reference) tuple', async () => {
    const payload = {
      event: 'charge.success',
      data: {
        reference: 'ref_abc123',
        amount: 240_00,
        fees: 360,
        currency: 'GHS',
        metadata: { orderId: 42 },
      },
    };
    const rawBody = JSON.stringify(payload);

    (prismaMock.webhookEvent.create as any).mockResolvedValueOnce({} as any);
    const p2002 = new Prisma.PrismaClientKnownRequestError('unique', {
      code: 'P2002',
      clientVersion: '5.22.0',
    } as any);
    (prismaMock.webhookEvent.create as any)
      .mockRejectedValueOnce(p2002)
      .mockRejectedValueOnce(p2002);

    const r1 = buildRes();
    const r2 = buildRes();
    const r3 = buildRes();
    await handleWebhook(buildReq(rawBody), r1);
    await handleWebhook(buildReq(rawBody), r2);
    await handleWebhook(buildReq(rawBody), r3);

    expect(r1.json).toHaveBeenCalledWith({ received: true });
    expect(r2.json).toHaveBeenCalledWith({ received: true, duplicate: true });
    expect(r3.json).toHaveBeenCalledWith({ received: true, duplicate: true });
    expect(mockedPaystack.verifyTransaction).toHaveBeenCalledTimes(1);
  });

  it('allows the same Paystack reference to land independently for two tenants', async () => {
    const payload = JSON.stringify({
      event: 'charge.success',
      data: { reference: 'ref_shared', amount: 1, fees: 0, currency: 'GHS', metadata: { orderId: 42 } },
    });

    // Tenant A
    (prismaMock.tenant.findUnique as any).mockResolvedValueOnce({ id: 'tenant-1' });
    (prismaMock.order.findUnique as any).mockResolvedValueOnce({ tenantId: 'tenant-1' });
    (prismaMock.webhookEvent.create as any).mockResolvedValueOnce({} as any);
    const rA = buildRes();
    await handleWebhook(buildReq(payload, 'tenant-1'), rA);
    expect(rA.json).toHaveBeenCalledWith({ received: true });

    // Tenant B — different tenant, same Paystack reference, NOT a duplicate.
    (prismaMock.tenant.findUnique as any).mockResolvedValueOnce({ id: 'tenant-2' });
    (prismaMock.order.findUnique as any).mockResolvedValueOnce({ tenantId: 'tenant-2' });
    (prismaMock.webhookEvent.create as any).mockResolvedValueOnce({} as any);
    const rB = buildRes();
    await handleWebhook(buildReq(payload, 'tenant-2'), rB);
    expect(rB.json).toHaveBeenCalledWith({ received: true });

    // Two independent writes, both succeed.
    expect(prismaMock.webhookEvent.create).toHaveBeenCalledTimes(2);
  });

  it('ignores webhooks whose order belongs to a different tenant', async () => {
    (prismaMock.webhookEvent.create as any).mockResolvedValueOnce({} as any);
    // The webhook arrives at tenant-1's URL but order says tenant-2 owns it.
    (prismaMock.order.findUnique as any).mockResolvedValueOnce({ tenantId: 'tenant-2' });

    const res = buildRes();
    await handleWebhook(
      buildReq(JSON.stringify({ event: 'charge.success', data: { reference: 'r', amount: 1, fees: 0, currency: 'GHS', metadata: { orderId: 42 } } })),
      res,
    );

    // Side effects skipped (no verifyTransaction call, no DB update).
    expect(mockedPaystack.verifyTransaction).not.toHaveBeenCalled();
    expect(prismaMock.$queryRaw).not.toHaveBeenCalled();
    // Still ACKs to prevent Paystack retry storms.
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe('paystackController.handleLegacyWebhook', () => {
  it('returns 410 with a hint pointing at the per-tenant URL', () => {
    const res = buildRes();
    handleLegacyWebhook({} as any, res);
    expect(res.status).toHaveBeenCalledWith(410);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.stringContaining('moved'),
        hint: expect.stringContaining('/api/paystack/webhook/'),
      }),
    );
  });
});
