import { describe, it, expect, beforeEach, jest } from '@jest/globals';

jest.mock('../../services/paystackService', () => ({
  paystackService: {
    initializeTransaction: jest.fn(),
    getPublicKey: jest.fn(),
  },
}));

jest.mock('../../utils/appEvents', () => ({
  __esModule: true,
  emitOrderCreatedEvent: jest.fn(),
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

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { prismaMock } from '../mocks/prisma.mock';
import * as paystackServiceModule from '../../services/paystackService';
import { createPublicOrder } from '../../controllers/publicOrderController';
import logger from '../../utils/logger';
import * as Money from '../../utils/money';
import { emitOrderCreatedEvent } from '../../utils/appEvents';
import { metaCapiService } from '../../services/metaCapiService';

const mockedLogger = logger as jest.Mocked<typeof logger>;

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

const buyer = { name: 'Ama Mensah', phoneNumber: '0241234567', address: '12 St', state: 'Greater Accra', town: 'Osu', landmark: 'Opposite the Total station' };

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
    (prismaMock.customer.findMany as any).mockResolvedValue([]);
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

  // F-405 / M0-T22: order money is major units. Only the Paystack charge is minor units.
  it('deposit checkout of 249.00 at 30% charges 7470 minor units and stores balanceDue 174.30 in major units', async () => {
    (prismaMock.checkoutForm.findFirst as any).mockResolvedValue(
      physicalForm({
        codEnabled: false,
        paystackDepositEnabled: true,
        depositPercent: 30,
        packages: [{ id: 10, name: 'Single', price: 249, quantity: 1, originalPrice: null, discountType: 'none', discountValue: 0 }],
      }),
    );
    (prismaMock.customer.findMany as any).mockResolvedValue([]);
    (prismaMock.customer.create as any).mockResolvedValue({
      id: 7, firstName: 'Ama', lastName: 'Mensah', phoneNumber: buyer.phoneNumber, email: null,
    });
    (prismaMock.formSubmission.findFirst as any).mockResolvedValue(null);
    (prismaMock.order.findFirst as any).mockResolvedValue(null);
    (prismaMock.pendingCheckout.create as any).mockResolvedValue({ id: 1 });
    (mockedPaystack.initializeTransaction as any).mockResolvedValue({
      authorization_url: 'https://paystack.co/pay/abc',
      reference: 'ref_dep',
    });

    await createPublicOrder(
      buildReq({ formData: buyer, selectedPackage: { id: 10 }, paymentMethod: 'paystack_deposit', totalAmount: 249 }),
      buildRes(),
      jest.fn(),
    );

    const data = (prismaMock.pendingCheckout.create as any).mock.calls[0][0].data;
    expect(data.paystackChargeMinor).toBe(7470);
    expect(Money.toApi(data.totalAmount)).toBe('249.00');
    expect(Money.toApi(data.balanceDue)).toBe('174.30');
    expect(Money.toApi(data.codAmount)).toBe('174.30');
    expect((mockedPaystack.initializeTransaction as any).mock.calls[0][2]).toBe(7470);
  });

  // MAN-82 synthesized-address guard: Paystack needs an email, so a blank one is
  // synthesized as `<phone>@codadminpro.com` — but that placeholder is LOCAL to the
  // Paystack init call and must never be persisted onto Customer.email, or it would
  // surface as a (bouncing) campaign recipient and damage sender reputation.
  it('synthesizes a Paystack email but never persists the @codadminpro.com placeholder onto the customer (MAN-82)', async () => {
    (prismaMock.checkoutForm.findFirst as any).mockResolvedValue(
      physicalForm({ codEnabled: false, paystackFullEnabled: true }),
    );
    (prismaMock.customer.findMany as any).mockResolvedValue([]); // new customer
    (prismaMock.customer.create as any).mockResolvedValue({
      id: 8, firstName: 'Ama', lastName: 'Mensah', phoneNumber: buyer.phoneNumber, email: null,
    });
    (prismaMock.formSubmission.findFirst as any).mockResolvedValue(null);
    (prismaMock.order.findFirst as any).mockResolvedValue(null);
    (prismaMock.pendingCheckout.create as any).mockResolvedValue({ id: 1 });
    (mockedPaystack.initializeTransaction as any).mockResolvedValue({
      authorization_url: 'https://paystack.co/pay/abc',
      reference: 'ref_xyz',
    });

    // buyer has NO email field — left blank.
    const req = buildReq({ formData: buyer, selectedPackage: { id: 10 }, paymentMethod: 'paystack_full', totalAmount: 250 });
    await createPublicOrder(req, buildRes(), jest.fn());

    // The persisted customer carries a real null email, NOT the placeholder.
    expect(prismaMock.customer.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ email: null }) }),
    );
    // But Paystack still received the synthesized address so its receipt/init works.
    expect(mockedPaystack.initializeTransaction).toHaveBeenCalledWith(
      'tenant-1',
      `${buyer.phoneNumber}@codadminpro.com`,
      expect.any(Number),
      'GHS',
      expect.any(Object),
      expect.any(String),
      expect.any(Object),
    );
  });
});

