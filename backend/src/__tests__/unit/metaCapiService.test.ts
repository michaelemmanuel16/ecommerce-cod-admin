import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { createHash } from 'crypto';

jest.mock('../../utils/logger', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

import { prismaMock } from '../mocks/prisma.mock';
import { metaCapiService } from '../../services/metaCapiService';

const sha = (v: string) => createHash('sha256').update(v).digest('hex');

const capiForm = {
  productId: 7,
  currency: 'GHS',
  country: 'Ghana',
  pixelConfig: { facebookPixelId: 'PIXEL123' },
  metaCapiAccessToken: 'token-abc', // plaintext (no PROVIDER_ENCRYPTION_KEY in tests)
  metaCapiTestEventCode: 'TEST99',
};

// The order now carries the form nested via the latest formSubmission.
const orderWith = (form: any, overrides: Record<string, unknown> = {}) => ({
  id: 42,
  totalAmount: 250,
  paymentReference: 'ref_xyz',
  capiEventFired: false,
  customer: { email: 'Ama@X.com', phoneNumber: '+233 24 123 4567', firstName: 'Ama', lastName: 'Owusu', state: 'Greater Accra', area: 'Accra' },
  formSubmissions: form ? [{ form }] : [],
  ...overrides,
});

describe('metaCapiService.fireCapiPurchaseEvent (MAN-59)', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    fetchMock = jest.fn(async () => ({ ok: true, text: async () => '' })) as any;
    (global as any).fetch = fetchMock;
    (prismaMock.order.findUnique as any).mockResolvedValue(orderWith(capiForm));
    (prismaMock.order.update as any).mockResolvedValue({});
  });

  it('POSTs a hashed Purchase event and marks the order fired', async () => {
    await metaCapiService.fireCapiPurchaseEvent(42);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0] as [string, any];
    expect(url).toContain('/PIXEL123/events');
    expect(url).toContain('access_token=token-abc');

    const body = JSON.parse(opts.body);
    const event = body.data[0];
    expect(event.event_name).toBe('Purchase');
    expect(event.event_id).toBe('ref_xyz'); // reference wins over orderId for dedup
    expect(event.custom_data).toMatchObject({ value: 250, currency: 'GHS', content_ids: [7], content_type: 'product' });
    // PII hashed SHA-256 over normalized values.
    expect(event.user_data.em).toBe(sha('ama@x.com'));
    expect(event.user_data.ph).toBe(sha('233241234567')); // digits only
    expect(event.user_data.fn).toBe(sha('ama'));
    expect(event.user_data.country).toBe(sha('gh')); // Ghana → ISO
    expect(body.test_event_code).toBe('TEST99');

    expect(prismaMock.order.update).toHaveBeenCalledWith({ where: { id: 42 }, data: { capiEventFired: true } });
  });

  it('is idempotent — skips when the order already fired', async () => {
    (prismaMock.order.findUnique as any).mockResolvedValue(orderWith(capiForm, { capiEventFired: true }));

    await metaCapiService.fireCapiPurchaseEvent(42);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(prismaMock.order.update).not.toHaveBeenCalled();
  });

  it('no-ops when the form has no CAPI token configured', async () => {
    (prismaMock.order.findUnique as any).mockResolvedValue(
      orderWith({ ...capiForm, metaCapiAccessToken: null }),
    );

    await metaCapiService.fireCapiPurchaseEvent(42);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falls back to orderId for event_id when there is no payment reference', async () => {
    (prismaMock.order.findUnique as any).mockResolvedValue(orderWith(capiForm, { paymentReference: null }));

    await metaCapiService.fireCapiPurchaseEvent(42);

    const body = JSON.parse((fetchMock.mock.calls[0] as any)[1].body);
    expect(body.data[0].event_id).toBe('42');
  });

  it('does not mark fired when Meta rejects the event (so it can retry)', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 400, text: async () => 'bad token' } as any);

    await metaCapiService.fireCapiPurchaseEvent(42);

    expect(prismaMock.order.update).not.toHaveBeenCalled();
  });

  it('never throws — a fetch error is swallowed', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'));

    await expect(metaCapiService.fireCapiPurchaseEvent(42)).resolves.toBeUndefined();
    expect(prismaMock.order.update).not.toHaveBeenCalled();
  });
});
