import { describe, it, expect, beforeEach, jest } from '@jest/globals';

jest.mock('../../services/paystackService', () => ({
  paystackService: {
    isConfigured: jest.fn(),
  },
}));

jest.mock('../../services/checkoutFormService', () => ({
  __esModule: true,
  default: {},
  clearCheckoutFormConfigCache: jest.fn(),
}));

import { prismaMock } from '../mocks/prisma.mock';
import * as paystackServiceModule from '../../services/paystackService';
import { createCheckoutForm, updateCheckoutForm } from '../../controllers/checkoutFormController';

const mockedPaystack = paystackServiceModule.paystackService as jest.Mocked<
  typeof paystackServiceModule.paystackService
>;

function buildReq(body: any, params: any = {}) {
  return { body, params, tenantId: 'tenant-1', user: { tenantId: 'tenant-1' } } as any;
}

function buildRes() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  } as any;
}

const baseCreateBody = {
  name: 'Form',
  slug: 'form',
  productId: 1,
  fields: [],
  styling: {},
  regions: {},
};

describe('checkoutFormController — payment-method toggle validation (MAN-58)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedPaystack.isConfigured.mockResolvedValue(true);
  });

  it('rejects when all three payment methods are enabled (max two)', async () => {
    const req = buildReq({
      ...baseCreateBody,
      codEnabled: true,
      paystackDepositEnabled: true,
      paystackFullEnabled: true,
      depositPercent: 50,
    });
    const res = buildRes();

    await createCheckoutForm(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringMatching(/at most two/i) }),
    );
    expect(prismaMock.checkoutForm.findUnique).not.toHaveBeenCalled();
  });

  it('rejects when no payment method is enabled', async () => {
    const req = buildReq({
      ...baseCreateBody,
      codEnabled: false,
      paystackDepositEnabled: false,
      paystackFullEnabled: false,
    });
    const res = buildRes();

    await createCheckoutForm(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringMatching(/at least one/i) }),
    );
  });

  it('rejects a deposit method with an out-of-range deposit percent', async () => {
    const req = buildReq({
      ...baseCreateBody,
      codEnabled: false,
      paystackDepositEnabled: true,
      paystackFullEnabled: false,
      depositPercent: 0,
    });
    const res = buildRes();

    await createCheckoutForm(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringMatching(/deposit percent/i) }),
    );
    // Percent is validated before the Paystack-keys check.
    expect(mockedPaystack.isConfigured).not.toHaveBeenCalled();
  });

  it('rejects enabling a Paystack method when the tenant has no Paystack keys', async () => {
    mockedPaystack.isConfigured.mockResolvedValue(false);
    const req = buildReq({
      ...baseCreateBody,
      codEnabled: true,
      paystackFullEnabled: true,
    });
    const res = buildRes();

    await createCheckoutForm(req, res);

    expect(mockedPaystack.isConfigured).toHaveBeenCalledWith('tenant-1');
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'Paystack disabled until you add keys',
        // `message` mirrors `error` so the frontend toast surfaces the reason.
        message: 'Paystack disabled until you add keys',
        link: '/settings/integrations',
      }),
    );
  });

  it('passes validation for a valid pair with Paystack configured (proceeds to slug check)', async () => {
    (prismaMock.checkoutForm.findUnique as any).mockResolvedValue({ id: 9, slug: 'form' });
    const req = buildReq({
      ...baseCreateBody,
      codEnabled: true,
      paystackFullEnabled: true,
    });
    const res = buildRes();

    await createCheckoutForm(req, res);

    // Validation passed → reached the slug-uniqueness check, which rejects here.
    expect(prismaMock.checkoutForm.findUnique).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'Slug already exists' }),
    );
  });

  it('skips payment validation entirely when no payment fields are sent (back-compat)', async () => {
    (prismaMock.checkoutForm.findUnique as any).mockResolvedValue({ id: 9, slug: 'form' });
    const req = buildReq({ ...baseCreateBody });
    const res = buildRes();

    await createCheckoutForm(req, res);

    expect(mockedPaystack.isConfigured).not.toHaveBeenCalled();
    // Falls straight through to the slug check.
    expect(prismaMock.checkoutForm.findUnique).toHaveBeenCalled();
  });

  it('on update, validates the merged result against the existing row', async () => {
    // Existing form has COD + full enabled; the request turns on deposit too →
    // three enabled → rejected, even though the body only sends the one toggle.
    (prismaMock.checkoutForm.findUnique as any).mockResolvedValue({
      id: 5,
      slug: 'form',
      codEnabled: true,
      paystackDepositEnabled: false,
      paystackFullEnabled: true,
      depositPercent: null,
    });
    const req = buildReq({ paystackDepositEnabled: true, depositPercent: 30 }, { id: '5' });
    const res = buildRes();

    await updateCheckoutForm(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringMatching(/at most two/i) }),
    );
  });
});
