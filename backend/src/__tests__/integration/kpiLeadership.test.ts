/**
 * M1-T19 (F-253, F-205): leadership numbers. Throwaway tenants on the test DB; the fixture checks are in
 * fixtureChecks/leadership.ts. Store zone Africa/Accra = UTC+0, so UTC instants read as local times.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import '../mocks/logger.mock';
import { prismaBase } from '../../utils/prisma';
import { createTenant, deleteTenantRows } from './helpers/twoTenants';
import { makeCustomer, makeOrder, makeUser } from './helpers/kpiOrders';
import { leadership, lever } from '../../services/kpi/leadership';

const d = (iso: string) => new Date(iso);
const date = (y: number, m: number, day: number) => new Date(Date.UTC(y, m - 1, day));

let tenantId: string;
let emptyTenantId: string;
let otherTenantId: string;
let customerId: number;
let repId: number;

type TargetSpec = { scope: 'north_star' | 'quarter' | 'month'; metric: string; unit: string; start: Date; end: Date; value: number };
const target = (t: string, s: TargetSpec) =>
  prismaBase.target.create({ data: { tenantId: t, scope: s.scope, metric: s.metric, unit: s.unit, periodStart: s.start, periodEnd: s.end, value: s.value } });
const monthTarget = (t: string, y: number, m: number, value: number) =>
  target(t, { scope: 'month', metric: 'revenue', unit: 'money', start: date(y, m, 1), end: date(y, m + 1, 0), value });

beforeAll(async () => {
  const [a, empty, other] = await Promise.all([createTenant('Kpi Lead A'), createTenant('Kpi Lead Empty'), createTenant('Kpi Lead Other')]);
  tenantId = a.id;
  emptyTenantId = empty.id;
  otherTenantId = other.id;
  customerId = (await makeCustomer(tenantId)).id;
  const otherCustomer = await makeCustomer(otherTenantId);
  repId = (await makeUser(tenantId, 'rep', 'sales_rep')).id;

  // September: 4 delivered orders of 249 (one by the rep), one in October, and the month targets.
  await monthTarget(tenantId, 2026, 9, 180_000);
  await monthTarget(tenantId, 2026, 10, 180_000);
  await monthTarget(tenantId, 2027, 2, 120_000); // 28 days
  await monthTarget(tenantId, 2028, 2, 120_000); // 29 days
  for (const day of [3, 8, 12, 16]) {
    await makeOrder({ tenantId, customerId, status: 'delivered', totalAmount: 249, deliveryDate: d(`2026-09-${String(day).padStart(2, '0')}T10:00:00Z`), createdAt: d('2026-09-01T10:00:00Z'), ...(day === 3 ? { customerRepId: repId } : {}) });
  }
  await makeOrder({ tenantId, customerId, status: 'delivered', totalAmount: 249, deliveryDate: d('2026-10-05T10:00:00Z'), createdAt: d('2026-10-01T10:00:00Z') });
  // Another tenant's money must never reach this tenant.
  await makeOrder({ tenantId: otherTenantId, customerId: otherCustomer.id, status: 'delivered', totalAmount: 999_999, deliveryDate: d('2026-09-10T10:00:00Z') });
});

afterAll(async () => {
  await deleteTenantRows([tenantId, emptyTenantId, otherTenantId]);
  await prismaBase.$disconnect();
});

describe('leadership: month arithmetic (F-253)', () => {
  it('September (30 days): projection, needed a day and a different divisor than October (31 days)', async () => {
    const sep = await leadership(tenantId, '2026-09-17');
    expect(sep.daysInMonth).toBe(30);
    expect(sep.revenueSoFar.value).toBe('996.00'); // 4 x 249
    expect(sep.projectedMonth.value).toBe('1757.65'); // 996 / 17 x 30
    expect(sep.neededPerDay.value).toBe(((180_000 - 996) / 13).toFixed(2)); // 13 days left
    // planned AOV 249 (last 30 days), 70% x 60%: 180,000 / 249 / 0.42 / 30 = 57.4
    expect(sep.plannedAov.value).toBe('249.00');
    expect(sep.ordersNeededPerDay.value).toBe(57);
    expect(sep.ordersNeededPerDay.detail).toMatchObject({ daysInMonth: 30 });

    const oct = await leadership(tenantId, '2026-10-17'); // same planned AOV 249, 31 days: 55.5 -> 56
    expect(oct.daysInMonth).toBe(31);
    expect(oct.ordersNeededPerDay.value).toBe(56);
  });

  it('February uses 28 or 29 real days', async () => {
    const [feb27, feb28] = await Promise.all([leadership(tenantId, '2027-02-10'), leadership(tenantId, '2028-02-10')]);
    expect([feb27.daysInMonth, feb28.daysInMonth]).toEqual([28, 29]);
    // no orders in those months: no planned AOV, so no orders a day, but the pace uses real calendar days
    expect(feb27.pace.month.value).toBe(35.7); // 10 / 28
    expect(feb28.pace.month.value).toBe(34.5); // 10 / 29
    expect(feb27.pace.year.detail).toMatchObject({ daysGone: 41, daysInPeriod: 365 });
    expect(feb28.pace.year.detail).toMatchObject({ daysGone: 41, daysInPeriod: 366 });
  });

  it('pace marker is 100 on the last day of the month, quarter and year', async () => {
    const l = await leadership(tenantId, '2026-12-31');
    expect([l.pace.month.value, l.pace.quarter.value, l.pace.year.value]).toEqual([100, 100, 100]);
    expect(l.neededPerDay.value).toBeNull(); // no day left (and no December target)
  });

  it('needed a day is 0.00 once the month target is hit', async () => {
    const hit = await createTenant('Kpi Lead Hit');
    try {
      const c = await makeCustomer(hit.id);
      await monthTarget(hit.id, 2026, 10, 1000);
      await makeOrder({ tenantId: hit.id, customerId: c.id, status: 'delivered', totalAmount: 1500, deliveryDate: d('2026-10-05T10:00:00Z') });
      const l = await leadership(hit.id, '2026-10-10');
      expect(l.neededPerDay.value).toBe('0.00');
      expect(l.attainment.month.value).toBe(150);
    } finally {
      await deleteTenantRows([hit.id]);
    }
  });

  it('with no target: no needed a day, no orders a day, no projected percent; revenue and pace still answer', async () => {
    const l = await leadership(emptyTenantId, '2026-10-17');
    expect(l.neededPerDay.value).toBeNull();
    expect(l.ordersNeededPerDay.value).toBeNull();
    expect(l.projectedPercent.value).toBeNull();
    expect(l.attainment.month).toMatchObject({ value: null, target: null });
    expect(l.revenueSoFar.value).toBe('0.00');
    expect(l.projectedMonth.value).toBe('0.00');
    expect(l.pace.month.value).toBe(54.8);
    expect(l.plannedAov.value).toBeNull(); // no delivered orders in 30 days
    expect(l.lever.value).toBeNull();
  });

  it('never reads another tenant', async () => {
    const l = await leadership(tenantId, '2026-09-17');
    expect(JSON.stringify(l)).not.toContain('999999');
  });
});

describe('leadership: planned AOV (R12, S2)', () => {
  it('is the delivered AOV of the last 30 store days, rounded to the whole unit; the window edges are exact', async () => {
    const t = await createTenant('Kpi Lead Aov');
    try {
      const c = await makeCustomer(t.id);
      // asOf 17 Oct: window = 18 Sep 00:00 to 18 Oct 00:00
      await makeOrder({ tenantId: t.id, customerId: c.id, status: 'delivered', totalAmount: 9999, deliveryDate: d('2026-09-17T23:59:59Z') }); // out
      await makeOrder({ tenantId: t.id, customerId: c.id, status: 'delivered', totalAmount: 100, deliveryDate: d('2026-09-18T00:00:00Z') }); // in
      await makeOrder({ tenantId: t.id, customerId: c.id, status: 'delivered', totalAmount: 145, deliveryDate: d('2026-10-17T23:59:59Z') }); // in
      await makeOrder({ tenantId: t.id, customerId: c.id, status: 'delivered', totalAmount: 144.5, deliveryDate: d('2026-10-05T10:00:00Z') }); // in
      await makeOrder({ tenantId: t.id, customerId: c.id, status: 'cancelled', totalAmount: 5000, createdAt: d('2026-10-05T10:00:00Z') }); // never
      const l = await leadership(t.id, '2026-10-17');
      expect(l.plannedAov.value).toBe('130.00'); // (100 + 145 + 144.5) / 3 = 129.83
      expect(l.plannedAov.source).toBe('auto');
      expect(l.plannedAov.detail).toEqual({ deliveredOrders: 3 });
    } finally {
      await deleteTenantRows([t.id]);
    }
  });

  it('a planned_aov target overrides the default and is marked manual', async () => {
    const t = await createTenant('Kpi Lead Manual');
    try {
      const c = await makeCustomer(t.id);
      await monthTarget(t.id, 2026, 10, 180_000);
      await makeOrder({ tenantId: t.id, customerId: c.id, status: 'delivered', totalAmount: 300, deliveryDate: d('2026-10-05T10:00:00Z') });
      await target(t.id, { scope: 'north_star', metric: 'planned_aov', unit: 'money', start: date(2026, 1, 1), end: date(2026, 12, 31), value: 200 });
      await target(t.id, { scope: 'north_star', metric: 'confirmation_rate', unit: 'percent', start: date(2026, 1, 1), end: date(2026, 12, 31), value: 80 });
      const l = await leadership(t.id, '2026-10-10');
      expect(l.plannedAov).toMatchObject({ value: '200.00', source: 'manual' });
      // 180,000 / 200 / (0.80 x 0.60) / 31 = 60.5 -> 60.48
      expect(l.ordersNeededPerDay.detail).toMatchObject({ confirmationTarget: 80, successTarget: 60, exact: 60.48 });
      expect(l.ordersNeededPerDay.value).toBe(60);
    } finally {
      await deleteTenantRows([t.id]);
    }
  });
});

describe('leadership: role scope', () => {
  it('a rep scope counts only the rep orders', async () => {
    const l = await leadership(tenantId, '2026-09-17', { scope: { repId } });
    expect(l.revenueSoFar.value).toBe('249.00');
  });
});

describe('leadership: asOf', () => {
  it('rejects a day that is not on the calendar', async () => {
    await expect(leadership(tenantId, '2026-02-30')).rejects.toThrow(RangeError);
    await expect(leadership(tenantId, 'tomorrow')).rejects.toThrow(RangeError);
  });

  it('defaults to today in the store zone', async () => {
    const l = await leadership(tenantId);
    expect(l.asOfDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('lever() (F-205)', () => {
  const base = { confirmed: 1026, placed: 1445, daysGone: 17, daysInMonth: 31, successRate: 48.3, confirmationTarget: 70, successTarget: 60, aov: '245.00' };

  it('names delivery success when it has the larger gap: projected confirmed x 5 points x AOV', () => {
    const r = lever(base);
    expect(r.rate).toBe('deliverySuccessRate');
    expect(r.value).toBe('22919.03'); // 1026 / 17 x 31 = 1870.94 confirmed x 0.05 x 245
    expect(Number(r.value)).toBeGreaterThan(21_000);
    expect(Number(r.value)).toBeLessThan(24_000);
  });

  it('names confirmation when it is the rate furthest under target: projected placed x 5 points x success rate x AOV', () => {
    const r = lever({ ...base, confirmed: 722, successRate: 58 });
    expect(r.rate).toBe('confirmationRate');
    // placed 1445 / 17 x 31 = 2635.1 x 0.05 x 0.58 x 245
    expect(Number(r.value)).toBeCloseTo(2635.0 * 0.05 * 0.58 * 245, -1);
  });

  it('has no lever when every rate is at or above target, with no AOV, or with no day gone', () => {
    expect(lever({ ...base, confirmed: 1012, successRate: 60 }).value).toBeNull();
    expect(lever({ ...base, aov: null }).value).toBeNull();
    expect(lever({ ...base, daysGone: 0 }).value).toBeNull();
    expect(lever({ ...base, confirmed: 0, placed: 0, successRate: null }).rate).toBeNull();
  });
});
