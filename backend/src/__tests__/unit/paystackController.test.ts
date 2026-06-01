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
import { handleWebhook } from '../../controllers/paystackController';

const mockedPaystack = paystackServiceModule.paystackService as jest.Mocked<
  typeof paystackServiceModule.paystackService
>;

function buildReq(rawBody: string) {
  return {
    headers: { 'x-paystack-signature': 'sig-ok' },
    body: JSON.parse(rawBody),
    rawBody,
  } as any;
}

function buildRes() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  } as any;
}

describe('paystackController.handleWebhook — idempotency', () => {
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
    (prismaMock.order.findUnique as any).mockResolvedValue({ tenantId: 'tenant-1' });
    (prismaMock.$queryRaw as any).mockResolvedValue([{ id: 42 }]);
    (prismaMock.$transaction as any).mockImplementation(async (cb: any) =>
      typeof cb === 'function' ? cb(prismaMock) : cb,
    );
  });

  it('dedupes (provider, eventType, reference) triplet across replays', async () => {
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

    // First call: clean insert.
    (prismaMock.webhookEvent.create as any).mockResolvedValueOnce({
      id: 1,
      provider: 'paystack',
      eventType: 'charge.success',
      reference: 'ref_abc123',
      payloadHash: 'h',
      tenantId: 'tenant-1',
      receivedAt: new Date(),
    });

    // Subsequent calls: unique constraint violation (P2002).
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

    // All 3 ACK with 200.
    expect(r1.status).toHaveBeenCalledWith(200);
    expect(r2.status).toHaveBeenCalledWith(200);
    expect(r3.status).toHaveBeenCalledWith(200);

    // First was a clean insert; replays were marked duplicate.
    expect(r1.json).toHaveBeenCalledWith({ received: true });
    expect(r2.json).toHaveBeenCalledWith({ received: true, duplicate: true });
    expect(r3.json).toHaveBeenCalledWith({ received: true, duplicate: true });

    // Side effects fired exactly once.
    expect(mockedPaystack.verifyTransaction).toHaveBeenCalledTimes(1);
    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('processes a distinct reference independently', async () => {
    const payloadA = {
      event: 'charge.success',
      data: { reference: 'ref_a', amount: 100_00, fees: 0, currency: 'GHS', metadata: { orderId: 42 } },
    };
    const payloadB = {
      event: 'charge.success',
      data: { reference: 'ref_b', amount: 100_00, fees: 0, currency: 'GHS', metadata: { orderId: 43 } },
    };

    (prismaMock.webhookEvent.create as any)
      .mockResolvedValueOnce({} as any)
      .mockResolvedValueOnce({} as any);

    const rA = buildRes();
    const rB = buildRes();
    await handleWebhook(buildReq(JSON.stringify(payloadA)), rA);
    await handleWebhook(buildReq(JSON.stringify(payloadB)), rB);

    expect(rA.json).toHaveBeenCalledWith({ received: true });
    expect(rB.json).toHaveBeenCalledWith({ received: true });
    expect(mockedPaystack.verifyTransaction).toHaveBeenCalledTimes(2);
  });
});
