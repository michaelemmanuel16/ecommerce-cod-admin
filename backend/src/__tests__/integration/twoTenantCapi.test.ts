/**
 * M0-T29 (COD-7), CAPI part: the Meta CAPI payload and URL use the pixel and token of the
 * tenant that owns the order or form. The HTTP call is mocked. The unit tests in
 * unit/metaCapiService.test.ts stay as they are.
 */
import { jest, describe, it, expect, beforeAll, afterAll, afterEach } from '@jest/globals';
import { prismaBase } from '../../utils/prisma';
import { metaCapiService } from '../../services/metaCapiService';
import { createTwoTenants, asTenant, TwoTenants } from './helpers/twoTenants';

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

let pair: TwoTenants;
const realFetch = global.fetch;
let calls: Array<{ url: string; body: any }> = [];

beforeAll(async () => {
  pair = await createTwoTenants('capi');
}, 30000);

afterAll(async () => {
  global.fetch = realFetch;
  await pair.cleanup();
  await prismaBase.$disconnect();
});

// plain function: resetMocks would wipe a jest.fn implementation
const mockFetch = () => {
  calls = [];
  (global as any).fetch = async (url: string, opts: any) => {
    calls.push({ url, body: JSON.parse(opts.body) });
    return { ok: true, text: async () => '' };
  };
};

afterEach(() => {
  global.fetch = realFetch;
});

describe('metaCapiService with two tenants', () => {
  it('Purchase for each tenant order goes to that tenant pixel with that tenant token', async () => {
    mockFetch();
    const { a, b } = pair;
    await asTenant(a, () => metaCapiService.fireCapiPurchaseEvent(a.ids.order));
    await asTenant(b, () => metaCapiService.fireCapiPurchaseEvent(b.ids.order));

    expect(calls).toHaveLength(2);
    expect(calls[0].url).toContain(`/${a.pixelId}/events`);
    expect(calls[0].url).toContain(`access_token=${a.capiToken}`);
    expect(calls[0].url).not.toContain(b.pixelId);
    expect(calls[0].body.data[0].custom_data.value).toBe(Number(a.amount));
    expect(calls[1].url).toContain(`/${b.pixelId}/events`);
    expect(calls[1].url).toContain(`access_token=${b.capiToken}`);
    expect(calls[1].url).not.toContain(a.capiToken);
    expect(calls[1].body.data[0].custom_data.value).toBe(Number(b.amount));
    expect(calls[0].body.data[0].custom_data.content_ids).toEqual([a.ids.product]);
    expect(calls[1].body.data[0].custom_data.content_ids).toEqual([b.ids.product]);

    const rows = await prismaBase.order.findMany({ where: { id: { in: [a.ids.order, b.ids.order] } }, select: { capiEventFired: true } });
    expect(rows.every((r) => r.capiEventFired)).toBe(true);
  });

  it("tenant A cannot fire a Purchase for tenant B's order", async () => {
    const { a, b } = pair;
    await prismaBase.order.update({ where: { id: b.ids.order }, data: { capiEventFired: false } });
    mockFetch();
    await asTenant(a, () => metaCapiService.fireCapiPurchaseEvent(b.ids.order));

    expect(calls).toHaveLength(0);
    const row = await prismaBase.order.findUniqueOrThrow({ where: { id: b.ids.order } });
    expect(row.capiEventFired).toBe(false);
  });

  it('InitiateCheckout by form slug uses the pixel and token of the tenant that owns the form', async () => {
    const { a, b } = pair;
    mockFetch();
    const base = { fbp: 'fb.1.1.1', clientIpAddress: '203.0.113.9', clientUserAgent: 'jest' };
    await asTenant(a, () => metaCapiService.fireCapiInitiateCheckoutEvent({ slug: a.formSlug, eventId: 'e-a', ...base }));
    await asTenant(b, () => metaCapiService.fireCapiInitiateCheckoutEvent({ slug: b.formSlug, eventId: 'e-b', ...base }));

    expect(calls).toHaveLength(2);
    expect(calls[0].url).toContain(`/${a.pixelId}/events`);
    expect(calls[0].url).toContain(`access_token=${a.capiToken}`);
    expect(calls[0].body.data[0].event_id).toBe('e-a');
    expect(calls[1].url).toContain(`/${b.pixelId}/events`);
    expect(calls[1].url).toContain(`access_token=${b.capiToken}`);
  });

  it("InitiateCheckout in tenant A context with B's form slug sends nothing", async () => {
    const { a, b } = pair;
    mockFetch();
    await asTenant(a, () =>
      metaCapiService.fireCapiInitiateCheckoutEvent({ slug: b.formSlug, eventId: 'e-x', fbp: 'fb.1.1.1', clientIpAddress: '203.0.113.9', clientUserAgent: 'jest' })
    );
    expect(calls).toHaveLength(0);
  });
});
