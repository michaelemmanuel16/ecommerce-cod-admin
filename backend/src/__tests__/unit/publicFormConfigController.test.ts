import { describe, it, expect, beforeEach, jest } from '@jest/globals';

jest.mock('../../services/paystackService', () => ({
  paystackService: { getPublicKey: jest.fn() },
}));

jest.mock('../../services/workflowService', () => ({ __esModule: true, default: {} }));
jest.mock('../../sockets', () => ({ emitOrderCreated: jest.fn() }));
jest.mock('../../utils/socketInstance', () => ({ getSocketInstance: jest.fn() }));

jest.mock('../../services/checkoutFormService', () => ({
  __esModule: true,
  default: { getCheckoutFormConfigBySlug: jest.fn() },
}));

import * as paystackServiceModule from '../../services/paystackService';
import checkoutFormService from '../../services/checkoutFormService';
import { getPublicFormConfig } from '../../controllers/publicOrderController';

const mockedService = checkoutFormService as jest.Mocked<typeof checkoutFormService>;
const mockedPaystack = paystackServiceModule.paystackService as jest.Mocked<
  typeof paystackServiceModule.paystackService
>;

function buildReq() {
  return { params: { slug: 'form-1' }, headers: {} } as any;
}
function buildRes() {
  const res: any = { statusCode: 200, payload: null };
  res.status = jest.fn().mockImplementation((c: number) => { res.statusCode = c; return res; });
  res.json = jest.fn().mockImplementation((p: any) => { res.payload = p; return res; });
  return res;
}

describe('getPublicFormConfig — Meta CAPI secret never leaks (MAN-59)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedPaystack.getPublicKey.mockResolvedValue('pk_test_123');
  });

  it('strips metaCapiAccessToken and metaCapiTestEventCode from the public config', async () => {
    // Simulate even a regressed select that accidentally includes the secrets —
    // the controller must still scrub them.
    mockedService.getCheckoutFormConfigBySlug.mockResolvedValue({
      id: 1,
      slug: 'form-1',
      name: 'Form',
      tenantId: 'tenant-1',
      allowedOrigins: [],
      pixelConfig: { facebookPixelId: 'PIXEL123' },
      metaCapiAccessToken: 'enc:v1:super-secret',
      metaCapiTestEventCode: 'TEST99',
    } as any);

    const res = buildRes();
    await getPublicFormConfig(buildReq(), res, jest.fn());

    const serialized = JSON.stringify(res.payload);
    expect(serialized).not.toContain('metaCapiAccessToken');
    expect(serialized).not.toContain('super-secret');
    expect(serialized).not.toContain('metaCapiTestEventCode');
    expect(serialized).not.toContain('TEST99');
    // Sanity: the Paystack PUBLIC key is still present (proves we returned a config).
    expect(serialized).toContain('pk_test_123');
  });
});
