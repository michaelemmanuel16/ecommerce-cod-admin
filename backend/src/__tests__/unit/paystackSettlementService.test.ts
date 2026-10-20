import { describe, it, expect, beforeEach, jest } from '@jest/globals';

jest.mock('../../services/paystackService', () => ({
  paystackService: { verifyTransaction: jest.fn() },
}));
jest.mock('../../services/digitalDeliveryService', () => ({
  digitalDeliveryService: { generateDownloadToken: jest.fn(), sendDownloadLinks: jest.fn() },
}));
jest.mock('../../services/glAutomationService', () => ({
  GLAutomationService: jest.fn().mockImplementation(() => ({ createDigitalSaleEntry: jest.fn() })),
}));
jest.mock('../../services/metaCapiService', () => ({
  metaCapiService: { fireCapiPurchaseEvent: jest.fn(() => Promise.resolve()) },
}));
jest.mock('../../services/workflowService', () => ({
  __esModule: true,
  default: { triggerOrderCreatedWorkflows: jest.fn(() => Promise.resolve()) },
}));
jest.mock('../../sockets', () => ({ emitOrderCreated: jest.fn() }));
jest.mock('../../utils/socketInstance', () => ({ getSocketInstance: jest.fn() }));

import { prismaMock } from '../mocks/prisma.mock';
import * as paystackServiceModule from '../../services/paystackService';
import workflowService from '../../services/workflowService';
import { metaCapiService } from '../../services/metaCapiService';
import { settlePaystackPayment } from '../../services/paystackSettlementService';
import { tenantStorage, getTenantId } from '../../utils/tenantContext';
import * as Money from '../../utils/money';

const mockedPaystack = paystackServiceModule.paystackService as jest.Mocked<
  typeof paystackServiceModule.paystackService
>;

const pending = {
  id: 1,
  reference: 'ref_ok',
  tenantId: 'tenant-1',
  customerId: 7,
  formId: 1,
  paymentMethod: 'paystack_full',
  orderType: 'physical',
  currency: 'GHS',
  subtotal: 250,
  shippingCost: 0,
  discount: 0,
  totalAmount: 250,
  codAmount: 0,
  balanceDue: 0,
  paystackChargeMinor: 25000,
  orderItems: [{ productId: 99, quantity: 1, unitPrice: 250, totalPrice: 250, itemType: 'package' }],
  formData: { name: 'Ama', phoneNumber: '0241234567', address: '12 St', state: 'Greater Accra' },
  selectedPackage: { id: 10 },
  selectedUpsells: null,
  ipAddress: '1.2.3.4',
  userAgent: 'jest',
};

