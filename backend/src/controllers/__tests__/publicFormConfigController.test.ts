import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import type { Request, Response } from 'express';
import { getPublicFormConfig } from '../publicOrderController';
import checkoutFormService from '../../services/checkoutFormService';
import { paystackService } from '../../services/paystackService';

jest.mock('../../services/checkoutFormService');
jest.mock('../../services/paystackService');

const mockedService = checkoutFormService as jest.Mocked<typeof checkoutFormService>;
const mockedPaystack = paystackService as jest.Mocked<typeof paystackService>;

const makeRes = () => {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const res = { status, json } as unknown as Response;
  return { res, json, status };
};

// A representative config-form row as returned by getCheckoutFormConfigBySlug.
const formWith = (overrides: Partial<any> = {}) => ({
  id: 7,
  slug: 'magic-groove',
  packages: [{ id: 1, name: 'Buy 1', price: 200, quantity: 1 }],
  product: { name: 'Copybook', inStock: true },
  tenantId: 'tenant-abc',
  allowedOrigins: [] as string[],
  ...overrides,
});

describe('getPublicFormConfig controller', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedPaystack.getPublicKey = jest.fn<any>().mockResolvedValue('pk_test_123');
  });

  it('returns the public form + Paystack public key, stripping tenantId and allowedOrigins', async () => {
    mockedService.getCheckoutFormConfigBySlug = jest.fn<any>().mockResolvedValue(formWith());
    const req = { params: { slug: 'magic-groove' }, headers: {} } as unknown as Request;
    const { res, json } = makeRes();
    const next = jest.fn();

    await getPublicFormConfig(req as any, res, next as any);

    expect(mockedPaystack.getPublicKey).toHaveBeenCalledWith('tenant-abc');
    const payload = (json.mock.calls[0] as any[])[0];
    expect(payload.config.paystackPublicKey).toBe('pk_test_123');
    expect(payload.config.slug).toBe('magic-groove');
    // SECURITY: server-side-only fields must never reach the host page.
    expect(payload.config.tenantId).toBeUndefined();
    expect(payload.config.allowedOrigins).toBeUndefined();
    expect(JSON.stringify(payload)).not.toContain('secret');
  });

  it('403s when the request Origin is not on a non-empty allowlist', async () => {
    mockedService.getCheckoutFormConfigBySlug = jest
      .fn<any>()
      .mockResolvedValue(formWith({ allowedOrigins: ['https://brand.com'] }));
    const req = {
      params: { slug: 'magic-groove' },
      headers: { origin: 'https://evil.com' },
    } as unknown as Request;
    const { res, status, json } = makeRes();
    const next = jest.fn();

    await getPublicFormConfig(req as any, res, next as any);

    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith({
      error: 'This domain is not allowed to embed this checkout form.',
    });
    expect(mockedPaystack.getPublicKey).not.toHaveBeenCalled();
  });

  it('allows an Origin that is on the allowlist', async () => {
    mockedService.getCheckoutFormConfigBySlug = jest
      .fn<any>()
      .mockResolvedValue(formWith({ allowedOrigins: ['https://brand.com'] }));
    const req = {
      params: { slug: 'magic-groove' },
      headers: { origin: 'https://brand.com' },
    } as unknown as Request;
    const { res, json } = makeRes();
    const next = jest.fn();

    await getPublicFormConfig(req as any, res, next as any);

    const payload = (json.mock.calls[0] as any[])[0];
    expect(payload.config.paystackPublicKey).toBe('pk_test_123');
  });

  it('allows any Origin when the allowlist is empty', async () => {
    mockedService.getCheckoutFormConfigBySlug = jest.fn<any>().mockResolvedValue(formWith());
    const req = {
      params: { slug: 'magic-groove' },
      headers: { origin: 'https://anything.com' },
    } as unknown as Request;
    const { res, json } = makeRes();
    const next = jest.fn();

    await getPublicFormConfig(req as any, res, next as any);

    const payload = (json.mock.calls[0] as any[])[0];
    expect(payload.config.slug).toBe('magic-groove');
  });

  it('does not gate requests without an Origin header even when an allowlist exists', async () => {
    mockedService.getCheckoutFormConfigBySlug = jest
      .fn<any>()
      .mockResolvedValue(formWith({ allowedOrigins: ['https://brand.com'] }));
    const req = { params: { slug: 'magic-groove' }, headers: {} } as unknown as Request;
    const { res, json, status } = makeRes();
    const next = jest.fn();

    await getPublicFormConfig(req as any, res, next as any);

    expect(status).not.toHaveBeenCalledWith(403);
    const payload = (json.mock.calls[0] as any[])[0];
    expect(payload.config.paystackPublicKey).toBe('pk_test_123');
  });

  it('returns an empty public key when the form has no tenant', async () => {
    mockedService.getCheckoutFormConfigBySlug = jest
      .fn<any>()
      .mockResolvedValue(formWith({ tenantId: null }));
    const req = { params: { slug: 'magic-groove' }, headers: {} } as unknown as Request;
    const { res, json } = makeRes();
    const next = jest.fn();

    await getPublicFormConfig(req as any, res, next as any);

    expect(mockedPaystack.getPublicKey).not.toHaveBeenCalled();
    const payload = (json.mock.calls[0] as any[])[0];
    expect(payload.config.paystackPublicKey).toBe('');
  });

  it('forwards service errors to next()', async () => {
    const err = new Error('db down');
    mockedService.getCheckoutFormConfigBySlug = jest.fn<any>().mockRejectedValue(err);
    const req = { params: { slug: 'magic-groove' }, headers: {} } as unknown as Request;
    const { res } = makeRes();
    const next = jest.fn();

    await getPublicFormConfig(req as any, res, next as any);

    expect(next).toHaveBeenCalledWith(err);
  });
});
