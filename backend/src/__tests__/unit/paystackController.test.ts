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

  it('refuses to process a legacy order whose tenantId is null', async () => {
    // Pre-MAN-66 row not yet backfilled by the follow-up migration. The
    // cross-tenant guard must trip — anyone routing through a per-tenant URL
    // must own the order, including for unscoped legacy rows.
    (prismaMock.webhookEvent.create as any).mockResolvedValueOnce({} as any);
    (prismaMock.order.findUnique as any).mockResolvedValueOnce({ tenantId: null });

    const res = buildRes();
    await handleWebhook(
      buildReq(JSON.stringify({ event: 'charge.success', data: { reference: 'r', amount: 1, fees: 0, currency: 'GHS', metadata: { orderId: 42 } } })),
      res,
    );

    expect(mockedPaystack.verifyTransaction).not.toHaveBeenCalled();
    expect(prismaMock.$queryRaw).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('rejects an underpayment — marks payment_failed and never runs the paid update', async () => {
    // Order total is GH₵500 (50000 minor units) but only GH₵240 was paid.
    (prismaMock.order.findUnique as any).mockResolvedValue({ tenantId: 'tenant-1', totalAmount: 500 });
    mockedPaystack.verifyTransaction.mockResolvedValueOnce({
      data: { status: 'success', reference: 'ref_under', amount: 240_00, currency: 'GHS', metadata: { orderId: 42 } },
    } as any);
    (prismaMock.webhookEvent.create as any).mockResolvedValueOnce({} as any);

    const res = buildRes();
    await handleWebhook(
      buildReq(JSON.stringify({ event: 'charge.success', data: { reference: 'ref_under', amount: 240_00, fees: 0, currency: 'GHS', metadata: { orderId: 42 } } })),
      res,
    );

    // Order set to payment_failed; the atomic "mark paid" $queryRaw never runs.
    expect(prismaMock.order.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'payment_failed' }) }),
    );
    expect(prismaMock.$queryRaw).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('fulfils when the paid amount matches the order total', async () => {
    // Exact match: GH₵240 order, GH₵240 paid → proceeds to the paid update.
    (prismaMock.order.findUnique as any).mockResolvedValue({ tenantId: 'tenant-1', totalAmount: 240 });
    mockedPaystack.verifyTransaction.mockResolvedValueOnce({
      data: { status: 'success', reference: 'ref_ok', amount: 240_00, currency: 'GHS', metadata: { orderId: 42 } },
    } as any);
    (prismaMock.webhookEvent.create as any).mockResolvedValueOnce({} as any);

    const res = buildRes();
    await handleWebhook(
      buildReq(JSON.stringify({ event: 'charge.success', data: { reference: 'ref_ok', amount: 240_00, fees: 0, currency: 'GHS', metadata: { orderId: 42 } } })),
      res,
    );

    // Reached the atomic paid update; not failed.
    expect(prismaMock.$queryRaw).toHaveBeenCalled();
    expect(prismaMock.order.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'payment_failed' }) }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('settles a deposit order when only the deposit portion is paid (MAN-58)', async () => {
    // GH₵500 order, 20% deposit → GH₵100 expected, GH₵400 balance due. Paying
    // exactly the deposit must NOT be treated as an underpayment.
    (prismaMock.order.findUnique as any).mockResolvedValue({
      tenantId: 'tenant-1',
      totalAmount: 500,
      paymentMethod: 'paystack_deposit',
      balanceDue: 400_00,
    });
    mockedPaystack.verifyTransaction.mockResolvedValueOnce({
      data: { status: 'success', reference: 'ref_dep', amount: 100_00, currency: 'GHS', metadata: { orderId: 42 } },
    } as any);
    (prismaMock.webhookEvent.create as any).mockResolvedValueOnce({} as any);

    const res = buildRes();
    await handleWebhook(
      buildReq(JSON.stringify({ event: 'charge.success', data: { reference: 'ref_dep', amount: 100_00, fees: 0, currency: 'GHS', metadata: { orderId: 42 } } })),
      res,
    );

    // Deposit covers the expected amount → proceeds to the settle update, not failed.
    expect(prismaMock.$queryRaw).toHaveBeenCalled();
    expect(prismaMock.order.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'payment_failed' }) }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('rejects a deposit order that underpays even the deposit portion (MAN-58)', async () => {
    // GH₵500 order, GH₵100 deposit expected, but only GH₵50 paid → underpaid.
    (prismaMock.order.findUnique as any).mockResolvedValue({
      tenantId: 'tenant-1',
      totalAmount: 500,
      paymentMethod: 'paystack_deposit',
      balanceDue: 400_00,
    });
    mockedPaystack.verifyTransaction.mockResolvedValueOnce({
      data: { status: 'success', reference: 'ref_dep_low', amount: 50_00, currency: 'GHS', metadata: { orderId: 42 } },
    } as any);
    (prismaMock.webhookEvent.create as any).mockResolvedValueOnce({} as any);

    const res = buildRes();
    await handleWebhook(
      buildReq(JSON.stringify({ event: 'charge.success', data: { reference: 'ref_dep_low', amount: 50_00, fees: 0, currency: 'GHS', metadata: { orderId: 42 } } })),
      res,
    );

    expect(prismaMock.order.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'payment_failed' }) }),
    );
    expect(prismaMock.$queryRaw).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('ignores non-numeric metadata.orderId without crashing Prisma', async () => {
    (prismaMock.webhookEvent.create as any).mockResolvedValueOnce({} as any);

    const res = buildRes();
    await handleWebhook(
      buildReq(JSON.stringify({ event: 'charge.success', data: { reference: 'r', amount: 1, fees: 0, currency: 'GHS', metadata: { orderId: 'abc' } } })),
      res,
    );

    // No order lookup with NaN, no verify, no update.
    expect(prismaMock.order.findUnique).not.toHaveBeenCalled();
    expect(mockedPaystack.verifyTransaction).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('deletes the dedup row when processing throws so Paystack retries succeed', async () => {
    (prismaMock.webhookEvent.create as any).mockResolvedValueOnce({ id: 999 });
    // verifyTransaction throws — simulate the isEnabled-toggled-mid-flight scenario.
    mockedPaystack.verifyTransaction.mockRejectedValueOnce(new Error('Paystack is disabled'));
    (prismaMock.webhookEvent.delete as any) = jest.fn().mockResolvedValue({});

    const res = buildRes();
    await handleWebhook(
      buildReq(JSON.stringify({ event: 'charge.success', data: { reference: 'r', amount: 1, fees: 0, currency: 'GHS', metadata: { orderId: 42 } } })),
      res,
    );

    // Outer catch still 200s (always-ACK contract), but the dedup row was removed.
    expect(prismaMock.webhookEvent.delete).toHaveBeenCalledWith({ where: { id: 999 } });
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
