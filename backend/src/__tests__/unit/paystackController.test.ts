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
  },
}));

// Settlement is delegated to the settlement service; the webhook only owns tenant
// resolution, signature checks and dedup. We mock settlement and assert delegation.
jest.mock('../../services/paystackSettlementService', () => ({
  settlePaystackPayment: jest.fn(),
}));

import { prismaMock } from '../mocks/prisma.mock';
import * as paystackServiceModule from '../../services/paystackService';
import * as settlementModule from '../../services/paystackSettlementService';
import { handleWebhook, handleLegacyWebhook } from '../../controllers/paystackController';

const mockedPaystack = paystackServiceModule.paystackService as jest.Mocked<
  typeof paystackServiceModule.paystackService
>;
const mockedSettle = settlementModule.settlePaystackPayment as jest.MockedFunction<
  typeof settlementModule.settlePaystackPayment
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

function chargeBody(reference = 'ref_abc123') {
  return JSON.stringify({ event: 'charge.success', data: { reference } });
}

describe('paystackController.handleWebhook — tenant scoping + idempotency', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedPaystack.validateWebhookSignature.mockResolvedValue(true);
    mockedSettle.mockResolvedValue({ status: 'success' } as any);
    (prismaMock.tenant.findUnique as any).mockResolvedValue({ id: 'tenant-1' });
  });

  it('rejects with 404 when the tenant slug is unknown', async () => {
    (prismaMock.tenant.findUnique as any).mockResolvedValueOnce(null);
    const res = buildRes();
    await handleWebhook(buildReq(chargeBody(), 'ghost'), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(mockedPaystack.validateWebhookSignature).not.toHaveBeenCalled();
  });

  it('rejects with 401 when HMAC signature is invalid', async () => {
    mockedPaystack.validateWebhookSignature.mockResolvedValueOnce(false);
    const res = buildRes();
    await handleWebhook(buildReq(chargeBody()), res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(prismaMock.webhookEvent.create).not.toHaveBeenCalled();
  });

  it('validates HMAC against the resolved tenant id', async () => {
    const res = buildRes();
    (prismaMock.webhookEvent.create as any).mockResolvedValueOnce({} as any);
    await handleWebhook(buildReq(chargeBody('r1')), res);
    expect(mockedPaystack.validateWebhookSignature).toHaveBeenCalledWith(
      'tenant-1',
      expect.any(String),
      'sig-ok',
    );
  });

  it('writes WebhookEvent with the tenant id from the URL slug', async () => {
    (prismaMock.webhookEvent.create as any).mockResolvedValueOnce({} as any);
    await handleWebhook(buildReq(chargeBody('r1')), buildRes());
    const createCall = (prismaMock.webhookEvent.create as any).mock.calls[0]?.[0];
    expect(createCall?.data?.tenantId).toBe('tenant-1');
    expect(createCall?.data?.provider).toBe('paystack');
    expect(createCall?.data?.eventType).toBe('charge.success');
    expect(createCall?.data?.reference).toBe('r1');
  });

  it('delegates charge.success settlement to the settlement service, scoped to the URL tenant', async () => {
    (prismaMock.webhookEvent.create as any).mockResolvedValueOnce({} as any);
    const res = buildRes();
    await handleWebhook(buildReq(chargeBody('ref_settle')), res);
    expect(mockedSettle).toHaveBeenCalledWith('ref_settle', { webhookTenantId: 'tenant-1' });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('dedupes replays for the same (tenant, provider, eventType, reference) tuple', async () => {
    const rawBody = chargeBody('ref_abc123');
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
    // Only the first, non-duplicate event reaches settlement.
    expect(mockedSettle).toHaveBeenCalledTimes(1);
  });

  it('allows the same Paystack reference to land independently for two tenants', async () => {
    const payload = chargeBody('ref_shared');

    (prismaMock.tenant.findUnique as any).mockResolvedValueOnce({ id: 'tenant-1' });
    (prismaMock.webhookEvent.create as any).mockResolvedValueOnce({} as any);
    const rA = buildRes();
    await handleWebhook(buildReq(payload, 'tenant-1'), rA);
    expect(rA.json).toHaveBeenCalledWith({ received: true });

    (prismaMock.tenant.findUnique as any).mockResolvedValueOnce({ id: 'tenant-2' });
    (prismaMock.webhookEvent.create as any).mockResolvedValueOnce({} as any);
    const rB = buildRes();
    await handleWebhook(buildReq(payload, 'tenant-2'), rB);
    expect(rB.json).toHaveBeenCalledWith({ received: true });

    expect(prismaMock.webhookEvent.create).toHaveBeenCalledTimes(2);
    expect(mockedSettle).toHaveBeenCalledTimes(2);
  });

  it('deletes the dedup row when settlement throws so Paystack retries succeed', async () => {
    (prismaMock.webhookEvent.create as any).mockResolvedValueOnce({ id: 999 });
    mockedSettle.mockRejectedValueOnce(new Error('Paystack is disabled'));
    (prismaMock.webhookEvent.delete as any) = jest.fn().mockResolvedValue({});

    const res = buildRes();
    await handleWebhook(buildReq(chargeBody('r')), res);

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
