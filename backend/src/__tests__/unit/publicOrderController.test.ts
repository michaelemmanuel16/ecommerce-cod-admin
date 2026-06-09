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

const buyer = { name: 'Ama', phoneNumber: '0241234567', address: '12 St', state: 'Greater Accra' };

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
