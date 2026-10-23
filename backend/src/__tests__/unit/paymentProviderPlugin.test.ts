/**
 * M3b-T03 (F-400): a second provider plugs in with no change to the controller or the settlement code.
 * A form names provider `stub`; checkout initializes through it, and settlement verifies through it.
 */
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

jest.mock('../../utils/appEvents', () => ({ __esModule: true, emitOrderCreatedEvent: jest.fn() }));
jest.mock('../../services/checkoutFormService', () => ({ __esModule: true, default: {} }));
jest.mock('../../services/metaCapiService', () => ({
  metaCapiService: { fireCapiPurchaseEvent: jest.fn(() => Promise.resolve()) },
}));
jest.mock('../../services/digitalDeliveryService', () => ({
  digitalDeliveryService: { generateDownloadToken: jest.fn(), sendDownloadLinks: jest.fn() },
}));
jest.mock('../../services/glAutomationService', () => ({
  GLAutomationService: jest.fn().mockImplementation(() => ({ createDigitalSaleEntry: jest.fn() })),
}));
jest.mock('../../services/orderStateMachine', () => ({ transitionOrder: jest.fn(() => Promise.resolve({ changed: true })) }));
jest.mock('../../sockets', () => ({ emitOrderCreated: jest.fn() }));
jest.mock('../../utils/socketInstance', () => ({ getSocketInstance: jest.fn() }));
jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { prismaMock } from '../mocks/prisma.mock';
import { clearTenantFeaturesCache } from '../../services/tenantFeatures';
import { createPublicOrder } from '../../controllers/publicOrderController';
import { settlePayment } from '../../services/paystackSettlementService';
import { registerPaymentProvider, unregisterPaymentProvider } from '../../services/payments';
import { createFakeProvider } from '../../services/payments/fakeProvider';
import { metaCapiService } from '../../services/metaCapiService';
import { tenantStorage } from '../../utils/tenantContext';
import * as Money from '../../utils/money';

const stub = createFakeProvider('stub');

const buyer = { name: 'Ama Mensah', phoneNumber: '0241234567', address: '12 St', state: 'Greater Accra', town: 'Osu', landmark: 'Opposite the Total station' };

const stubForm = {
  id: 1, slug: 'form-1', tenantId: 'tenant-1', currency: 'GHS', isActive: true, productId: 99,
  product: { isActive: true, productType: 'physical' },
  packages: [{ id: 10, name: 'Single', price: 250, quantity: 1, originalPrice: null, discountType: 'none', discountValue: 0 }],
  upsells: [], codEnabled: false, paystackDepositEnabled: false, paystackFullEnabled: true, depositPercent: null,
  paymentProvider: 'stub',
};