describe('settlePaystackPayment (issue #3 — paid → confirmed)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // jest config has resetMocks:true, so re-arm the fire-and-forget mocks each test.
    (prismaMock.$transaction as any).mockImplementation(async (cb: any) => cb(prismaMock));
    (workflowService.triggerOrderCreatedWorkflows as any).mockResolvedValue(undefined);
    (metaCapiService.fireCapiPurchaseEvent as any).mockResolvedValue(undefined);
  });

  it('creates a confirmed, paid order from the pending checkout on a successful payment', async () => {
    (prismaMock.order.findFirst as any).mockResolvedValue(null); // not settled yet
    (prismaMock.pendingCheckout.findUnique as any).mockResolvedValue(pending);
    (mockedPaystack.verifyTransaction as any).mockResolvedValue({
      data: { status: 'success', reference: 'ref_ok', amount: 25000, currency: 'GHS', fees: 375 },
    });
    (prismaMock.pendingCheckout.delete as any).mockResolvedValue(pending);
    const createdOrder = { id: 55, tenantId: 'tenant-1', orderType: 'physical', status: 'confirmed', paymentStatus: 'paid', customer: { id: 7 } };
    (prismaMock.order.create as any).mockResolvedValue(createdOrder);
    (prismaMock.order.findUnique as any).mockResolvedValue({ ...createdOrder });

    const result = await settlePaystackPayment('ref_ok');

    expect(result.status).toBe('success');
    expect(prismaMock.order.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'confirmed',
          paymentStatus: 'paid',
          paymentReference: 'ref_ok',
        }),
      }),
    );
    // major units (F-405): 25000 minor units from Paystack is 250.00, not 25000
    expect(Money.toApi((prismaMock.order.create as any).mock.calls[0][0].data.depositPaid)).toBe('250.00');
    expect(prismaMock.pendingCheckout.delete).toHaveBeenCalledWith({ where: { reference: 'ref_ok' } });
  });

  it('does NOT create an order when Paystack reports the payment was not successful (issue #4)', async () => {
    (prismaMock.order.findFirst as any).mockResolvedValue(null);
    (prismaMock.pendingCheckout.findUnique as any).mockResolvedValue(pending);
    (mockedPaystack.verifyTransaction as any).mockResolvedValue({
      data: { status: 'abandoned', reference: 'ref_ok', amount: 0, currency: 'GHS', fees: 0 },
    });

    const result = await settlePaystackPayment('ref_ok');

    expect(result.status).toBe('pending');
    expect(prismaMock.order.create).not.toHaveBeenCalled();
    expect(prismaMock.pendingCheckout.delete).not.toHaveBeenCalled();
  });

  it('is idempotent — returns the existing order when already settled', async () => {
    const existing = { id: 55, status: 'confirmed', paymentStatus: 'paid' };
    (prismaMock.order.findFirst as any).mockResolvedValue(existing);

    const result = await tenantStorage.run({ tenantId: 'tenant-1' }, () => settlePaystackPayment('ref_ok'));

    expect(result.status).toBe('success');
    expect(result.order).toBe(existing);
    expect(prismaMock.pendingCheckout.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.order.create).not.toHaveBeenCalled();
  });

  it('public verify (no context) resolves the tenant from the pending checkout before settling (T15)', async () => {
    (prismaMock.pendingCheckout.findUnique as any).mockResolvedValue(pending);
    const seen: Array<string | null> = [];
    (prismaMock.order.findFirst as any).mockImplementation(async () => {
      seen.push(getTenantId());
      return { id: 55, status: 'confirmed', paymentStatus: 'paid' };
    });

    const result = await settlePaystackPayment('ref_ok');

    expect(result.status).toBe('success');
    // the tenant is the pending checkout's tenant for the settlement lookup
    expect(seen[seen.length - 1]).toBe(pending.tenantId);
  });

  it('public verify (no context) with an unknown reference is not_found and settles nothing (T15)', async () => {
    (prismaMock.pendingCheckout.findUnique as any).mockResolvedValue(null);
    (prismaMock.order.findFirst as any).mockResolvedValue(null);

    const result = await settlePaystackPayment('ref_nope');

    expect(result.status).toBe('not_found');
    expect(prismaMock.order.create).not.toHaveBeenCalled();
  });

  it('scopes the order lookup to the webhook tenant so a cross-account reference collision cannot resolve another tenant order (H1)', async () => {
    (prismaMock.order.findFirst as any).mockResolvedValue(null);
    (prismaMock.pendingCheckout.findUnique as any).mockResolvedValue(null); // stop early after the lookup

    await settlePaystackPayment('ref_ok', { webhookTenantId: 'tenant-1' });

    expect(prismaMock.order.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ paymentReference: 'ref_ok', tenantId: 'tenant-1' }),
      }),
    );
  });

  it('rejects an underpayment — no order created', async () => {
    (prismaMock.order.findFirst as any).mockResolvedValue(null);
    (prismaMock.pendingCheckout.findUnique as any).mockResolvedValue(pending); // expects 25000
    (mockedPaystack.verifyTransaction as any).mockResolvedValue({
      data: { status: 'success', reference: 'ref_ok', amount: 10000, currency: 'GHS', fees: 0 },
    });

    const result = await settlePaystackPayment('ref_ok');

    expect(result.status).toBe('failed');
    expect(prismaMock.order.create).not.toHaveBeenCalled();
    expect(prismaMock.pendingCheckout.delete).not.toHaveBeenCalled();
  });

  it('settles a deposit to paymentStatus "deposited" when the deposit portion is paid', async () => {
    const depositPending = { ...pending, paymentMethod: 'paystack_deposit', paystackChargeMinor: 10000, balanceDue: 150 };
    (prismaMock.order.findFirst as any).mockResolvedValue(null);
    (prismaMock.pendingCheckout.findUnique as any).mockResolvedValue(depositPending);
    (mockedPaystack.verifyTransaction as any).mockResolvedValue({
      data: { status: 'success', reference: 'ref_ok', amount: 10000, currency: 'GHS', fees: 150 },
    });
    (prismaMock.pendingCheckout.delete as any).mockResolvedValue(depositPending);
    const createdOrder = { id: 56, tenantId: 'tenant-1', orderType: 'physical', status: 'confirmed', paymentStatus: 'deposited', customer: { id: 7 } };
    (prismaMock.order.create as any).mockResolvedValue(createdOrder);
    (prismaMock.order.findUnique as any).mockResolvedValue({ ...createdOrder });

    const result = await settlePaystackPayment('ref_ok');

    expect(result.status).toBe('success');
    expect(prismaMock.order.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ paymentStatus: 'deposited' }) }),
    );
    expect(Money.toApi((prismaMock.order.create as any).mock.calls[0][0].data.depositPaid)).toBe('100.00');
  });

  // F-405 / M0-T22
  it('a 249.00 deposit order stores depositPaid 74.70 (30%), not 7470, and the Paystack fee in major units', async () => {
    const depositPending = {
      ...pending,
      paymentMethod: 'paystack_deposit',
      subtotal: 249,
      totalAmount: 249,
      codAmount: 174.3,
      balanceDue: 174.3,
      paystackChargeMinor: 7470,
    };
    (prismaMock.order.findFirst as any).mockResolvedValue(null);
    (prismaMock.pendingCheckout.findUnique as any).mockResolvedValue(depositPending);
    (mockedPaystack.verifyTransaction as any).mockResolvedValue({
      data: { status: 'success', reference: 'ref_ok', amount: 7470, currency: 'GHS', fees: 112 },
    });
    (prismaMock.pendingCheckout.delete as any).mockResolvedValue(depositPending);
    const createdOrder = { id: 57, tenantId: 'tenant-1', orderType: 'physical', status: 'confirmed', paymentStatus: 'deposited', customer: { id: 7 } };
    (prismaMock.order.create as any).mockResolvedValue(createdOrder);
    (prismaMock.order.findUnique as any).mockResolvedValue({ ...createdOrder });

    const result = await settlePaystackPayment('ref_ok');

    expect(result.status).toBe('success');
    const data = (prismaMock.order.create as any).mock.calls[0][0].data;
    expect(Money.toApi(data.depositPaid)).toBe('74.70');
    expect(Money.toApi(data.balanceDue)).toBe('174.30');
    expect(Money.toApi(data.totalAmount)).toBe('249.00');
    expect(Money.eq(Money.add(data.depositPaid, data.balanceDue), data.totalAmount)).toBe(true);
    const txn = (prismaMock.transaction.create as any).mock.calls[0][0].data;
    expect(Money.toApi(txn.amount)).toBe('74.70');
    expect(txn.metadata.fees).toBe('1.12');
  });

  it('ignores a settlement whose pending checkout belongs to a different tenant', async () => {
    (prismaMock.order.findFirst as any).mockResolvedValue(null);
    (prismaMock.pendingCheckout.findUnique as any).mockResolvedValue(pending); // tenant-1

    const result = await settlePaystackPayment('ref_ok', { webhookTenantId: 'tenant-2' });

    expect(result.status).toBe('not_found');
    expect(mockedPaystack.verifyTransaction).not.toHaveBeenCalled();
    expect(prismaMock.order.create).not.toHaveBeenCalled();
  });
});
