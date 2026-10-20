/**
 * M1-T21 (F-702): partner rates and timings. Throwaway tenant on the test DB.
 * Partner A: 3 delivered (one is a 3PL jump with a 10 day gap), 1 failed, 1 returned. Partner B: one open order only.
 * Zone is Africa/Accra (UTC+0).
 */
import { jest, describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { prismaBase } from '../../utils/prisma';
import { createTenant, deleteTenantRows } from './helpers/twoTenants';
import { makeCustomer, makeOrder, makeUser, KpiOrderInput } from './helpers/kpiOrders';
import { partnerRates } from '../../services/kpi/partners';
import { getStoreTimeZone, startOfDay, endOfDay } from '../../services/kpi/dates';

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const d = (iso: string) => new Date(iso);
const ZONE = getStoreTimeZone();
const RANGE = { from: startOfDay('2026-10-01', ZONE), to: endOfDay('2026-10-17', ZONE) };

let tenantId: string;
let customerId: number;
let agentA: number;
let agentB: number;
let agentC: number;

const order = async (o: Omit<KpiOrderInput, 'tenantId' | 'customerId'> & { confirmedAt?: Date; dispatchedAt?: Date; jump?: boolean }) => {
  const { confirmedAt, dispatchedAt, jump, ...rest } = o;
  const created = await makeOrder({ tenantId, customerId, createdAt: d('2026-10-05T00:00:00Z'), ...rest });
  await prismaBase.order.update({ where: { id: created.id }, data: { confirmedAt, dispatchedAt } });
  if (jump) {
    await prismaBase.orderHistory.create({
      data: { orderId: created.id, status: 'delivered', metadata: { jump: true }, actorKind: 'integration', tenantId },
    });
  }
  return created;
};

beforeAll(async () => {
  tenantId = (await createTenant('Kpi Partners')).id;
  customerId = (await makeCustomer(tenantId)).id;
  agentA = (await makeUser(tenantId, 'partner-a', 'delivery_agent')).id;
  agentB = (await makeUser(tenantId, 'partner-b', 'delivery_agent')).id;
  agentC = (await makeUser(tenantId, 'partner-c', 'delivery_agent')).id;

  const base = { deliveryAgentId: agentA, confirmedAt: d('2026-10-05T00:00:00Z') };
  // 1 day to dispatch, 2 days to deliver
  await order({ ...base, status: 'delivered', dispatchedAt: d('2026-10-06T00:00:00Z'), deliveryDate: d('2026-10-08T00:00:00Z') });
  // 2 days to dispatch, 4 days to deliver
  await order({ ...base, status: 'delivered', dispatchedAt: d('2026-10-07T00:00:00Z'), deliveryDate: d('2026-10-11T00:00:00Z') });
  // 3PL jump: 10 days and 10 days. Left out of the timings, still counted in the rate.
  await order({ ...base, status: 'delivered', jump: true, dispatchedAt: d('2026-10-15T00:00:00Z'), deliveryDate: d('2026-10-25T00:00:00Z') });
  await order({ ...base, status: 'failed_delivery', dispatchedAt: d('2026-10-06T00:00:00Z') });
  await order({ ...base, status: 'returned', dispatchedAt: d('2026-10-06T00:00:00Z'), returnedAt: d('2026-10-09T00:00:00Z') });
  // Out of scope: placed in September, digital, deleted.
  await order({ ...base, status: 'delivered', createdAt: d('2026-09-20T00:00:00Z'), deliveryDate: d('2026-09-25T00:00:00Z') });
  await order({ deliveryAgentId: agentA, status: 'digital_delivered', paymentStatus: 'paid', deliveryDate: d('2026-10-05T00:00:00Z') });
  const gone = await order({ ...base, status: 'delivered', deliveryDate: d('2026-10-06T00:00:00Z') });
  await prismaBase.order.update({ where: { id: gone.id }, data: { deletedAt: new Date() } });

  // Partner B: assigned, nothing closed yet. Partner C: no order at all.
  await order({ deliveryAgentId: agentB, status: 'out_for_delivery', confirmedAt: d('2026-10-05T00:00:00Z'), dispatchedAt: d('2026-10-05T12:00:00Z') });
});

afterAll(async () => {
  await deleteTenantRows([tenantId]);
  await prismaBase.$disconnect();
});

describe('partnerRates', () => {
  it('success rate is delivered / closed, jump order included', async () => {
    const rows = await partnerRates(tenantId, RANGE.from, RANGE.to);
    const a = rows.find((r) => r.partnerId === agentA)!;
    expect(a.assigned).toBe(5);
    expect(a.deliverySuccessRate).toMatchObject({ value: 60, unit: 'percent', dateBasis: 'cohort', formulaId: 'partner.deliverySuccess.cohort.v1' });
    expect(a.deliverySuccessRate.detail).toEqual({ delivered: 3, failed: 1, returned: 1, closed: 5 });
  });

  it('timings are medians in days and leave the jump order out', async () => {
    const a = (await partnerRates(tenantId, RANGE.from, RANGE.to)).find((r) => r.partnerId === agentA)!;
    // Without the jump: confirmed to dispatched median(1, 1 (failed), 1 (returned), 2) is 1; dispatched to delivered median(2, 4) = 3.
    // With the jump in, delivered timing would be median(2, 4, 10) = 4.
    expect(a.dispatchedToDeliveredDays.value).toBe(3);
    expect(a.dispatchedToDeliveredDays.detail).toEqual({ measured: 2 });
    expect(a.dispatchedToDeliveredDays.unit).toBe('days');
    expect(a.confirmedToDispatchedDays.value).toBe(1);
    expect(a.confirmedToDispatchedDays.detail).toEqual({ measured: 4 });
  });

  it('a partner with no closed order has a null rate; a partner with no order is not listed', async () => {
    const rows = await partnerRates(tenantId, RANGE.from, RANGE.to);
    const b = rows.find((r) => r.partnerId === agentB)!;
    expect(b.assigned).toBe(1);
    expect(b.deliverySuccessRate.value).toBeNull();
    expect(b.deliverySuccessRate.detail?.closed).toBe(0);
    expect(b.dispatchedToDeliveredDays.value).toBeNull();
    expect(rows.find((r) => r.partnerId === agentC)).toBeUndefined();
  });

  it('names come from the user row and rows are ordered by partner id', async () => {
    const rows = await partnerRates(tenantId, RANGE.from, RANGE.to);
    expect(rows.map((r) => r.partnerId)).toEqual([agentA, agentB]);
    expect(rows[0].name).toBe('partner-a T');
  });
});