describe('a second payment provider', () => {
  beforeEach(() => {
    registerPaymentProvider(stub);
    // jest config has resetMocks:true, so re-arm the fire-and-forget mock each test.
    (metaCapiService.fireCapiPurchaseEvent as any).mockResolvedValue(undefined);
    clearTenantFeaturesCache();
  (prismaMock.systemConfig.findUnique as any).mockResolvedValue({ features: { prepaidPhysical: true } });
    (prismaMock.$transaction as any).mockImplementation(async (cb: any) => cb(prismaMock));
    (prismaMock.product.count as any).mockResolvedValue(1);
  });
  afterEach(() => unregisterPaymentProvider('stub'));

  it('takes the checkout when the form names it', async () => {
    (prismaMock.checkoutForm.findFirst as any).mockResolvedValue(stubForm);
    (prismaMock.customer.findMany as any).mockResolvedValue([]);
    (prismaMock.customer.create as any).mockResolvedValue({ id: 7, firstName: 'Ama', lastName: 'Mensah', phoneNumber: buyer.phoneNumber, email: null });
    (prismaMock.formSubmission.findFirst as any).mockResolvedValue(null);
    (prismaMock.order.findFirst as any).mockResolvedValue(null);
    (prismaMock.pendingCheckout.create as any).mockResolvedValue({ id: 1 });
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() } as any;

    await createPublicOrder(
      { params: { slug: 'form-1' }, body: { formData: buyer, selectedPackage: { id: 10 }, paymentMethod: 'paystack_full', totalAmount: 250 }, ip: '1.2.3.4', get: () => 'jest' } as any,
      res,
      jest.fn(),
    );

    expect(stub.initialized).toEqual([expect.objectContaining({ tenantId: 'tenant-1', amount: '250.00', currency: 'GHS' })]);
    // the callback URL names the form, so the page can theme itself even for an unknown reference
    expect(stub.initialized[0].callbackUrl).toMatch(/\/checkout\/payment\/callback\/form-1$/);
    const pending = (prismaMock.pendingCheckout.create as any).mock.calls[0][0].data;
    expect(pending).toMatchObject({ provider: 'stub', reference: stub.initialized[0].reference });
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ authorization_url: `https://pay.stub.test/${stub.initialized[0].reference}` }),
    );
  });

  it('settles a payment it holds, and the order records the provider', async () => {
    const pending = {
      id: 1, reference: 'stub_ref_9', tenantId: 'tenant-1', provider: 'stub', customerId: 7, formId: 1,
      paymentMethod: 'paystack_full', orderType: 'physical', currency: 'GHS', subtotal: 250, shippingCost: 0, discount: 0,
      totalAmount: 250, codAmount: 0, balanceDue: 0, paystackChargeMinor: 25000,
      orderItems: [{ productId: 99, quantity: 1, unitPrice: 250, totalPrice: 250, itemType: 'package' }],
      formData: { name: 'Ama', phoneNumber: '0241234567', address: '12 St', state: 'Greater Accra' },
      selectedPackage: { id: 10 }, selectedUpsells: null, ipAddress: '1.2.3.4', userAgent: 'jest',
    };
    stub.setPayment('stub_ref_9', { status: 'success', amount: '250.00', fee: '3.75' });
    (prismaMock.order.findFirst as any).mockResolvedValue(null);
    (prismaMock.pendingCheckout.findUnique as any).mockResolvedValue(pending);
    (prismaMock.pendingCheckout.delete as any).mockResolvedValue(pending);
    (prismaMock.order.create as any).mockResolvedValue({ id: 55, tenantId: 'tenant-1', orderType: 'physical', status: 'confirmed', customer: { id: 7 } });

    const result = await tenantStorage.run({ tenantId: 'tenant-1' }, () => settlePayment('stub_ref_9'));

    expect(result.status).toBe('success');
    const data = (prismaMock.order.create as any).mock.calls[0][0].data;
    expect(data).toMatchObject({ paymentProvider: 'stub', paymentStatus: 'paid' });
    expect(Money.toApi(data.depositPaid)).toBe('250.00');
    expect((prismaMock.transaction.create as any).mock.calls[0][0].data).toMatchObject({ provider: 'stub' });
  });

  it('does not settle when the stub says the payment is short', async () => {
    const pending = {
      reference: 'stub_ref_10', tenantId: 'tenant-1', provider: 'stub', currency: 'GHS', paystackChargeMinor: 25000,
    };
    stub.setPayment('stub_ref_10', { status: 'success', amount: '100.00' });
    (prismaMock.order.findFirst as any).mockResolvedValue(null);
    (prismaMock.pendingCheckout.findUnique as any).mockResolvedValue(pending);

    const result = await tenantStorage.run({ tenantId: 'tenant-1' }, () => settlePayment('stub_ref_10'));

    expect(result.status).toBe('failed');
    expect(prismaMock.order.create).not.toHaveBeenCalled();
  });

  it('rejects a payment taken in another currency, even for a bigger number', async () => {
    const pending = { reference: 'stub_ref_11', tenantId: 'tenant-1', provider: 'stub', currency: 'GHS', paystackChargeMinor: 25000 };
    stub.setPayment('stub_ref_11', { status: 'success', amount: '9999.00', currency: 'NGN' });
    (prismaMock.order.findFirst as any).mockResolvedValue(null);
    (prismaMock.pendingCheckout.findUnique as any).mockResolvedValue(pending);

    const result = await tenantStorage.run({ tenantId: 'tenant-1' }, () => settlePayment('stub_ref_11'));

    expect(result.status).toBe('failed');
    expect(prismaMock.pendingCheckout.delete).not.toHaveBeenCalled();
    expect(prismaMock.order.create).not.toHaveBeenCalled();
  });

  it('compares minor against minor: one minor unit short fails, exact passes', async () => {
    const pending = {
      reference: 'r', tenantId: 'tenant-1', provider: 'stub', currency: 'GHS', paystackChargeMinor: 25000, customerId: 7, formId: 1,
      paymentMethod: 'paystack_full', orderType: 'physical', subtotal: 250, shippingCost: 0, discount: 0, totalAmount: 250,
      codAmount: 0, balanceDue: 0, orderItems: [], formData: { address: '12 St' }, selectedPackage: {}, selectedUpsells: null,
    };
    (prismaMock.order.findFirst as any).mockResolvedValue(null);
    (prismaMock.pendingCheckout.findUnique as any).mockResolvedValue(pending);
    stub.setPayment('r', { status: 'success', amount: '249.99' });
    const short = await tenantStorage.run({ tenantId: 'tenant-1' }, () => settlePayment('r'));
    expect(short.status).toBe('failed');
    expect(prismaMock.pendingCheckout.delete).not.toHaveBeenCalled();

    stub.setPayment('r', { status: 'success', amount: '250.00' });
    (prismaMock.pendingCheckout.delete as any).mockResolvedValue(pending);
    (prismaMock.order.create as any).mockResolvedValue({ id: 1, tenantId: 'tenant-1', orderType: 'physical', status: 'confirmed', customer: { id: 7 } });
    const exact = await tenantStorage.run({ tenantId: 'tenant-1' }, () => settlePayment('r'));
    expect(exact.status).toBe('success');
  });
});
