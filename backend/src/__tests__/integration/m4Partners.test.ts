/**
 * M4-T36 (COD-46 part 1): the partner gaps that deliveryPartners*, deliveryProofAttempts and kpiPartners leave open.
 * Already held elsewhere: the fixture rows 926 / 376 / 402 / 148 / 48% and the row identity (deliveryPartnersFixtureApi),
 * failure reasons 402 (same file), the away partner skipped (deliveryPartnersWrite), manual assign of a blocked partner
 * (ordersMutationApi), region normalisation on order create and the review list (deliveryPartnersWrite), proof roles
 * and tenants (deliveryProofAttempts, deliveryPartnersTwoTenant).
 * Here: blocked, away and deactivated partners against the real database, a row with every kind of order, a store in
 * another country, the review list's own filters, and the proof routes with no token.
 */
import { jest, describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import '../mocks/logger.mock';
import '../mocks/socketInstance.mock';
import request from 'supertest';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { runInTenant } from '../../utils/tenantContext';
import { createTenant, deleteTenantRows, mkUser } from './helpers/twoTenants';
import { seedTenantDefaults } from '../../services/tenantDefaultsService';
import assignmentService from '../../services/assignmentService';
import { executeAction } from '../../queues/workflowQueue';
import { normalizeOrderRegion } from '../../services/regionService';
import { getRegionsForCountry } from '../../utils/regions';
import { bearer } from './helpers/superAdminToken';

jest.setTimeout(120_000);

const WIDE = 'from=2020-01-01&to=2100-01-01';
let tenantId: string;
let ngTenantId: string;
let customerId: number;
let ngCustomerId: number;
let admin: { id: number; token: string };
const P: Record<string, number> = {};

const mkPartner = (label: string, extra: Record<string, unknown> = {}) =>
  mkUser(tenantId, label, 'delivery_agent', extra).then((u) => { P[label] = u.id; return u; });
const mkOrder = (status: string, agent: number | null, extra: Record<string, unknown> = {}, tenant = tenantId, customer = customerId) =>
  prismaBase.order.create({
    data: {
      customerId: customer, status, subtotal: 10, totalAmount: 10, codAmount: 10, deliveryAddress: '1 St',
      deliveryState: 'Greater Accra', deliveryArea: 'Accra', tenantId: tenant, ...(agent ? { deliveryAgentId: agent } : {}), ...extra,
    } as any,
  }).then((o) => o.id);

beforeAll(async () => {
  tenantId = (await createTenant('M4 Partners', { currency: 'GHS' })).id;
  ngTenantId = (await createTenant('M4 Partners NG', { currency: 'NGN' })).id;
  await seedTenantDefaults(tenantId);
  await seedTenantDefaults(ngTenantId);
  const customer = (tenant: string, phone: string) => prismaBase.customer.create({
    data: { firstName: 'Ama', lastName: 'Mensah', phoneNumber: phone, address: '3 Test Rd', state: 'Greater Accra', area: 'Accra', tenantId: tenant },
  }).then((c) => c.id);
  const stamp = String(Date.now()).slice(-8);
  customerId = await customer(tenantId, `+2332${stamp}`);
  ngCustomerId = await customer(ngTenantId, `+2348${stamp}`);
  admin = await mkUser(tenantId, 'admin', 'admin');

  // Assignment pool: only "ok" may be picked.
  await mkPartner('ok');
  await mkPartner('blocked');
  await mkPartner('away', { isAvailable: false });
  await mkPartner('gone', { isActive: false });
  for (const label of ['ok', 'blocked', 'away', 'gone']) {
    await prismaBase.agentBalance.create({ data: { agentId: P[label], isBlocked: label === 'blocked', tenantId } });
  }
}, 60_000);

afterAll(async () => {
  await deleteTenantRows([tenantId, ngTenantId]);
  await prismaBase.$disconnect();
});

describe('assignment skips blocked, away and deactivated partners (real database)', () => {
  const pool = () => runInTenant(tenantId, () => assignmentService.getUsersByRole('delivery_agent'));

  // BUG: getUsersByRole('delivery_agent') filters `balance: { OR: [{ isBlocked: false }, { isBlocked: null }] }`. isBlocked is a
  // required Boolean, so Prisma rejects `isBlocked: null` ("Argument `isBlocked` is missing") and the call throws on a real database.
  // The unit test mocks Prisma and does not see it.
  it.failing('getUsersByRole returns the available partners and leaves out the blocked, away and deactivated ones', async () => {
    const ids = (await pool()).map((u) => u.id);
    expect(ids).toContain(P.ok);
    for (const label of ['blocked', 'away', 'gone']) expect([label, ids.includes(P[label])]).toEqual([label, false]);
  });

  // Same cause: selectDeliveryAgentForArea calls getUsersByRole.
  it.failing('selectDeliveryAgentForArea picks an available partner and never a blocked, away or deactivated one', async () => {
    const picked = new Set<number>();
    for (let i = 0; i < 12; i++) {
      const u = await runInTenant(tenantId, () => assignmentService.selectDeliveryAgentForArea('Accra'));
      if (u) picked.add(u.id);
    }
    expect(picked.size).toBeGreaterThan(0);
    for (const label of ['blocked', 'away', 'gone']) expect([label, picked.has(P[label])]).toEqual([label, false]);
  });

  it('a workflow assign_user action refuses a blocked partner and leaves the order alone', async () => {
    const orderId = await mkOrder('confirmed', null);
    const action = { type: 'assign_user', config: { userType: 'delivery_agent', distributionMode: 'weighted', assignments: [{ userId: P.blocked, weight: 1 }] } };
    await expect(runInTenant(tenantId, () => executeAction(action, { orderId }))).rejects.toThrow(/blocked/);
    expect((await prismaBase.order.findUniqueOrThrow({ where: { id: orderId } })).deliveryAgentId).toBeNull();
  });

  // F-709 says the away partner is skipped, and the action does skip it. A blocked partner in the same list is not skipped:
  // the weighted pick lands on it (weight 1 of 1) and the whole action throws PARTNER_BLOCKED instead of choosing "ok".
  it.failing('a workflow assign_user action skips a blocked partner and assigns the next one', async () => {
    const orderId = await mkOrder('confirmed', null);
    const action = { type: 'assign_user', config: { userType: 'delivery_agent', distributionMode: 'weighted', assignments: [{ userId: P.blocked, weight: 1 }, { userId: P.ok, weight: 0 }] } };
    await runInTenant(tenantId, () => executeAction(action, { orderId }));
    expect((await prismaBase.order.findUniqueOrThrow({ where: { id: orderId } })).deliveryAgentId).toBe(P.ok);
  });
});

describe('partner row with every kind of order', () => {
  it('delivered + failed or returned + out now = assigned; orders not yet sent out show apart; the total adds the rows', async () => {
    const mix = await mkPartner('mix');
    const solo = await mkPartner('solo');
    await prismaBase.agentBalance.create({ data: { agentId: mix.id, isBlocked: false, tenantId } });
    const now = new Date();
    for (let i = 0; i < 3; i++) await mkOrder('delivered', mix.id, { deliveryDate: now });
    for (let i = 0; i < 2; i++) await mkOrder('failed_delivery', mix.id, { failureReason: i ? 'refused' : 'not_reachable' });
    await mkOrder('returned', mix.id, { failureReason: 'refused' });
    for (let i = 0; i < 2; i++) await mkOrder('out_for_delivery', mix.id);
    await mkOrder('confirmed', mix.id);
    await mkOrder('delivered', solo.id, { deliveryDate: now });

    const res = await request(app).get(`/api/delivery-partners?${WIDE}`).set(bearer(admin.token));
    expect(res.status).toBe(200);
    const row = res.body.rows.find((r: any) => r.partnerId === mix.id);
    expect(row).toMatchObject({ assigned: 8, delivered: 3, failed: 2, returned: 1, failedOrReturned: 3, outNow: 2, notYetDispatched: 1 });
    for (const r of [...res.body.rows, res.body.total]) {
      expect([r.partnerId ?? 'total', r.delivered + r.failedOrReturned + r.outNow]).toEqual([r.partnerId ?? 'total', r.assigned]);
    }
    const sum = (k: string) => res.body.rows.reduce((s: number, r: any) => s + r[k], 0);
    for (const k of ['assigned', 'delivered', 'failedOrReturned', 'outNow']) expect([k, res.body.total[k]]).toEqual([k, sum(k)]);
  });

  it('failure reasons of the partner: failed 2 and returned 1 are counted by reason, an order with no reason is "other"', async () => {
    const mix = P.mix;
    await mkOrder('failed_delivery', mix);
    const res = await request(app).get(`/api/delivery-partners/failure-reasons?${WIDE}&partnerId=${mix}`).set(bearer(admin.token));
    expect(res.status).toBe(200);
    const by = Object.fromEntries(res.body.reasons.map((r: any) => [r.reason, r.count]));
    expect(by).toMatchObject({ not_reachable: 1, refused: 2, other: 1 });
    expect(res.body.total).toBe(4);
  });
});

describe('region normalisation (O3)', () => {
  it('every region of Ghana maps from "<name> Region", lower case and spaced, to its own name', async () => {
    const regions = getRegionsForCountry('GH');
    expect(regions.length).toBeGreaterThan(10);
    for (const r of regions) {
      for (const typed of [`${r} Region`, r.toLowerCase(), `  ${r}  `]) {
        expect([typed, await runInTenant(tenantId, () => normalizeOrderRegion(typed))]).toEqual([typed, r]);
      }
    }
  });

  it('a store in Nigeria uses the regions of Nigeria: "lagos" maps, a Ghana region is kept as typed', async () => {
    expect(getRegionsForCountry('NG')).toContain('Lagos');
    expect(await runInTenant(ngTenantId, () => normalizeOrderRegion('lagos'))).toBe('Lagos');
    expect(await runInTenant(ngTenantId, () => normalizeOrderRegion('Greater Accra Region'))).toBe('Greater Accra Region');
    expect(await runInTenant(tenantId, () => normalizeOrderRegion('lagos'))).toBe('lagos');
  });

  it('the review list leaves out a clean region, a digital order and a deleted order', async () => {
    await mkOrder('confirmed', null, { deliveryState: 'Ashanti' });
    await mkOrder('payment_pending', null, { deliveryState: 'Digital Only Place' });
    await mkOrder('digital_delivered', null, { deliveryState: 'Digital Only Place' });
    await mkOrder('confirmed', null, { deliveryState: 'Deleted Place', deletedAt: new Date() });
    await mkOrder('confirmed', null, { deliveryState: 'Kumasi Central' });
    await mkOrder('confirmed', null, { deliveryState: 'Kumasi Central' });
    const res = await request(app).get('/api/delivery-partners/region-review').set(bearer(admin.token));
    expect(res.status).toBe(200);
    const values = res.body.regions.map((r: any) => r.value);
    expect(values).not.toContain('Ashanti');
    expect(values).not.toContain('Digital Only Place');
    expect(values).not.toContain('Deleted Place');
    expect(res.body.regions.find((r: any) => r.value === 'Kumasi Central')).toMatchObject({ orders: 2, suggestion: null });
  });

  it('the review list of the Nigerian store holds its own orders only', async () => {
    await mkOrder('confirmed', null, { deliveryState: 'Lagos' }, ngTenantId, ngCustomerId);
    await mkOrder('confirmed', null, { deliveryState: 'Greater Accra' }, ngTenantId, ngCustomerId);
    const ngAdmin = await mkUser(ngTenantId, 'admin', 'admin');
    const res = await request(app).get('/api/delivery-partners/region-review').set(bearer(ngAdmin.token));
    expect(res.status).toBe(200);
    expect(res.body.regions.map((r: any) => r.value)).toEqual(['Greater Accra']);
  });
});

describe('delivery proof access with no token or a super admin', () => {
  it('no token is 401 on the proof routes', async () => {
    const orderId = await mkOrder('confirmed', P.ok);
    expect((await request(app).get(`/api/deliveries/by-order/${orderId}`)).status).toBe(401);
    expect((await request(app).get(`/api/delivery-partners/${P.ok}/order-proofs?orderIds=${orderId}`)).status).toBe(401);
  });

  it('an owner reads the proof block and the batched proofs of a partner', async () => {
    const owner = await mkUser(tenantId, 'owner', 'super_admin');
    const orderId = await mkOrder('confirmed', P.ok);
    expect((await request(app).get(`/api/deliveries/by-order/${orderId}`).set(bearer(owner.token))).status).toBe(200);
    const batch = await request(app).get(`/api/delivery-partners/${P.ok}/order-proofs?orderIds=${orderId}`).set(bearer(owner.token));
    expect(batch.status).toBe(200);
    expect(batch.body.proofs).toEqual([{ orderId, photoUrl: null, attemptCount: 0 }]);
  });
});
