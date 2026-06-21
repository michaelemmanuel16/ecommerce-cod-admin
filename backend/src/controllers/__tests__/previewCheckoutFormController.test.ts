import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import type { Request, Response } from 'express';
import { previewCheckoutForm } from '../checkoutFormController';
import checkoutFormService from '../../services/checkoutFormService';

jest.mock('../../services/checkoutFormService');

const mockedService = checkoutFormService as jest.Mocked<typeof checkoutFormService>;

const makeRes = () => {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const res = { status, json } as unknown as Response;
  return { res, json, status };
};

describe('previewCheckoutForm controller', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns the form payload from getCheckoutFormForPreview', async () => {
    const form = { id: 42, slug: 'magic-groove', design: {} };
    mockedService.getCheckoutFormForPreview = jest.fn<any>().mockResolvedValue(form);

    const req = {
      params: { id: '42' },
      user: { tenantId: 'tenant-abc' },
    } as unknown as Request;
    const { res, json } = makeRes();

    await previewCheckoutForm(req as any, res);

    expect(mockedService.getCheckoutFormForPreview).toHaveBeenCalledWith(42, 'tenant-abc');
    expect(json).toHaveBeenCalledWith({ form });
  });

  it('400s on a non-numeric :id', async () => {
    mockedService.getCheckoutFormForPreview = jest.fn<any>();
    const req = { params: { id: 'not-a-number' }, user: {} } as unknown as Request;
    const { res, status, json } = makeRes();

    await previewCheckoutForm(req as any, res);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({ message: 'Invalid form ID' });
    expect(mockedService.getCheckoutFormForPreview).not.toHaveBeenCalled();
  });

  it('passes null tenantId when neither req.tenantId nor req.user.tenantId is set', async () => {
    mockedService.getCheckoutFormForPreview = jest.fn<any>().mockResolvedValue({ id: 1 });
    const req = { params: { id: '1' } } as unknown as Request;
    const { res } = makeRes();

    await previewCheckoutForm(req as any, res);

    expect(mockedService.getCheckoutFormForPreview).toHaveBeenCalledWith(1, null);
  });

  it('returns 404 when the service throws a 404 AppError', async () => {
    const err: any = new Error('Checkout form not found');
    err.statusCode = 404;
    mockedService.getCheckoutFormForPreview = jest.fn<any>().mockRejectedValue(err);

    const req = { params: { id: '999' }, user: { tenantId: 't' } } as unknown as Request;
    const { res, status, json } = makeRes();

    await previewCheckoutForm(req as any, res);

    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith({ message: 'Checkout form not found' });
  });

  it('rethrows non-404 service errors so the global handler can surface them', async () => {
    const err = new Error('db down');
    mockedService.getCheckoutFormForPreview = jest.fn<any>().mockRejectedValue(err);

    const req = { params: { id: '1' }, user: { tenantId: 't' } } as unknown as Request;
    const { res } = makeRes();

    await expect(previewCheckoutForm(req as any, res)).rejects.toThrow('db down');
  });
});
