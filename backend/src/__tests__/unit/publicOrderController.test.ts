import { describe, it, expect, beforeEach, jest } from '@jest/globals';

jest.mock('../../services/paystackService', () => ({
  paystackService: {
    initializeTransaction: jest.fn(),
    getPublicKey: jest.fn(),
  },
}));

jest.mock('../../services/workflowService', () => ({
  __esModule: true,
  default: { triggerOrderCreatedWorkflows: jest.fn() },
}));

jest.mock('../../services/checkoutFormService', () => ({
  __esModule: true,
  default: {},
}));

jest.mock('../../services/metaCapiService', () => ({
  metaCapiService: { fireCapiPurchaseEvent: jest.fn(() => Promise.resolve()) },
}));

jest.mock('../../sockets', () => ({ emitOrderCreated: jest.fn() }));
jest.mock('../../utils/socketInstance', () => ({ getSocketInstance: jest.fn() }));

import { prismaMock } from '../mocks/prisma.mock';
import * as paystackServiceModule from '../../services/paystackService';
import { createPublicOrder } from '../../controllers/publicOrderController';

const mockedPaystack = paystackServiceModule.paystackService as jest.Mocked<
  typeof paystackServiceModule.paystackService
>;

function buildReq(body: any) {
  return { params: { slug: 'form-1' }, body, ip: '1.2.3.4', get: () => 'jest' } as any;
}

function buildRes() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  } as any;
}

// A physical form with a configurable toggle matrix.
function physicalForm(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    slug: 'form-1',
    tenantId: 'tenant-1',
    currency: 'GHS',
    isActive: true,
    productId: 99,
    product: { isActive: true, productType: 'physical' },
    packages: [{ id: 10, name: 'Single', price: 250, quantity: 1, originalPrice: null, discountType: 'none', discountValue: 0 }],
    upsells: [],
    codEnabled: true,
    paystackDepositEnabled: false,
    paystackFullEnabled: false,
    depositPercent: null,
    ...overrides,
  };
}

const buyer = { name: 'Ama Mensah', phoneNumber: '0241234567', address: '12 St', state: 'Greater Accra' };

describe('publicOrderController.createPublicOrder — payment-method enforcement (MAN-58)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects a payment method the form has not enabled (anti-tampering)', async () => {
    (prismaMock.checkoutForm.findFirst as any).mockResolvedValue(physicalForm()); // COD only
    const req = buildReq({
      formData: buyer,
      selectedPackage: { id: 10 },
      paymentMethod: 'paystack_deposit', // not enabled on this form
      totalAmount: 250,
    });
    const res = buildRes();

    await createPublicOrder(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringMatching(/not available/i) }),
    );
    expect(mockedPaystack.initializeTransaction).not.toHaveBeenCalled();
  });

  it('rejects a Paystack method when the form has no tenant', async () => {
    (prismaMock.checkoutForm.findFirst as any).mockResolvedValue(
      physicalForm({ tenantId: null, codEnabled: false, paystackFullEnabled: true }),
    );
    const req = buildReq({
      formData: buyer,
      selectedPackage: { id: 10 },
      paymentMethod: 'paystack_full',
      totalAmount: 250,
    });
    const res = buildRes();

    await createPublicOrder(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringMatching(/not attached to a tenant/i) }),
    );
    expect(mockedPaystack.initializeTransaction).not.toHaveBeenCalled();
  });
});

describe('publicOrderController.createPublicOrder — deferred Paystack creation (issues #2/#4)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('does NOT create an order for a Paystack checkout — stashes a pending checkout and returns the auth URL', async () => {
    (prismaMock.checkoutForm.findFirst as any).mockResolvedValue(
      physicalForm({ codEnabled: false, paystackFullEnabled: true }),
    );
    // New customer
    (prismaMock.customer.findFirst as any).mockResolvedValue(null);
    (prismaMock.customer.create as any).mockResolvedValue({
      id: 7, firstName: 'Ama', lastName: 'Mensah', phoneNumber: buyer.phoneNumber, email: null,
    });
    (prismaMock.formSubmission.findFirst as any).mockResolvedValue(null); // no cooldown
    (prismaMock.order.findFirst as any).mockResolvedValue(null); // no dedup
    (prismaMock.pendingCheckout.create as any).mockResolvedValue({ id: 1 });
    (mockedPaystack.initializeTransaction as any).mockResolvedValue({
      authorization_url: 'https://paystack.co/pay/abc',
      reference: 'ref_abc123',
    });

    const req = buildReq({
      formData: buyer,
      selectedPackage: { id: 10 },
      paymentMethod: 'paystack_full',
      totalAmount: 250,
    });
    const res = buildRes();

    await createPublicOrder(req, res, jest.fn());

    // No order is created up front — abandoned/failed payments never enter the system.
    expect(prismaMock.order.create).not.toHaveBeenCalled();
    // A pending checkout snapshot is stored, keyed by the Paystack reference.
    expect(prismaMock.pendingCheckout.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ reference: 'ref_abc123', paymentMethod: 'paystack_full' }),
      }),
    );
    // The buyer's name is forwarded to Paystack so the receipt shows the payer.
    expect(mockedPaystack.initializeTransaction).toHaveBeenCalledWith(
      'tenant-1',
      expect.any(String),
      expect.any(Number),
      'GHS',
      expect.any(Object),
      expect.any(String),
      expect.objectContaining({ firstName: 'Ama', lastName: 'Mensah' }),
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        authorization_url: 'https://paystack.co/pay/abc',
        paymentReference: 'ref_abc123',
      }),
    );
  });
});

describe('publicOrderController.createPublicOrder — email linking (issue #1)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('updates a returning customer with the email typed at checkout, even when they already had a different one', async () => {
    (prismaMock.checkoutForm.findFirst as any).mockResolvedValue(physicalForm()); // COD
    (prismaMock.customer.findFirst as any).mockResolvedValue({
      id: 7, firstName: 'Ama', lastName: 'Mensah', phoneNumber: buyer.phoneNumber, email: 'old@x.com', alternatePhone: null,
    });
    (prismaMock.customer.update as any).mockResolvedValue({
      id: 7, firstName: 'Ama', lastName: 'Mensah', phoneNumber: buyer.phoneNumber, email: 'new@x.com',
    });
    (prismaMock.formSubmission.findFirst as any).mockResolvedValue(null);
    (prismaMock.order.findFirst as any).mockResolvedValue(null);
    (prismaMock.order.create as any).mockResolvedValue({ id: 55, totalAmount: 250, status: 'pending_confirmation', orderType: 'physical' });
    (prismaMock.formSubmission.create as any).mockResolvedValue({ id: 1 });

    const req = buildReq({
      formData: { ...buyer, email: 'new@x.com' },
      selectedPackage: { id: 10 },
      paymentMethod: 'cod',
      totalAmount: 250,
    });
    const res = buildRes();

    await createPublicOrder(req, res, jest.fn());

    expect(prismaMock.customer.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 7 },
        data: expect.objectContaining({ email: 'new@x.com' }),
      }),
    );
  });
});
