/**
 * M1-T17 (F-251, F-1008): the three named rates. Throwaway tenant on the test DB.
 * Old cohorts (March 2025) are all closed by age. Recent cohorts are placed relative to now.
 * Time zone is Africa/Accra (UTC+0), so a UTC instant reads as local time.
 */
import { jest, describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { prismaBase } from '../../utils/prisma';
import { createTenant, deleteTenantRows } from './helpers/twoTenants';
import { makeCustomer, makeOrder, makeUser, KpiOrderInput } from './helpers/kpiOrders';
import { rates, ratePercent } from '../../services/kpi/rates';
import { addDays, getStoreTimeZone, localDate, startOfDay, endOfDay } from '../../services/kpi/dates';

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const d = (iso: string) => new Date(iso);
const ZONE = getStoreTimeZone();
const range = (fromDay: string, toDay: string) => ({ from: startOfDay(fromDay, ZONE), to: endOfDay(toDay, ZONE) });

let tenantId: string;
let customerId: number;
let agentA: number;
let repA: number;

const order = (o: Omit<KpiOrderInput, 'tenantId' | 'customerId'>) => makeOrder({ tenantId, customerId, ...o });

beforeAll(async () => {
  tenantId = (await createTenant('Kpi Rates')).id;
  customerId = (await makeCustomer(tenantId)).id;
  agentA = (await makeUser(tenantId, 'agent-a', 'delivery_agent')).id;
  repA = (await makeUser(tenantId, 'rep-a', 'sales_rep')).id;

  const day1 = d('2025-03-01T12:00:00Z');
  const day2 = d('2025-03-02T12:00:00Z');
  // Day 1: 8 placed. 3 delivered (2 with agent A, 2 confirmed by rep A), 1 failed (agent A, rep A), 1 returned, 2 cancelled, 1 pending (old, so the day is closed by age).
  await order({ status: 'delivered', createdAt: day1, deliveryDate: d('2025-03-05T10:00:00Z'), deliveryAgentId: agentA, confirmedById: repA, customerRepId: repA });
  await order({ status: 'delivered', createdAt: day1, deliveryDate: d('2025-03-05T11:00:00Z'), deliveryAgentId: agentA, confirmedById: repA, customerRepId: repA });
  await order({ status: 'delivered', createdAt: day1, deliveryDate: d('2025-03-05T12:00:00Z') });
  await order({ status: 'failed_delivery', createdAt: day1, deliveryAgentId: agentA, confirmedById: repA, customerRepId: repA, history: [{ status: 'failed_delivery', at: d('2025-03-05T09:00:00Z') }] });
  await order({ status: 'returned', createdAt: day1, returnedAt: d('2025-03-09T10:00:00Z') });
  await order({ status: 'cancelled', createdAt: day1 });
  await order({ status: 'cancelled', createdAt: day1 });
  await order({ status: 'pending_confirmation', createdAt: day1 });
  // Day 2: 3 placed. 1 delivered, 1 out for delivery (open, closed by age), 1 cancelled.
  await order({ status: 'delivered', createdAt: day2, deliveryDate: d('2025-03-01T10:00:00Z') });
  await order({ status: 'out_for_delivery', createdAt: day2 });
  await order({ status: 'cancelled', createdAt: day2 });
  // Digital orders have no call and no delivery: out of every rate.
  await order({ status: 'digital_delivered', paymentStatus: 'paid', createdAt: day1, deliveryDate: day1 });
  await order({ status: 'payment_pending', createdAt: day1 });

  // Recent cohorts for the open-cohort test.
  const today = localDate(new Date(), ZONE);
  const threeAgo = localDate(addDays(new Date(), -3), ZONE);
  const oneAgo = localDate(addDays(new Date(), -1), ZONE);
  const at = (day: string) => new Date(`${day}T12:00:00Z`);
  await order({ status: 'delivered', createdAt: at(threeAgo) });
  await order({ status: 'delivered', createdAt: at(threeAgo) });
  await order({ status: 'failed_delivery', createdAt: at(threeAgo) });
  await order({ status: 'delivered', createdAt: at(oneAgo) });
  await order({ status: 'out_for_delivery', createdAt: at(oneAgo) });
  await order({ status: 'out_for_delivery', createdAt: at(oneAgo) });
  recent = { from: startOfDay(threeAgo, ZONE), to: endOfDay(today, ZONE) };
});

let recent: { from: Date; to: Date };

afterAll(async () => {
  await deleteTenantRows([tenantId]);
  await prismaBase.$disconnect();
});

const OLD = range('2025-03-01', '2025-03-02');

describe('ratePercent', () => {
  it('rounds half up to 1 decimal and is null when the denominator is 0', () => {
    expect(ratePercent(1026, 1445)).toBe(71);
    expect(ratePercent(376, 778)).toBe(48.3);
    expect(ratePercent(1, 8)).toBe(12.5);
    expect(ratePercent(0, 5)).toBe(0);
    expect(ratePercent(5, 0)).toBeNull();
  });
});

describe('confirmation rate (F-251): confirmed / placed, by order date', () => {
  it('counts placed minus pending and cancelled, digital orders out', async () => {
    const r = await rates(tenantId, OLD.from, OLD.to);
    // placed 11 (8 + 3), confirmed 7 (4 delivered, 1 failed, 1 returned, 1 out for delivery)
    expect(r.confirmationRate.detail).toEqual({ confirmed: 7, placed: 11 });
    expect(r.confirmationRate.value).toBe(63.6);
    expect(r.confirmationRate.dateBasis).toBe('createdAt');
  });

  it('is the same on the delivery basis (always by order date)', async () => {
    const r = await rates(tenantId, OLD.from, OLD.to, { basis: 'delivery' });
    expect(r.confirmationRate.value).toBe(63.6);
  });

  it('partnerId filters by delivery agent; repId by the assigned rep (customerRepId)', async () => {
    const byPartner = await rates(tenantId, OLD.from, OLD.to, { partnerId: agentA });
    expect(byPartner.confirmationRate.detail).toEqual({ confirmed: 3, placed: 3 });
    const byRep = await rates(tenantId, OLD.from, OLD.to, { repId: repA });
    expect(byRep.confirmationRate.detail).toEqual({ confirmed: 3, placed: 3 });
  });
});

describe('delivery success rate (F-251): delivered / (delivered + failed + returned)', () => {
  it('cohort basis: orders placed in the range, outcome by current status', async () => {
    const r = await rates(tenantId, OLD.from, OLD.to, { basis: 'cohort' });
    expect(r.deliverySuccessRate.detail).toEqual({ delivered: 4, failed: 1, returned: 1, closed: 6 });
    expect(r.deliverySuccessRate.value).toBe(66.7);
    expect(r.deliverySuccessRate.dateBasis).toBe('cohort');
  });

  it('is cohort by default', async () => {
    const r = await rates(tenantId, OLD.from, OLD.to);
    expect(r.deliverySuccessRate.dateBasis).toBe('cohort');
  });

  it('delivery basis: orders closed in the range (delivery date, failed history, return date)', async () => {
    const r = await rates(tenantId, startOfDay('2025-03-05', ZONE), endOfDay('2025-03-05', ZONE), { basis: 'delivery' });
    // 5 Mar: 3 delivered, 1 failed (history row). The return is on 9 Mar, the other delivery on 1 Mar.
    expect(r.deliverySuccessRate.detail).toEqual({ delivered: 3, failed: 1, returned: 0, closed: 4 });
    expect(r.deliverySuccessRate.value).toBe(75);
    expect(r.deliverySuccessRate.dateBasis).toBe('delivery');
    const march9 = await rates(tenantId, startOfDay('2025-03-09', ZONE), endOfDay('2025-03-09', ZONE), { basis: 'delivery' });
    expect(march9.deliverySuccessRate.detail).toEqual({ delivered: 0, failed: 0, returned: 1, closed: 1 });
    expect(march9.deliverySuccessRate.value).toBe(0);
  });

  it('partnerId and repId (confirmedById) filter the closed orders', async () => {
    const byPartner = await rates(tenantId, OLD.from, OLD.to, { partnerId: agentA });
    expect(byPartner.deliverySuccessRate.detail).toEqual({ delivered: 2, failed: 1, returned: 0, closed: 3 });
    expect(byPartner.deliverySuccessRate.value).toBe(66.7);
    const byRep = await rates(tenantId, OLD.from, OLD.to, { repId: repA });
    expect(byRep.deliverySuccessRate.detail).toEqual({ delivered: 2, failed: 1, returned: 0, closed: 3 });
  });
});

describe('order-to-cash yield (F-1008): delivered / placed on closed day cohorts', () => {
  it('cohorts older than 30 days are closed even with an open order in them', async () => {
    const r = await rates(tenantId, OLD.from, OLD.to);
    // 4 delivered of 11 placed; day 1 has a pending order and day 2 an out-for-delivery order, both old.
    expect(r.orderToCashYield.detail).toEqual({ delivered: 4, placed: 11, closedDays: 2, totalDays: 2 });
    expect(r.orderToCashYield.value).toBe(36.4);
    expect(r.orderToCashYield.dateBasis).toBe('cohort');
  });

  it('an open recent cohort is left out: only closed day cohorts count', async () => {
    const r = await rates(tenantId, recent.from, recent.to);
    // 3 days ago: 2 delivered + 1 failed, no open order (closed). Yesterday: 2 out for delivery (open, left out).
    expect(r.orderToCashYield.detail).toEqual({ delivered: 2, placed: 3, closedDays: 1, totalDays: 2 });
    expect(r.orderToCashYield.value).toBe(66.7);
  });

  it('is null when no cohort is closed', async () => {
    const yesterday = localDate(addDays(new Date(), -1), ZONE);
    const r = await rates(tenantId, startOfDay(yesterday, ZONE), endOfDay(yesterday, ZONE));
    expect(r.orderToCashYield.value).toBeNull();
    expect(r.orderToCashYield.detail).toMatchObject({ closedDays: 0, totalDays: 1 });
  });
});

describe('every rate', () => {
  it('is null when the denominator is 0', async () => {
    const r = await rates(tenantId, startOfDay('2024-01-01', ZONE), endOfDay('2024-01-02', ZONE));
    expect(r.confirmationRate.value).toBeNull();
    expect(r.deliverySuccessRate.value).toBeNull();
    expect(r.orderToCashYield.value).toBeNull();
    const delivery = await rates(tenantId, startOfDay('2024-01-01', ZONE), endOfDay('2024-01-02', ZONE), { basis: 'delivery' });
    expect(delivery.deliverySuccessRate.value).toBeNull();
  });

  it('carries dateBasis, a stable formulaId, unit percent and the range', async () => {
    const r = await rates(tenantId, OLD.from, OLD.to);
    for (const kpi of Object.values(r)) {
      expect(kpi.unit).toBe('percent');
      expect(['createdAt', 'cohort', 'delivery']).toContain(kpi.dateBasis);
      expect(kpi.formulaId).toMatch(/^rate\..+\.v1$/);
      expect(kpi.from).toBe(OLD.from.toISOString());
      expect(kpi.to).toBe(OLD.to.toISOString());
    }
  });

  it('the response JSON has no key named deliveryRate, fulfilmentRate, fulfillmentRate or conversionRate', async () => {
    const keys: string[] = [];
    JSON.parse(JSON.stringify(await rates(tenantId, OLD.from, OLD.to)), (k, v) => { keys.push(k); return v; });
    expect(keys.filter((k) => /^(deliveryRate|fulfilmentRate|fulfillmentRate|conversionRate)$/.test(k))).toEqual([]);
    expect(keys).toEqual(expect.arrayContaining(['confirmationRate', 'deliverySuccessRate', 'orderToCashYield']));
  });

  it('is scoped to the tenant', async () => {
    const other = await createTenant('Kpi Rates Other');
    try {
      const r = await rates(other.id, OLD.from, OLD.to);
      expect(r.confirmationRate.detail).toEqual({ confirmed: 0, placed: 0 });
    } finally {
      await deleteTenantRows([other.id]);
    }
  });
});