describe('publicOrderController.createPublicOrder — email linking (issue #1)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('updates a returning customer with the email typed at checkout, even when they already had a different one', async () => {
    (prismaMock.checkoutForm.findFirst as any).mockResolvedValue(physicalForm()); // COD
    (prismaMock.customer.findMany as any).mockResolvedValue([{
      id: 7, firstName: 'Ama', lastName: 'Mensah', phoneNumber: buyer.phoneNumber, email: 'old@x.com', alternatePhone: null,
    }]);
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

// Archiving a customer only flips `isActive` to false; the row keeps the phone
// number's slot in the @@unique([phoneNumber, tenantId]) index. The soft-delete
// extension hides it from reads, so the old find-then-create path found nothing,
// tried to create a duplicate, and returned a 500 — every repeat buyer whose
// record had ever been archived was permanently locked out of the checkout.
describe('publicOrderController.createPublicOrder — archived customers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  function codOrderMocks() {
    // The completed-order path calls .catch() on this, and
    // clearAllMocks() strips the module-level implementation — so it has to
    // be re-armed here or the controller throws after the order is created.
    (metaCapiService.fireCapiPurchaseEvent as any).mockResolvedValue(undefined);
    (prismaMock.checkoutForm.findFirst as any).mockResolvedValue(physicalForm());
    (prismaMock.formSubmission.findFirst as any).mockResolvedValue(null);
    (prismaMock.order.findFirst as any).mockResolvedValue(null);
    (prismaMock.order.create as any).mockResolvedValue({
      id: 55, tenantId: 'tenant-1', totalAmount: 250, status: 'pending_confirmation', orderType: 'physical',
    });
    (prismaMock.formSubmission.create as any).mockResolvedValue({ id: 1 });
  }

  it('reactivates an archived customer instead of creating a duplicate', async () => {
    codOrderMocks();
    const archived = {
      id: 7, firstName: 'Ama', lastName: 'Mensah', phoneNumber: buyer.phoneNumber,
      email: null, alternatePhone: null, isActive: false,
    };
    (prismaMock.customer.findMany as any).mockResolvedValue([archived]);
    (prismaMock.customer.update as any).mockResolvedValue({ ...archived, isActive: true });

    const res = buildRes();
    await createPublicOrder(
      buildReq({ formData: buyer, selectedPackage: { id: 10 }, paymentMethod: 'cod', totalAmount: 250 }),
      res,
      jest.fn(),
    );

    // The archived record is restored, not duplicated — a create here would hit
    // the unique constraint and 500.
    expect(prismaMock.customer.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { isActive: true },
    });
    expect(prismaMock.customer.create).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
    // order_created workflows hear about it through the event (M2-T17)
    expect(emitOrderCreatedEvent).toHaveBeenCalledWith(expect.objectContaining({ id: 55 }));
  });

  it('leaves an active customer untouched', async () => {
    codOrderMocks();
    (prismaMock.customer.findMany as any).mockResolvedValue([{
      id: 7, firstName: 'Ama', lastName: 'Mensah', phoneNumber: buyer.phoneNumber,
      email: null, alternatePhone: null, isActive: true,
    }]);

    await createPublicOrder(
      buildReq({ formData: buyer, selectedPackage: { id: 10 }, paymentMethod: 'cod', totalAmount: 250 }),
      buildRes(),
      jest.fn(),
    );

    // The order still increments the customer's totals; what must NOT happen is
    // a reactivation write against a customer who was never archived.
    expect(prismaMock.customer.update).not.toHaveBeenCalledWith({
      where: { id: 7 },
      data: { isActive: true },
    });
    expect(prismaMock.customer.create).not.toHaveBeenCalled();
  });
});

// A rejected submission is a buyer who tried to order and got nothing. These
// used to return silently, which let a tenant sit at zero orders for days with
// no signal — the log line is the fix for that, so it's asserted like behaviour.
describe('publicOrderController.createPublicOrder — rejection logging', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('logs a missing required field with the keys the form did send', async () => {
    (prismaMock.checkoutForm.findFirst as any).mockResolvedValue(
      physicalForm({ fields: [{ label: 'Delivery Address', standardKey: 'streetAddress', required: true, enabled: true }] }),
    );
    const res = buildRes();

    await createPublicOrder(
      buildReq({
        // What a form whose address field doesn't map produces: the buyer typed
        // an address, but it arrived as a custom field and `address` is empty.
        formData: {
          name: 'Ama Mensah',
          phoneNumber: '0241234567',
          state: 'Greater Accra',
          town: 'Osu',
          landmark: 'Near the post office',
          customFields: { 'Delivery Address': '12 Test Street' },
        },
        selectedPackage: { id: 10 },
        paymentMethod: 'cod',
        totalAmount: 250,
      }),
      res,
      jest.fn(),
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockedLogger.warn).toHaveBeenCalledWith(
      'Public checkout submission rejected',
      expect.objectContaining({
        slug: 'form-1',
        reason: 'Missing required field: address',
        customFieldKeys: ['Delivery Address'],
      }),
    );
  });
});

describe('publicOrderController.createPublicOrder — locationFieldsAbsent (embed Mode B)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const noLocation = { name: 'Ama Mensah', phoneNumber: '0241234567', state: 'Greater Accra', town: '' };

  it('still rejects a missing town when the flag is absent', async () => {
    (prismaMock.checkoutForm.findFirst as any).mockResolvedValue(physicalForm());
    const res = buildRes();

    await createPublicOrder(
      buildReq({ formData: noLocation, selectedPackage: { id: 10 }, paymentMethod: 'cod', totalAmount: 250 }),
      res,
      jest.fn(),
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Missing required field: town' });
  });

  it('does not demand town or landmark when locationFieldsAbsent is true', async () => {
    (prismaMock.checkoutForm.findFirst as any).mockResolvedValue(physicalForm());
    const res = buildRes();

    await createPublicOrder(
      buildReq({
        formData: noLocation,
        selectedPackage: { id: 10 },
        paymentMethod: 'cod',
        totalAmount: 250,
        locationFieldsAbsent: true,
      }),
      res,
      jest.fn(),
    ).catch(() => undefined);

    expect(res.json).not.toHaveBeenCalledWith({ error: expect.stringMatching(/Missing required field: (town|landmark)/) });
  });

  it('ignores a non-boolean locationFieldsAbsent', async () => {
    (prismaMock.checkoutForm.findFirst as any).mockResolvedValue(physicalForm());
    const res = buildRes();

    await createPublicOrder(
      buildReq({ formData: noLocation, selectedPackage: { id: 10 }, paymentMethod: 'cod', totalAmount: 250, locationFieldsAbsent: 'true' }),
      res,
      jest.fn(),
    );

    expect(res.json).toHaveBeenCalledWith({ error: 'Missing required field: town' });
  });
});
